import {
  type AskRequest,
  type AskResult,
  type AuthSession,
  askResultSchema,
  authSessionSchema,
  type CreateEmbeddingIndexResponse,
  type CreateRepositoryRequest,
  type CreateRepositoryResponse,
  createEmbeddingIndexResponseSchema,
  createRepositoryResponseSchema,
  type GitHubInstallation,
  type GitHubInstallationRepositoryPage,
  type GuardrailComparison,
  type GuardrailProfile,
  type GuardrailReport,
  githubInstallationRepositoryPageSchema,
  githubInstallationSchema,
  guardrailComparisonSchema,
  guardrailProfileSchema,
  guardrailReportSchema,
  type Job,
  jobSchema,
  type RepositorySummary,
  repositorySummarySchema,
  type SearchResult,
  type Snapshot,
  searchResultSchema,
  snapshotSchema,
} from "@repovista/contracts";
import { CLI_USER_AGENT } from "./version.js";

const repositoryListSchema = repositorySummarySchema.array();
const snapshotListSchema = snapshotSchema.array();
const guardrailProfileListSchema = guardrailProfileSchema.array();
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
  apiToken?: string;
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

export class RepoVistaClient {
  readonly apiUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly apiToken: string | null;

  constructor(options: RepoVistaClientOptions) {
    this.apiUrl = parseApiUrl(options.apiUrl);
    this.fetchImplementation = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.apiToken = options.apiToken ?? null;
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

  authSession(): Promise<AuthSession> {
    return this.requestEnvelope("/v1/auth/session", {}, (value) => authSessionSchema.parse(value));
  }

  listGitHubInstallations(): Promise<GitHubInstallation[]> {
    return this.requestEnvelope("/v1/integrations/github/installations", {}, (value) =>
      githubInstallationSchema.array().parse(value),
    );
  }

  listInstallationRepositories(
    installationId: number,
    page = 1,
    pageSize = 50,
  ): Promise<GitHubInstallationRepositoryPage> {
    const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return this.requestEnvelope(
      `/v1/integrations/github/installations/${installationId}/repositories?${parameters.toString()}`,
      {},
      (value) => githubInstallationRepositoryPageSchema.parse(value),
    );
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
      (value) => askResultSchema.parse(value),
    );
  }

  searchSnapshot(
    snapshotId: string,
    query: string,
    mode: "text" | "symbol" | "semantic" | "hybrid",
    limit: number,
  ): Promise<SearchResult> {
    const parameters = new URLSearchParams({ q: query, mode, limit: String(limit) });
    return this.requestEnvelope(
      `/v1/snapshots/${encodeURIComponent(snapshotId)}/search?${parameters.toString()}`,
      {},
      (value) => searchResultSchema.parse(value),
    );
  }

  createEmbeddingIndex(snapshotId: string): Promise<CreateEmbeddingIndexResponse> {
    return this.requestEnvelope(
      `/v1/snapshots/${encodeURIComponent(snapshotId)}/embeddings`,
      { method: "POST" },
      (value) => createEmbeddingIndexResponseSchema.parse(value),
    );
  }

  getGuardrails(snapshotId: string): Promise<GuardrailReport> {
    return this.requestEnvelope(
      `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails`,
      {},
      (value) => guardrailReportSchema.parse(value),
    );
  }

  compareGuardrails(baseSnapshotId: string, headSnapshotId: string): Promise<GuardrailComparison> {
    const query = new URLSearchParams({ baseSnapshotId });
    return this.requestEnvelope(
      `/v1/snapshots/${encodeURIComponent(headSnapshotId)}/guardrails/compare?${query.toString()}`,
      {},
      (value) => guardrailComparisonSchema.parse(value),
    );
  }

  listGuardrailProfiles(): Promise<GuardrailProfile[]> {
    return this.requestEnvelope("/v1/guardrail-profiles", {}, (value) =>
      guardrailProfileListSchema.parse(value),
    );
  }

  createGuardrailProfile(input: {
    profileKey: string;
    name: string;
    description: string;
    thresholds: GuardrailProfile["thresholds"];
  }): Promise<GuardrailProfile> {
    return this.requestEnvelope(
      "/v1/guardrail-profiles",
      { method: "POST", body: JSON.stringify(input) },
      (value) => guardrailProfileSchema.parse(value),
    );
  }

  getRepositoryGuardrailProfile(repositoryId: string): Promise<GuardrailProfile> {
    return this.requestEnvelope(
      `/v1/repositories/${encodeURIComponent(repositoryId)}/guardrail-profile`,
      {},
      (value) => guardrailProfileSchema.parse(value),
    );
  }

  assignRepositoryGuardrailProfile(
    repositoryId: string,
    profileId: string | null,
  ): Promise<GuardrailProfile> {
    return this.requestEnvelope(
      `/v1/repositories/${encodeURIComponent(repositoryId)}/guardrail-profile`,
      { method: "PUT", body: JSON.stringify({ profileId }) },
      (value) => guardrailProfileSchema.parse(value),
    );
  }

  async downloadGuardrailsSarif(snapshotId: string): Promise<{ body: string; filename: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const headers = new Headers({
      Accept: "application/sarif+json",
      "User-Agent": CLI_USER_AGENT,
    });
    if (this.apiToken) headers.set("Authorization", `Bearer ${this.apiToken}`);
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.apiUrl}/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/sarif`,
        { headers, signal: controller.signal },
      );
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
    const body = await response.text();
    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(body);
      } catch {
        // Keep the stable HTTP error below when a proxy returns non-JSON.
      }
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
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ??
      disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim() ??
      `repovista-${snapshotId}-guardrails.sarif`;
    return { body, filename };
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
    if (this.apiToken) headers.set("Authorization", `Bearer ${this.apiToken}`);
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
