import {
  type AskRequest,
  type CreateRepositoryRequest,
  type CreateRepositoryResponse,
  createRepositoryResponseSchema,
  type Evidence,
  evidenceSchema,
  type GroundedAnswer,
  groundedAnswerSchema,
  idSchema,
  type Job,
  jobSchema,
  type RepositorySummary,
  repositorySummarySchema,
  type Snapshot,
  snapshotSchema,
} from "@repovista/contracts";
import { CLI_USER_AGENT } from "./version.js";

const repositoryListSchema = repositorySummarySchema.array();
const snapshotListSchema = snapshotSchema.array();
const evidenceListSchema = evidenceSchema.array();

export interface AskResult {
  messageId: string;
  answer: GroundedAnswer;
  evidence: Evidence[];
}

export interface AskRepositoryRequest extends AskRequest {
  snapshotId?: string;
}

export interface ApiErrorOptions {
  cause?: unknown;
  code?: string;
  details?: Record<string, unknown>;
  requestId?: string;
  retryable?: boolean;
  status?: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = options.code ?? "REQUEST_FAILED";
    this.details = options.details;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string };
}

interface ApiFailure {
  error: {
    code: string;
    details?: Record<string, unknown>;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}

type Decoder<T> = (value: unknown) => T;

export interface RepoVistaClientOptions {
  apiUrl: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return isRecord(value) && "data" in value;
}

function isApiFailure(value: unknown): value is ApiFailure {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.message === "string";
}

function parseApiUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError("The API URL is invalid.", { code: "API_URL_INVALID" });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError("The API URL must use HTTP or HTTPS.", { code: "API_URL_INVALID" });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ApiError("The API URL cannot contain credentials, a query, or a fragment.", {
      code: "API_URL_INVALID",
    });
  }
  return parsed.toString().replace(/\/+$/, "");
}

function decodeAskResult(value: unknown): AskResult {
  if (!isRecord(value)) throw new Error("Expected an object.");
  return {
    messageId: idSchema.parse(value.messageId),
    answer: groundedAnswerSchema.parse(value.answer),
    evidence: evidenceListSchema.parse(value.evidence),
  };
}

export class RepoVistaClient {
  readonly apiUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: RepoVistaClientOptions) {
    this.apiUrl = parseApiUrl(options.apiUrl);
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  async health(): Promise<{ status: "ok" }> {
    const payload = await this.requestPayload("/v1/health/ready");
    if (!isRecord(payload) || payload.status !== "ok") {
      throw new ApiError("The API returned an invalid health response.", {
        code: "API_RESPONSE_INVALID",
      });
    }
    return { status: "ok" };
  }

  createRepository(input: CreateRepositoryRequest): Promise<CreateRepositoryResponse> {
    return this.requestEnvelope(
      "/v1/repositories",
      { method: "POST", body: JSON.stringify(input) },
      (value) => createRepositoryResponseSchema.parse(value),
    );
  }

  listRepositories(): Promise<RepositorySummary[]> {
    return this.requestEnvelope("/v1/repositories", {}, (value) =>
      repositoryListSchema.parse(value),
    );
  }

  getRepository(repositoryId: string): Promise<RepositorySummary> {
    return this.requestEnvelope(
      `/v1/repositories/${encodeURIComponent(repositoryId)}`,
      {},
      (value) => repositorySummarySchema.parse(value),
    );
  }

  listSnapshots(repositoryId: string): Promise<Snapshot[]> {
    return this.requestEnvelope(
      `/v1/repositories/${encodeURIComponent(repositoryId)}/snapshots`,
      {},
      (value) => snapshotListSchema.parse(value),
    );
  }

  getSnapshot(snapshotId: string): Promise<Snapshot> {
    return this.requestEnvelope(`/v1/snapshots/${encodeURIComponent(snapshotId)}`, {}, (value) =>
      snapshotSchema.parse(value),
    );
  }

  getJob(jobId: string): Promise<Job> {
    return this.requestEnvelope(`/v1/jobs/${encodeURIComponent(jobId)}`, {}, (value) =>
      jobSchema.parse(value),
    );
  }

  ask(repositoryId: string, input: AskRepositoryRequest): Promise<AskResult> {
    return this.requestEnvelope(
      `/v1/repositories/${encodeURIComponent(repositoryId)}/ask`,
      { method: "POST", body: JSON.stringify(input) },
      decodeAskResult,
    );
  }

  private async requestEnvelope<T>(
    pathname: string,
    init: RequestInit,
    decode: Decoder<T>,
  ): Promise<T> {
    const payload = await this.requestPayload(pathname, init);
    if (!isApiEnvelope(payload)) {
      throw new ApiError("The API returned a response without a data envelope.", {
        code: "API_RESPONSE_INVALID",
      });
    }
    try {
      return decode(payload.data);
    } catch (cause) {
      throw new ApiError("The API returned data that does not match the RepoVista contract.", {
        cause,
        code: "API_RESPONSE_INVALID",
        requestId:
          isRecord(payload.meta) && typeof payload.meta.requestId === "string"
            ? payload.meta.requestId
            : undefined,
      });
    }
  }

  private async requestPayload(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", CLI_USER_AGENT);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.apiUrl}${pathname}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ApiError(`The API request timed out after ${this.requestTimeoutMs}ms.`, {
          cause,
          code: "REQUEST_TIMEOUT",
          retryable: true,
        });
      }
      throw new ApiError(`Unable to reach the RepoVista API at ${this.apiUrl}.`, {
        cause,
        code: "API_UNREACHABLE",
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const failure = isApiFailure(payload) ? payload.error : undefined;
      throw new ApiError(
        failure?.message ?? `The API request failed with HTTP ${response.status}.`,
        {
          code: failure?.code ?? `HTTP_${response.status}`,
          details: failure?.details,
          requestId: failure?.requestId ?? response.headers.get("x-request-id") ?? undefined,
          retryable: failure?.retryable ?? response.status >= 500,
          status: response.status,
        },
      );
    }
    if (payload === null) {
      throw new ApiError("The API returned an empty or non-JSON response.", {
        code: "API_RESPONSE_INVALID",
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
    }
    return payload;
  }
}
