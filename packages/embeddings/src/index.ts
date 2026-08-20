import { createHash } from "node:crypto";
import type { EmbeddingProvider as EmbeddingProviderId } from "@repovista/contracts";
import { DomainError } from "@repovista/domain";

export const EMBEDDING_INPUT_VERSION = "code-chunk-v1";
export const MAX_EMBEDDING_DIMENSIONS = 16_000;

export interface CodeChunkEmbeddingInput {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

export interface BuiltEmbeddingInput {
  text: string;
  hash: string;
  version: typeof EMBEDDING_INPUT_VERSION;
  truncated: boolean;
}

export interface EmbeddingBatch {
  vectors: number[][];
  model: string;
  dimensions: number | null;
}

export interface EmbeddingModelProvider {
  readonly id: EmbeddingProviderId;
  readonly model: string;
  embed(input: readonly string[]): Promise<EmbeddingBatch>;
  healthCheck(): Promise<boolean>;
}

interface ProviderOptions {
  apiKey?: string;
  baseUrl: string;
  fetch?: typeof fetch;
  model: string;
  requestTimeoutMs?: number;
}

export interface CreateEmbeddingProviderOptions extends ProviderOptions {
  provider: "none" | EmbeddingProviderId;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function buildEmbeddingInput(
  input: CodeChunkEmbeddingInput,
  maximumCharacters = 12_000,
): BuiltEmbeddingInput {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters < 256) {
    throw new DomainError(
      "EMBEDDING_INPUT_LIMIT_INVALID",
      "The embedding input limit must be at least 256 characters.",
    );
  }
  if (
    !Number.isInteger(input.startLine) ||
    !Number.isInteger(input.endLine) ||
    input.startLine < 1 ||
    input.endLine < input.startLine
  ) {
    throw new DomainError(
      "EMBEDDING_INPUT_INVALID",
      "Embedding source ranges must use positive, ordered line numbers.",
    );
  }

  const header = [
    `PATH: ${input.path}`,
    `SYMBOL: ${input.symbol ?? "none"}`,
    `LINES: ${input.startLine}-${input.endLine}`,
    "CONTENT:",
  ].join("\n");
  const prefix = `${header}\n`;
  const availableContentCharacters = Math.max(0, maximumCharacters - prefix.length);
  const boundedContent = input.content.slice(0, availableContentCharacters);
  const text = `${prefix}${boundedContent}`.slice(0, maximumCharacters);
  return {
    text,
    hash: sha256(text),
    version: EMBEDDING_INPUT_VERSION,
    truncated: text.length < prefix.length + input.content.length,
  };
}

export function validateEmbeddingVectors(
  vectors: unknown,
  expectedCount: number,
): { dimensions: number | null; vectors: number[][] } {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new DomainError("EMBEDDING_OUTPUT_INVALID", "The expected embedding count is invalid.");
  }
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new DomainError(
      "EMBEDDING_OUTPUT_INVALID",
      "The embedding provider returned an unexpected number of vectors.",
    );
  }
  if (expectedCount === 0) return { dimensions: null, vectors: [] };

  let dimensions: number | null = null;
  const validated = vectors.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length < 1) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider returned an empty vector.",
      );
    }
    if (candidate.length > MAX_EMBEDDING_DIMENSIONS) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        `Embedding vectors cannot exceed ${MAX_EMBEDDING_DIMENSIONS} dimensions.`,
      );
    }
    if (dimensions === null) dimensions = candidate.length;
    if (candidate.length !== dimensions) {
      throw new DomainError(
        "EMBEDDING_DIMENSION_MISMATCH",
        "The embedding provider returned vectors with inconsistent dimensions.",
      );
    }

    let squaredNorm = 0;
    const vector = candidate.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(
          "EMBEDDING_OUTPUT_INVALID",
          "Embedding vectors must contain only finite numbers.",
        );
      }
      squaredNorm += value * value;
      return value;
    });
    if (!Number.isFinite(squaredNorm) || squaredNorm === 0) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider returned a zero or invalid vector.",
      );
    }
    return vector;
  });
  return { dimensions, vectors: validated };
}

function endpoint(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

function providerFailure(status: number): DomainError {
  const retryable = status === 429 || status >= 500;
  const code =
    status === 401 || status === 403
      ? "EMBEDDING_PROVIDER_UNAUTHORIZED"
      : "EMBEDDING_UPSTREAM_UNAVAILABLE";
  return new DomainError(code, "The configured embedding provider returned an error.", {
    retryable,
    details: { status },
  });
}

abstract class HttpEmbeddingProvider implements EmbeddingModelProvider {
  abstract readonly id: EmbeddingProviderId;
  readonly model: string;
  protected readonly baseUrl: string;
  protected readonly apiKey?: string;
  protected readonly fetchImplementation: typeof fetch;
  protected readonly requestTimeoutMs: number;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.model = options.model.trim();
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    if (!this.model) {
      throw new DomainError("EMBEDDING_MODEL_REQUIRED", "An embedding model must be configured.");
    }
  }

  protected async requestJson(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new DomainError(
        "EMBEDDING_UPSTREAM_UNAVAILABLE",
        "The configured embedding provider is unavailable.",
        { retryable: true, cause: error },
      );
    }
    if (!response.ok) throw providerFailure(response.status);
    try {
      return await response.json();
    } catch (error) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider returned invalid JSON.",
        { cause: error },
      );
    }
  }

  protected async check(url: string, headers?: HeadersInit): Promise<boolean> {
    try {
      const response = await this.fetchImplementation(url, {
        headers,
        signal: AbortSignal.timeout(Math.min(this.requestTimeoutMs, 5_000)),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  abstract embed(input: readonly string[]): Promise<EmbeddingBatch>;
  abstract healthCheck(): Promise<boolean>;
}

export class OllamaEmbeddingProvider extends HttpEmbeddingProvider {
  readonly id = "ollama" as const;

  async healthCheck(): Promise<boolean> {
    return this.check(endpoint(this.baseUrl, "/api/tags"));
  }

  async embed(input: readonly string[]): Promise<EmbeddingBatch> {
    if (input.length === 0) return { vectors: [], model: this.model, dimensions: null };
    const payload = (await this.requestJson(endpoint(this.baseUrl, "/api/embed"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input }),
    })) as { embeddings?: unknown; model?: unknown };
    const validated = validateEmbeddingVectors(payload.embeddings, input.length);
    return {
      ...validated,
      model:
        typeof payload.model === "string" && payload.model.length > 0 ? payload.model : this.model,
    };
  }
}

export class OpenAICompatibleEmbeddingProvider extends HttpEmbeddingProvider {
  readonly id = "openai-compatible" as const;

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async healthCheck(): Promise<boolean> {
    return this.check(endpoint(this.baseUrl, "/models"), this.headers());
  }

  async embed(input: readonly string[]): Promise<EmbeddingBatch> {
    if (input.length === 0) return { vectors: [], model: this.model, dimensions: null };
    const payload = (await this.requestJson(endpoint(this.baseUrl, "/embeddings"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: this.model, input, encoding_format: "float" }),
    })) as {
      data?: unknown;
      model?: unknown;
    };
    if (!Array.isArray(payload.data)) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider returned no indexed vectors.",
      );
    }
    const indexed = new Map<number, unknown>();
    for (const item of payload.data) {
      if (typeof item !== "object" || item === null) {
        throw new DomainError("EMBEDDING_OUTPUT_INVALID", "An embedding item is invalid.");
      }
      const record = item as { embedding?: unknown; index?: unknown };
      if (
        !Number.isInteger(record.index) ||
        (record.index as number) < 0 ||
        indexed.has(record.index as number)
      ) {
        throw new DomainError(
          "EMBEDDING_OUTPUT_INVALID",
          "Embedding response indexes must be unique non-negative integers.",
        );
      }
      indexed.set(record.index as number, record.embedding);
    }
    const ordered = input.map((_value, index) => indexed.get(index));
    if (ordered.some((value) => value === undefined)) {
      throw new DomainError(
        "EMBEDDING_OUTPUT_INVALID",
        "The embedding provider omitted one or more input vectors.",
      );
    }
    const validated = validateEmbeddingVectors(ordered, input.length);
    return {
      ...validated,
      model:
        typeof payload.model === "string" && payload.model.length > 0 ? payload.model : this.model,
    };
  }
}

/** A deterministic local provider for unit/integration tests. It is never selected by configuration. */
export class TestDeterministicEmbeddingProvider implements EmbeddingModelProvider {
  readonly id = "ollama" as const;
  readonly model: string;

  constructor(
    private readonly dimensions = 16,
    model = "test-deterministic-embedding",
  ) {
    if (!Number.isInteger(dimensions) || dimensions < 2 || dimensions > MAX_EMBEDDING_DIMENSIONS) {
      throw new DomainError("EMBEDDING_DIMENSION_MISMATCH", "Test dimensions are invalid.");
    }
    this.model = model;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async embed(input: readonly string[]): Promise<EmbeddingBatch> {
    const vectors = input.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      const tokens = text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_]+/u)
        .filter(Boolean);
      for (const token of tokens.length > 0 ? tokens : [text]) {
        const digest = createHash("sha256").update(token).digest();
        const slot = digest.readUInt16BE(0) % this.dimensions;
        vector[slot] = (vector[slot] ?? 0) + ((digest[2] ?? 0) % 2 === 0 ? 1 : -1);
      }
      const hasSignal = vector.some((value) => value !== 0);
      if (!hasSignal) vector[0] = 1;
      return vector;
    });
    const validated = validateEmbeddingVectors(vectors, input.length);
    return { ...validated, model: this.model };
  }
}

export function createEmbeddingProvider(
  options: CreateEmbeddingProviderOptions,
): EmbeddingModelProvider | null {
  if (options.provider === "none") return null;
  if (options.provider === "ollama") return new OllamaEmbeddingProvider(options);
  return new OpenAICompatibleEmbeddingProvider(options);
}
