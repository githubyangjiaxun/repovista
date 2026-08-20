import type { AppConfig } from "@repovista/config";
import type {
  EmbeddingIndex,
  RetrievalChannel,
  RetrievalChannelTrace,
  RetrievalMode,
  RetrievalUnavailableReason,
  SearchResult,
} from "@repovista/contracts";
import { searchResultSchema } from "@repovista/contracts";
import type { RepoVistaStore } from "@repovista/database";
import { DomainError, isDomainError } from "@repovista/domain";
import {
  createEmbeddingProvider,
  EMBEDDING_INPUT_VERSION,
  type EmbeddingModelProvider,
} from "@repovista/embeddings";
import { type ChannelResult, channelsForMode, fuseRetrievalChannels } from "@repovista/retrieval";

export type RetrievalStore = Pick<
  RepoVistaStore,
  | "getRetrievalStatus"
  | "getSnapshot"
  | "searchSemanticEvidence"
  | "searchSymbolEvidence"
  | "searchTextEvidence"
>;

export type RetrievalConfig = Pick<
  AppConfig,
  | "EMBEDDING_MODEL"
  | "EMBEDDING_PROVIDER"
  | "EMBEDDING_REQUEST_TIMEOUT_MS"
  | "OLLAMA_BASE_URL"
  | "OPENAI_COMPATIBLE_API_KEY"
  | "OPENAI_COMPATIBLE_BASE_URL"
>;

export interface RetrievalDependencies {
  createProvider(config: RetrievalConfig): EmbeddingModelProvider | null;
  now(): number;
}

export interface RetrieveEvidenceInput {
  snapshotId: string;
  query: string;
  mode: RetrievalMode;
  limit: number;
}

interface ChannelExecution {
  result: ChannelResult | null;
  trace: RetrievalChannelTrace;
  embeddingIndex: EmbeddingIndex | null;
}

const defaultDependencies: RetrievalDependencies = {
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
  now: () => Date.now(),
};

function requireReadySnapshot(snapshot: Awaited<ReturnType<RetrievalStore["getSnapshot"]>>): void {
  if (!snapshot) {
    throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
  }
  if (snapshot.status !== "ready" || !snapshot.commitSha) {
    throw new DomainError("SNAPSHOT_NOT_READY", "The requested snapshot is not ready yet.", {
      retryable: true,
    });
  }
}

function unavailableError(reason: RetrievalUnavailableReason): DomainError {
  return new DomainError(
    "RETRIEVAL_MODE_UNAVAILABLE",
    "Semantic retrieval is not available for the requested snapshot.",
    {
      retryable: reason === "index_building" || reason === "provider_unavailable",
      details: { reason },
    },
  );
}

function reasonForError(error: unknown): RetrievalUnavailableReason {
  if (!isDomainError(error)) return "provider_unavailable";
  if (error.code === "EMBEDDING_DIMENSION_MISMATCH") return "dimension_mismatch";
  if (error.code === "EMBEDDING_PROVIDER_MISMATCH" || error.code === "EMBEDDING_MODEL_REQUIRED") {
    return "model_mismatch";
  }
  if (error.code === "EMBEDDING_INDEX_NOT_FOUND") return "index_missing";
  if (error.code === "EMBEDDING_INDEX_NOT_READY") return "index_building";
  return "provider_unavailable";
}

function configuredProfile(config: RetrievalConfig) {
  return {
    provider: config.EMBEDDING_PROVIDER === "none" ? null : config.EMBEDDING_PROVIDER,
    model: config.EMBEDDING_MODEL ?? null,
    inputVersion: EMBEDDING_INPUT_VERSION,
  };
}

async function executeLexicalChannel(
  store: RetrievalStore,
  channel: "text" | "symbol",
  input: RetrieveEvidenceInput,
  candidateLimit: number,
  now: () => number,
): Promise<ChannelExecution> {
  const startedAt = now();
  const candidates =
    channel === "text"
      ? await store.searchTextEvidence(input.snapshotId, input.query, candidateLimit)
      : await store.searchSymbolEvidence(input.snapshotId, input.query, candidateLimit);
  return {
    result: { channel, candidates },
    trace: {
      channel,
      status: "used",
      candidateCount: candidates.length,
      reason: null,
      latencyMs: Math.max(0, now() - startedAt),
    },
    embeddingIndex: null,
  };
}

async function executeSemanticChannel(
  store: RetrievalStore,
  config: RetrievalConfig,
  input: RetrieveEvidenceInput,
  candidateLimit: number,
  dependencies: RetrievalDependencies,
): Promise<ChannelExecution> {
  const startedAt = dependencies.now();
  const status = await store.getRetrievalStatus({
    snapshotId: input.snapshotId,
    ...configuredProfile(config),
  });
  const embeddingIndex = status.semantic.currentIndex ?? status.semantic.latestIndex;
  if (!status.semantic.queryable || !status.semantic.currentIndex) {
    const reason = status.semantic.reason ?? "index_missing";
    if (input.mode === "semantic") throw unavailableError(reason);
    return {
      result: null,
      trace: {
        channel: "semantic",
        status: "unavailable",
        candidateCount: 0,
        reason,
        latencyMs: Math.max(0, dependencies.now() - startedAt),
      },
      embeddingIndex,
    };
  }

  try {
    // Profile and worker configuration are compared explicitly before any
    // network call so a mixed model cannot silently query the wrong index.
    if (
      config.EMBEDDING_PROVIDER === "none" ||
      !config.EMBEDDING_MODEL ||
      status.semantic.currentIndex.provider !== config.EMBEDDING_PROVIDER ||
      status.semantic.currentIndex.model !== config.EMBEDDING_MODEL
    ) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_MISMATCH",
        "The query provider does not match the ready embedding profile.",
      );
    }
    if (config.EMBEDDING_PROVIDER === "openai-compatible" && !config.OPENAI_COMPATIBLE_BASE_URL) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_MISMATCH",
        "The OpenAI-compatible embedding endpoint is not configured.",
      );
    }
    const provider = dependencies.createProvider(config);
    if (
      !provider ||
      provider.id !== status.semantic.currentIndex.provider ||
      provider.model !== status.semantic.currentIndex.model
    ) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_MISMATCH",
        "The query provider does not match the ready embedding profile.",
      );
    }
    const embedded = await provider.embed([input.query]);
    const vector = embedded.vectors[0];
    if (!vector || embedded.dimensions === null) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider returned no query vector.",
      );
    }
    if (embedded.model !== status.semantic.currentIndex.model) {
      throw new DomainError(
        "EMBEDDING_PROVIDER_MISMATCH",
        "The embedding provider returned a different model.",
      );
    }
    if (
      status.semantic.currentIndex.dimensions !== null &&
      embedded.dimensions !== status.semantic.currentIndex.dimensions
    ) {
      throw new DomainError(
        "EMBEDDING_DIMENSION_MISMATCH",
        "The query vector dimensions do not match the ready embedding profile.",
      );
    }
    const candidates = await store.searchSemanticEvidence({
      snapshotId: input.snapshotId,
      embeddingIndexId: status.semantic.currentIndex.id,
      queryVector: vector,
      limit: candidateLimit,
    });
    return {
      result: { channel: "semantic", candidates },
      trace: {
        channel: "semantic",
        status: "used",
        candidateCount: candidates.length,
        reason: null,
        latencyMs: Math.max(0, dependencies.now() - startedAt),
      },
      embeddingIndex: status.semantic.currentIndex,
    };
  } catch (error) {
    if (input.mode === "semantic") throw error;
    return {
      result: null,
      trace: {
        channel: "semantic",
        status: "failed",
        candidateCount: 0,
        reason: reasonForError(error),
        latencyMs: Math.max(0, dependencies.now() - startedAt),
      },
      embeddingIndex,
    };
  }
}

export async function retrieveEvidence(
  store: RetrievalStore,
  config: RetrievalConfig,
  input: RetrieveEvidenceInput,
  dependencies: RetrievalDependencies = defaultDependencies,
): Promise<SearchResult> {
  const query = input.query.trim();
  if (query.length < 2 || query.length > 4_000) {
    throw new DomainError("RETRIEVAL_INPUT_INVALID", "The retrieval query is invalid.");
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new DomainError("RETRIEVAL_INPUT_INVALID", "The retrieval limit is invalid.");
  }
  const snapshot = await store.getSnapshot(input.snapshotId);
  requireReadySnapshot(snapshot);
  const candidateLimit = Math.min(200, Math.max(20, input.limit * 4));
  const channels = channelsForMode(input.mode);
  const executions = await Promise.all(
    channels.map((channel: RetrievalChannel) =>
      channel === "semantic"
        ? executeSemanticChannel(store, config, { ...input, query }, candidateLimit, dependencies)
        : executeLexicalChannel(
            store,
            channel,
            { ...input, query },
            candidateLimit,
            dependencies.now,
          ),
    ),
  );
  const channelResults = executions.flatMap((execution) =>
    execution.result ? [execution.result] : [],
  );
  const traces = executions.map((execution) => execution.trace);
  const failedSemantic = traces.find(
    (trace) => trace.channel === "semantic" && trace.status !== "used",
  );
  const result = {
    query,
    trace: {
      requestedMode: input.mode,
      usedChannels: channels.filter((channel) =>
        traces.some((trace) => trace.channel === channel && trace.status === "used"),
      ),
      degraded: input.mode === "hybrid" && Boolean(failedSemantic),
      degradationReason: input.mode === "hybrid" && failedSemantic ? failedSemantic.reason : null,
      channels: traces,
      embeddingIndex:
        executions.find((execution) => execution.embeddingIndex)?.embeddingIndex ?? null,
    },
    results: fuseRetrievalChannels(channelResults, input.limit),
  };
  return searchResultSchema.parse(result);
}
