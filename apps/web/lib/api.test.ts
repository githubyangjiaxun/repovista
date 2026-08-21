// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, fetchSnapshotExport, setApiCsrfToken } from "./api";

function success(data: unknown, status = 200): Response {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify({ data, meta: { requestId: "request-web" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
}

describe("web API client", () => {
  beforeEach(() => {
    setApiCsrfToken(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    setApiCsrfToken(null);
    vi.unstubAllGlobals();
  });

  it("always includes browser credentials and adds CSRF only to mutations", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => success({ ok: true }));
    setApiCsrfToken("csrf_test_abcdefghijklmnopqrstuvwxyz0123456789");

    await apiFetch("/v1/repositories", { headers: { "X-Test": "yes" } });
    await apiFetch("/v1/repositories", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/acme/demo" }),
      headers: { "X-RepoVista-CSRF": "caller-cannot-replace-session-token" },
    });

    const read = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const readHeaders = read.headers as Headers;
    expect(read.credentials).toBe("include");
    expect(readHeaders.get("X-Test")).toBe("yes");
    expect(readHeaders.has("X-RepoVista-CSRF")).toBe(false);

    const mutation = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const mutationHeaders = mutation.headers as Headers;
    expect(mutation.credentials).toBe("include");
    expect(mutationHeaders.get("Content-Type")).toBe("application/json");
    expect(mutationHeaders.get("X-RepoVista-CSRF")).toBe(
      "csrf_test_abcdefghijklmnopqrstuvwxyz0123456789",
    );
  });

  it("accepts successful empty mutation responses", async () => {
    vi.mocked(fetch).mockResolvedValue(success(undefined, 204));

    await expect(apiFetch<void>("/v1/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("fetches exports with credentials and preserves the server filename", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response("# private report", {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="private-report.md"',
          "Content-Type": "text/markdown; charset=utf-8",
        },
      }),
    );

    const result = await fetchSnapshotExport("snapshot-private", "markdown");

    expect(result.filename).toBe("private-report.md");
    await expect(result.blob.text()).resolves.toBe("# private report");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/snapshots/snapshot-private/exports/markdown",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "text/markdown" },
      }),
    );
  });

  it("surfaces structured export failures and request IDs", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "WORKSPACE_FORBIDDEN",
            message: "You cannot access this private snapshot.",
            requestId: "export-denied",
            retryable: false,
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(fetchSnapshotExport("snapshot-private", "svg")).rejects.toMatchObject({
      code: "WORKSPACE_FORBIDDEN",
      requestId: "export-denied",
      message: "You cannot access this private snapshot.",
    });
  });
});
