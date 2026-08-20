import { loadConfig } from "@repovista/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicPullRequest } from "./github.js";

const config = loadConfig({
  APP_ENV: "test",
  LOG_LEVEL: "fatal",
  MODEL_PROVIDER: "fake",
  GITHUB_API_ORIGIN: "https://api.github.test",
});

const repository = {
  owner: "acme",
  name: "demo",
  canonicalUrl: "https://github.com/acme/demo",
};

const base = "1111111111111111111111111111111111111111";
const head = "2222222222222222222222222222222222222222";

afterEach(() => vi.restoreAllMocks());

describe("fetchPublicPullRequest", () => {
  it("normalizes safe file metadata and sends the optional read-only token", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-token",
        Accept: "application/vnd.github+json",
      });
      if (url.endsWith("/pulls/7")) {
        return new Response(
          JSON.stringify({
            number: 7,
            title: "safe change",
            html_url: "https://github.com/acme/demo/pull/7",
            base: { sha: base, repo: { full_name: "acme/demo", private: false } },
            head: { sha: head },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            filename: "src/main.go",
            previous_filename: "src/old.go",
            status: "renamed",
            additions: 3,
            deletions: 1,
            patch: "@@",
          },
        ]),
        { status: 200 },
      );
    });

    const result = await fetchPublicPullRequest(
      { ...config, GITHUB_API_TOKEN: "test-token" },
      repository,
      7,
      fetcher as typeof fetch,
    );
    expect(result).toMatchObject({ number: 7, baseSha: base, headSha: head });
    expect(result.files).toEqual([
      expect.objectContaining({
        path: "src/main.go",
        oldPath: "src/old.go",
        changeType: "renamed",
        additions: 3,
        deletions: 1,
        binary: false,
      }),
    ]);
  });

  it.each([
    "../escape",
    "/absolute",
    "src//bad",
    "src/./bad",
  ])("rejects unsafe GitHub path %s", async (filename) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/pulls/7")) {
        return new Response(
          JSON.stringify({
            number: 7,
            title: "unsafe",
            html_url: "https://github.com/acme/demo/pull/7",
            base: { sha: base, repo: { full_name: "acme/demo", private: false } },
            head: { sha: head },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([{ filename, status: "modified", additions: 0, deletions: 0 }]),
        { status: 200 },
      );
    });

    await expect(
      fetchPublicPullRequest(config, repository, 7, fetcher as typeof fetch),
    ).rejects.toMatchObject({ code: "GITHUB_PULL_REQUEST_INVALID" });
  });

  it("maps a GitHub 404 to a stable not-found domain error", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      fetchPublicPullRequest(config, repository, 7, fetcher as typeof fetch),
    ).rejects.toMatchObject({
      code: "PULL_REQUEST_NOT_FOUND",
      retryable: false,
    });
  });

  it("turns network failures into retryable upstream errors", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("connection reset");
    });
    await expect(
      fetchPublicPullRequest(config, repository, 7, fetcher as typeof fetch),
    ).rejects.toMatchObject({
      code: "GITHUB_API_FAILED",
      retryable: true,
      details: { reason: "network_error" },
    });
  });
});
