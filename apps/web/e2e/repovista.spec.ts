import { readFile } from "node:fs/promises";
import { type BrowserContext, expect, type Locator, type Route, test } from "@playwright/test";
import type { EmbeddingIndex, RetrievalMode, SearchResult } from "@repovista/contracts";

const apiOrigin = "http://localhost:4000";
const webOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const fileId = "01900000-0000-7000-8000-000000000004";
const symbolId = "01900000-0000-7000-8000-000000000005";
const messageId = "01900000-0000-7000-8000-000000000006";
const baseSnapshotId = "01900000-0000-7000-8000-000000000008";
const prAnalysisId = "01900000-0000-7000-8000-000000000010";
const prImpactId = "01900000-0000-7000-8000-000000000011";
const prUnknownImpactId = "01900000-0000-7000-8000-000000000012";
const prBaseSnapshotId = "01900000-0000-7000-8000-000000000013";
const prHeadSnapshotId = "01900000-0000-7000-8000-000000000014";
const baseCommitSha = "fedcba9876543210fedcba9876543210fedcba98";
const prBaseCommitSha = "1111111111111111111111111111111111111111";
const prHeadCommitSha = "2222222222222222222222222222222222222222";

const repository = {
  id: repositoryId,
  owner: "acme",
  name: "signal-hub",
  canonicalUrl: "https://github.com/acme/signal-hub",
  defaultBranch: "main",
  latestSnapshotId: snapshotId,
  latestSnapshotStatus: "ready",
  latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
  autoUpdateEnabled: true,
  lastWebhookAt: "2026-01-01T00:00:02.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:03.000Z",
};

const snapshot = {
  id: snapshotId,
  repositoryId,
  commitSha: repository.latestCommitSha,
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-ts-js-py-v1",
  stats: {
    files: 3,
    symbols: 6,
    edges: 5,
    languages: { python: 1, typescript: 2 },
    warnings: 0,
    indexing: {
      mode: "incremental",
      baseSnapshotId,
      baseCommitSha,
      scannedFiles: 3,
      changedFiles: 2,
      reusedFiles: 1,
      parsedFiles: 2,
      deletedFiles: 1,
    },
  },
  baseSnapshotId,
  indexMode: "incremental",
  treeHash: "sha256:tree",
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:03.000Z",
  failure: null,
};

const files = [
  {
    id: fileId,
    path: "src/server.ts",
    language: "typescript",
    byteSize: 480,
    lineCount: 14,
    blobHash: "sha256:server",
    parseStatus: "parsed",
  },
  {
    id: "01900000-0000-7000-8000-000000000007",
    path: "src/router.ts",
    language: "typescript",
    byteSize: 240,
    lineCount: 8,
    blobHash: "sha256:router",
    parseStatus: "parsed",
  },
  {
    id: "01900000-0000-7000-8000-000000000009",
    path: "src/worker.py",
    language: "python",
    byteSize: 180,
    lineCount: 7,
    blobHash: "sha256:worker",
    parseStatus: "parsed",
  },
];

const sourceLines = [
  'import { createRouter } from "./router.js";',
  "",
  "export async function start() {",
  "  const app = createRouter();",
  "  await app.registerRoutes();",
  "  await app.loadConfig();",
  "  await app.connectDatabase();",
  "  await app.prepare();",
  "  const host = process.env.HOST ?? '127.0.0.1';",
  "  await app.listen({ port: 4000, host });",
  "  return app;",
  "}",
  "",
  "void start();",
];

function embeddingIndex(status: "queued" | "running" | "ready"): EmbeddingIndex {
  const embeddedChunks = status === "queued" ? 0 : status === "running" ? 7 : 12;
  return {
    id: "01900000-0000-7000-8000-000000000015",
    snapshotId,
    provider: "ollama",
    model: "nomic-embed-text",
    inputVersion: "code-chunk-v1",
    status,
    dimensions: status === "ready" ? 768 : null,
    totalChunks: 12,
    embeddedChunks,
    revision: 1,
    jobId,
    failure: null,
    createdAt: "2026-01-01T00:00:03.000Z",
    updatedAt: "2026-01-01T00:00:04.000Z",
    readyAt: status === "ready" ? "2026-01-01T00:00:05.000Z" : null,
  };
}

function retrievalStatus(status: "missing" | "queued" | "running" | "ready") {
  const index = status === "missing" ? null : embeddingIndex(status);
  return {
    snapshotId,
    text: { ready: true, reason: null },
    symbol: { ready: true, reason: null },
    semantic: {
      configured: true,
      queryable: status === "ready",
      reason: status === "missing" ? "index_missing" : status === "ready" ? null : "index_building",
      currentIndex: index,
      latestIndex: index,
    },
  };
}

function searchResult(query: string, mode: RetrievalMode): SearchResult {
  const semanticUsed = mode === "semantic" || mode === "hybrid";
  const channels: SearchResult["trace"]["usedChannels"] =
    mode === "text"
      ? ["text"]
      : mode === "semantic"
        ? ["semantic"]
        : ["text", "symbol", "semantic"];
  return {
    query,
    trace: {
      requestedMode: mode,
      usedChannels: channels,
      degraded: false,
      degradationReason: null,
      channels: [
        {
          channel: "text",
          status: channels.includes("text") ? "used" : "skipped",
          candidateCount: channels.includes("text") ? 2 : 0,
          reason: null,
          latencyMs: channels.includes("text") ? 2 : null,
        },
        {
          channel: "symbol",
          status: channels.includes("symbol") ? "used" : "skipped",
          candidateCount: channels.includes("symbol") ? 1 : 0,
          reason: null,
          latencyMs: channels.includes("symbol") ? 1 : null,
        },
        {
          channel: "semantic",
          status: semanticUsed ? "used" : "skipped",
          candidateCount: semanticUsed ? 3 : 0,
          reason: null,
          latencyMs: semanticUsed ? 8 : null,
        },
      ],
      embeddingIndex: semanticUsed ? embeddingIndex("ready") : null,
    },
    results: [
      {
        id: "evidence-search-1",
        snapshotId,
        commitSha: repository.latestCommitSha,
        fileId,
        path: "src/server.ts",
        symbolId,
        symbol: "start",
        startLine: 3,
        endLine: 10,
        content: sourceLines.slice(2, 10).join("\n"),
        contentHash: "sha256:search-evidence",
        score: 0.0322,
        signals: channels.map((channel, index) => ({
          channel,
          rank: index + 1,
          rawScore: 0.93 - index * 0.1,
        })),
      },
    ],
  };
}

interface MockState {
  embeddingRequests: number;
  embeddingStatusReads: number;
  exportRequests: string[];
  importRequests: unknown[];
  jobRequests: number;
  mapLevels: string[];
  prAnalysisPolls: number;
  prAnalysisRequests: unknown[];
  questions: unknown[];
  retrievalStatusRequests: number;
  searchRequests: URLSearchParams[];
  shareRequests: unknown[];
}

function graph(level: string) {
  const nodes =
    level === "package"
      ? [
          {
            id: "package:src",
            level: "package",
            kind: "package",
            label: "src",
            path: "src/server.ts",
            range: null,
            importance: 1,
            metadata: {},
          },
        ]
      : [
          {
            id: "file:server",
            level,
            kind: level === "symbol" ? "function" : "file",
            label: level === "symbol" ? "start" : "server.ts",
            path: "src/server.ts",
            range: { startLine: 3, endLine: 12 },
            importance: 1,
            metadata: {},
          },
          {
            id: "file:router",
            level,
            kind: level === "symbol" ? "function" : "file",
            label: level === "symbol" ? "createRouter" : "router.ts",
            path: "src/router.ts",
            range: { startLine: 1, endLine: 8 },
            importance: 0.8,
            metadata: {},
          },
        ];
  return {
    snapshot: {
      id: snapshotId,
      commitSha: repository.latestCommitSha,
      parserVersion: snapshot.parserVersion,
    },
    level,
    nodes,
    edges:
      nodes.length > 1
        ? [
            {
              id: "edge:server-router",
              from: nodes[0]?.id,
              to: nodes[1]?.id,
              type: "imports",
              confidence: 1,
            },
          ]
        : [],
    truncated: false,
  };
}

function pullRequestAnalysis(status: "queued" | "ready") {
  return {
    id: prAnalysisId,
    repositoryId,
    prNumber: 42,
    title: "Keep impact evidence fixed to immutable commits",
    url: "https://github.com/acme/signal-hub/pull/42",
    baseSha: prBaseCommitSha,
    headSha: prHeadCommitSha,
    baseSnapshotId: prBaseSnapshotId,
    headSnapshotId: prHeadSnapshotId,
    parserVersion: "tree-sitter-ts-js-py-go-v1",
    algorithmVersion: "reverse-bfs-v1",
    revision: 1,
    status,
    progress: status === "ready" ? 1 : 0.48,
    stats: {
      changedFiles: 2,
      changedSymbols: 2,
      directImpacts: 1,
      transitiveImpacts: 0,
      unknownImpacts: 1,
      truncated: true,
    },
    failure: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: status === "ready" ? "2026-01-01T00:00:04.000Z" : "2026-01-01T00:00:02.000Z",
    completedAt: status === "ready" ? "2026-01-01T00:00:04.000Z" : null,
  };
}

function pullRequestImpact() {
  return {
    analysis: pullRequestAnalysis("ready"),
    files: [
      {
        path: "src/api.ts",
        oldPath: null,
        changeType: "modified",
        baseBlobHash: "sha256:base-api",
        headBlobHash: "sha256:head-api",
        additions: 12,
        deletions: 4,
        binary: false,
      },
      {
        path: "generated/client.go",
        oldPath: null,
        changeType: "added",
        baseBlobHash: null,
        headBlobHash: "sha256:client",
        additions: 24,
        deletions: 0,
        binary: false,
      },
    ],
    symbols: [
      {
        id: "symbol-change-e2e",
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
    impacts: [
      {
        id: prImpactId,
        analysisId: prAnalysisId,
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
        riskScore: 0.92,
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
            evidenceId: "e2e-impact-evidence",
          },
        ],
        evidence: [
          {
            id: "e2e-impact-evidence",
            snapshotId: prHeadSnapshotId,
            commitSha: prHeadCommitSha,
            fileId,
            symbolId,
            path: "src/api.ts",
            startLine: 10,
            endLine: 24,
            quote: "export function createServer() { return buildRouter(); }",
            contentHash: "sha256:impact-evidence",
            relationType: "calls",
            algorithmVersion: "reverse-bfs-v1",
          },
        ],
      },
      {
        id: prUnknownImpactId,
        analysisId: prAnalysisId,
        side: "head",
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
        truncated: true,
        paths: [],
        evidence: [],
      },
    ],
    nextCursor: null,
  };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": webOrigin,
    Vary: "Origin",
  };
}

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data, meta: { requestId: "e2e-request" } }),
    headers: corsHeaders(),
    status,
    contentType: "application/json",
  });
}

async function installMockApi(
  context: BrowserContext,
  options: { importFailure?: boolean; semanticUnavailable?: boolean } = {},
): Promise<MockState> {
  const state: MockState = {
    embeddingRequests: 0,
    embeddingStatusReads: 0,
    exportRequests: [],
    importRequests: [],
    jobRequests: 0,
    mapLevels: [],
    prAnalysisPolls: 0,
    prAnalysisRequests: [],
    questions: [],
    retrievalStatusRequests: 0,
    searchRequests: [],
    shareRequests: [],
  };

  await context.route(`${apiOrigin}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders(), status: 204 });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/v1/repositories") {
      state.importRequests.push(request.postDataJSON());
      if (options.importFailure) {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: "REPOSITORY_HOST_NOT_ALLOWED",
              message: "This Git host is not enabled by the server.",
              requestId: "e2e-import-failure",
              retryable: false,
            },
          }),
          headers: corsHeaders(),
          status: 400,
          contentType: "application/json",
        });
      } else {
        await json(route, { repositoryId, snapshotId, jobId, status: "queued" }, 202);
      }
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/jobs/${jobId}`) {
      state.jobRequests += 1;
      const succeeded = state.jobRequests > 2;
      await json(route, {
        id: jobId,
        snapshotId,
        type: "index_snapshot",
        status: succeeded ? "succeeded" : "running",
        phase: succeeded ? "completed" : "building_graph",
        progress: succeeded ? 1 : 0.72,
        processed: succeeded ? 2 : 1,
        total: 2,
        retryable: false,
        error: null,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/jobs/${jobId}/events`) {
      await route.fulfill({
        body: `event: progress\ndata: ${JSON.stringify({ message: "Parsed 2 of 2 changed files; reused 1 unchanged file." })}\n\n`,
        headers: { ...corsHeaders(), "Content-Type": "text/event-stream; charset=utf-8" },
        status: 200,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/v1/repositories") {
      await json(route, [repository]);
      return;
    }

    if (request.method() === "GET" && url.pathname === "/v1/integrations/github") {
      await json(route, {
        enabled: true,
        appSlug: "repovista-demo",
        events: ["ping", "push"],
        scope: "public-repositories",
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/repositories/${repositoryId}`) {
      await json(route, repository);
      return;
    }

    if (
      request.method() === "POST" &&
      url.pathname === `/v1/repositories/${repositoryId}/pull-requests`
    ) {
      state.prAnalysisRequests.push(request.postDataJSON());
      await json(
        route,
        {
          analysisId: prAnalysisId,
          jobId: jobId,
          revision: 1,
          status: "queued",
        },
        202,
      );
      return;
    }

    if (
      request.method() === "GET" &&
      url.pathname === `/v1/pull-request-analyses/${prAnalysisId}`
    ) {
      state.prAnalysisPolls += 1;
      await json(route, pullRequestAnalysis(state.prAnalysisPolls > 1 ? "ready" : "queued"));
      return;
    }

    if (
      request.method() === "GET" &&
      url.pathname === `/v1/pull-request-analyses/${prAnalysisId}/impact`
    ) {
      await json(route, pullRequestImpact());
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}`) {
      await json(route, snapshot);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/files`) {
      await json(route, { files, nextCursor: null });
      return;
    }

    if (
      request.method() === "GET" &&
      url.pathname === `/v1/snapshots/${snapshotId}/exports/markdown`
    ) {
      state.exportRequests.push(request.url());
      await route.fulfill({
        body: [
          "# acme/signal-hub architecture report",
          `- Commit SHA: \`${repository.latestCommitSha}\``,
          `- Snapshot ID: \`${snapshotId}\``,
          `- Parser version: \`${snapshot.parserVersion}\``,
        ].join("\n"),
        headers: {
          ...corsHeaders(),
          "Content-Disposition": 'attachment; filename="acme-signal-hub-0123456.md"',
          "Content-Type": "text/markdown; charset=utf-8",
        },
        status: 200,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/exports/svg`) {
      state.exportRequests.push(request.url());
      await route.fulfill({
        body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><title>acme/signal-hub ${snapshotId}</title><text x="10" y="30">${repository.latestCommitSha}</text></svg>`,
        headers: {
          ...corsHeaders(),
          "Content-Disposition": 'attachment; filename="acme-signal-hub-0123456-package.svg"',
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Type": "image/svg+xml; charset=utf-8",
        },
        status: 200,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/map`) {
      const level = url.searchParams.get("level") ?? "package";
      state.mapLevels.push(level);
      await json(route, graph(level));
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/retrieval`) {
      state.retrievalStatusRequests += 1;
      if (options.semanticUnavailable) {
        await json(route, retrievalStatus("ready"));
        return;
      }
      if (state.embeddingRequests > 0) state.embeddingStatusReads += 1;
      const status =
        state.embeddingRequests === 0
          ? "missing"
          : state.embeddingStatusReads < 3
            ? "running"
            : "ready";
      await json(route, retrievalStatus(status));
      return;
    }

    if (request.method() === "POST" && url.pathname === `/v1/snapshots/${snapshotId}/embeddings`) {
      state.embeddingRequests += 1;
      state.embeddingStatusReads = 0;
      await json(route, { embeddingIndex: embeddingIndex("queued"), jobId, reused: false }, 202);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/search`) {
      state.searchRequests.push(new URLSearchParams(url.searchParams));
      const query = url.searchParams.get("q") ?? "";
      const mode = (url.searchParams.get("mode") ?? "hybrid") as RetrievalMode;
      if (options.semanticUnavailable && mode === "semantic") {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: "EMBEDDING_PROVIDER_UNAVAILABLE",
              message: "The embedding provider is temporarily unavailable.",
              requestId: "e2e-semantic-unavailable",
              retryable: true,
            },
          }),
          headers: corsHeaders(),
          status: 503,
          contentType: "application/json",
        });
        return;
      }
      const result = searchResult(query, mode);
      if (options.semanticUnavailable && mode === "hybrid") {
        result.trace.usedChannels = ["text", "symbol"];
        result.trace.degraded = true;
        result.trace.degradationReason = "provider_unavailable";
        result.trace.channels[2] = {
          channel: "semantic",
          status: "failed",
          candidateCount: 0,
          reason: "provider_unavailable",
          latencyMs: 12,
        };
        const hit = result.results[0];
        if (hit) {
          hit.signals = hit.signals.filter((signal) => signal.channel !== "semantic");
        }
      }
      await json(route, result);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/source`) {
      const startLine = Number.parseInt(url.searchParams.get("startLine") ?? "1", 10);
      const endLine = Number.parseInt(url.searchParams.get("endLine") ?? "14", 10);
      const requestedPath = url.searchParams.get("path") ?? "src/server.ts";
      const python = requestedPath.endsWith(".py");
      await json(route, {
        id: fileId,
        path: requestedPath,
        language: python ? "python" : "typescript",
        content: python
          ? "from signal_hub.router import Router\n\ndef run():\n    return Router().start()"
          : sourceLines.slice(startLine - 1, endLine).join("\n"),
        lineCount: python ? 4 : sourceLines.length,
        startLine,
        commitSha: repository.latestCommitSha,
        blobHash: "sha256:server",
        truncated: false,
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === `/v1/repositories/${repositoryId}/ask`) {
      state.questions.push(request.postDataJSON());
      await json(route, {
        messageId,
        answer: {
          summary: "Requests enter through start() and are handed to the configured router.",
          steps: [
            {
              text: "start() creates the router, prepares dependencies, and listens on port 4000.",
              evidenceIds: ["evidence-1"],
            },
          ],
          limitations: [],
          status: "grounded",
          citations: [
            {
              evidenceId: "evidence-1",
              path: "src/server.ts",
              symbol: "start",
              startLine: 3,
              endLine: 10,
              quote:
                "export async function start() { ... await app.listen({ port: 4000, host }); }",
            },
          ],
          provider: "fake",
          model: "evidence-demo-v1",
        },
        evidence: [
          {
            id: "evidence-1",
            snapshotId,
            commitSha: repository.latestCommitSha,
            fileId,
            path: "src/server.ts",
            symbolId,
            symbol: "start",
            startLine: 3,
            endLine: 10,
            content: sourceLines.slice(2, 10).join("\n"),
            contentHash: "sha256:evidence",
            score: 1,
            signals: [{ channel: "text", rank: 1, rawScore: 1 }],
          },
        ],
        trace: {
          requestedMode: "hybrid",
          usedChannels: ["text", "symbol", "semantic"],
          degraded: false,
          degradationReason: null,
          channels: [
            { channel: "text", status: "used", candidateCount: 2, reason: null, latencyMs: 2 },
            {
              channel: "symbol",
              status: "used",
              candidateCount: 1,
              reason: null,
              latencyMs: 1,
            },
            {
              channel: "semantic",
              status: "used",
              candidateCount: 3,
              reason: null,
              latencyMs: 8,
            },
          ],
          embeddingIndex: embeddingIndex("ready"),
        },
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/v1/share-reports") {
      state.shareRequests.push(request.postDataJSON());
      await json(route, { id: messageId, slug: "acme-signal-hub-tour" }, 201);
      return;
    }

    if (request.method() === "GET" && url.pathname === "/v1/share-reports/acme-signal-hub-tour") {
      await json(route, {
        id: messageId,
        slug: "acme-signal-hub-tour",
        title: "acme/signal-hub architecture story",
        repository,
        snapshot,
        content: {
          version: 2,
          algorithmVersion: "architecture-story-v2",
          headline: "A small TypeScript service with a clear server and router boundary.",
          overview: "Requests enter through the server and flow into a compact routing core.",
          metrics: {
            files: 3,
            symbols: 6,
            edges: 5,
            languages: [
              { name: "typescript", files: 2 },
              { name: "python", files: 1 },
            ],
          },
          keyModules: [
            {
              id: "package:src",
              label: "src",
              path: null,
              importance: 1,
              inDegree: 2,
              outDegree: 3,
              score: 0.96,
              representativePath: "src/server.ts",
              reason: "Connects startup, routing, configuration, and persistence.",
            },
          ],
          readingPath: [
            { path: "src/server.ts", reason: "Start with the process entry point." },
            { path: "src/router.ts", reason: "Then inspect request routing." },
          ],
          evidenceHighlights: [
            {
              id: "story-evidence-1",
              fileId,
              symbolId,
              path: "src/server.ts",
              symbol: "start",
              startLine: 3,
              endLine: 10,
              quote: sourceLines.slice(2, 10).join("\n"),
              contentHash: "sha256:story-evidence",
            },
          ],
          map: {
            nodes: graph("package").nodes,
            edges: graph("package").edges,
            truncated: false,
          },
          provenance: {
            snapshotId,
            commitSha: repository.latestCommitSha,
            parserVersion: snapshot.parserVersion,
            generatedAt: "2026-01-01T00:00:03.000Z",
            generatedAtSource: "snapshot_ready_at",
            retrievalProfile: {
              id: embeddingIndex("ready").id,
              provider: "ollama",
              model: "nomic-embed-text",
              dimensions: 768,
            },
          },
        },
        createdAt: "2026-01-01T00:00:04.000Z",
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "E2E_ROUTE_NOT_MOCKED",
          message: `${request.method()} ${url.pathname} is not mocked.`,
          requestId: "e2e-unmocked",
          retryable: false,
        },
      }),
      headers: corsHeaders(),
      status: 404,
      contentType: "application/json",
    });
  });

  return state;
}

async function expandAnalysisOptions(toggle: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") return;
    await toggle.click();
    try {
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
      return;
    } catch {
      // A first interaction can land while the development page is still hydrating.
    }
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test("analyzes a repository and explores its evidence-backed result", async ({ context, page }) => {
  test.setTimeout(90_000);
  const state = await installMockApi(context);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Understand any codebase as a map, not a maze/ }),
  ).toBeVisible();
  await page.getByPlaceholder("https://github.com/owner/repository").fill(repository.canonicalUrl);
  await page.getByRole("button", { name: "Explore repository" }).click();

  await expect(page).toHaveURL(/\/repositories\/new\?url=/);
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue(repository.canonicalUrl);
  await expandAnalysisOptions(page.getByRole("button", { name: "Analysis options" }));
  await page.getByLabel("Branch, tag, or commit").fill("main");
  await page.getByLabel("Ignored paths").fill("dist\ngenerated");
  await page.getByRole("button", { name: "Analyze repository" }).click();

  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}`));
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(
    page.getByText("Parsed 2 of 2 changed files; reused 1 unchanged file."),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `${webOrigin}/repositories/${repositoryId}?snapshotId=${snapshotId}`,
    { timeout: 12_000 },
  );
  expect(state.importRequests).toEqual([
    { url: repository.canonicalUrl, ref: "main", ignore: ["dist", "generated"] },
  ]);

  await expect(
    page.getByRole("heading", { name: "See the system before reading every file." }),
  ).toBeVisible();
  await expect(page.getByText("incremental index", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deterministic snapshot exports" })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await expect(page.getByTitle("src/worker.py")).toContainText("python");
  await page.getByTitle("src/worker.py").click();
  await expect(page.locator(".source-code")).toContainText("from signal_hub.router import Router");
  await page.getByRole("button", { name: "Close source" }).click();
  await page.getByTitle("src/server.ts").click();
  await expect(page.getByText("src/server.ts", { exact: true }).last()).toBeVisible();
  await expect(page.locator(".source-code")).toContainText("export async function start");
  await page.getByRole("button", { name: "Close source" }).click();

  await page.getByRole("button", { name: "Architecture map" }).click();
  await page.getByRole("button", { name: "file", exact: true }).click();
  await expect(page.getByText("2 nodes · 1 edges")).toBeVisible();
  await expect.poll(() => state.mapLevels).toContain("file");

  await page.getByRole("button", { name: "Ask repository" }).click();
  await page.getByRole("button", { name: "Where does this application start?" }).click();
  await page.getByRole("button", { name: "Ask with evidence" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Requests enter through start() and are handed to the configured router.",
    }),
  ).toBeVisible();
  await expect(page.getByText("src/server.ts:3-10")).toBeVisible();
  expect(state.questions).toEqual([
    {
      question: "Where does this application start?",
      snapshotId,
    },
  ]);
  await page.getByRole("button", { name: /src\/server\.ts:3-10/ }).click();
  await expect(page.getByText("Evidence lines 3-10")).toBeVisible();
  await page.getByRole("button", { name: "Close source" }).click();
  await expect(page.getByRole("region", { name: "Retrieval used" })).toContainText(
    "text + symbol + semantic",
  );
  await expect(page.getByRole("region", { name: "Retrieval used" })).toContainText(
    "nomic-embed-text · 768d",
  );

  await page.getByRole("button", { name: "Search evidence" }).click();
  await expect(
    page.getByRole("heading", { name: "Search evidence without hiding the ranking." }),
  ).toBeVisible();
  await page.getByLabel("Search query").fill("Where is startup configured?");
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/tab=search.*q=Where(?:\+|%20)is(?:\+|%20)startup/);
  await expect(page.getByText("Text #1 · 0.9300")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Search evidence without hiding the ranking." }),
  ).toBeVisible();
  await expect(page.getByText("Text #1 · 0.9300")).toBeVisible();
  await page.getByRole("button", { name: "Open source" }).click();
  await expect(page.getByText("Evidence lines 3-10")).toBeVisible();
  await page.getByRole("button", { name: "Close source" }).click();

  await page.getByRole("button", { name: "Build index" }).click();
  await expect(page.getByRole("progressbar", { name: "Semantic index progress" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View job" })).toHaveAttribute(
    "href",
    `/jobs/${jobId}`,
  );
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 8_000 });
  await page.getByRole("tab", { name: "Hybrid" }).click();
  await page.getByLabel("Search query").fill("How does the process begin?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Complete channel trace")).toBeVisible();
  await expect(page.getByText("Semantic #3 · 0.7300")).toBeVisible();
  expect(state.embeddingRequests).toBe(1);
  expect(state.searchRequests.map((request) => request.get("mode"))).toEqual([
    "text",
    "text",
    "hybrid",
  ]);

  if (process.env.REPOVISTA_CAPTURE_README === "1") {
    await page.screenshot({
      path: "../../docs/assets/repovista-explorer.png",
      fullPage: true,
    });
  }

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Share story" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`${webOrigin}/share/acme-signal-hub-tour`);
  await expect(
    popup.getByRole("heading", {
      name: "A small TypeScript service with a clear server and router boundary.",
    }),
  ).toBeVisible();
  await expect(popup.getByRole("region", { name: "Architecture metrics" })).toContainText("6");
  await expect(popup.getByText("Where the architecture concentrates.")).toBeVisible();
  await expect(popup.getByText("Highlights from the snapshot.")).toBeVisible();
  await expect(popup.getByText("Profile ollama · nomic-embed-text · 768d")).toBeVisible();
  await expect(popup.getByText("A deterministic reading path.")).toBeVisible();
  expect(state.shareRequests).toEqual([
    { snapshotId, title: "acme/signal-hub architecture story" },
  ]);
});

test("keeps hybrid useful and makes semantic-only failure explicit when Ollama stops", async ({
  context,
  page,
}) => {
  const state = await installMockApi(context, { semanticUnavailable: true });
  await page.goto(`/repositories/${repositoryId}?snapshotId=${snapshotId}&tab=search`);

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByLabel("Search query").fill("Where does the server begin?");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Hybrid degraded: provider unavailable")).toBeVisible();
  await expect(page.getByText("Text #1 · 0.9300")).toBeVisible();

  await page.getByRole("tab", { name: "Semantic" }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const retrievalAlert = page.locator(".retrieval-alert");
  await expect(retrievalAlert).toContainText("The embedding provider is temporarily unavailable.");
  await expect(retrievalAlert).toContainText("Request ID: e2e-semantic-unavailable");
  expect(state.searchRequests.map((request) => request.get("mode"))).toEqual([
    "hybrid",
    "semantic",
  ]);
});

test("analyzes pull request impact and opens immutable evidence", async ({ context, page }) => {
  const state = await installMockApi(context);
  await page.goto(`/repositories/${repositoryId}?snapshotId=${snapshotId}`);

  await page.getByLabel("Pull request impact").fill("42");
  await page.getByRole("button", { name: "Analyze pull request" }).click();

  await expect(page).toHaveURL(
    `${webOrigin}/repositories/${repositoryId}/pull-requests/42?analysisId=${prAnalysisId}`,
  );
  await expect(
    page.getByText("Waiting for immutable base and head snapshots.").first(),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Impact summary" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/Static traversal reached its safety limit/)).toBeVisible();
  expect(state.prAnalysisRequests).toEqual([{ number: 42 }]);
  expect(state.prAnalysisPolls).toBeGreaterThanOrEqual(2);

  await page.locator(".impact-toolbar select").nth(0).selectOption("critical");
  await expect(page.getByText("1 visible impacts")).toBeVisible();
  await expect(page.getByText("GeneratedClient")).toBeHidden();
  await page.getByRole("button", { name: "1-step shortest static path" }).click();
  await expect(page.getByText("src/router.ts")).toBeVisible();

  await page.getByRole("button", { name: "Inspect createServer evidence" }).click();
  const drawer = page.getByRole("complementary", { name: "Fixed impact evidence" });
  await expect(drawer.getByText(prHeadSnapshotId)).toBeVisible();
  await expect(drawer.getByText(prHeadCommitSha)).toBeVisible();
  await expect(drawer.getByText(/export function createServer/)).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Open in VS Code" })).toHaveAttribute(
    "href",
    new RegExp(
      `repositoryId=${repositoryId}&snapshotId=${prHeadSnapshotId}&commitSha=${prHeadCommitSha}`,
    ),
  );
  await expect(drawer.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
    "href",
    `https://github.com/acme/signal-hub/blob/${prHeadCommitSha}/src/api.ts#L10-L24`,
  );

  await drawer.getByRole("button", { name: "Close evidence" }).click();
  await page.locator(".impact-toolbar select").nth(0).selectOption("all");
  await page.locator(".impact-toolbar select").nth(1).selectOption("unknown");
  await page.getByRole("button", { name: "Inspect GeneratedClient evidence" }).click();
  await expect(
    page.getByText(/could not prove a fixed source range.*marked unknown/i),
  ).toBeVisible();
});

test("downloads deterministic Markdown and SVG for the selected snapshot", async ({
  context,
  page,
}) => {
  const state = await installMockApi(context);
  await page.goto(`/repositories/${repositoryId}?snapshotId=${snapshotId}`);

  const markdownEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Markdown" }).click();
  const markdown = await markdownEvent;
  expect(markdown.suggestedFilename()).toBe("acme-signal-hub-0123456.md");
  const markdownPath = await markdown.path();
  expect(markdownPath).not.toBeNull();
  const markdownBody = await readFile(markdownPath as string, "utf8");
  expect(markdownBody).toContain(repository.latestCommitSha);
  expect(markdownBody).toContain(snapshotId);
  expect(markdownBody).toContain(snapshot.parserVersion);

  const svgEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SVG" }).click();
  const svg = await svgEvent;
  expect(svg.suggestedFilename()).toBe("acme-signal-hub-0123456-package.svg");
  const svgPath = await svg.path();
  expect(svgPath).not.toBeNull();
  const svgBody = await readFile(svgPath as string, "utf8");
  expect(svgBody).toContain(snapshotId);
  const validXml = await page.evaluate((body) => {
    const document = new DOMParser().parseFromString(body, "image/svg+xml");
    return (
      document.querySelector("parsererror") === null && document.documentElement.nodeName === "svg"
    );
  }, svgBody);
  expect(validXml).toBe(true);
  expect(state.exportRequests).toEqual([
    `${apiOrigin}/v1/snapshots/${snapshotId}/exports/markdown`,
    `${apiOrigin}/v1/snapshots/${snapshotId}/exports/svg?level=package`,
  ]);
});

test("lists existing repositories and opens an immutable snapshot", async ({ context, page }) => {
  await installMockApi(context);

  await page.goto("/repositories");

  await expect(page.getByRole("heading", { name: "Indexed repositories" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "signal-hub" })).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /acme signal-hub/ }).click();
  await expect(page).toHaveURL(
    `${webOrigin}/repositories/${repositoryId}?snapshotId=${snapshotId}`,
  );
  await expect(page.getByText("main · 0123456")).toBeVisible();
});

test("shows structured API failures with a request ID", async ({ context, page }) => {
  await installMockApi(context, { importFailure: true });

  await page.goto("/repositories/new");
  await page.getByLabel("Public GitHub repository").fill(repository.canonicalUrl);
  await page.getByRole("button", { name: "Analyze repository" }).click();

  const alert = page.locator('.form-error[role="alert"]');
  await expect(alert).toContainText("This Git host is not enabled by the server.");
  await expect(alert).toContainText("Request ID: e2e-import-failure");
  await expect(page).toHaveURL(`${webOrigin}/repositories/new`);
});
