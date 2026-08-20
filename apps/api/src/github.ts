import type { AppConfig } from "@repovista/config";
import type { PullRequestFileChange } from "@repovista/contracts";
import { DomainError } from "@repovista/domain";
import { z } from "zod";

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(1_000),
  html_url: z.url(),
  base: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/i),
    repo: z.object({
      full_name: z.string(),
      private: z.boolean(),
    }),
  }),
  head: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/i),
  }),
});

const pullRequestFileSchema = z.object({
  filename: z.string().min(1).max(1_000),
  previous_filename: z.string().min(1).max(1_000).optional(),
  status: z.enum(["added", "modified", "removed", "renamed", "changed", "copied"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().optional(),
});

function safeGitHubPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new DomainError("GITHUB_PULL_REQUEST_INVALID", "GitHub returned an unsafe file path.");
  }
  return normalized;
}

function githubHeaders(config: Pick<AppConfig, "GITHUB_API_TOKEN">): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "RepoVista/0.3",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(config.GITHUB_API_TOKEN ? { Authorization: `Bearer ${config.GITHUB_API_TOKEN}` } : {}),
  };
}

async function githubJson(response: Response, resource: string): Promise<unknown> {
  if (response.ok) {
    try {
      return await response.json();
    } catch {
      throw new DomainError("GITHUB_API_FAILED", `GitHub returned invalid ${resource}.`, {
        retryable: true,
        details: { status: response.status },
      });
    }
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  if (response.status === 429 || (response.status === 403 && remaining === "0")) {
    const resetSeconds = reset ? Number(reset) : Number.NaN;
    throw new DomainError("GITHUB_RATE_LIMITED", "GitHub API rate limit was exhausted.", {
      retryable: true,
      details: {
        resetAt:
          Number.isFinite(resetSeconds) && resetSeconds >= 0 && resetSeconds <= 8.64e12
            ? new Date(resetSeconds * 1_000).toISOString()
            : null,
        retryAfter: response.headers.get("retry-after"),
      },
    });
  }
  if (response.status === 404) {
    throw new DomainError(
      "PULL_REQUEST_NOT_FOUND",
      "The public GitHub pull request was not found.",
    );
  }
  throw new DomainError("GITHUB_API_FAILED", `GitHub could not load ${resource}.`, {
    retryable: response.status === 429 || response.status >= 500,
    details: { status: response.status },
  });
}

async function githubRequest(
  fetcher: typeof fetch,
  url: string,
  headers: HeadersInit,
  resource: string,
): Promise<Response> {
  try {
    return await fetcher(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new DomainError("GITHUB_API_FAILED", `GitHub could not load ${resource}.`, {
      retryable: true,
      details: {
        reason:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "timeout"
            : "network_error",
      },
    });
  }
}

export interface PublicPullRequestMetadata {
  number: number;
  title: string;
  url: string;
  baseSha: string;
  headSha: string;
  files: PullRequestFileChange[];
}

export async function fetchPublicPullRequest(
  config: Pick<AppConfig, "GITHUB_API_ORIGIN" | "GITHUB_API_TOKEN">,
  repository: { owner: string; name: string; canonicalUrl: string },
  number: number,
  fetcher: typeof fetch = fetch,
): Promise<PublicPullRequestMetadata> {
  const origin = config.GITHUB_API_ORIGIN.replace(/\/$/, "");
  const encodedOwner = encodeURIComponent(repository.owner);
  const encodedName = encodeURIComponent(repository.name);
  const headers = githubHeaders(config);
  const response = await githubRequest(
    fetcher,
    `${origin}/repos/${encodedOwner}/${encodedName}/pulls/${number}`,
    headers,
    "pull request metadata",
  );
  const parsed = pullRequestSchema.safeParse(await githubJson(response, "pull request metadata"));
  if (!parsed.success) {
    throw new DomainError(
      "GITHUB_PULL_REQUEST_INVALID",
      "GitHub returned invalid pull request metadata.",
    );
  }
  const pullRequest = parsed.data;
  if (
    pullRequest.number !== number ||
    pullRequest.base.repo.private ||
    pullRequest.base.repo.full_name.toLowerCase() !==
      `${repository.owner}/${repository.name}`.toLowerCase() ||
    pullRequest.html_url !== `${repository.canonicalUrl}/pull/${number}`
  ) {
    throw new DomainError(
      "GITHUB_PULL_REQUEST_INVALID",
      "The pull request does not belong to the selected public repository.",
    );
  }

  const files: PullRequestFileChange[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const fileResponse = await githubRequest(
      fetcher,
      `${origin}/repos/${encodedOwner}/${encodedName}/pulls/${number}/files?per_page=100&page=${page}`,
      headers,
      "pull request files",
    );
    const filePayload = await githubJson(fileResponse, "pull request files");
    const parsedFiles = z.array(pullRequestFileSchema).safeParse(filePayload);
    if (!parsedFiles.success) {
      throw new DomainError(
        "GITHUB_PULL_REQUEST_INVALID",
        "GitHub returned invalid pull request files.",
      );
    }
    for (const item of parsedFiles.data) {
      files.push({
        path: safeGitHubPath(item.filename),
        oldPath: item.previous_filename ? safeGitHubPath(item.previous_filename) : null,
        changeType:
          item.status === "removed"
            ? "deleted"
            : item.status === "renamed"
              ? "renamed"
              : item.status === "added" || item.status === "copied"
                ? "added"
                : "modified",
        baseBlobHash: null,
        headBlobHash: null,
        additions: item.additions,
        deletions: item.deletions,
        binary: item.patch === undefined && item.additions === 0 && item.deletions === 0,
      });
    }
    const link = fileResponse.headers.get("link");
    const hasNextPage = link ? /<[^>]+>;\s*rel="next"/.test(link) : parsedFiles.data.length === 100;
    if (!hasNextPage) break;
    if (page === 5) {
      throw new DomainError(
        "PULL_REQUEST_TOO_LARGE",
        "Pull requests changing more than 500 files are not supported.",
      );
    }
  }
  return {
    number,
    title: pullRequest.title,
    url: pullRequest.html_url,
    baseSha: pullRequest.base.sha.toLowerCase(),
    headSha: pullRequest.head.sha.toLowerCase(),
    files,
  };
}
