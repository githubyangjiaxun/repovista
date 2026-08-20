import type { Snapshot } from "@repovista/contracts";
import { describe, expect, it } from "vitest";
import { buildArchitectureStory, STORY_ALGORITHM_VERSION } from "./index.js";

const snapshot: Snapshot = {
  id: "01900000-0000-7000-8000-000000000001",
  repositoryId: "01900000-0000-7000-8000-000000000002",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-test-v1",
  baseSnapshotId: null,
  indexMode: "full",
  treeHash: "sha256:tree",
  stats: {
    files: 3,
    symbols: 3,
    edges: 2,
    languages: { typescript: 2, text: 1 },
    warnings: 0,
    indexing: null,
  },
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:01:00.000Z",
  failure: null,
};

const files = [
  {
    id: "01900000-0000-7000-8000-000000000010",
    path: "README.md",
    language: "text",
    byteSize: 20,
    lineCount: 2,
    content: "# Demo\nA mapped system.",
  },
  {
    id: "01900000-0000-7000-8000-000000000011",
    path: "src/server.ts",
    language: "typescript",
    byteSize: 80,
    lineCount: 3,
    content: "export function createServer() {\n  return registerRoutes();\n}",
  },
  {
    id: "01900000-0000-7000-8000-000000000012",
    path: "src/routes/index.ts",
    language: "typescript",
    byteSize: 70,
    lineCount: 3,
    content: "export function registerRoutes() {\n  return 'ready';\n}",
  },
];

const symbols = [
  {
    id: "01900000-0000-7000-8000-000000000020",
    fileId: files[1]?.id ?? "",
    path: "src/server.ts",
    stableKey: "function:server:createServer",
    kind: "function",
    name: "createServer",
    qualifiedName: "createServer",
    startLine: 1,
    endLine: 3,
  },
  {
    id: "01900000-0000-7000-8000-000000000021",
    fileId: files[2]?.id ?? "",
    path: "src/routes/index.ts",
    stableKey: "function:routes:registerRoutes",
    kind: "function",
    name: "registerRoutes",
    qualifiedName: "registerRoutes",
    startLine: 1,
    endLine: 3,
  },
  {
    id: "01900000-0000-7000-8000-000000000022",
    fileId: files[2]?.id ?? "",
    path: "src/routes/index.ts",
    stableKey: "module:routes",
    kind: "module",
    name: "index.ts",
    qualifiedName: "src/routes/index.ts",
    startLine: 1,
    endLine: 3,
  },
];

const edges = [
  {
    id: "01900000-0000-7000-8000-000000000030",
    fromSymbolId: symbols[0]?.id ?? "",
    toSymbolId: symbols[1]?.id ?? null,
    unresolvedTarget: null,
    relationType: "calls",
    confidence: 0.9,
  },
  {
    id: "01900000-0000-7000-8000-000000000031",
    fromSymbolId: symbols[2]?.id ?? "",
    toSymbolId: symbols[1]?.id ?? null,
    unresolvedTarget: null,
    relationType: "contains",
    confidence: 1,
  },
];

describe("architecture story", () => {
  it("builds fixed metrics, modules, reading path, evidence, and provenance", () => {
    const story = buildArchitectureStory({
      repository: { owner: "acme", name: "demo" },
      snapshot,
      files,
      symbols,
      edges,
    });
    expect(story).toMatchObject({
      version: 2,
      algorithmVersion: STORY_ALGORITHM_VERSION,
      metrics: { files: 3, symbols: 3, edges: 2 },
      provenance: {
        snapshotId: snapshot.id,
        commitSha: snapshot.commitSha,
        generatedAtSource: "snapshot_ready_at",
      },
    });
    expect(story.keyModules[0]).toMatchObject({ label: "src/routes" });
    expect(story.readingPath[0]).toMatchObject({ path: "README.md" });
    expect(story.evidenceHighlights[0]?.quote).toContain("function");
    expect(story.evidenceHighlights[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is stable when files, symbols, and edges arrive in a different order", () => {
    const first = buildArchitectureStory({
      repository: { owner: "acme", name: "demo" },
      snapshot,
      files,
      symbols,
      edges,
    });
    const second = buildArchitectureStory({
      repository: { owner: "acme", name: "demo" },
      snapshot,
      files: [...files].reverse(),
      symbols: [...symbols].reverse(),
      edges: [...edges].reverse(),
    });
    expect(second).toEqual(first);
  });

  it("refuses non-ready snapshots", () => {
    expect(() =>
      buildArchitectureStory({
        repository: { owner: "acme", name: "demo" },
        snapshot: { ...snapshot, status: "failed", commitSha: null },
        files,
        symbols,
        edges,
      }),
    ).toThrowError(/ready snapshot/);
  });
});
