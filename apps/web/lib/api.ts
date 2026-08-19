import type {
  Evidence,
  GraphResponse,
  GroundedAnswer,
  Job,
  RepositorySummary,
  Snapshot,
  SourceFile,
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

export function apiErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof ApiError)) return fallback;
  return `${cause.message}${cause.requestId ? ` Request ID: ${cause.requestId}` : ""}`;
}

export async function apiFetch<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiOrigin}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
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

export interface AskResult {
  messageId: string;
  answer: GroundedAnswer;
  evidence: Evidence[];
}

export interface ShareReport {
  id: string;
  slug: string;
  title: string;
  repository: RepositorySummary;
  snapshot: Snapshot;
  content: {
    overview: string;
    readingPath: { path: string; reason: string }[];
    map: unknown;
  };
  createdAt: string;
}

export type { GraphResponse, Job, RepositorySummary, Snapshot, SourceFile };
