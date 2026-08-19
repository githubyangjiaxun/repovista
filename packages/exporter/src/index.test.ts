import type { GraphNode, RepositorySummary, Snapshot } from "@repovista/contracts";
import { describe, expect, it } from "vitest";
import {
  createMarkdownExport,
  createSvgExport,
  EXPORT_NODE_LIMIT,
  type SnapshotExportInput,
} from "./index.js";

const repository: RepositorySummary = {
  id: "01900000-0000-7000-8000-000000000001",
  owner: "acme & <team>",
  name: 'demo "map" `core`',
  canonicalUrl: "https://github.com/acme/demo",
  defaultBranch: "main",
  latestSnapshotId: "01900000-0000-7000-8000-000000000002",
  latestSnapshotStatus: "ready",
  latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
  autoUpdateEnabled: true,
  lastWebhookAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const snapshot: Snapshot & { commitSha: string } = {
  id: "01900000-0000-7000-8000-000000000002",
  repositoryId: repository.id,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-ts-js-py-v1",
  stats: {
    files: 3,
    symbols: 300,
    edges: 299,
    languages: { python: 2, typescript: 1 },
    warnings: 0,
    indexing: {
      mode: "incremental",
      baseSnapshotId: "01900000-0000-7000-8000-000000000003",
      baseCommitSha: "1123456789abcdef0123456789abcdef01234567",
      scannedFiles: 3,
      changedFiles: 1,
      reusedFiles: 2,
      parsedFiles: 1,
      deletedFiles: 0,
    },
  },
  baseSnapshotId: "01900000-0000-7000-8000-000000000003",
  indexMode: "incremental",
  treeHash: "sha256:tree",
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:03.000Z",
  failure: null,
};

function node(index: number): GraphNode {
  return {
    id: `node-${index.toString().padStart(3, "0")}`,
    level: "symbol",
    kind: index % 2 === 0 ? "function" : "class",
    label: index === 0 ? "unsafe & <node> \"quote\" 'apostrophe'" : `Symbol ${index}`,
    path: index === 0 ? "src/a&b/<entry>.py" : `src/module-${index}.py`,
    range: { startLine: index + 1, endLine: index + 2 },
    importance: index === 0 ? 1 : (index % 10) / 10,
    metadata: {},
  };
}

function fixture(): SnapshotExportInput {
  const nodes = Array.from({ length: 300 }, (_, index) => node(index));
  const edges = nodes.slice(1).map((current, index) => ({
    id: `edge-${index}`,
    from: nodes[index]?.id ?? nodes[0]?.id ?? "node-000",
    to: current.id,
    type: "calls" as const,
    confidence: 0.9,
  }));
  return {
    repository,
    snapshot,
    files: [
      {
        path: "src/main.py",
        language: "python",
        byteSize: 10,
        lineCount: 2,
        parseStatus: "parsed",
      },
      {
        path: "README.md",
        language: "markdown",
        byteSize: 20,
        lineCount: 4,
        parseStatus: "unsupported",
      },
      {
        path: "src/a|b.ts",
        language: "typescript",
        byteSize: 30,
        lineCount: 6,
        parseStatus: "parsed",
      },
    ],
    graph: { level: "symbol", nodes, edges, truncated: false },
  };
}

describe("createMarkdownExport", () => {
  it("creates deterministic provenance, delta, language, reading-path, and map sections", () => {
    const input = fixture();
    const first = createMarkdownExport(input);
    const reordered = createMarkdownExport({
      ...input,
      files: [...input.files].reverse(),
      graph: {
        ...input.graph,
        nodes: [...input.graph.nodes].reverse(),
        edges: [...input.graph.edges].reverse(),
      },
    });

    expect(first).toEqual(reordered);
    expect(first.body).toContain(snapshot.commitSha);
    expect(first.body).toContain(snapshot.id);
    expect(first.body).toContain(snapshot.parserVersion);
    expect(first.body).toContain("repository_snapshots.ready_at");
    expect(first.body).toContain("## Update delta");
    expect(first.body).toContain("## Reading path");
    expect(first.body).toContain("README.md");
    expect(first.body).toContain("a\\|b.ts");
    expect(first.body).toContain("No AI-generated claims are included");
    expect(first.filename).toMatch(/^[a-z0-9._-]+\.md$/);
  });
});

describe("createSvgExport", () => {
  it("escapes XML, uses stable layout, and enforces the node safety limit", () => {
    const input = fixture();
    const first = createSvgExport(input);
    const reordered = createSvgExport({
      ...input,
      graph: {
        ...input.graph,
        nodes: [...input.graph.nodes].reverse(),
        edges: [...input.graph.edges].reverse(),
      },
    });

    expect(first).toEqual(reordered);
    expect(first.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(first.body.match(/<g class="node"/g)).toHaveLength(EXPORT_NODE_LIMIT);
    expect(first.body).toContain("&amp;");
    expect(first.body).toContain("&lt;team&gt;");
    expect(first.body).toContain("&quot;");
    expect(first.body).toContain("&apos;");
    expect(first.body).not.toContain("<team>");
    expect(first.body).toContain("50 nodes");
    expect(first.body).toContain(snapshot.commitSha);
    expect(first.filename).toMatch(/^[a-z0-9._-]+-symbol-map\.svg$/);
  });
});
