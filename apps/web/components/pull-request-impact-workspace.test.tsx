// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestAnalysis,
  PullRequestImpact,
  PullRequestImpactResponse,
  RepositorySummary,
} from "@/lib/api";
import { PullRequestImpactWorkspace } from "./pull-request-impact-workspace";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const analysisId = "01900000-0000-7000-8000-000000000002";
const nextAnalysisId = "01900000-0000-7000-8000-000000000003";
const baseSnapshotId = "01900000-0000-7000-8000-000000000004";
const headSnapshotId = "01900000-0000-7000-8000-000000000005";
const fileId = "01900000-0000-7000-8000-000000000006";
const symbolId = "01900000-0000-7000-8000-000000000007";
const baseSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";

const repository: RepositorySummary = {
  id: repositoryId,
  owner: "acme",
  name: "signal-hub",
  canonicalUrl: "https://github.com/acme/signal-hub",
  defaultBranch: "main",
  latestSnapshotId: headSnapshotId,
  latestSnapshotStatus: "ready",
  latestCommitSha: headSha,
  autoUpdateEnabled: false,
  lastWebhookAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function analysis(overrides: Partial<PullRequestAnalysis> = {}): PullRequestAnalysis {
  return {
    id: analysisId,
    repositoryId,
    prNumber: 42,
    title: "Keep impact evidence fixed to the head commit",
    url: "https://github.com/acme/signal-hub/pull/42",
    baseSha,
    headSha,
    baseSnapshotId,
    headSnapshotId,
    parserVersion: "tree-sitter-ts-js-py-go-v1",
    algorithmVersion: "reverse-bfs-v1",
    revision: 1,
    status: "ready",
    progress: 1,
    stats: {
      changedFiles: 2,
      changedSymbols: 2,
      directImpacts: 1,
      transitiveImpacts: 1,
      unknownImpacts: 1,
      truncated: true,
    },
    failure: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:03.000Z",
    completedAt: "2026-01-01T00:00:03.000Z",
    ...overrides,
  };
}

function impact(overrides: Partial<PullRequestImpact> = {}): PullRequestImpact {
  return {
    id: "01900000-0000-7000-8000-000000000010",
    analysisId,
    side: "head",
    symbolId,
    stableKey: "function:src/api.ts:createServer",
    path: "src/api.ts",
    name: "createServer",
    kind: "function",
    startLine: 10,
    endLine: 24,
    impactType: "direct",
    distance: 1,
    riskScore: 0.91,
    riskLevel: "critical",
    riskBreakdown: {
      changedSymbolWeight: 1,
      reverseFanInWeight: 0.8,
      publicApiWeight: 0.9,
      languageWeight: 0.5,
    },
    truncated: false,
    paths: [
      {
        ordinal: 0,
        fromSymbolId: symbolId,
        toSymbolId: symbolId,
        fromPath: "src/router.ts",
        toPath: "src/api.ts",
        relationType: "calls",
        confidence: 0.98,
        evidenceId: "impact-evidence-1",
      },
    ],
    evidence: [
      {
        id: "impact-evidence-1",
        snapshotId: headSnapshotId,
        commitSha: headSha,
        fileId,
        symbolId,
        path: "src/api.ts",
        startLine: 10,
        endLine: 24,
        quote: "export function createServer() { return buildRouter(); }",
        contentHash: "sha256:evidence",
        relationType: "calls",
        algorithmVersion: "reverse-bfs-v1",
      },
    ],
    ...overrides,
  };
}

const unknownImpact = impact({
  id: "01900000-0000-7000-8000-000000000011",
  symbolId: null,
  stableKey: "unknown:generated/client.go",
  path: "generated/client.go",
  name: "GeneratedClient",
  kind: "unknown",
  startLine: 1,
  endLine: 1,
  impactType: "unknown",
  distance: 0,
  riskScore: 0.18,
  riskLevel: "low",
  riskBreakdown: {
    changedSymbolWeight: 0.2,
    reverseFanInWeight: 0,
    publicApiWeight: 0,
    languageWeight: 0.5,
  },
  paths: [],
  evidence: [],
});

const transitiveImpact = impact({
  id: "01900000-0000-7000-8000-000000000012",
  stableKey: "method:src/worker.ts:Worker.run",
  path: "src/worker.ts",
  name: "Worker.run",
  impactType: "transitive",
  distance: 2,
  riskScore: 0.58,
  riskLevel: "medium",
  evidence: [],
});

function impactPage(overrides: Partial<PullRequestImpactResponse> = {}): PullRequestImpactResponse {
  return {
    analysis: analysis(),
    files: [
      {
        path: "src/api.ts",
        oldPath: null,
        changeType: "modified",
        baseBlobHash: "sha256:base",
        headBlobHash: "sha256:head",
        additions: 9,
        deletions: 2,
        binary: false,
      },
      {
        path: "generated/client.go",
        oldPath: null,
        changeType: "added",
        baseBlobHash: null,
        headBlobHash: "sha256:generated",
        additions: 30,
        deletions: 0,
        binary: false,
      },
    ],
    symbols: [
      {
        id: "symbol-change-1",
        side: "head",
        symbolId,
        stableKey: "function:src/api.ts:createServer",
        path: "src/api.ts",
        name: "createServer",
        kind: "function",
        startLine: 10,
        endLine: 24,
        changeType: "modified",
      },
    ],
    impacts: [impact(), unknownImpact, transitiveImpact],
    nextCursor: null,
    ...overrides,
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "web-test" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "TEST_FAILURE",
        message,
        requestId: "web-test-failure",
        retryable: true,
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function installApi(
  options: {
    current?: PullRequestAnalysis;
    page?: PullRequestImpactResponse;
    nextPage?: PullRequestImpactResponse;
    repositoryResponse?: Response;
    rerun?: PullRequestAnalysis;
  } = {},
) {
  const current = options.current ?? analysis();
  const page = options.page ?? impactPage({ analysis: current });
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === `/v1/repositories/${repositoryId}`) {
      return options.repositoryResponse ?? response(repository);
    }
    if (method === "GET" && url.pathname === `/v1/pull-request-analyses/${analysisId}`) {
      return response(current);
    }
    if (method === "GET" && url.pathname === `/v1/pull-request-analyses/${nextAnalysisId}`) {
      return response(
        options.rerun ??
          analysis({ id: nextAnalysisId, revision: 2, status: "queued", progress: 0 }),
      );
    }
    if (method === "GET" && url.pathname === `/v1/pull-request-analyses/${analysisId}/impact`) {
      return response(url.searchParams.has("cursor") ? (options.nextPage ?? page) : page);
    }
    if (method === "POST" && url.pathname === `/v1/pull-request-analyses/${analysisId}/rerun`) {
      return response(
        {
          analysisId: nextAnalysisId,
          jobId: "01900000-0000-7000-8000-000000000099",
          revision: 2,
          status: "queued",
        },
        202,
      );
    }
    throw new Error(`Unexpected API request: ${method} ${url.pathname}${url.search}`);
  });
  return fetchMock;
}

describe("PullRequestImpactWorkspace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders queued progress without presenting speculative impact", async () => {
    installApi({ current: analysis({ status: "queued", progress: 0.25, completedAt: null }) });

    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Analysis in progress" })).toBeVisible();
    expect(screen.getAllByText("Waiting for immutable base and head snapshots.")).toHaveLength(2);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.queryByRole("region", { name: "Pull request impacts" })).not.toBeInTheDocument();
  });

  it("filters ready results and opens commit-fixed evidence links", async () => {
    installApi();
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    expect(await screen.findByRole("heading", { name: analysis().title })).toBeVisible();
    expect(screen.getByText(/Static traversal reached its safety limit/)).toBeVisible();
    expect(screen.getByText("3 visible impacts")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Risk"), { target: { value: "critical" } });
    expect(screen.getByText("1 visible impacts")).toBeVisible();
    expect(screen.getByText("createServer")).toBeVisible();
    expect(screen.queryByText("GeneratedClient")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Risk"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Impact type"), { target: { value: "transitive" } });
    expect(screen.getByText("Worker.run")).toBeVisible();
    expect(screen.queryByText("createServer")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Impact type"), { target: { value: "all" } });
    fireEvent.change(screen.getByPlaceholderText("Filter symbol or path"), {
      target: { value: "src/api" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inspect createServer evidence" }));

    const drawer = screen.getByRole("complementary", { name: "Fixed impact evidence" });
    expect(within(drawer).getByText(headSnapshotId)).toBeVisible();
    expect(within(drawer).getByText(headSha)).toBeVisible();
    expect(within(drawer).getByText(/export function createServer/)).toBeVisible();
    expect(within(drawer).getByRole("link", { name: "Open in VS Code" })).toHaveAttribute(
      "href",
      expect.stringContaining(
        `repositoryId=${repositoryId}&snapshotId=${headSnapshotId}&commitSha=${headSha}`,
      ),
    );
    expect(within(drawer).getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      `https://github.com/acme/signal-hub/blob/${headSha}/src/api.ts#L10-L24`,
    );
  });

  it("explains unknown evidence instead of inventing a source range", async () => {
    installApi();
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Inspect GeneratedClient evidence" }),
    );
    expect(screen.getByText(/could not prove a fixed source range.*marked unknown/i)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open in VS Code" })).not.toBeInTheDocument();
  });

  it("appends the next stable cursor page", async () => {
    const paged = impactPage({ impacts: [impact()], nextCursor: "stable-cursor" });
    const nextPage = impactPage({ impacts: [transitiveImpact], nextCursor: null });
    const fetchMock = installApi({ page: paged, nextPage });
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Load next 50 impacts" }));
    expect(await screen.findByText("Worker.run")).toBeVisible();
    expect(screen.getByText("2 visible impacts")).toBeVisible();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=stable-cursor"))).toBe(
      true,
    );
  });

  it("clears old results and switches to a new immutable revision", async () => {
    installApi();
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New revision" }));

    expect(await screen.findByText("Pull request impact · revision 2")).toBeVisible();
    expect(screen.getAllByText("Waiting for immutable base and head snapshots.")).toHaveLength(2);
    expect(screen.queryByText("createServer")).not.toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      `/repositories/${repositoryId}/pull-requests/42?analysisId=${nextAnalysisId}`,
    );
  });

  it("rejects an analysis that belongs to another repository", async () => {
    installApi({ current: analysis({ repositoryId: "01900000-0000-7000-8000-999999999999" }) });
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Impact workspace unavailable" }),
    ).toBeVisible();
    expect(screen.getByText(/does not belong to the selected repository and PR/)).toBeVisible();
  });

  it("preserves structured API failure request IDs", async () => {
    installApi({ repositoryResponse: failure("GitHub rate limit exhausted.", 429) });
    render(
      <PullRequestImpactWorkspace
        initialAnalysisId={analysisId}
        prNumber={42}
        repositoryId={repositoryId}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Impact workspace unavailable" }),
    ).toBeVisible();
    expect(screen.getByText(/GitHub rate limit exhausted.*web-test-failure/)).toBeVisible();
  });
});
