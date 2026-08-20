import { loadConfig } from "@repovista/config";
import type { EmbeddingIndex, Evidence, RetrievalStatus, Snapshot } from "@repovista/contracts";
import { DomainError } from "@repovista/domain";
import { TestDeterministicEmbeddingProvider } from "@repovista/embeddings";
import { describe, expect, it, vi } from "vitest";
import { type RetrievalDependencies, type RetrievalStore, retrieveEvidence } from "./retrieval.js";

const snapshotId = "01900000-0000-7000-8000-000000000301";
const repositoryId = "01900000-0000-7000-8000-000000000302";
const embeddingIndexId = "01900000-0000-7000-8000-000000000303";

const snapshot: Snapshot = {
  id: snapshotId,
  repositoryId,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  refName: "main",
  status: "ready",
  parserVersion: "test-parser",
  baseSnapshotId: null,
  indexMode: "full",
  treeHash: "sha256:test-tree",
  stats: {
    files: 2,
    symbols: 2,
    edges: 0,
    languages: { typescript: 2 },
    warnings: 0,
    indexing: null,
  },
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:01.000Z",
  failure: null,
};

const embeddingIndex: EmbeddingIndex = {
  id: embeddingIndexId,
  snapshotId,
  provider: "ollama",
  model: "test-retrieval-model",
  inputVersion: "code-chunk-v1",
  status: "ready",
  dimensions: 8,
  totalChunks: 2,
  embeddedChunks: 2,
  revision: 1,
  jobId: "01900000-0000-7000-8000-000000000304",
  failure: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  readyAt: "2026-01-01T00:00:01.000Z",
};

function evidence(id: string, path: string, score: number): Evidence {
  return {
    id,
    snapshotId,
    commitSha: snapshot.commitSha ?? "",
    fileId: "01900000-0000-7000-8000-000000000305",
    path,
    symbolId: null,
    symbol: null,
    startLine: 1,
    endLine: 2,
    content: path,
    contentHash: `sha256:${id}`,
    score,
  };
}

function retrievalStatus(reason: RetrievalStatus["semantic"]["reason"]): RetrievalStatus {
  return {
    snapshotId,
    text: { ready: true, reason: null },
    symbol: { ready: true, reason: null },
    semantic: {
      configured: reason !== "provider_disabled",
      queryable: reason === null,
      reason,
      currentIndex: reason === null ? embeddingIndex : null,
      latestIndex: reason === "model_mismatch" ? embeddingIndex : null,
    },
  };
}

function createStore(status = retrievalStatus("provider_disabled")): RetrievalStore {
  return {
    getSnapshot: vi.fn(async () => snapshot),
    getRetrievalStatus: vi.fn(async () => status),
    searchTextEvidence: vi.fn(async () => [
      { ...evidence("shared", "src/shared.ts", 0.4), channel: "text" as const },
      { ...evidence("text", "src/text.ts", 0.3), channel: "text" as const },
    ]),
    searchSymbolEvidence: vi.fn(async () => [
      { ...evidence("shared", "src/shared.ts", 1), channel: "symbol" as const },
    ]),
    searchSemanticEvidence: vi.fn(async () => [
      { ...evidence("semantic", "src/semantic.ts", 0.9), channel: "semantic" as const },
    ]),
  };
}

const disabledConfig = loadConfig({ APP_ENV: "test", EMBEDDING_PROVIDER: "none" });
const semanticConfig = loadConfig({
  APP_ENV: "test",
  EMBEDDING_PROVIDER: "ollama",
  EMBEDDING_MODEL: embeddingIndex.model,
});

function dependencies(
  provider = new TestDeterministicEmbeddingProvider(8, embeddingIndex.model),
): RetrievalDependencies {
  let time = 100;
  return {
    createProvider: vi.fn(() => provider),
    now: vi.fn(() => {
      time += 1;
      return time;
    }),
  };
}

describe("retrieveEvidence", () => {
  it("returns lexical hybrid results with a transparent disabled-semantic trace", async () => {
    const store = createStore();
    const result = await retrieveEvidence(store, disabledConfig, {
      snapshotId,
      query: "where is the shared handler",
      mode: "hybrid",
      limit: 10,
    });

    expect(result.trace).toMatchObject({
      requestedMode: "hybrid",
      usedChannels: ["text", "symbol"],
      degraded: true,
      degradationReason: "provider_disabled",
      embeddingIndex: null,
    });
    expect(result.results[0]).toMatchObject({
      id: "shared",
      signals: [
        { channel: "text", rank: 1, rawScore: 0.4 },
        { channel: "symbol", rank: 1, rawScore: 1 },
      ],
    });
  });

  it("queries only the selected ready semantic profile", async () => {
    const store = createStore(retrievalStatus(null));
    const result = await retrieveEvidence(
      store,
      semanticConfig,
      { snapshotId, query: "natural language intent", mode: "semantic", limit: 5 },
      dependencies(),
    );

    expect(store.searchTextEvidence).not.toHaveBeenCalled();
    expect(store.searchSemanticEvidence).toHaveBeenCalledWith({
      snapshotId,
      embeddingIndexId,
      queryVector: expect.any(Array),
      limit: 20,
    });
    expect(result.trace).toMatchObject({
      requestedMode: "semantic",
      usedChannels: ["semantic"],
      degraded: false,
      embeddingIndex: { id: embeddingIndexId },
    });
  });

  it("degrades hybrid retrieval when the provider is temporarily unavailable", async () => {
    const store = createStore(retrievalStatus(null));
    const provider = new TestDeterministicEmbeddingProvider(8, embeddingIndex.model);
    vi.spyOn(provider, "embed").mockRejectedValue(
      new DomainError("EMBEDDING_UPSTREAM_UNAVAILABLE", "Provider unavailable.", {
        retryable: true,
      }),
    );
    const result = await retrieveEvidence(
      store,
      semanticConfig,
      { snapshotId, query: "where is the handler", mode: "hybrid", limit: 5 },
      dependencies(provider),
    );

    expect(result.trace).toMatchObject({
      usedChannels: ["text", "symbol"],
      degraded: true,
      degradationReason: "provider_unavailable",
      channels: expect.arrayContaining([
        expect.objectContaining({ channel: "semantic", status: "failed" }),
      ]),
    });
  });

  it("does not silently downgrade semantic-only retrieval", async () => {
    const store = createStore(retrievalStatus("index_missing"));
    await expect(
      retrieveEvidence(store, semanticConfig, {
        snapshotId,
        query: "where is the handler",
        mode: "semantic",
        limit: 5,
      }),
    ).rejects.toMatchObject({
      code: "RETRIEVAL_MODE_UNAVAILABLE",
      details: { reason: "index_missing" },
    });
    expect(store.searchTextEvidence).not.toHaveBeenCalled();
  });

  it("reports a provider dimension mismatch without losing lexical results", async () => {
    const store = createStore(retrievalStatus(null));
    const result = await retrieveEvidence(
      store,
      semanticConfig,
      { snapshotId, query: "where is the handler", mode: "hybrid", limit: 5 },
      dependencies(new TestDeterministicEmbeddingProvider(4, embeddingIndex.model)),
    );
    expect(result.trace).toMatchObject({
      degraded: true,
      degradationReason: "dimension_mismatch",
    });
    expect(store.searchSemanticEvidence).not.toHaveBeenCalled();
  });
});
