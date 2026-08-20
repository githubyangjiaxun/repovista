import type {
  ClaimedEmbeddingJob,
  EmbeddingChunkRecord,
  SaveEmbeddingBatchInput,
} from "@repovista/database";
import { DomainError } from "@repovista/domain";
import { TestDeterministicEmbeddingProvider } from "@repovista/embeddings";
import { describe, expect, it, vi } from "vitest";
import {
  type EmbeddingIndexerConfig,
  type EmbeddingIndexerDependencies,
  type EmbeddingIndexerStore,
  executeEmbeddingJob,
} from "./embedding-indexer.js";

const job: ClaimedEmbeddingJob = {
  id: "01900000-0000-7000-8000-000000000101",
  embeddingIndexId: "01900000-0000-7000-8000-000000000102",
  snapshotId: "01900000-0000-7000-8000-000000000103",
  workspaceId: "00000000-0000-7000-8000-000000000002",
  repositoryId: "01900000-0000-7000-8000-000000000104",
  provider: "ollama",
  model: "test-deterministic-embedding",
  inputVersion: "code-chunk-v1",
  attemptCount: 1,
  maxAttempts: 3,
};

const config: EmbeddingIndexerConfig = {
  EMBEDDING_PROVIDER: "ollama",
  EMBEDDING_MODEL: job.model,
  EMBEDDING_BATCH_SIZE: 1,
  EMBEDDING_INPUT_MAX_CHARS: 12_000,
  EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
  JOB_LEASE_SECONDS: 30,
  OLLAMA_BASE_URL: "http://localhost:11434",
  OPENAI_COMPATIBLE_API_KEY: undefined,
  OPENAI_COMPATIBLE_BASE_URL: undefined,
  WORKER_ID: "embedding-test-worker",
};

const chunks: EmbeddingChunkRecord[] = [
  {
    id: "01900000-0000-7000-8000-000000000201",
    snapshotId: job.snapshotId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    fileId: "01900000-0000-7000-8000-000000000211",
    path: "src/server.ts",
    symbolId: "01900000-0000-7000-8000-000000000221",
    symbol: "startServer",
    startLine: 1,
    endLine: 3,
    content: "export function startServer() { return true; }",
    contentHash: "sha256:chunk-one",
  },
  {
    id: "01900000-0000-7000-8000-000000000202",
    snapshotId: job.snapshotId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    fileId: "01900000-0000-7000-8000-000000000212",
    path: "src/database.ts",
    symbolId: null,
    symbol: null,
    startLine: 1,
    endLine: 2,
    content: "export const transaction = true;",
    contentHash: "sha256:chunk-two",
  },
];

function createStore(options: { cancelled?: boolean; leaseOwned?: boolean } = {}) {
  let remaining = [...chunks];
  const store: EmbeddingIndexerStore = {
    cancelEmbeddingJob: vi.fn(async () => undefined),
    claimEmbeddingJob: vi.fn(async () => null),
    completeEmbeddingJob: vi.fn(async () => undefined),
    failEmbeddingJob: vi.fn(async () => undefined),
    heartbeatJob: vi.fn(async () => options.leaseOwned ?? true),
    isCancellationRequested: vi.fn(async () => options.cancelled ?? false),
    listEmbeddingBatch: vi.fn(async (_indexId, limit) => remaining.slice(0, limit)),
    saveEmbeddingBatch: vi.fn(async (input: SaveEmbeddingBatchInput) => {
      const saved = new Set(input.rows.map((row) => row.codeChunkId));
      remaining = remaining.filter((chunk) => !saved.has(chunk.id));
    }),
  };
  return store;
}

function createDependencies(
  provider = new TestDeterministicEmbeddingProvider(8, job.model),
): EmbeddingIndexerDependencies {
  return { createProvider: vi.fn(() => provider) };
}

describe("executeEmbeddingJob", () => {
  it("embeds bounded batches, persists their hashes, and completes the job", async () => {
    const store = createStore();
    const dependencies = createDependencies();

    await expect(executeEmbeddingJob(store, job, config, dependencies)).resolves.toBe("succeeded");

    expect(store.saveEmbeddingBatch).toHaveBeenCalledTimes(2);
    expect(store.saveEmbeddingBatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dimensions: 8,
        rows: [
          expect.objectContaining({
            codeChunkId: chunks[0]?.id,
            contentHash: chunks[0]?.contentHash,
            inputHash: expect.stringMatching(/^sha256:/),
            embedding: expect.any(Array),
          }),
        ],
      }),
    );
    expect(store.completeEmbeddingJob).toHaveBeenCalledWith(
      job.id,
      job.embeddingIndexId,
      job.snapshotId,
      config.WORKER_ID,
    );
    expect(store.failEmbeddingJob).not.toHaveBeenCalled();
  });

  it("permanently fails a job when the worker profile does not match", async () => {
    const store = createStore();
    const dependencies = createDependencies();

    await expect(
      executeEmbeddingJob(
        store,
        job,
        { ...config, EMBEDDING_MODEL: "different-model" },
        dependencies,
      ),
    ).resolves.toBe("failed");

    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(store.failEmbeddingJob).toHaveBeenCalledWith(
      job.id,
      job.embeddingIndexId,
      job.snapshotId,
      config.WORKER_ID,
      "EMBEDDING_PROVIDER_MISMATCH",
      expect.any(String),
      false,
    );
  });

  it("preserves retryability for temporary provider failures", async () => {
    const store = createStore();
    const provider = new TestDeterministicEmbeddingProvider(8, job.model);
    vi.spyOn(provider, "embed").mockRejectedValue(
      new DomainError("EMBEDDING_UPSTREAM_UNAVAILABLE", "Provider unavailable.", {
        retryable: true,
      }),
    );

    await expect(
      executeEmbeddingJob(store, job, config, createDependencies(provider)),
    ).resolves.toBe("failed");
    expect(store.failEmbeddingJob).toHaveBeenCalledWith(
      job.id,
      job.embeddingIndexId,
      job.snapshotId,
      config.WORKER_ID,
      "EMBEDDING_UPSTREAM_UNAVAILABLE",
      "Provider unavailable.",
      true,
    );
  });

  it("honors cancellation before sending a provider request", async () => {
    const store = createStore({ cancelled: true });
    const dependencies = createDependencies();

    await expect(executeEmbeddingJob(store, job, config, dependencies)).resolves.toBe("cancelled");
    expect(dependencies.createProvider).not.toHaveBeenCalled();
    expect(store.cancelEmbeddingJob).toHaveBeenCalledWith(
      job.id,
      job.embeddingIndexId,
      job.snapshotId,
      config.WORKER_ID,
    );
  });

  it("does not overwrite state after losing the lease", async () => {
    const store = createStore({ leaseOwned: false });

    await expect(executeEmbeddingJob(store, job, config, createDependencies())).resolves.toBe(
      "lease-lost",
    );
    expect(store.failEmbeddingJob).not.toHaveBeenCalled();
    expect(store.cancelEmbeddingJob).not.toHaveBeenCalled();
  });
});
