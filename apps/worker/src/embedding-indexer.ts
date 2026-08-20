import type { AppConfig } from "@repovista/config";
import type { ClaimedEmbeddingJob, RepoVistaStore } from "@repovista/database";
import { DomainError, isDomainError } from "@repovista/domain";
import {
  buildEmbeddingInput,
  createEmbeddingProvider,
  EMBEDDING_INPUT_VERSION,
  type EmbeddingModelProvider,
} from "@repovista/embeddings";

export type EmbeddingIndexerStore = Pick<
  RepoVistaStore,
  | "cancelEmbeddingJob"
  | "claimEmbeddingJob"
  | "completeEmbeddingJob"
  | "failEmbeddingJob"
  | "heartbeatJob"
  | "isCancellationRequested"
  | "listEmbeddingBatch"
  | "saveEmbeddingBatch"
>;

export type EmbeddingIndexerConfig = Pick<
  AppConfig,
  | "EMBEDDING_BATCH_SIZE"
  | "EMBEDDING_INPUT_MAX_CHARS"
  | "EMBEDDING_MODEL"
  | "EMBEDDING_PROVIDER"
  | "EMBEDDING_REQUEST_TIMEOUT_MS"
  | "JOB_LEASE_SECONDS"
  | "OLLAMA_BASE_URL"
  | "OPENAI_COMPATIBLE_API_KEY"
  | "OPENAI_COMPATIBLE_BASE_URL"
  | "WORKER_ID"
>;

export interface EmbeddingIndexerDependencies {
  createProvider(config: EmbeddingIndexerConfig): EmbeddingModelProvider | null;
}

export type EmbeddingJobOutcome = "cancelled" | "failed" | "lease-lost" | "succeeded";

const defaultDependencies: EmbeddingIndexerDependencies = {
  createProvider(config) {
    const baseUrl =
      config.EMBEDDING_PROVIDER === "ollama"
        ? config.OLLAMA_BASE_URL
        : (config.OPENAI_COMPATIBLE_BASE_URL ?? "");
    return createEmbeddingProvider({
      provider: config.EMBEDDING_PROVIDER,
      model: config.EMBEDDING_MODEL ?? "",
      baseUrl,
      apiKey: config.OPENAI_COMPATIBLE_API_KEY,
      requestTimeoutMs: config.EMBEDDING_REQUEST_TIMEOUT_MS,
    });
  },
};

class EmbeddingCancellationRequested extends Error {
  constructor() {
    super("The embedding job was cancelled.");
    this.name = "EmbeddingCancellationRequested";
  }
}

class EmbeddingLeaseGuard {
  private timer: ReturnType<typeof setInterval> | null = null;
  private renewal: Promise<void> | null = null;
  private lost = false;
  private heartbeatFailure: unknown;

  constructor(
    private readonly store: EmbeddingIndexerStore,
    private readonly job: ClaimedEmbeddingJob,
    private readonly config: EmbeddingIndexerConfig,
  ) {}

  start(): void {
    const interval = Math.max(1_000, Math.floor((this.config.JOB_LEASE_SECONDS * 1_000) / 3));
    this.timer = setInterval(() => void this.renew().catch(() => undefined), interval);
    this.timer.unref();
  }

  async checkpoint(): Promise<void> {
    await this.renew();
    if (await this.store.isCancellationRequested(this.job.id)) {
      throw new EmbeddingCancellationRequested();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.renewal?.catch(() => undefined);
  }

  private async renew(): Promise<void> {
    if (this.lost) this.throwLeaseLost();
    if (this.renewal) {
      await this.renewal;
      if (this.lost) this.throwLeaseLost();
      return;
    }
    const renewal = (async () => {
      try {
        this.lost = !(await this.store.heartbeatJob(
          this.job.id,
          this.config.WORKER_ID,
          this.config.JOB_LEASE_SECONDS,
        ));
      } catch (error) {
        this.lost = true;
        this.heartbeatFailure = error;
      }
    })();
    this.renewal = renewal;
    await renewal;
    if (this.renewal === renewal) this.renewal = null;
    if (this.lost) this.throwLeaseLost();
  }

  private throwLeaseLost(): never {
    throw new DomainError("JOB_LEASE_LOST", "The worker no longer owns the embedding job.", {
      retryable: true,
      cause: this.heartbeatFailure,
    });
  }
}

function failure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (isDomainError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "EMBEDDING_INDEX_FAILED",
    message: error instanceof Error ? error.message : "The embedding job failed unexpectedly.",
    retryable: false,
  };
}

function requireMatchingProvider(
  job: ClaimedEmbeddingJob,
  config: EmbeddingIndexerConfig,
  dependencies: EmbeddingIndexerDependencies,
): EmbeddingModelProvider {
  if (
    config.EMBEDDING_PROVIDER === "none" ||
    config.EMBEDDING_PROVIDER !== job.provider ||
    config.EMBEDDING_MODEL !== job.model ||
    job.inputVersion !== EMBEDDING_INPUT_VERSION
  ) {
    throw new DomainError(
      "EMBEDDING_PROVIDER_MISMATCH",
      "The worker embedding configuration does not match the queued profile.",
    );
  }
  if (job.provider === "openai-compatible" && !config.OPENAI_COMPATIBLE_BASE_URL) {
    throw new DomainError(
      "EMBEDDING_PROVIDER_MISMATCH",
      "The OpenAI-compatible embedding endpoint is not configured.",
    );
  }
  const provider = dependencies.createProvider(config);
  if (!provider || provider.id !== job.provider || provider.model !== job.model) {
    throw new DomainError(
      "EMBEDDING_PROVIDER_MISMATCH",
      "The embedding provider factory returned a different profile.",
    );
  }
  return provider;
}

export async function executeEmbeddingJob(
  store: EmbeddingIndexerStore,
  job: ClaimedEmbeddingJob,
  config: EmbeddingIndexerConfig,
  dependencies: EmbeddingIndexerDependencies = defaultDependencies,
): Promise<EmbeddingJobOutcome> {
  const lease = new EmbeddingLeaseGuard(store, job, config);
  lease.start();
  try {
    await lease.checkpoint();
    const provider = requireMatchingProvider(job, config, dependencies);

    while (true) {
      await lease.checkpoint();
      const chunks = await store.listEmbeddingBatch(
        job.embeddingIndexId,
        config.EMBEDDING_BATCH_SIZE,
      );
      if (chunks.length === 0) {
        await lease.stop();
        await store.completeEmbeddingJob(
          job.id,
          job.embeddingIndexId,
          job.snapshotId,
          config.WORKER_ID,
        );
        return "succeeded";
      }

      const inputs = chunks.map((chunk) =>
        buildEmbeddingInput(
          {
            path: chunk.path,
            symbol: chunk.symbol,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            content: chunk.content,
          },
          config.EMBEDDING_INPUT_MAX_CHARS,
        ),
      );
      const embedded = await provider.embed(inputs.map((input) => input.text));
      await lease.checkpoint();
      if (embedded.model !== job.model) {
        throw new DomainError(
          "EMBEDDING_PROVIDER_MISMATCH",
          "The embedding provider returned a different model.",
        );
      }
      if (embedded.dimensions === null) {
        throw new DomainError(
          "EMBEDDING_OUTPUT_INVALID",
          "The embedding provider returned no vector dimensions.",
        );
      }
      await store.saveEmbeddingBatch({
        jobId: job.id,
        embeddingIndexId: job.embeddingIndexId,
        snapshotId: job.snapshotId,
        workerId: config.WORKER_ID,
        dimensions: embedded.dimensions,
        rows: chunks.map((chunk, index) => {
          const vector = embedded.vectors[index];
          const input = inputs[index];
          if (!vector || !input) {
            throw new DomainError(
              "EMBEDDING_OUTPUT_INVALID",
              "The embedding provider omitted a batch vector.",
            );
          }
          return {
            codeChunkId: chunk.id,
            contentHash: chunk.contentHash,
            inputHash: input.hash,
            embedding: vector,
          };
        }),
        processed: chunks.length,
        total: chunks.length,
        message: `Persisted ${chunks.length} embedding vectors.`,
      });
    }
  } catch (error) {
    await lease.stop();
    if (error instanceof EmbeddingCancellationRequested) {
      try {
        await store.cancelEmbeddingJob(
          job.id,
          job.embeddingIndexId,
          job.snapshotId,
          config.WORKER_ID,
        );
        return "cancelled";
      } catch (cancelError) {
        if (isDomainError(cancelError) && cancelError.code === "JOB_LEASE_LOST") {
          return "lease-lost";
        }
        throw cancelError;
      }
    }
    if (isDomainError(error) && error.code === "JOB_LEASE_LOST") return "lease-lost";
    const details = failure(error);
    try {
      await store.failEmbeddingJob(
        job.id,
        job.embeddingIndexId,
        job.snapshotId,
        config.WORKER_ID,
        details.code,
        details.message,
        details.retryable,
      );
      return "failed";
    } catch (failureError) {
      if (isDomainError(failureError) && failureError.code === "JOB_LEASE_LOST") {
        return "lease-lost";
      }
      throw failureError;
    }
  } finally {
    await lease.stop();
  }
}

export async function executeNextEmbeddingJob(
  store: EmbeddingIndexerStore,
  config: EmbeddingIndexerConfig,
  dependencies: EmbeddingIndexerDependencies = defaultDependencies,
): Promise<boolean> {
  const job = await store.claimEmbeddingJob(config.WORKER_ID, config.JOB_LEASE_SECONDS);
  if (!job) return false;
  await executeEmbeddingJob(store, job, config, dependencies);
  return true;
}
