import { describe, expect, it, vi } from "vitest";
import { ApiError, RepoVistaClient } from "./api-client.js";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";

function jsonResponse(payload: unknown, status = 200, requestId = "request-1"): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
    status,
  });
}

describe("RepoVistaClient", () => {
  it("posts repository imports and validates the response contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: { repositoryId, snapshotId, jobId, status: "queued" },
        meta: { requestId: "request-1" },
      }),
    );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000/",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(
      client.createRepository({
        url: "https://github.com/acme/demo",
        ref: "main",
        ignore: ["dist"],
      }),
    ).resolves.toEqual({ repositoryId, snapshotId, jobId, status: "queued" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://localhost:4000/v1/repositories",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect((request.headers as Headers).get("User-Agent")).toBe("RepoVista-CLI/0.4.0");
    expect(JSON.parse(String(request.body))).toEqual({
      url: "https://github.com/acme/demo",
      ref: "main",
      ignore: ["dist"],
    });
  });

  it("surfaces structured API failures with their request ID", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "SNAPSHOT_NOT_READY",
            message: "The snapshot is still indexing.",
            requestId: "request-failure",
            retryable: true,
          },
        },
        409,
        "request-failure",
      ),
    );
    const client = new RepoVistaClient({
      apiUrl: "https://repovista.example",
      fetch: fetchImplementation as typeof fetch,
    });

    const error = await client.getSnapshot(snapshotId).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "SNAPSHOT_NOT_READY",
      requestId: "request-failure",
      retryable: true,
      status: 409,
    });
  });

  it("rejects successful responses that drift from the shared contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: { id: jobId, status: "mystery" },
        meta: { requestId: "request-drift" },
      }),
    );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(client.getJob(jobId)).rejects.toMatchObject({
      code: "API_RESPONSE_INVALID",
      requestId: "request-drift",
    });
  });

  it("validates API origins before making a network request", () => {
    expect(() => new RepoVistaClient({ apiUrl: "file:///tmp/api" })).toThrowError(
      expect.objectContaining({ code: "API_URL_INVALID" }),
    );
  });
});
