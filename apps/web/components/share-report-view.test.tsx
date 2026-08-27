// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareReport } from "@/lib/api";
import { ShareReportView } from "./share-report-view";

vi.mock("@/components/architecture-map", () => ({
  ArchitectureMap: ({ graph }: { graph: { nodes: unknown[]; edges: unknown[] } }) => (
    <div data-testid="architecture-map">
      {graph.nodes.length} nodes · {graph.edges.length} edges
    </div>
  ),
}));

const repositoryId = "01900000-0000-7000-8000-000000000201";
const snapshotId = "01900000-0000-7000-8000-000000000202";
const fileId = "01900000-0000-7000-8000-000000000203";
const commitSha = "0123456789abcdef0123456789abcdef01234567";

const baseReport = {
  id: "01900000-0000-7000-8000-000000000204",
  slug: "acme-signal-hub-story",
  title: "acme/signal-hub architecture story",
  visibility: "public" as const,
  repository: {
    id: repositoryId,
    owner: "acme",
    name: "signal-hub",
    canonicalUrl: "https://github.com/acme/signal-hub",
    defaultBranch: "main",
    latestSnapshotId: snapshotId,
    latestSnapshotStatus: "ready" as const,
    latestCommitSha: commitSha,
    autoUpdateEnabled: false,
    lastWebhookAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:03.000Z",
  },
  snapshot: {
    id: snapshotId,
    repositoryId,
    commitSha,
    refName: "main",
    status: "ready" as const,
    parserVersion: "tree-sitter-ts-js-py-go-v1",
    baseSnapshotId: null,
    indexMode: "full" as const,
    treeHash: "sha256:tree",
    stats: {
      files: 4,
      symbols: 12,
      edges: 9,
      languages: { typescript: 3, python: 1 },
      warnings: 0,
      indexing: null,
    },
    requestedAt: "2026-08-20T00:00:00.000Z",
    readyAt: "2026-08-20T00:00:03.000Z",
    failure: null,
  },
  createdAt: "2026-08-20T00:00:04.000Z",
};

function success(data: ShareReport): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-share" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ShareReportView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders Architecture Story v2 metrics, modules, evidence, and provenance", async () => {
    const report: ShareReport = {
      ...baseReport,
      content: {
        version: 2,
        algorithmVersion: "architecture-story-v2",
        headline: "A compact service centered on its server boundary.",
        overview: "Requests flow from the server entry point into a small routing core.",
        metrics: {
          files: 4,
          symbols: 12,
          edges: 9,
          languages: [
            { name: "typescript", files: 3 },
            { name: "python", files: 1 },
          ],
        },
        map: { nodes: [], edges: [], truncated: false },
        keyModules: [
          {
            id: "package:src",
            label: "src",
            path: null,
            importance: 0.92,
            inDegree: 4,
            outDegree: 5,
            score: 0.95,
            representativePath: "src/server.ts",
            reason: "Connects the entry point to routing and configuration.",
          },
        ],
        readingPath: [
          { path: "src/server.ts", reason: "Start at the process boundary." },
          { path: "src/router.ts", reason: "Follow request dispatch next." },
        ],
        evidenceHighlights: [
          {
            id: "evidence:start",
            fileId,
            symbolId: null,
            path: "src/server.ts",
            symbol: "start",
            startLine: 3,
            endLine: 10,
            quote: "export async function start() { await app.listen(); }",
            contentHash: "sha256:start-evidence",
          },
        ],
        provenance: {
          snapshotId,
          commitSha,
          parserVersion: "tree-sitter-ts-js-py-go-v1",
          generatedAt: "2026-08-20T00:00:03.000Z",
          generatedAtSource: "snapshot_ready_at",
          retrievalProfile: {
            id: "01900000-0000-7000-8000-000000000205",
            provider: "ollama",
            model: "nomic-embed-text",
            dimensions: 768,
          },
        },
      },
    };
    vi.mocked(fetch).mockResolvedValue(success(report));

    render(<ShareReportView slug={report.slug} />);

    expect(
      await screen.findByRole("heading", {
        name: "A compact service centered on its server boundary.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(report.title)).toBeInTheDocument();
    const metrics = within(screen.getByRole("region", { name: "Architecture metrics" }));
    expect(metrics.getByText("4")).toBeInTheDocument();
    expect(metrics.getByText("12")).toBeInTheDocument();
    expect(metrics.getByText("9")).toBeInTheDocument();
    expect(metrics.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Where the architecture concentrates.")).toBeInTheDocument();
    expect(screen.getByText("Importance 92%")).toBeInTheDocument();
    expect(screen.getByText("9 connections")).toBeInTheDocument();
    expect(screen.getAllByText("src/server.ts")).toHaveLength(2);
    expect(screen.getByText(/export async function start/)).toBeInTheDocument();
    expect(screen.getByText("sha256:start-evidence")).toBeInTheDocument();
    expect(screen.getByText(`Commit ${commitSha.slice(0, 12)}`)).toBeInTheDocument();
    expect(screen.getByText("Profile ollama · nomic-embed-text · 768d")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Story provenance" })).toHaveTextContent(snapshotId);
    expect(
      screen.getByRole("heading", { name: "A deterministic reading path." }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("architecture-map")).toHaveTextContent("0 nodes · 0 edges");
  });

  it("keeps legacy v1 tours readable without v2-only sections", async () => {
    const report: ShareReport = {
      ...baseReport,
      slug: "acme-signal-hub-tour",
      content: {
        overview: "A legacy deterministic architecture tour.",
        readingPath: [{ path: "src/index.ts", reason: "Begin with the public module." }],
        map: { nodes: [], edges: [], truncated: false },
      },
    };
    vi.mocked(fetch).mockResolvedValue(success(report));

    render(<ShareReportView slug={report.slug} />);

    expect(
      await screen.findByRole("heading", { name: "Read the repository in this order." }),
    ).toBeInTheDocument();
    expect(screen.getByText("A legacy deterministic architecture tour.")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Architecture metrics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Provenance")).not.toBeInTheDocument();
  });

  it("does not link a bundled fixture to an external repository", async () => {
    const report: ShareReport = {
      ...baseReport,
      repository: {
        ...baseReport.repository,
        owner: "repovista-fixtures",
        name: "polyglot-demo",
        canonicalUrl: "https://repovista-demo.invalid/polyglot-demo",
      },
      content: {
        version: 1,
        overview: "A bundled deterministic fixture.",
        map: { nodes: [], edges: [], truncated: false },
        readingPath: [],
      },
    };
    vi.mocked(fetch).mockResolvedValue(success(report));

    render(<ShareReportView slug={report.slug} />);

    expect(await screen.findByText(/repovista-fixtures\/polyglot-demo · bundled/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /repovista-fixtures\/polyglot-demo/ })).toBeNull();
  });

  it("labels private reports as workspace-only content", async () => {
    const report: ShareReport = {
      ...baseReport,
      visibility: "private",
      content: {
        overview: "A private deterministic architecture tour.",
        readingPath: [{ path: "src/private.ts", reason: "Private workspace evidence." }],
        map: { nodes: [], edges: [], truncated: false },
      },
    };
    vi.mocked(fetch).mockResolvedValue(success(report));

    render(<ShareReportView slug={report.slug} />);

    expect(await screen.findByText("Private workspace report")).toBeInTheDocument();
    expect(screen.queryByText("Public architecture tour")).not.toBeInTheDocument();
  });
});
