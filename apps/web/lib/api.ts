import type {
  ApiTokenMetadata,
  AuthSession,
  AskResult as ContractAskResult,
  CreateEmbeddingIndexResponse,
  GitHubIntegrationStatus,
  GraphResponse,
  GuardrailComparison,
  GuardrailExplanation,
  GuardrailExplanationComparison,
  GuardrailExplanationHistory,
  GuardrailExplanationSummary,
  GuardrailReport,
  GuardrailReview,
  GuardrailReviewHistoryPage,
  GuardrailReviewsResponse,
  Job,
  NotificationDelivery,
  NotificationDeliveryPage,
  NotificationEndpoint,
  NotificationEventType,
  PullRequestAnalysis,
  PullRequestFileChange,
  PullRequestImpact,
  PullRequestImpactResponse,
  PullRequestSymbolChange,
  RepositorySummary,
  RetrievalStatus,
  SearchResult,
  ShareReportContent,
  Snapshot,
  SnapshotSymbolEvidence,
  SourceFile,
  WorkspaceMember,
  WorkspaceSummary,
} from "@repovista/contracts";

export const apiOrigin =
  process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/+$/, "") ?? "http://localhost:4000";

export interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string };
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
    retryable: boolean;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; requestId?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "REQUEST_FAILED";
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? false;
  }
}

let csrfToken: string | null = null;

export function setApiCsrfToken(value: string | null): void {
  csrfToken = value;
}

export function apiErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof ApiError)) return fallback;
  return `${cause.message}${cause.requestId ? ` Request ID: ${cause.requestId}` : ""}`;
}

/**
 * Build a direct download URL for a deterministic snapshot export.
 *
 * Export responses are deliberately not routed through apiFetch: they are
 * attachment bodies (Markdown/SVG), not JSON envelopes.
 */
export function snapshotExportUrl(
  snapshotId: string,
  format: "markdown" | "svg",
  level: "package" | "file" | "symbol" = "package",
): string {
  const encodedSnapshotId = encodeURIComponent(snapshotId);
  const suffix =
    format === "svg" ? `/exports/svg?level=${encodeURIComponent(level)}` : "/exports/markdown";
  return `${apiOrigin}/v1/snapshots/${encodedSnapshotId}${suffix}`;
}

export type SnapshotExportFormat = "markdown" | "svg";

export interface SnapshotExportDownload {
  blob: Blob;
  filename: string;
}

export interface GuardrailSarifDownload {
  blob: Blob;
  filename: string;
}

export interface GuardrailJsonDownload {
  blob: Blob;
  filename: string;
}

function defaultExportFilename(
  snapshotId: string,
  format: SnapshotExportFormat,
  level: "package" | "file" | "symbol",
): string {
  const extension = format === "markdown" ? "md" : "svg";
  const suffix = format === "svg" ? `-${level}` : "";
  return `repovista-${snapshotId}${suffix}.${extension}`;
}

function contentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain =
    value.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ?? value.match(/filename\s*=\s*([^;]+)/i)?.[1];
  let candidate = plain;
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      candidate = encoded;
    }
  }
  if (!candidate) return null;
  const safe = Array.from(candidate, (character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 0x20 || code === 0x7f
      ? "_"
      : character;
  })
    .join("")
    .trim();
  return safe || null;
}

/**
 * Fetch an export as an authenticated browser request. Direct cross-origin
 * anchor navigation cannot reliably carry the active workspace cookie, while
 * this request explicitly opts into credentials and turns the response into a
 * local Blob download.
 */
export async function fetchSnapshotExport(
  snapshotId: string,
  format: SnapshotExportFormat,
  level: "package" | "file" | "symbol" = "package",
): Promise<SnapshotExportDownload> {
  const response = await fetch(snapshotExportUrl(snapshotId, format, level), {
    credentials: "include",
    headers: { Accept: format === "markdown" ? "text/markdown" : "image/svg+xml" },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiFailure | null;
    const failure = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(failure?.message ?? `Export failed with status ${response.status}.`, {
      code: failure?.code ?? "EXPORT_FAILED",
      requestId: failure?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      retryable: failure?.retryable,
    });
  }
  return {
    blob: await response.blob(),
    filename:
      contentDispositionFilename(response.headers.get("content-disposition")) ??
      defaultExportFilename(snapshotId, format, level),
  };
}

export async function fetchGuardrailSarif(snapshotId: string): Promise<GuardrailSarifDownload> {
  const response = await fetch(
    `${apiOrigin}/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/sarif`,
    {
      credentials: "include",
      headers: { Accept: "application/sarif+json" },
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiFailure | null;
    const failure = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(failure?.message ?? `SARIF export failed with status ${response.status}.`, {
      code: failure?.code ?? "GUARDRAIL_EXPORT_FAILED",
      requestId: failure?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      retryable: failure?.retryable,
    });
  }
  return {
    blob: await response.blob(),
    filename:
      contentDispositionFilename(response.headers.get("content-disposition")) ??
      `repovista-${snapshotId}-guardrails.sarif`,
  };
}

export async function fetchGuardrailJson(snapshotId: string): Promise<GuardrailJsonDownload> {
  const response = await fetch(
    `${apiOrigin}/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/json`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiFailure | null;
    const failure = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(failure?.message ?? `JSON export failed with status ${response.status}.`, {
      code: failure?.code ?? "GUARDRAIL_EXPORT_FAILED",
      requestId: failure?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      retryable: failure?.retryable,
    });
  }
  return {
    blob: await response.blob(),
    filename:
      contentDispositionFilename(response.headers.get("content-disposition")) ??
      `repovista-${snapshotId}-guardrails.json`,
  };
}

export function vscodeEvidenceUrl(input: {
  repositoryId: string;
  snapshotId: string;
  commitSha: string;
  path: string;
  startLine: number;
  endLine: number;
}): string {
  const query = new URLSearchParams({
    repositoryId: input.repositoryId,
    snapshotId: input.snapshotId,
    commitSha: input.commitSha,
    path: input.path,
    startLine: String(input.startLine),
    endLine: String(input.endLine),
  });
  return `vscode://yueliang.repovista/openEvidence?${query.toString()}`;
}

export async function apiFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (mutation && csrfToken) headers.set("X-RepoVista-CSRF", csrfToken);
  const response = await fetch(`${apiOrigin}${pathname}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | ApiFailure | null;
  if (!response.ok) {
    const failure = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(failure?.message ?? `Request failed with status ${response.status}.`, {
      code: failure?.code,
      requestId: failure?.requestId ?? response.headers.get("x-request-id") ?? undefined,
      retryable: failure?.retryable,
    });
  }
  if (!payload || !("data" in payload)) {
    throw new ApiError("The API returned an invalid response.");
  }
  return payload.data;
}

export interface CreateRepositoryResult {
  jobId: string;
  repositoryId: string;
  snapshotId: string;
  status: "queued";
}

export type CreatePullRequestAnalysisResult =
  import("@repovista/contracts").CreatePullRequestAnalysisResponse;
export type {
  PullRequestAnalysis,
  PullRequestFileChange,
  PullRequestImpact,
  PullRequestImpactResponse,
  PullRequestSymbolChange,
  SnapshotSymbolEvidence,
};

export interface SnapshotFileSummary {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  blobHash: string;
  parseStatus: string;
}

export interface SnapshotFilePage {
  files: SnapshotFileSummary[];
  nextCursor: string | null;
}

export type AskResult = ContractAskResult;
export type {
  GuardrailExplanation,
  GuardrailExplanationComparison,
  GuardrailExplanationHistory,
  GuardrailExplanationSummary,
  GuardrailReview,
  GuardrailReviewsResponse,
};
export type {
  GuardrailReviewHistoryPage,
  NotificationDelivery,
  NotificationDeliveryPage,
  NotificationEndpoint,
  NotificationEventType,
};

export interface GuardrailExplanationResult {
  explanation: GuardrailExplanation;
  reused: boolean;
}

export type { CreateEmbeddingIndexResponse, RetrievalStatus, SearchResult };
export type { GuardrailReport };
export type { GuardrailComparison };

export interface CreateNotificationEndpointResult {
  endpoint: NotificationEndpoint;
  signingSecret: string;
}

export async function listGuardrailReviewHistory(
  snapshotId: string,
  options: {
    findingId?: string;
    status?: GuardrailReview["status"];
    cursor?: string;
    limit?: number;
  } = {},
): Promise<GuardrailReviewHistoryPage> {
  const query = new URLSearchParams();
  if (options.findingId) query.set("findingId", options.findingId);
  if (options.status) query.set("status", options.status);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<GuardrailReviewHistoryPage>(
    `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/reviews/history${suffix}`,
    { cache: "no-store" },
  );
}

export async function listNotificationEndpoints(
  workspaceId: string,
): Promise<NotificationEndpoint[]> {
  return apiFetch<NotificationEndpoint[]>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-endpoints`,
    { cache: "no-store" },
  );
}

export async function createNotificationEndpoint(
  workspaceId: string,
  input: {
    name: string;
    url: string;
    eventTypes?: NotificationEventType[];
    enabled?: boolean;
  },
): Promise<CreateNotificationEndpointResult> {
  return apiFetch<CreateNotificationEndpointResult>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-endpoints`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateNotificationEndpoint(
  workspaceId: string,
  endpointId: string,
  input: {
    name?: string;
    url?: string;
    eventTypes?: NotificationEventType[];
    enabled?: boolean;
  },
): Promise<NotificationEndpoint> {
  return apiFetch<NotificationEndpoint>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-endpoints/${encodeURIComponent(endpointId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteNotificationEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<void> {
  await apiFetch<void>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-endpoints/${encodeURIComponent(endpointId)}`,
    { method: "DELETE" },
  );
}

export async function testNotificationEndpoint(
  workspaceId: string,
  endpointId: string,
): Promise<NotificationDelivery> {
  return apiFetch<NotificationDelivery>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-endpoints/${encodeURIComponent(endpointId)}/test`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function listNotificationDeliveries(
  workspaceId: string,
  options: {
    endpointId?: string;
    status?: NotificationDelivery["status"];
    cursor?: string;
    limit?: number;
  } = {},
): Promise<NotificationDeliveryPage> {
  const query = new URLSearchParams();
  if (options.endpointId) query.set("endpointId", options.endpointId);
  if (options.status) query.set("status", options.status);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiFetch<NotificationDeliveryPage>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/notification-deliveries${suffix}`,
    { cache: "no-store" },
  );
}

export interface ShareReport {
  id: string;
  slug: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  repository: RepositorySummary;
  snapshot: Snapshot;
  content: ShareReportContent;
  createdAt: string;
}

export type { ApiTokenMetadata, AuthSession, WorkspaceMember, WorkspaceSummary };

export type {
  GitHubIntegrationStatus,
  GraphResponse,
  Job,
  RepositorySummary,
  Snapshot,
  SourceFile,
};
