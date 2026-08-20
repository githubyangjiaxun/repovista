import { createHash } from "node:crypto";
import type {
  EmbeddingIndex,
  EmbeddingProvider,
  Job,
  PullRequestAnalysis,
  PullRequestAnalysisStatus,
  PullRequestFileChange,
  PullRequestImpact,
  PullRequestSymbolChange,
  RepositorySummary,
  Snapshot,
  SnapshotSymbolEvidence,
  SourceFile,
} from "@repovista/contracts";
import {
  embeddingIndexSchema,
  idSchema,
  pullRequestAnalysisSchema,
  pullRequestImpactSchema,
  retrievalStatusSchema,
  shareReportContentSchema,
  snapshotStatsSchema,
} from "@repovista/contracts";
import {
  createId,
  DomainError,
  type IndexedRepository,
  isDomainError,
  type JobProgress,
  PUBLIC_USER_ID,
  PUBLIC_WORKSPACE_ID,
} from "@repovista/domain";
import type { DatabaseClient, DatabasePool } from "./pool.js";
import { withTransaction } from "./pool.js";
import type {
  ClaimedEmbeddingJob,
  ClaimedIndexJob,
  CompletePullRequestAnalysisInput,
  CreateImportInput,
  CreateImportResult,
  CreatePullRequestAnalysisInput,
  CreatePullRequestAnalysisResult,
  EmbeddingChunkRecord,
  EmbeddingIndexInput,
  EmbeddingIndexResult,
  EmbeddingSearchOptions,
  GitHubWebhookInput,
  GitHubWebhookProcessResult,
  IncrementalIndexBase,
  JobEventRecord,
  ListSnapshotFilesOptions,
  PullRequestAnalysisCursor,
  PullRequestAnalysisJob,
  PullRequestAnalysisPage,
  RetrievalSearchRecord,
  RetrievalStatusOptions,
  RetrievalStatusResult,
  SaveAnswerInput,
  SaveEmbeddingBatchInput,
  SearchEvidenceRecord,
  ShareReportContent,
  ShareReportRecord,
  SnapshotFilePage,
  SnapshotFileRecord,
  SnapshotGraphData,
  SymbolEdgeRecord,
  SymbolRecord,
} from "./types.js";

interface RepositoryRow {
  id: string;
  owner_name: string;
  repo_name: string;
  canonical_url: string;
  default_branch: string | null;
  latest_ready_snapshot_id: string | null;
  latest_snapshot_status: Snapshot["status"] | null;
  latest_commit_sha: string | null;
  auto_update_enabled: boolean;
  last_webhook_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SnapshotRow {
  id: string;
  repository_id: string;
  commit_sha: string | null;
  ref_name: string | null;
  status: Snapshot["status"];
  parser_version: string;
  base_snapshot_id: string | null;
  index_mode: "full" | "incremental";
  tree_hash: string | null;
  stats_json: unknown;
  error_code: string | null;
  error_message: string | null;
  requested_at: Date | string;
  ready_at: Date | string | null;
}

interface JobRow {
  id: string;
  snapshot_id: string | null;
  analysis_id: string | null;
  job_type: string;
  status: Job["status"];
  phase: string | null;
  progress: number;
  processed: string | number | null;
  total: string | number | null;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean;
}

interface PullRequestAnalysisRow {
  id: string;
  repository_id: string;
  pr_number: number;
  title: string;
  canonical_url: string;
  base_sha: string;
  head_sha: string;
  base_snapshot_id: string | null;
  head_snapshot_id: string | null;
  parser_version: string;
  algorithm_version: string;
  revision: number;
  status: PullRequestAnalysisStatus;
  progress: number;
  stats_json: unknown;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

function mapPullRequestAnalysis(row: PullRequestAnalysisRow): PullRequestAnalysis {
  return pullRequestAnalysisSchema.parse({
    id: row.id,
    repositoryId: row.repository_id,
    prNumber: row.pr_number,
    title: row.title,
    url: row.canonical_url,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    baseSnapshotId: row.base_snapshot_id,
    headSnapshotId: row.head_snapshot_id,
    parserVersion: row.parser_version,
    algorithmVersion: row.algorithm_version,
    revision: row.revision,
    status: row.status,
    progress: Number(row.progress),
    stats: row.stats_json ?? {
      changedFiles: 0,
      changedSymbols: 0,
      directImpacts: 0,
      transitiveImpacts: 0,
      unknownImpacts: 0,
      truncated: false,
    },
    failure:
      row.error_code === null
        ? null
        : {
            code: row.error_code,
            message: row.error_message ?? "Pull request analysis failed.",
            retryable: row.error_retryable,
          },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: nullableIso(row.completed_at),
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function invalidImpactCursor(): never {
  throw new DomainError("PAGINATION_CURSOR_INVALID", "The impact pagination cursor is invalid.");
}

function decodeImpactCursor(value: string): PullRequestAnalysisCursor {
  if (value.length > 1_000 || !/^[A-Za-z0-9_-]+$/.test(value)) invalidImpactCursor();
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof decoded !== "object" || decoded === null) invalidImpactCursor();
    const cursor = decoded as Record<string, unknown>;
    if (
      cursor.v !== 1 ||
      typeof cursor.riskScore !== "number" ||
      !Number.isFinite(cursor.riskScore) ||
      cursor.riskScore < 0 ||
      cursor.riskScore > 1 ||
      typeof cursor.path !== "string" ||
      cursor.path.length === 0 ||
      cursor.path.length > 1_000 ||
      typeof cursor.startLine !== "number" ||
      !Number.isInteger(cursor.startLine) ||
      cursor.startLine < 1 ||
      !idSchema.safeParse(cursor.id).success
    ) {
      invalidImpactCursor();
    }
    return {
      riskScore: cursor.riskScore,
      path: cursor.path,
      startLine: cursor.startLine,
      id: cursor.id as string,
    };
  } catch (error) {
    if (isDomainError(error)) throw error;
    return invalidImpactCursor();
  }
}

function encodeImpactCursor(cursor: PullRequestAnalysisCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}

function mapRepository(row: RepositoryRow): RepositorySummary {
  return {
    id: row.id,
    owner: row.owner_name,
    name: row.repo_name,
    canonicalUrl: row.canonical_url,
    defaultBranch: row.default_branch,
    latestSnapshotId: row.latest_ready_snapshot_id,
    latestSnapshotStatus: row.latest_snapshot_status,
    latestCommitSha: row.latest_commit_sha,
    autoUpdateEnabled: row.auto_update_enabled ?? false,
    lastWebhookAt: nullableIso(row.last_webhook_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    commitSha: row.commit_sha,
    refName: row.ref_name,
    status: row.status,
    parserVersion: row.parser_version,
    baseSnapshotId: row.base_snapshot_id,
    indexMode: row.index_mode,
    treeHash: row.tree_hash,
    stats: snapshotStatsSchema.parse(row.stats_json ?? {}),
    requestedAt: iso(row.requested_at),
    readyAt: nullableIso(row.ready_at),
    failure:
      row.error_code === null
        ? null
        : {
            code: row.error_code,
            message: row.error_message ?? "Snapshot indexing failed.",
          },
  };
}

interface EmbeddingIndexRow {
  id: string;
  snapshot_id: string;
  provider: EmbeddingProvider;
  model: string;
  input_version: string;
  status: EmbeddingIndex["status"];
  dimensions: number | null;
  total_chunks: number;
  embedded_chunks: number;
  revision: number;
  job_id: string | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  ready_at: Date | string | null;
}

function mapEmbeddingIndex(row: EmbeddingIndexRow): EmbeddingIndex {
  return embeddingIndexSchema.parse({
    id: row.id,
    snapshotId: row.snapshot_id,
    provider: row.provider,
    model: row.model,
    inputVersion: row.input_version,
    status: row.status,
    dimensions: row.dimensions === null ? null : Number(row.dimensions),
    totalChunks: Number(row.total_chunks),
    embeddedChunks: Number(row.embedded_chunks),
    revision: Number(row.revision),
    jobId: row.job_id,
    failure:
      row.error_code === null
        ? null
        : {
            code: row.error_code,
            message: row.error_message ?? "Embedding index failed.",
            retryable: row.error_retryable,
          },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    readyAt: nullableIso(row.ready_at),
  });
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    analysisId: row.analysis_id,
    type: row.job_type,
    status: row.status,
    phase: row.phase,
    progress: Number(row.progress),
    processed: row.processed === null ? null : Number(row.processed),
    total: row.total === null ? null : Number(row.total),
    retryable: row.error_retryable,
    error:
      row.error_code === null
        ? null
        : {
            code: row.error_code,
            message: row.error_message ?? "Job failed.",
          },
  };
}

function sourceSlice(content: string, startLine: number, endLine: number): string {
  return content
    .split(/\r?\n/)
    .slice(Math.max(0, startLine - 1), Math.max(startLine, endLine))
    .join("\n");
}

function hashText(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function approximateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function vectorLiteral(values: readonly number[]): string {
  if (values.length < 1 || values.length > 16_000) {
    throw new DomainError(
      "EMBEDDING_OUTPUT_INVALID",
      "The embedding vector dimensions are invalid.",
    );
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new DomainError(
      "EMBEDDING_OUTPUT_INVALID",
      "Embedding vectors must contain finite numbers.",
    );
  }
  return `[${values.join(",")}]`;
}

function fileTextChunks(content: string, maximumCharacters = 100_000) {
  const lines = content.split(/\r?\n/);
  const chunks: { content: string; endLine: number; startLine: number }[] = [];
  let selected: string[] = [];
  let selectedCharacters = 0;
  let startLine = 1;

  const flush = (endLine: number) => {
    const chunkContent = selected.join("\n");
    if (chunkContent.trim().length > 0) {
      chunks.push({ content: chunkContent, startLine, endLine });
    }
    selected = [];
    selectedCharacters = 0;
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.length > maximumCharacters) {
      if (selected.length > 0) flush(lineNumber - 1);
      for (let offset = 0; offset < line.length; offset += maximumCharacters) {
        chunks.push({
          content: line.slice(offset, offset + maximumCharacters),
          startLine: lineNumber,
          endLine: lineNumber,
        });
      }
      startLine = lineNumber + 1;
      continue;
    }

    const separatorCharacters = selected.length > 0 ? 1 : 0;
    if (
      selected.length > 0 &&
      selectedCharacters + separatorCharacters + line.length > maximumCharacters
    ) {
      flush(lineNumber - 1);
      startLine = lineNumber;
    }
    selected.push(line);
    selectedCharacters += (selected.length > 1 ? 1 : 0) + line.length;
  }
  if (selected.length > 0) flush(lines.length);
  return chunks;
}

export class RepoVistaStore {
  constructor(readonly pool: DatabasePool) {}

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createRepositoryImport(input: CreateImportInput): Promise<CreateImportResult> {
    return withTransaction(this.pool, async (client) => {
      const existingRepository = await client.query<{ id: string }>(
        "SELECT id FROM repositories WHERE workspace_id = $1 AND canonical_url = $2",
        [input.workspaceId, input.identity.canonicalUrl],
      );

      const repositoryId = existingRepository.rows[0]?.id ?? createId();
      if (existingRepository.rowCount === 0) {
        await client.query(
          "INSERT INTO repositories (" +
            "id, workspace_id, provider, canonical_url, clone_url, owner_name, repo_name, visibility, ignore_patterns" +
            ") VALUES ($1, $2, 'github', $3, $4, $5, $6, 'public', $7::jsonb)",
          [
            repositoryId,
            input.workspaceId,
            input.identity.canonicalUrl,
            input.identity.cloneUrl,
            input.identity.owner,
            input.identity.name,
            JSON.stringify(input.ignore),
          ],
        );
      } else {
        await client.query(
          "UPDATE repositories SET ignore_patterns = $2::jsonb, updated_at = now() WHERE id = $1",
          [repositoryId, JSON.stringify(input.ignore)],
        );
      }

      const active = await client.query<{
        snapshot_id: string;
        job_id: string;
      }>(
        "SELECT s.id AS snapshot_id, j.id AS job_id " +
          "FROM repository_snapshots s " +
          "JOIN analysis_jobs j ON j.snapshot_id = s.id " +
          "WHERE s.repository_id = $1 " +
          "AND s.requested_ref IS NOT DISTINCT FROM $2 " +
          "AND j.status IN ('queued', 'running') " +
          "ORDER BY j.created_at DESC LIMIT 1",
        [repositoryId, input.requestedRef ?? null],
      );

      const activeRow = active.rows[0];
      if (activeRow) {
        return {
          repositoryId,
          snapshotId: activeRow.snapshot_id,
          jobId: activeRow.job_id,
          status: "queued" as const,
        };
      }

      const snapshotId = createId();
      const jobId = createId();
      await client.query(
        "INSERT INTO repository_snapshots (" +
          "id, repository_id, requested_ref, status, parser_version" +
          ") VALUES ($1, $2, $3, 'requested', $4)",
        [snapshotId, repositoryId, input.requestedRef ?? null, input.parserVersion],
      );
      await client.query(
        "INSERT INTO analysis_jobs (" +
          "id, workspace_id, repository_id, snapshot_id, job_type, status, idempotency_key" +
          ") VALUES ($1, $2, $3, $4, 'index_snapshot', 'queued', $5)",
        [
          jobId,
          input.workspaceId,
          repositoryId,
          snapshotId,
          [repositoryId, input.requestedRef ?? "HEAD", input.parserVersion, snapshotId].join(":"),
        ],
      );
      await this.appendJobEvent(client, jobId, "queued", {
        phase: "queued",
        progress: 0,
        snapshotId,
      });

      return { repositoryId, snapshotId, jobId, status: "queued" as const };
    });
  }

  async createPullRequestAnalysis(
    input: CreatePullRequestAnalysisInput,
  ): Promise<CreatePullRequestAnalysisResult> {
    if (!/^[a-f0-9]{40}$/i.test(input.baseSha) || !/^[a-f0-9]{40}$/i.test(input.headSha)) {
      throw new DomainError(
        "PULL_REQUEST_SHA_INVALID",
        "Pull request commits must be full SHA-1 values.",
      );
    }
    return withTransaction(this.pool, async (client) => {
      const repository = await client.query<{
        id: string;
        owner_name: string;
        repo_name: string;
      }>("SELECT id, owner_name, repo_name FROM repositories WHERE id = $1 AND workspace_id = $2", [
        input.repositoryId,
        input.workspaceId,
      ]);
      if (!repository.rows[0]) {
        throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `pr-analysis:${input.repositoryId}:${input.prNumber}`,
      ]);
      const baseIdempotencyKey = [
        input.repositoryId,
        input.prNumber,
        input.baseSha.toLowerCase(),
        input.headSha.toLowerCase(),
        input.parserVersion,
        input.algorithmVersion,
      ].join(":");
      if (input.forceRevision === undefined) {
        const existing = await client.query<{
          id: string;
          revision: number;
          status: Job["status"];
        }>(
          "SELECT a.id, a.revision, COALESCE(j.status, a.status) AS status " +
            "FROM pull_request_analyses a LEFT JOIN analysis_jobs j ON j.analysis_id = a.id " +
            "WHERE a.idempotency_key = $1 ORDER BY a.revision DESC LIMIT 1",
          [baseIdempotencyKey],
        );
        if (existing.rows[0]) {
          const old = existing.rows[0];
          const job = await client.query<{ id: string }>(
            "SELECT id FROM analysis_jobs WHERE analysis_id = $1 ORDER BY created_at DESC LIMIT 1",
            [old.id],
          );
          return {
            analysisId: old.id,
            jobId: job.rows[0]?.id ?? old.id,
            revision: old.revision,
            status: old.status,
          };
        }
      }
      const revisionResult = await client.query<{ revision: number }>(
        "SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM pull_request_analyses " +
          "WHERE repository_id = $1 AND pr_number = $2",
        [input.repositoryId, input.prNumber],
      );
      const nextRevision = revisionResult.rows[0]?.revision ?? 1;
      const revision = input.forceRevision ?? nextRevision;
      if (revision !== nextRevision) {
        throw new DomainError(
          "PR_ANALYSIS_REVISION_CONFLICT",
          "The pull request analysis revision is no longer current.",
          { retryable: true },
        );
      }
      const idempotencyKey =
        input.forceRevision === undefined
          ? baseIdempotencyKey
          : `${baseIdempotencyKey}:revision:${revision}`;
      const analysisId = createId();
      const jobId = createId();
      await client.query(
        "INSERT INTO pull_request_analyses (" +
          "id, workspace_id, repository_id, pr_number, title, canonical_url, base_sha, head_sha, " +
          "parser_version, algorithm_version, provider_files_json, revision, status, idempotency_key" +
          ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, 'queued', $13)",
        [
          analysisId,
          input.workspaceId,
          input.repositoryId,
          input.prNumber,
          input.title,
          input.canonicalUrl,
          input.baseSha.toLowerCase(),
          input.headSha.toLowerCase(),
          input.parserVersion,
          input.algorithmVersion,
          JSON.stringify(input.providerFiles),
          revision,
          idempotencyKey,
        ],
      );
      await client.query(
        "INSERT INTO analysis_jobs (" +
          "id, workspace_id, repository_id, job_type, status, idempotency_key, analysis_id" +
          ") VALUES ($1, $2, $3, 'pull_request_analysis', 'queued', $4, $5)",
        [jobId, input.workspaceId, input.repositoryId, `pr-analysis:${idempotencyKey}`, analysisId],
      );
      await this.appendJobEvent(client, jobId, "queued", {
        phase: "queued",
        progress: 0,
        analysisId,
        revision,
      });
      return { analysisId, jobId, revision, status: "queued" as const };
    });
  }

  async getPullRequestAnalysis(analysisId: string): Promise<PullRequestAnalysis | null> {
    const result = await this.pool.query<PullRequestAnalysisRow>(
      "SELECT id, repository_id, pr_number, title, canonical_url, base_sha, head_sha, " +
        "base_snapshot_id, head_snapshot_id, parser_version, algorithm_version, revision, status, " +
        "progress, stats_json, error_code, error_message, error_retryable, created_at, updated_at, completed_at " +
        "FROM pull_request_analyses WHERE id = $1",
      [analysisId],
    );
    const row = result.rows[0];
    return row ? mapPullRequestAnalysis(row) : null;
  }

  async getPullRequestAnalysisJobId(analysisId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      "SELECT id FROM analysis_jobs WHERE analysis_id = $1 ORDER BY created_at DESC LIMIT 1",
      [analysisId],
    );
    return result.rows[0]?.id ?? null;
  }

  async ensureSnapshotForCommit(input: {
    repositoryId: string;
    workspaceId: string;
    commitSha: string;
    parserVersion: string;
  }): Promise<{
    snapshotId: string;
    jobId: string | null;
    status: "ready" | "queued" | "running";
  }> {
    const commitSha = input.commitSha.toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(commitSha)) {
      throw new DomainError(
        "PULL_REQUEST_SHA_INVALID",
        "A snapshot commit must be a full SHA-1 value.",
      );
    }
    return withTransaction(this.pool, async (client) => {
      const repository = await client.query<{ id: string; clone_url: string }>(
        "SELECT id, clone_url FROM repositories WHERE id = $1 AND workspace_id = $2",
        [input.repositoryId, input.workspaceId],
      );
      if (!repository.rows[0]) {
        throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `commit-snapshot:${input.repositoryId}:${commitSha}:${input.parserVersion}`,
      ]);
      const ready = await client.query<{ id: string }>(
        "SELECT id FROM repository_snapshots WHERE repository_id = $1 AND commit_sha = $2 " +
          "AND parser_version = $3 AND status = 'ready' ORDER BY ready_at DESC LIMIT 1",
        [input.repositoryId, commitSha, input.parserVersion],
      );
      if (ready.rows[0])
        return { snapshotId: ready.rows[0].id, jobId: null, status: "ready" as const };
      const active = await client.query<{
        snapshot_id: string;
        job_id: string;
        status: "queued" | "running";
      }>(
        "SELECT s.id AS snapshot_id, j.id AS job_id, j.status FROM repository_snapshots s " +
          "JOIN analysis_jobs j ON j.snapshot_id = s.id " +
          "WHERE s.repository_id = $1 AND s.requested_ref = $2 AND s.parser_version = $3 " +
          "AND j.job_type = 'index_snapshot' AND j.status IN ('queued', 'running') " +
          "ORDER BY j.created_at DESC LIMIT 1",
        [input.repositoryId, commitSha, input.parserVersion],
      );
      if (active.rows[0]) {
        return {
          snapshotId: active.rows[0].snapshot_id,
          jobId: active.rows[0].job_id,
          status: active.rows[0].status,
        };
      }
      const snapshotId = createId();
      const jobId = createId();
      await client.query(
        "INSERT INTO repository_snapshots (id, repository_id, requested_ref, status, parser_version, promote_latest) " +
          "VALUES ($1, $2, $3, 'requested', $4, false)",
        [snapshotId, input.repositoryId, commitSha, input.parserVersion],
      );
      await client.query(
        "INSERT INTO analysis_jobs (id, workspace_id, repository_id, snapshot_id, job_type, status, idempotency_key) " +
          "VALUES ($1, $2, $3, $4, 'index_snapshot', 'queued', $5)",
        [
          jobId,
          input.workspaceId,
          input.repositoryId,
          snapshotId,
          `commit:${input.repositoryId}:${commitSha}:${input.parserVersion}:${snapshotId}`,
        ],
      );
      await this.appendJobEvent(client, jobId, "queued", {
        phase: "queued",
        progress: 0,
        snapshotId,
        source: "pull_request_analysis",
      });
      return { snapshotId, jobId, status: "queued" as const };
    });
  }

  async attachPullRequestSnapshots(
    analysisId: string,
    baseSnapshotId: string,
    headSnapshotId: string,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE pull_request_analyses SET base_snapshot_id = $2, head_snapshot_id = $3, updated_at = now() " +
        "WHERE id = $1 AND status IN ('queued', 'running')",
      [analysisId, baseSnapshotId, headSnapshotId],
    );
  }

  async updatePullRequestAnalysisProgress(
    jobId: string,
    analysisId: string,
    workerId: string,
    progress: { phase: string; value: number; message: string },
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const updated = await client.query(
        "UPDATE analysis_jobs SET phase = $2, progress = $3 WHERE id = $1 AND analysis_id = $4 " +
          "AND lease_owner = $5 AND status = 'running'",
        [jobId, progress.phase, progress.value, analysisId, workerId],
      );
      if (updated.rowCount !== 1) {
        throw new DomainError(
          "JOB_LEASE_LOST",
          "The pull request analysis lease is no longer owned.",
          {
            retryable: true,
          },
        );
      }
      await client.query(
        "UPDATE pull_request_analyses SET status = 'running', progress = $2, updated_at = now() WHERE id = $1",
        [analysisId, progress.value],
      );
      await this.appendJobEvent(client, jobId, "progress", {
        phase: progress.phase,
        progress: progress.value,
        message: progress.message,
        analysisId,
      });
    });
  }

  async completePullRequestAnalysis(input: CompletePullRequestAnalysisInput): Promise<void> {
    const computation = input.computation;
    const expectedStats = {
      changedFiles: computation.files.length,
      changedSymbols: computation.symbols.length,
      directImpacts: computation.impacts.filter((impact) => impact.impactType === "direct").length,
      transitiveImpacts: computation.impacts.filter((impact) => impact.impactType === "transitive")
        .length,
      unknownImpacts: computation.impacts.filter((impact) => impact.impactType === "unknown")
        .length,
    };
    if (
      computation.stats.changedFiles !== expectedStats.changedFiles ||
      computation.stats.changedSymbols !== expectedStats.changedSymbols ||
      computation.stats.directImpacts !== expectedStats.directImpacts ||
      computation.stats.transitiveImpacts !== expectedStats.transitiveImpacts ||
      computation.stats.unknownImpacts !== expectedStats.unknownImpacts
    ) {
      throw new DomainError(
        "PR_IMPACT_STATS_INVALID",
        "The pull request impact statistics do not match the persisted result.",
      );
    }
    await withTransaction(this.pool, async (client) => {
      const lease = await client.query<{ id: string }>(
        "SELECT id FROM analysis_jobs WHERE id = $1 AND analysis_id = $2 AND lease_owner = $3 " +
          "AND status = 'running' FOR UPDATE",
        [input.jobId, input.analysisId, input.workerId],
      );
      if (!lease.rows[0]) {
        throw new DomainError(
          "JOB_LEASE_LOST",
          "The pull request analysis lease is no longer owned.",
          {
            retryable: true,
          },
        );
      }
      const analysis = await client.query<{
        repository_id: string;
        base_sha: string;
        head_sha: string;
        base_snapshot_id: string | null;
        head_snapshot_id: string | null;
        parser_version: string;
        algorithm_version: string;
        status: PullRequestAnalysisStatus;
      }>(
        "SELECT repository_id, base_sha, head_sha, base_snapshot_id, head_snapshot_id, " +
          "parser_version, algorithm_version, status FROM pull_request_analyses WHERE id = $1 FOR UPDATE",
        [input.analysisId],
      );
      const analysisRow = analysis.rows[0];
      if (!analysisRow)
        throw new DomainError("PR_ANALYSIS_NOT_FOUND", "The analysis does not exist.");
      if (
        analysisRow.status !== "running" ||
        (analysisRow.base_snapshot_id !== null &&
          analysisRow.base_snapshot_id !== input.baseSnapshotId) ||
        (analysisRow.head_snapshot_id !== null &&
          analysisRow.head_snapshot_id !== input.headSnapshotId)
      ) {
        throw new DomainError(
          "PR_ANALYSIS_INVARIANT_FAILED",
          "The analysis no longer owns the selected immutable snapshots.",
        );
      }

      const snapshotIds = [...new Set([input.baseSnapshotId, input.headSnapshotId])];
      const snapshots = await client.query<{
        id: string;
        repository_id: string;
        commit_sha: string | null;
        parser_version: string;
        status: Snapshot["status"];
      }>(
        "SELECT id, repository_id, commit_sha, parser_version, status " +
          "FROM repository_snapshots WHERE id = ANY($1::uuid[]) FOR SHARE",
        [snapshotIds],
      );
      const snapshotById = new Map(snapshots.rows.map((snapshot) => [snapshot.id, snapshot]));
      const assertSnapshot = (snapshotId: string, commitSha: string): void => {
        const snapshot = snapshotById.get(snapshotId);
        if (
          !snapshot ||
          snapshot.repository_id !== analysisRow.repository_id ||
          snapshot.status !== "ready" ||
          snapshot.commit_sha !== commitSha ||
          snapshot.parser_version !== analysisRow.parser_version
        ) {
          throw new DomainError(
            "PR_SNAPSHOT_INVARIANT_FAILED",
            "A pull request snapshot does not match the fixed repository, commit, and parser version.",
          );
        }
      };
      assertSnapshot(input.baseSnapshotId, analysisRow.base_sha);
      assertSnapshot(input.headSnapshotId, analysisRow.head_sha);

      const evidenceEntries = computation.impacts.flatMap((impact) =>
        impact.evidence.map((evidence) => ({ impact, evidence })),
      );
      const stableEvidenceIds = new Set<string>();
      for (const { impact, evidence } of evidenceEntries) {
        const expectedSnapshotId =
          impact.side === "base" ? input.baseSnapshotId : input.headSnapshotId;
        const expectedCommitSha =
          impact.side === "base" ? analysisRow.base_sha : analysisRow.head_sha;
        if (
          evidence.id.length === 0 ||
          evidence.id.length > 1_000 ||
          stableEvidenceIds.has(evidence.id) ||
          evidence.snapshotId !== expectedSnapshotId ||
          evidence.commitSha !== expectedCommitSha ||
          evidence.algorithmVersion !== analysisRow.algorithm_version
        ) {
          throw new DomainError(
            "PR_EVIDENCE_INVARIANT_FAILED",
            "Impact evidence is duplicated or does not belong to its fixed snapshot.",
          );
        }
        stableEvidenceIds.add(evidence.id);
      }

      const evidenceFileIds = [...new Set(evidenceEntries.map(({ evidence }) => evidence.fileId))];
      const evidenceSymbolIds = [
        ...new Set(
          evidenceEntries
            .map(({ evidence }) => evidence.symbolId)
            .filter((symbolId): symbolId is string => symbolId !== null),
        ),
      ];
      const evidenceFiles = evidenceFileIds.length
        ? (
            await client.query<{
              id: string;
              snapshot_id: string;
              path: string;
              line_count: number;
              inline_content: string;
            }>(
              "SELECT f.id, f.snapshot_id, f.path, f.line_count, b.inline_content " +
                "FROM snapshot_files f JOIN content_blobs b ON b.hash = f.blob_hash " +
                "WHERE f.id = ANY($1::uuid[])",
              [evidenceFileIds],
            )
          ).rows
        : [];
      const evidenceSymbols = evidenceSymbolIds.length
        ? (
            await client.query<{
              id: string;
              snapshot_id: string;
              snapshot_file_id: string;
              start_line: number;
              end_line: number;
            }>(
              "SELECT id, snapshot_id, snapshot_file_id, start_line, end_line " +
                "FROM symbols WHERE id = ANY($1::uuid[])",
              [evidenceSymbolIds],
            )
          ).rows
        : [];
      const evidenceFileById = new Map(evidenceFiles.map((file) => [file.id, file]));
      const evidenceSymbolById = new Map(evidenceSymbols.map((symbol) => [symbol.id, symbol]));
      for (const { evidence } of evidenceEntries) {
        const file = evidenceFileById.get(evidence.fileId);
        const symbol = evidence.symbolId ? evidenceSymbolById.get(evidence.symbolId) : null;
        const storedQuote = file?.inline_content
          .split(/\r?\n/)
          .slice(
            Math.max(0, evidence.startLine - 1),
            Math.max(evidence.startLine, evidence.endLine),
          )
          .join("\n")
          .slice(0, 8_000);
        const storedHash =
          storedQuote === undefined
            ? null
            : `sha256:${createHash("sha256").update(storedQuote).digest("hex")}`;
        if (
          !file ||
          file.snapshot_id !== evidence.snapshotId ||
          file.path !== evidence.path ||
          evidence.startLine < 1 ||
          evidence.endLine < evidence.startLine ||
          evidence.endLine > file.line_count ||
          storedQuote !== evidence.quote ||
          storedHash !== evidence.contentHash ||
          (evidence.symbolId !== null &&
            (!symbol ||
              symbol.snapshot_id !== evidence.snapshotId ||
              symbol.snapshot_file_id !== evidence.fileId ||
              evidence.startLine < symbol.start_line ||
              evidence.endLine > symbol.end_line))
        ) {
          throw new DomainError(
            "PR_EVIDENCE_INVARIANT_FAILED",
            "Impact evidence does not match persisted source, symbols, and line ranges.",
          );
        }
      }

      for (const file of computation.files) {
        const id = createId();
        await client.query(
          "INSERT INTO pull_request_files (id, analysis_id, path, old_path, change_type, base_blob_hash, head_blob_hash, additions, deletions, is_binary) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [
            id,
            input.analysisId,
            file.path,
            file.oldPath,
            file.changeType,
            file.baseBlobHash,
            file.headBlobHash,
            file.additions,
            file.deletions,
            file.binary,
          ],
        );
      }
      for (const change of computation.symbols) {
        const id = createId();
        const snapshotId = change.side === "base" ? input.baseSnapshotId : input.headSnapshotId;
        await client.query(
          "INSERT INTO pull_request_symbol_changes (id, analysis_id, snapshot_id, snapshot_side, symbol_id, stable_key, path, name, kind, start_line, end_line, change_type) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [
            id,
            input.analysisId,
            snapshotId,
            change.side,
            change.symbolId,
            change.stableKey,
            change.path,
            change.name,
            change.kind,
            change.startLine,
            change.endLine,
            change.changeType,
          ],
        );
      }
      const impactIds = new Map<string, string>();
      for (const impact of computation.impacts) {
        if (impactIds.has(impact.id)) {
          throw new DomainError("PR_IMPACT_DUPLICATE", "Impact identifiers must be unique.");
        }
        const id = createId();
        impactIds.set(impact.id, id);
        const snapshotId = impact.side === "base" ? input.baseSnapshotId : input.headSnapshotId;
        await client.query(
          "INSERT INTO pull_request_impacts (id, analysis_id, snapshot_id, snapshot_side, symbol_id, stable_key, path, name, kind, start_line, end_line, impact_type, distance, risk_score, risk_level, risk_breakdown_json, truncated) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)",
          [
            id,
            input.analysisId,
            snapshotId,
            impact.side,
            impact.symbolId,
            impact.stableKey,
            impact.path,
            impact.name,
            impact.kind,
            impact.startLine,
            impact.endLine,
            impact.impactType,
            impact.distance,
            impact.riskScore,
            impact.riskLevel,
            JSON.stringify(impact.riskBreakdown),
            impact.truncated,
          ],
        );
      }

      const persistedEvidence = new Map<string, { id: string; impactId: string }>();
      for (const impact of computation.impacts) {
        const impactId = impactIds.get(impact.id);
        if (!impactId) throw new DomainError("PR_IMPACT_DUPLICATE", "An impact ID is missing.");
        for (const evidence of impact.evidence) {
          const evidenceId = createId();
          persistedEvidence.set(evidence.id, { id: evidenceId, impactId: impact.id });
          await client.query(
            "INSERT INTO pull_request_evidence (id, stable_id, analysis_id, impact_id, snapshot_id, commit_sha, file_id, symbol_id, path, start_line, end_line, quote, content_hash, relation_type, algorithm_version) " +
              "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
            [
              evidenceId,
              evidence.id,
              input.analysisId,
              impactId,
              evidence.snapshotId,
              evidence.commitSha,
              evidence.fileId,
              evidence.symbolId,
              evidence.path,
              evidence.startLine,
              evidence.endLine,
              evidence.quote,
              evidence.contentHash,
              evidence.relationType,
              evidence.algorithmVersion,
            ],
          );
        }
      }
      for (const impact of computation.impacts) {
        const impactId = impactIds.get(impact.id);
        if (!impactId) throw new DomainError("PR_IMPACT_DUPLICATE", "An impact ID is missing.");
        const snapshotId = impact.side === "base" ? input.baseSnapshotId : input.headSnapshotId;
        for (const item of impact.paths) {
          const linkedEvidence = item.evidenceId
            ? persistedEvidence.get(item.evidenceId)
            : undefined;
          if (item.evidenceId && (!linkedEvidence || linkedEvidence.impactId !== impact.id)) {
            throw new DomainError(
              "PR_EVIDENCE_INVARIANT_FAILED",
              "An impact path references evidence outside its own impact.",
            );
          }
          await client.query(
            "INSERT INTO pull_request_impact_paths (id, impact_id, snapshot_id, ordinal, from_symbol_id, to_symbol_id, from_stable_key, to_stable_key, from_path, to_path, relation_type, confidence, evidence_id, edge_id) " +
              "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
            [
              createId(),
              impactId,
              snapshotId,
              item.ordinal,
              item.fromSymbolId,
              item.toSymbolId,
              item.fromStableKey,
              item.toStableKey,
              item.fromPath,
              item.toPath,
              item.relationType,
              item.confidence,
              linkedEvidence?.id ?? null,
              item.edgeId,
            ],
          );
        }
      }
      await client.query(
        "UPDATE pull_request_analyses SET status = 'ready', progress = 1, base_snapshot_id = $2, head_snapshot_id = $3, " +
          "stats_json = $4::jsonb, result_json = $5::jsonb, updated_at = now(), completed_at = now(), " +
          "error_code = NULL, error_message = NULL, error_retryable = false " +
          "WHERE id = $1 AND status = 'running'",
        [
          input.analysisId,
          input.baseSnapshotId,
          input.headSnapshotId,
          JSON.stringify(computation.stats),
          JSON.stringify(computation),
        ],
      );
      await client.query(
        "UPDATE analysis_jobs SET status = 'succeeded', phase = 'completed', progress = 1, lease_owner = NULL, " +
          "lease_expires_at = NULL, finished_at = now(), error_code = NULL, error_message = NULL, error_details_json = NULL " +
          "WHERE id = $1",
        [input.jobId],
      );
      await this.appendJobEvent(client, input.jobId, "completed", {
        phase: "completed",
        progress: 1,
        analysisId: input.analysisId,
        stats: computation.stats,
      });
    });
  }

  async failPullRequestAnalysis(
    jobId: string,
    analysisId: string,
    workerId: string,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const jobResult = await client.query<{ attempt_count: number; max_attempts: number }>(
        "SELECT attempt_count, max_attempts FROM analysis_jobs WHERE id = $1 AND analysis_id = $2 " +
          "AND lease_owner = $3 AND status = 'running' FOR UPDATE",
        [jobId, analysisId, workerId],
      );
      const job = jobResult.rows[0];
      if (!job)
        throw new DomainError("JOB_LEASE_LOST", "The pull request analysis lease was lost.", {
          retryable: true,
        });
      const shouldRetry = retryable && job.attempt_count < job.max_attempts;
      await client.query(
        "UPDATE analysis_jobs SET status = $2, error_code = $3, error_message = $4, error_details_json = jsonb_build_object('retryable', $5::boolean), " +
          "lease_owner = NULL, lease_expires_at = NULL, " +
          "available_at = CASE WHEN $2 = 'queued' THEN now() + (LEAST(30, GREATEST(1, attempt_count * attempt_count)) * interval '1 second') ELSE now() END, " +
          "finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1",
        [jobId, shouldRetry ? "queued" : "failed", code, message, retryable],
      );
      await client.query(
        "UPDATE pull_request_analyses SET status = $2, error_code = $3, error_message = $4, error_retryable = $5, updated_at = now() WHERE id = $1",
        [analysisId, shouldRetry ? "queued" : "failed", code, message, retryable],
      );
      await this.appendJobEvent(client, jobId, shouldRetry ? "warning" : "failed", {
        phase: shouldRetry ? "retrying" : "failed",
        progress: 1,
        analysisId,
        code,
        message,
        retryable: shouldRetry,
      });
    });
  }

  async deferPullRequestAnalysis(
    jobId: string,
    analysisId: string,
    workerId: string,
    message: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const deferred = await client.query(
        "UPDATE analysis_jobs SET status = 'queued', phase = 'waiting_for_snapshots', progress = 0.3, " +
          "attempt_count = GREATEST(0, attempt_count - 1), lease_owner = NULL, lease_expires_at = NULL, " +
          "available_at = now() + interval '5 seconds' " +
          "WHERE id = $1 AND analysis_id = $2 AND lease_owner = $3 AND status = 'running' RETURNING id",
        [jobId, analysisId, workerId],
      );
      if (deferred.rowCount !== 1) {
        throw new DomainError("JOB_LEASE_LOST", "The pull request analysis lease was lost.", {
          retryable: true,
        });
      }
      await client.query(
        "UPDATE pull_request_analyses SET status = 'queued', progress = 0.3, updated_at = now() WHERE id = $1",
        [analysisId],
      );
      await this.appendJobEvent(client, jobId, "waiting", {
        phase: "waiting_for_snapshots",
        progress: 0.3,
        analysisId,
        message,
      });
    });
  }

  async cancelPullRequestAnalysis(
    jobId: string,
    analysisId: string,
    workerId: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const cancelled = await client.query(
        "UPDATE analysis_jobs SET status = 'cancelled', phase = 'cancelled', progress = 1, " +
          "lease_owner = NULL, lease_expires_at = NULL, finished_at = now() " +
          "WHERE id = $1 AND analysis_id = $2 AND lease_owner = $3 AND status = 'running' RETURNING id",
        [jobId, analysisId, workerId],
      );
      if (cancelled.rowCount !== 1) {
        throw new DomainError("JOB_LEASE_LOST", "The pull request analysis lease was lost.", {
          retryable: true,
        });
      }
      await client.query(
        "UPDATE pull_request_analyses SET status = 'cancelled', progress = 1, updated_at = now(), completed_at = now() WHERE id = $1",
        [analysisId],
      );
      await this.appendJobEvent(client, jobId, "cancelled", {
        phase: "cancelled",
        progress: 1,
        analysisId,
      });
    });
  }

  async getPullRequestImpactPage(
    analysisId: string,
    limit = 50,
    cursor?: string,
  ): Promise<PullRequestAnalysisPage | null> {
    const analysis = await this.getPullRequestAnalysis(analysisId);
    if (!analysis) return null;
    const boundedLimit = Math.min(100, Math.max(1, limit));
    const decodedCursor = cursor ? decodeImpactCursor(cursor) : null;
    const impactParams: unknown[] = [analysisId];
    let impactCursorClause = "";
    if (decodedCursor) {
      impactParams.push(
        decodedCursor.riskScore,
        decodedCursor.path,
        decodedCursor.startLine,
        decodedCursor.id,
      );
      impactCursorClause =
        "AND (risk_score < $2::real " +
        "OR (risk_score = $2::real AND path > $3) " +
        "OR (risk_score = $2::real AND path = $3 AND start_line > $4) " +
        "OR (risk_score = $2::real AND path = $3 AND start_line = $4 AND id > $5::uuid)) ";
    }
    impactParams.push(boundedLimit + 1);
    const impactLimitParameter = `$${impactParams.length}`;
    const [fileResult, symbolResult, impactResult] = await Promise.all([
      this.pool.query<{
        path: string;
        old_path: string | null;
        change_type: PullRequestFileChange["changeType"];
        base_blob_hash: string | null;
        head_blob_hash: string | null;
        additions: number | null;
        deletions: number | null;
        is_binary: boolean;
      }>(
        "SELECT path, old_path, change_type, base_blob_hash, head_blob_hash, additions, deletions, is_binary " +
          "FROM pull_request_files WHERE analysis_id = $1 ORDER BY path",
        [analysisId],
      ),
      this.pool.query<{
        id: string;
        snapshot_side: PullRequestSymbolChange["side"];
        symbol_id: string | null;
        stable_key: string;
        path: string;
        name: string;
        kind: string;
        start_line: number;
        end_line: number;
        change_type: PullRequestSymbolChange["changeType"];
      }>(
        "SELECT id, snapshot_side, symbol_id, stable_key, path, name, kind, start_line, end_line, change_type " +
          "FROM pull_request_symbol_changes WHERE analysis_id = $1 ORDER BY path, start_line, id",
        [analysisId],
      ),
      this.pool.query<{
        id: string;
        snapshot_side: PullRequestImpact["side"];
        symbol_id: string | null;
        stable_key: string;
        path: string;
        name: string;
        kind: string;
        start_line: number;
        end_line: number;
        impact_type: PullRequestImpact["impactType"];
        distance: number;
        risk_score: number;
        risk_level: PullRequestImpact["riskLevel"];
        risk_breakdown_json: PullRequestImpact["riskBreakdown"];
        truncated: boolean;
      }>(
        "SELECT id, snapshot_side, symbol_id, stable_key, path, name, kind, start_line, end_line, " +
          "impact_type, distance, risk_score, risk_level, risk_breakdown_json, truncated " +
          "FROM pull_request_impacts WHERE analysis_id = $1 " +
          impactCursorClause +
          `ORDER BY risk_score DESC, path ASC, start_line ASC, id ASC LIMIT ${impactLimitParameter}`,
        impactParams,
      ),
    ]);
    const hasMore = impactResult.rows.length > boundedLimit;
    const impactRows = impactResult.rows.slice(0, boundedLimit);
    const impactIds = impactRows.map((row) => row.id);
    const [pathResult, evidenceResult] = impactIds.length
      ? await Promise.all([
          this.pool.query<{
            impact_id: string;
            ordinal: number;
            from_symbol_id: string | null;
            to_symbol_id: string | null;
            from_stable_key: string | null;
            to_stable_key: string | null;
            from_path: string | null;
            to_path: string | null;
            relation_type: PullRequestImpact["paths"][number]["relationType"];
            confidence: number;
            evidence_stable_id: string | null;
          }>(
            "SELECT p.impact_id, p.ordinal, p.from_symbol_id, p.to_symbol_id, p.from_stable_key, " +
              "p.to_stable_key, p.from_path, p.to_path, p.relation_type, p.confidence, " +
              "e.stable_id AS evidence_stable_id FROM pull_request_impact_paths p " +
              "LEFT JOIN pull_request_evidence e ON e.id = p.evidence_id " +
              "WHERE p.impact_id = ANY($1::uuid[]) ORDER BY p.impact_id, p.ordinal",
            [impactIds],
          ),
          this.pool.query<{
            id: string;
            impact_id: string;
            snapshot_id: string;
            commit_sha: string;
            file_id: string;
            symbol_id: string | null;
            path: string;
            start_line: number;
            end_line: number;
            quote: string;
            content_hash: string;
            relation_type: PullRequestImpact["evidence"][number]["relationType"];
            algorithm_version: string;
          }>(
            "SELECT stable_id AS id, impact_id, snapshot_id, commit_sha, file_id, symbol_id, path, start_line, end_line, " +
              "quote, content_hash, relation_type, algorithm_version FROM pull_request_evidence " +
              "WHERE impact_id = ANY($1::uuid[]) ORDER BY impact_id, path, start_line, id",
            [impactIds],
          ),
        ])
      : [{ rows: [] }, { rows: [] }];
    const pathsByImpact = new Map<string, PullRequestImpact["paths"]>();
    for (const row of pathResult.rows) {
      const paths = pathsByImpact.get(row.impact_id) ?? [];
      paths.push({
        ordinal: row.ordinal,
        fromSymbolId: row.from_symbol_id,
        toSymbolId: row.to_symbol_id,
        fromPath: row.from_path,
        toPath: row.to_path,
        relationType: row.relation_type,
        confidence: Number(row.confidence),
        evidenceId: row.evidence_stable_id,
      });
      pathsByImpact.set(row.impact_id, paths);
    }
    const evidenceByImpact = new Map<string, PullRequestImpact["evidence"]>();
    for (const row of evidenceResult.rows) {
      const evidence = evidenceByImpact.get(row.impact_id) ?? [];
      evidence.push({
        id: row.id,
        snapshotId: row.snapshot_id,
        commitSha: row.commit_sha,
        fileId: row.file_id,
        symbolId: row.symbol_id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        quote: row.quote,
        contentHash: row.content_hash,
        relationType: row.relation_type,
        algorithmVersion: row.algorithm_version,
      });
      evidenceByImpact.set(row.impact_id, evidence);
    }
    const impacts = impactRows.map((row) =>
      pullRequestImpactSchema.parse({
        id: row.id,
        analysisId,
        side: row.snapshot_side,
        symbolId: row.symbol_id,
        stableKey: row.stable_key,
        path: row.path,
        name: row.name,
        kind: row.kind,
        startLine: row.start_line,
        endLine: row.end_line,
        impactType: row.impact_type,
        distance: row.distance,
        riskScore: Number(row.risk_score),
        riskLevel: row.risk_level,
        riskBreakdown: row.risk_breakdown_json,
        truncated: row.truncated,
        paths: pathsByImpact.get(row.id) ?? [],
        evidence: evidenceByImpact.get(row.id) ?? [],
      }),
    );
    return {
      analysis,
      files: fileResult.rows.map((row) => ({
        path: row.path,
        oldPath: row.old_path,
        changeType: row.change_type,
        baseBlobHash: row.base_blob_hash,
        headBlobHash: row.head_blob_hash,
        additions: row.additions,
        deletions: row.deletions,
        binary: row.is_binary,
      })),
      symbols: symbolResult.rows.map((row) => ({
        id: row.id,
        side: row.snapshot_side,
        symbolId: row.symbol_id,
        stableKey: row.stable_key,
        path: row.path,
        name: row.name,
        kind: row.kind,
        startLine: row.start_line,
        endLine: row.end_line,
        changeType: row.change_type,
      })),
      impacts,
      nextCursor:
        hasMore && impactRows.length > 0
          ? encodeImpactCursor({
              riskScore: Number(impactRows.at(-1)?.risk_score),
              path: impactRows.at(-1)?.path ?? "",
              startLine: impactRows.at(-1)?.start_line ?? 1,
              id: impactRows.at(-1)?.id ?? "",
            })
          : null,
    };
  }

  async claimPullRequestAnalysisJob(
    workerId: string,
    leaseSeconds: number,
  ): Promise<PullRequestAnalysisJob | null> {
    return withTransaction(this.pool, async (client) => {
      const claimed = await client.query<{
        id: string;
        analysis_id: string;
        repository_id: string;
        workspace_id: string;
        attempt_count: number;
        max_attempts: number;
      }>(
        "WITH candidate AS (" +
          "SELECT id FROM analysis_jobs WHERE job_type = 'pull_request_analysis' " +
          "AND ((status = 'queued' AND available_at <= now()) " +
          "OR (status = 'running' AND lease_expires_at < now())) " +
          "AND attempt_count < max_attempts ORDER BY priority ASC, created_at ASC " +
          "FOR UPDATE SKIP LOCKED LIMIT 1" +
          ") UPDATE analysis_jobs jobs SET status = 'running', lease_owner = $1, " +
          "lease_expires_at = now() + ($2 * interval '1 second'), attempt_count = attempt_count + 1, " +
          "available_at = now(), " +
          "started_at = COALESCE(started_at, now()), phase = 'starting', progress = 0, " +
          "error_code = NULL, error_message = NULL, error_details_json = NULL, finished_at = NULL " +
          "FROM candidate WHERE jobs.id = candidate.id RETURNING jobs.id, jobs.analysis_id, " +
          "jobs.repository_id, jobs.workspace_id, jobs.attempt_count, jobs.max_attempts",
        [workerId, leaseSeconds],
      );
      const row = claimed.rows[0];
      if (!row) return null;
      const detail = await client.query<{
        owner_name: string;
        repo_name: string;
        clone_url: string;
        pr_number: number;
        title: string;
        canonical_url: string;
        base_sha: string;
        head_sha: string;
        parser_version: string;
        algorithm_version: string;
        provider_files_json: PullRequestFileChange[];
      }>(
        "SELECT r.owner_name, r.repo_name, r.clone_url, a.pr_number, a.title, a.canonical_url, " +
          "a.base_sha, a.head_sha, a.parser_version, a.algorithm_version, a.provider_files_json " +
          "FROM pull_request_analyses a JOIN repositories r ON r.id = a.repository_id " +
          "WHERE a.id = $1",
        [row.analysis_id],
      );
      const info = detail.rows[0];
      if (!info)
        throw new DomainError(
          "PR_ANALYSIS_RESOURCE_MISSING",
          "The PR analysis resource is missing.",
        );
      await client.query(
        "UPDATE pull_request_analyses SET status = 'running', progress = 0, error_code = NULL, " +
          "error_message = NULL, error_retryable = false, updated_at = now() WHERE id = $1",
        [row.analysis_id],
      );
      await this.appendJobEvent(client, row.id, "started", {
        phase: "starting",
        progress: 0,
        analysisId: row.analysis_id,
      });
      return {
        id: row.id,
        analysisId: row.analysis_id,
        repositoryId: row.repository_id,
        workspaceId: row.workspace_id,
        owner: info.owner_name,
        name: info.repo_name,
        cloneUrl: info.clone_url,
        prNumber: info.pr_number,
        title: info.title,
        canonicalUrl: info.canonical_url,
        baseSha: info.base_sha,
        headSha: info.head_sha,
        parserVersion: info.parser_version,
        algorithmVersion: info.algorithm_version,
        providerFiles: info.provider_files_json ?? [],
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
    });
  }

  async listRepositories(workspaceId: string): Promise<RepositorySummary[]> {
    const result = await this.pool.query<RepositoryRow>(
      "SELECT r.id, r.owner_name, r.repo_name, r.canonical_url, r.default_branch, " +
        "r.latest_ready_snapshot_id, s.status AS latest_snapshot_status, " +
        "s.commit_sha AS latest_commit_sha, r.auto_update_enabled, r.last_webhook_at, " +
        "r.created_at, r.updated_at " +
        "FROM repositories r " +
        "LEFT JOIN repository_snapshots s ON s.id = r.latest_ready_snapshot_id " +
        "WHERE r.workspace_id = $1 ORDER BY r.updated_at DESC",
      [workspaceId],
    );
    return result.rows.map(mapRepository);
  }

  async getRepository(repositoryId: string): Promise<RepositorySummary | null> {
    const result = await this.pool.query<RepositoryRow>(
      "SELECT r.id, r.owner_name, r.repo_name, r.canonical_url, r.default_branch, " +
        "r.latest_ready_snapshot_id, s.status AS latest_snapshot_status, " +
        "s.commit_sha AS latest_commit_sha, r.auto_update_enabled, r.last_webhook_at, " +
        "r.created_at, r.updated_at " +
        "FROM repositories r " +
        "LEFT JOIN repository_snapshots s ON s.id = r.latest_ready_snapshot_id " +
        "WHERE r.id = $1",
      [repositoryId],
    );
    const row = result.rows[0];
    return row ? mapRepository(row) : null;
  }

  async processGitHubWebhook(
    input: GitHubWebhookInput,
    parserVersion: string,
  ): Promise<GitHubWebhookProcessResult> {
    return withTransaction(this.pool, async (client) => {
      const push = input.push;
      if (input.eventName === "push" && !push) {
        throw new DomainError(
          "GITHUB_WEBHOOK_PAYLOAD_INVALID",
          "A push webhook requires a validated push payload.",
        );
      }
      const ignoredReason =
        input.eventName === "ping"
          ? "ping"
          : input.eventName !== "push"
            ? "event_not_supported"
            : push?.isPrivate
              ? "private_repository"
              : push?.deleted
                ? "deleted_ref"
                : push?.ref !== `refs/heads/${push?.defaultBranch}`
                  ? "non_default_branch"
                  : !/^[a-f0-9]{40}$/i.test(push?.after ?? "")
                    ? "invalid_commit"
                    : null;
      const inserted = await client.query<{ delivery_id: string }>(
        "INSERT INTO github_webhook_deliveries " +
          "(delivery_id, event_name, payload_sha256, status, reason) " +
          "VALUES ($1, $2, $3, $4, $5) " +
          "ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id",
        [
          input.deliveryId,
          input.eventName,
          input.payloadSha256,
          ignoredReason ? "ignored" : "enqueued",
          ignoredReason,
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{
          delivery_id: string;
          payload_sha256: string;
          status: "enqueued" | "ignored";
          reason: string | null;
          repository_id: string | null;
          snapshot_id: string | null;
          job_id: string | null;
        }>(
          "SELECT delivery_id, payload_sha256, status, reason, repository_id, snapshot_id, job_id " +
            "FROM github_webhook_deliveries WHERE delivery_id = $1",
          [input.deliveryId],
        );
        const old = existing.rows[0];
        if (!old) {
          throw new DomainError(
            "GITHUB_WEBHOOK_DELIVERY_CONFLICT",
            "The webhook delivery could not be resolved after an idempotency conflict.",
            { retryable: true },
          );
        }
        if (old.payload_sha256 !== input.payloadSha256) {
          throw new DomainError(
            "GITHUB_WEBHOOK_DELIVERY_CONFLICT",
            "The delivery ID was received with a different payload.",
          );
        }
        return {
          status: "duplicate" as const,
          duplicate: true,
          deliveryId: old.delivery_id,
          reason: old.reason,
          repositoryId: old.repository_id,
          snapshotId: old.snapshot_id,
          jobId: old.job_id,
        };
      }

      if (ignoredReason) {
        return {
          status: "ignored" as const,
          duplicate: false,
          deliveryId: input.deliveryId,
          reason: ignoredReason,
          repositoryId: null,
          snapshotId: null,
          jobId: null,
        };
      }

      if (!push) {
        throw new DomainError(
          "GITHUB_WEBHOOK_PAYLOAD_INVALID",
          "A supported webhook event did not contain repository data.",
        );
      }
      const repositoryResult = await client.query<{ id: string }>(
        "INSERT INTO repositories (" +
          "id, workspace_id, provider, provider_repo_id, canonical_url, clone_url, " +
          "owner_name, repo_name, default_branch, visibility, auto_update_enabled, " +
          "github_installation_id, last_webhook_at" +
          ") VALUES ($1, $2, 'github', $3, $4, $5, $6, $7, $8, 'public', true, $9, now()) " +
          "ON CONFLICT (workspace_id, canonical_url) DO UPDATE SET " +
          "provider_repo_id = COALESCE(EXCLUDED.provider_repo_id, repositories.provider_repo_id), " +
          "clone_url = EXCLUDED.clone_url, owner_name = EXCLUDED.owner_name, " +
          "repo_name = EXCLUDED.repo_name, default_branch = EXCLUDED.default_branch, " +
          "visibility = 'public', auto_update_enabled = true, " +
          "github_installation_id = COALESCE(" +
          "EXCLUDED.github_installation_id, repositories.github_installation_id), " +
          "last_webhook_at = now(), updated_at = now() RETURNING id",
        [
          createId(),
          PUBLIC_WORKSPACE_ID,
          push.providerRepoId,
          push.canonicalUrl,
          push.cloneUrl,
          push.owner,
          push.name,
          push.defaultBranch,
          push.installationId,
        ],
      );
      const repositoryId = repositoryResult.rows[0]?.id;
      if (!repositoryId) {
        throw new DomainError(
          "GITHUB_WEBHOOK_PAYLOAD_INVALID",
          "The webhook repository could not be persisted.",
          { retryable: true },
        );
      }

      const snapshotId = createId();
      const jobId = createId();
      await client.query(
        "INSERT INTO repository_snapshots (" +
          "id, repository_id, commit_sha, parent_commit_sha, requested_ref, ref_name, status, parser_version" +
          ") VALUES ($1, $2, $3, NULL, $4, $5, 'requested', $6)",
        [snapshotId, repositoryId, null, push.after, push.defaultBranch, parserVersion],
      );
      await client.query(
        "INSERT INTO analysis_jobs (" +
          "id, workspace_id, repository_id, snapshot_id, job_type, status, idempotency_key" +
          ") VALUES ($1, $2, $3, $4, 'index_snapshot', 'queued', $5)",
        [jobId, PUBLIC_WORKSPACE_ID, repositoryId, snapshotId, `github:${input.deliveryId}`],
      );
      await this.appendJobEvent(client, jobId, "queued", {
        phase: "queued",
        progress: 0,
        snapshotId,
        source: "github_webhook",
        deliveryId: input.deliveryId,
      });
      await client.query(
        "UPDATE github_webhook_deliveries SET repository_id = $2, snapshot_id = $3, job_id = $4, " +
          "processed_at = now() WHERE delivery_id = $1",
        [input.deliveryId, repositoryId, snapshotId, jobId],
      );
      return {
        status: "enqueued" as const,
        duplicate: false,
        deliveryId: input.deliveryId,
        reason: null,
        repositoryId,
        snapshotId,
        jobId,
      };
    });
  }

  async listSnapshots(repositoryId: string): Promise<Snapshot[]> {
    const result = await this.pool.query<SnapshotRow>(
      "SELECT id, repository_id, commit_sha, ref_name, status, parser_version, " +
        "base_snapshot_id, index_mode, tree_hash, " +
        "stats_json, error_code, error_message, requested_at, ready_at " +
        "FROM repository_snapshots WHERE repository_id = $1 " +
        "ORDER BY requested_at DESC LIMIT 100",
      [repositoryId],
    );
    return result.rows.map(mapSnapshot);
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      "SELECT id, repository_id, commit_sha, ref_name, status, parser_version, " +
        "base_snapshot_id, index_mode, tree_hash, " +
        "stats_json, error_code, error_message, requested_at, ready_at " +
        "FROM repository_snapshots WHERE id = $1",
      [snapshotId],
    );
    const row = result.rows[0];
    return row ? mapSnapshot(row) : null;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<JobRow>(
      "SELECT id, snapshot_id, analysis_id, job_type, status, phase, progress, processed, total, " +
        "attempt_count, max_attempts, error_code, error_message, " +
        "COALESCE((error_details_json->>'retryable')::boolean, false) " +
        "AND status IN ('queued', 'failed') AS error_retryable " +
        "FROM analysis_jobs WHERE id = $1",
      [jobId],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
  }

  async getIncrementalIndexBase(
    repositoryId: string,
    parserVersion: string,
    currentSnapshotId: string,
  ): Promise<IncrementalIndexBase | null> {
    const snapshotResult = await this.pool.query<{
      id: string;
      commit_sha: string;
      parser_version: string;
    }>(
      "SELECT id, commit_sha, parser_version FROM repository_snapshots " +
        "WHERE repository_id = $1 AND parser_version = $2 AND id <> $3 " +
        "AND status = 'ready' AND commit_sha IS NOT NULL " +
        "ORDER BY ready_at DESC, requested_at DESC LIMIT 1",
      [repositoryId, parserVersion, currentSnapshotId],
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) return null;

    const [fileResult, symbolResult, edgeResult] = await Promise.all([
      this.pool.query<{
        path: string;
        blob_hash: string;
        language: string | null;
        parse_status: string;
      }>(
        "SELECT path, blob_hash, language, parse_status FROM snapshot_files " +
          "WHERE snapshot_id = $1 ORDER BY path",
        [snapshot.id],
      ),
      this.pool.query<{
        id: string;
        path: string;
        stable_key: string;
        kind: import("@repovista/contracts").SymbolKind;
        name: string;
        qualified_name: string | null;
        signature: string | null;
        start_line: number;
        start_column: number;
        end_line: number;
        end_column: number;
        doc_text: string | null;
        content_hash: string;
      }>(
        "SELECT s.id, f.path, s.stable_key, s.kind, s.name, s.qualified_name, " +
          "s.signature, s.start_line, s.start_column, s.end_line, s.end_column, " +
          "s.doc_text, s.content_hash FROM symbols s " +
          "JOIN snapshot_files f ON f.id = s.snapshot_file_id " +
          "WHERE s.snapshot_id = $1 ORDER BY f.path, s.start_line, s.start_column",
        [snapshot.id],
      ),
      this.pool.query<{
        from_stable_key: string;
        from_path: string;
        to_stable_key: string | null;
        unresolved_target: string | null;
        relation_type: import("@repovista/contracts").RelationType;
        confidence: number;
        evidence_json: import("@repovista/domain").ParsedEdge["evidence"];
      }>(
        "SELECT source.stable_key AS from_stable_key, source_file.path AS from_path, " +
          "target.stable_key AS to_stable_key, edge.unresolved_target, " +
          "edge.relation_type, edge.confidence, edge.evidence_json " +
          "FROM symbol_edges edge " +
          "JOIN symbols source ON source.id = edge.from_symbol_id " +
          "JOIN snapshot_files source_file ON source_file.id = source.snapshot_file_id " +
          "LEFT JOIN symbols target ON target.id = edge.to_symbol_id " +
          "WHERE edge.snapshot_id = $1 ORDER BY edge.id",
        [snapshot.id],
      ),
    ]);

    const symbolsByPath = new Map<string, IncrementalIndexBase["parsedFiles"][number]["symbols"]>();
    for (const row of symbolResult.rows) {
      const symbols = symbolsByPath.get(row.path) ?? [];
      symbols.push({
        stableKey: row.stable_key,
        kind: row.kind,
        name: row.name,
        qualifiedName: row.qualified_name,
        signature: row.signature,
        startLine: row.start_line,
        startColumn: row.start_column,
        endLine: row.end_line,
        endColumn: row.end_column,
        docText: row.doc_text,
        contentHash: row.content_hash,
      });
      symbolsByPath.set(row.path, symbols);
    }

    const edgesByPath = new Map<string, IncrementalIndexBase["parsedFiles"][number]["edges"]>();
    const importsByPath = new Map<string, IncrementalIndexBase["parsedFiles"][number]["imports"]>();
    for (const row of edgeResult.rows) {
      const edges = edgesByPath.get(row.from_path) ?? [];
      edges.push({
        fromStableKey: row.from_stable_key,
        ...(row.to_stable_key ? { targetStableKey: row.to_stable_key } : {}),
        ...(row.unresolved_target ? { unresolvedTarget: row.unresolved_target } : {}),
        type: row.relation_type,
        confidence: Number(row.confidence),
        evidence: row.evidence_json,
      });
      edgesByPath.set(row.from_path, edges);

      if (row.relation_type === "imports") {
        const source = row.evidence_json.importSource ?? row.unresolved_target;
        if (source) {
          const imports = importsByPath.get(row.from_path) ?? [];
          if (
            !imports.some(
              (item) => item.source === source && item.startLine === row.evidence_json.startLine,
            )
          ) {
            imports.push({
              source,
              importedNames: row.evidence_json.importedNames ?? [],
              startLine: row.evidence_json.startLine,
              endLine: row.evidence_json.endLine,
            });
            importsByPath.set(row.from_path, imports);
          }
        }
      }
    }

    const parsedFiles = fileResult.rows.flatMap((file) => {
      if (file.parse_status !== "parsed") return [];
      const symbols = symbolsByPath.get(file.path) ?? [];
      const module = symbols.find((symbol) => symbol.kind === "module");
      if (!module) return [];
      return [
        {
          path: file.path,
          moduleStableKey: module.stableKey,
          symbols,
          edges: edgesByPath.get(file.path) ?? [],
          imports: importsByPath.get(file.path) ?? [],
        },
      ];
    });

    return {
      snapshotId: snapshot.id,
      commitSha: snapshot.commit_sha,
      parserVersion: snapshot.parser_version,
      files: fileResult.rows.map((row) => ({
        path: row.path,
        contentHash: row.blob_hash,
        language: row.language,
        parseStatus: row.parse_status,
      })),
      parsedFiles,
    };
  }

  private async embeddingIndexQuery(
    query: string,
    params: unknown[],
  ): Promise<EmbeddingIndex | null> {
    const result = await this.pool.query<EmbeddingIndexRow>(query, params);
    const row = result.rows[0];
    return row ? mapEmbeddingIndex(row) : null;
  }

  async getEmbeddingIndex(indexId: string): Promise<EmbeddingIndex | null> {
    return this.embeddingIndexQuery(
      "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
        "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, j.id AS job_id, " +
        "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
        "FROM snapshot_embedding_indexes i " +
        "LEFT JOIN analysis_jobs j ON j.embedding_index_id = i.id " +
        "WHERE i.id = $1 ORDER BY j.created_at DESC NULLS LAST LIMIT 1",
      [indexId],
    );
  }

  async getEmbeddingIndexForSnapshot(
    snapshotId: string,
    provider: EmbeddingProvider,
    model: string,
    inputVersion: string,
  ): Promise<EmbeddingIndex | null> {
    return this.embeddingIndexQuery(
      "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
        "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, j.id AS job_id, " +
        "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
        "FROM snapshot_embedding_indexes i " +
        "LEFT JOIN analysis_jobs j ON j.embedding_index_id = i.id " +
        "WHERE i.snapshot_id = $1 AND i.provider = $2 AND i.model = $3 AND i.input_version = $4 " +
        "ORDER BY i.created_at DESC LIMIT 1",
      [snapshotId, provider, model, inputVersion],
    );
  }

  async createOrRetryEmbeddingIndex(input: EmbeddingIndexInput): Promise<EmbeddingIndexResult> {
    if (
      !idSchema.safeParse(input.snapshotId).success ||
      !idSchema.safeParse(input.workspaceId).success
    ) {
      throw new DomainError(
        "EMBEDDING_INPUT_INVALID",
        "The embedding resource identifiers are invalid.",
      );
    }
    if (!input.model.trim() || input.model.length > 200 || input.inputVersion.length > 100) {
      throw new DomainError("EMBEDDING_INPUT_INVALID", "The embedding profile values are invalid.");
    }
    return withTransaction(this.pool, async (client) => {
      const snapshotResult = await client.query<{
        id: string;
        repository_id: string;
        workspace_id: string;
        status: Snapshot["status"];
        commit_sha: string | null;
      }>(
        "SELECT s.id, s.repository_id, r.workspace_id, s.status, s.commit_sha " +
          "FROM repository_snapshots s JOIN repositories r ON r.id = s.repository_id " +
          "WHERE s.id = $1 AND r.workspace_id = $2 FOR UPDATE",
        [input.snapshotId, input.workspaceId],
      );
      const snapshot = snapshotResult.rows[0];
      if (!snapshot) {
        throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
      }
      if (snapshot.status !== "ready" || !snapshot.commit_sha) {
        throw new DomainError(
          "SNAPSHOT_NOT_READY",
          "An embedding index requires a ready snapshot.",
          {
            retryable: true,
          },
        );
      }
      const chunkCount = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM code_chunks WHERE snapshot_id = $1",
        [input.snapshotId],
      );
      const totalChunks = Number(chunkCount.rows[0]?.count ?? 0);
      const existingResult = await client.query<EmbeddingIndexRow>(
        "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
          "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, j.id AS job_id, " +
          "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
          "FROM snapshot_embedding_indexes i LEFT JOIN analysis_jobs j ON j.embedding_index_id = i.id " +
          "WHERE i.snapshot_id = $1 AND i.provider = $2 AND i.model = $3 AND i.input_version = $4 " +
          "FOR UPDATE OF i",
        [input.snapshotId, input.provider, input.model.trim(), input.inputVersion],
      );
      let profileId = existingResult.rows[0]?.id;
      let jobId = existingResult.rows[0]?.job_id ?? null;
      let reused = false;

      if (existingResult.rows[0]) {
        const existing = existingResult.rows[0];
        if (
          existing.status === "ready" ||
          existing.status === "queued" ||
          existing.status === "running"
        ) {
          reused = true;
          return {
            embeddingIndex: mapEmbeddingIndex(existing),
            jobId,
            reused,
          };
        }
        if (!profileId)
          throw new DomainError("EMBEDDING_INDEX_NOT_FOUND", "The embedding profile is missing.");
        const revision = Number(existing.revision) + 1;
        // Keep any vectors that still match the current snapshot. A retry may
        // follow a partial batch, so resetting the progress counter to zero
        // would make the profile report misleading progress and needlessly
        // re-embed already persisted chunks.
        const embeddedResult = await client.query<{ embedded: number }>(
          "SELECT count(*)::integer AS embedded FROM code_chunk_embeddings e " +
            "JOIN code_chunks c ON c.id = e.code_chunk_id AND c.snapshot_id = e.snapshot_id " +
            "WHERE e.embedding_index_id = $1 AND e.snapshot_id = $2 AND e.content_hash = c.content_hash",
          [profileId, input.snapshotId],
        );
        const embeddedChunks = Number(embeddedResult.rows[0]?.embedded ?? 0);
        await client.query(
          "UPDATE snapshot_embedding_indexes SET status = $2, total_chunks = $3, " +
            "embedded_chunks = $4, revision = $5, error_code = NULL, error_message = NULL, " +
            "error_retryable = false, started_at = NULL, ready_at = NULL, failed_at = NULL, updated_at = now() " +
            "WHERE id = $1",
          [
            profileId,
            totalChunks === 0 ? "ready" : "queued",
            totalChunks,
            Math.min(totalChunks, embeddedChunks),
            revision,
          ],
        );
        if (jobId) {
          await client.query(
            "UPDATE analysis_jobs SET status = $2, phase = $3, progress = $4, processed = $5, total = $6, " +
              "attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL, cancel_requested_at = NULL, " +
              "available_at = now(), error_code = NULL, error_message = NULL, error_details_json = NULL, " +
              "finished_at = NULL WHERE id = $1",
            [
              jobId,
              totalChunks === 0 ? "succeeded" : "queued",
              totalChunks === 0 ? "completed" : "queued",
              totalChunks === 0 ? 1 : 0,
              totalChunks === 0 ? totalChunks : null,
              totalChunks === 0 ? totalChunks : null,
            ],
          );
        }
      } else {
        profileId = createId();
        await client.query(
          "INSERT INTO snapshot_embedding_indexes (" +
            "id, snapshot_id, workspace_id, provider, model, input_version, status, total_chunks, embedded_chunks" +
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [
            profileId,
            input.snapshotId,
            input.workspaceId,
            input.provider,
            input.model.trim(),
            input.inputVersion,
            totalChunks === 0 ? "ready" : "queued",
            totalChunks,
            0,
          ],
        );
      }

      if (totalChunks === 0) {
        await client.query(
          "UPDATE snapshot_embedding_indexes SET ready_at = now(), updated_at = now() WHERE id = $1",
          [profileId],
        );
      } else {
        if (!jobId) {
          jobId = createId();
          await client.query(
            "INSERT INTO analysis_jobs (id, workspace_id, repository_id, snapshot_id, embedding_index_id, " +
              "job_type, status, idempotency_key, total) VALUES ($1, $2, $3, $4, $5, 'embed_snapshot', 'queued', $6, $7)",
            [
              jobId,
              input.workspaceId,
              snapshot.repository_id,
              input.snapshotId,
              profileId,
              `embedding:${profileId}`,
              totalChunks,
            ],
          );
        }
        await this.appendJobEvent(client, jobId, "queued", {
          phase: "queued",
          progress: 0,
          snapshotId: input.snapshotId,
          embeddingIndexId: profileId,
          total: totalChunks,
        });
      }

      const finalResult = await client.query<EmbeddingIndexRow>(
        "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
          "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, $2::uuid AS job_id, " +
          "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
          "FROM snapshot_embedding_indexes i WHERE i.id = $1",
        [profileId, jobId],
      );
      const row = finalResult.rows[0];
      if (!row)
        throw new DomainError(
          "EMBEDDING_INDEX_NOT_FOUND",
          "The embedding profile was not created.",
        );
      return { embeddingIndex: mapEmbeddingIndex(row), jobId, reused };
    });
  }

  async getRetrievalStatus(options: RetrievalStatusOptions): Promise<RetrievalStatusResult> {
    const snapshot = await this.getSnapshot(options.snapshotId);
    if (!snapshot)
      throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
    const latestResult = await this.pool.query<EmbeddingIndexRow>(
      "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
        "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, j.id AS job_id, " +
        "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
        "FROM snapshot_embedding_indexes i LEFT JOIN analysis_jobs j ON j.embedding_index_id = i.id " +
        "WHERE i.snapshot_id = $1 ORDER BY i.created_at DESC LIMIT 1",
      [options.snapshotId],
    );
    const currentResult =
      options.provider && options.model
        ? await this.pool.query<EmbeddingIndexRow>(
            "SELECT i.id, i.snapshot_id, i.provider, i.model, i.input_version, i.status, " +
              "i.dimensions, i.total_chunks, i.embedded_chunks, i.revision, j.id AS job_id, " +
              "i.error_code, i.error_message, i.error_retryable, i.created_at, i.updated_at, i.ready_at " +
              "FROM snapshot_embedding_indexes i LEFT JOIN analysis_jobs j ON j.embedding_index_id = i.id " +
              "WHERE i.snapshot_id = $1 AND i.provider = $2 AND i.model = $3 AND i.input_version = $4 " +
              "ORDER BY i.created_at DESC LIMIT 1",
            [options.snapshotId, options.provider, options.model, options.inputVersion],
          )
        : { rows: [] as EmbeddingIndexRow[] };
    const current = currentResult.rows[0] ? mapEmbeddingIndex(currentResult.rows[0]) : null;
    const latest = latestResult.rows[0] ? mapEmbeddingIndex(latestResult.rows[0]) : null;
    const reason =
      !options.provider || !options.model
        ? "provider_disabled"
        : current === null
          ? "index_missing"
          : current.status === "ready"
            ? null
            : current.status === "failed" || current.status === "cancelled"
              ? "index_failed"
              : "index_building";
    return retrievalStatusSchema.parse({
      snapshotId: options.snapshotId,
      text: {
        ready: snapshot.status === "ready",
        reason: snapshot.status === "ready" ? null : "index_building",
      },
      symbol: {
        ready: snapshot.status === "ready",
        reason: snapshot.status === "ready" ? null : "index_building",
      },
      semantic: {
        configured: Boolean(options.provider && options.model),
        queryable: current?.status === "ready",
        reason,
        currentIndex: current,
        latestIndex: latest,
      },
    });
  }

  async claimEmbeddingJob(
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedEmbeddingJob | null> {
    return withTransaction(this.pool, async (client) => {
      const claimed = await client.query<{
        id: string;
        embedding_index_id: string;
        snapshot_id: string;
        workspace_id: string;
        repository_id: string;
        attempt_count: number;
        max_attempts: number;
        provider: EmbeddingProvider;
        model: string;
        input_version: string;
      }>(
        "WITH candidate AS (" +
          "SELECT j.id, i.provider, i.model, i.input_version FROM analysis_jobs j " +
          "JOIN snapshot_embedding_indexes i ON i.id = j.embedding_index_id " +
          "WHERE j.job_type = 'embed_snapshot' AND i.status IN ('queued', 'running') " +
          "AND ((j.status = 'queued' AND j.available_at <= now()) " +
          "OR (j.status = 'running' AND j.lease_expires_at < now())) " +
          "AND j.attempt_count < j.max_attempts " +
          "ORDER BY j.priority ASC, j.created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1" +
          ") UPDATE analysis_jobs j SET status = 'running', lease_owner = $1, " +
          "lease_expires_at = now() + ($2 * interval '1 second'), available_at = now(), " +
          "attempt_count = j.attempt_count + 1, started_at = COALESCE(j.started_at, now()), " +
          "phase = 'embedding', progress = 0, error_code = NULL, error_message = NULL, " +
          "error_details_json = NULL, finished_at = NULL " +
          "FROM candidate c WHERE j.id = c.id " +
          "RETURNING j.id, j.embedding_index_id, j.snapshot_id, j.workspace_id, j.repository_id, " +
          "j.attempt_count, j.max_attempts, c.provider, c.model, c.input_version",
        [workerId, leaseSeconds],
      );
      const row = claimed.rows[0];
      if (!row) return null;
      await client.query(
        "UPDATE snapshot_embedding_indexes SET status = 'running', started_at = COALESCE(started_at, now()), " +
          "updated_at = now(), error_code = NULL, error_message = NULL, error_retryable = false WHERE id = $1",
        [row.embedding_index_id],
      );
      await this.appendJobEvent(client, row.id, "started", {
        phase: "embedding",
        progress: 0,
        embeddingIndexId: row.embedding_index_id,
        attempt: row.attempt_count,
      });
      return {
        id: row.id,
        embeddingIndexId: row.embedding_index_id,
        snapshotId: row.snapshot_id,
        workspaceId: row.workspace_id,
        repositoryId: row.repository_id,
        provider: row.provider,
        model: row.model,
        inputVersion: row.input_version,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
    });
  }

  async listEmbeddingBatch(indexId: string, limit = 16): Promise<EmbeddingChunkRecord[]> {
    const boundedLimit = Math.min(64, Math.max(1, Math.floor(limit)));
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      file_id: string;
      path: string;
      symbol_id: string | null;
      symbol: string | null;
      start_line: number;
      end_line: number;
      content: string;
      content_hash: string;
    }>(
      "SELECT c.id, c.snapshot_id, s.commit_sha, c.snapshot_file_id AS file_id, f.path, c.symbol_id, " +
        "sym.name AS symbol, c.start_line, c.end_line, c.content, c.content_hash " +
        "FROM code_chunks c " +
        "JOIN snapshot_files f ON f.id = c.snapshot_file_id " +
        "JOIN repository_snapshots s ON s.id = c.snapshot_id " +
        "LEFT JOIN symbols sym ON sym.id = c.symbol_id " +
        "LEFT JOIN code_chunk_embeddings e ON e.embedding_index_id = $1 AND e.code_chunk_id = c.id " +
        "WHERE c.snapshot_id = (SELECT snapshot_id FROM snapshot_embedding_indexes WHERE id = $1) " +
        "AND (e.code_chunk_id IS NULL OR e.content_hash <> c.content_hash) " +
        "ORDER BY c.id LIMIT $2",
      [indexId, boundedLimit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      fileId: row.file_id,
      path: row.path,
      symbolId: row.symbol_id,
      symbol: row.symbol,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      contentHash: row.content_hash,
    }));
  }

  async saveEmbeddingBatch(input: SaveEmbeddingBatchInput): Promise<void> {
    if (!Number.isInteger(input.dimensions) || input.dimensions < 1 || input.dimensions > 16_000) {
      throw new DomainError(
        "EMBEDDING_DIMENSION_MISMATCH",
        "The embedding dimensions are invalid.",
      );
    }
    await withTransaction(this.pool, async (client) => {
      const lease = await client.query<{
        id: string;
        dimensions: number | null;
        total_chunks: number;
      }>(
        "SELECT j.id, i.dimensions, i.total_chunks FROM analysis_jobs j " +
          "JOIN snapshot_embedding_indexes i ON i.id = j.embedding_index_id " +
          "WHERE j.id = $1 AND j.embedding_index_id = $2 AND j.snapshot_id = $3 " +
          "AND j.lease_owner = $4 AND j.status = 'running' FOR UPDATE",
        [input.jobId, input.embeddingIndexId, input.snapshotId, input.workerId],
      );
      const job = lease.rows[0];
      if (!job) {
        throw new DomainError("JOB_LEASE_LOST", "The embedding job lease is no longer owned.", {
          retryable: true,
        });
      }
      if (job.dimensions !== null && Number(job.dimensions) !== input.dimensions) {
        throw new DomainError(
          "EMBEDDING_DIMENSION_MISMATCH",
          "The embedding dimensions changed within one index.",
        );
      }
      await client.query(
        "UPDATE snapshot_embedding_indexes SET dimensions = COALESCE(dimensions, $2), updated_at = now() " +
          "WHERE id = $1 AND (dimensions IS NULL OR dimensions = $2)",
        [input.embeddingIndexId, input.dimensions],
      );

      for (const row of input.rows) {
        const embedding = vectorLiteral(row.embedding);
        if (row.embedding.length !== input.dimensions) {
          throw new DomainError(
            "EMBEDDING_DIMENSION_MISMATCH",
            "A batch vector does not match the index dimensions.",
          );
        }
        const chunk = await client.query<{ content_hash: string }>(
          "SELECT content_hash FROM code_chunks WHERE id = $1 AND snapshot_id = $2 FOR SHARE",
          [row.codeChunkId, input.snapshotId],
        );
        if (chunk.rows[0]?.content_hash !== row.contentHash) {
          throw new DomainError(
            "EMBEDDING_INPUT_STALE",
            "The code chunk changed while its embedding was being computed.",
            { retryable: true },
          );
        }
        const existing = await client.query<{
          content_hash: string;
          input_hash: string;
          dimensions: number;
        }>(
          "SELECT content_hash, input_hash, dimensions FROM code_chunk_embeddings " +
            "WHERE embedding_index_id = $1 AND code_chunk_id = $2 FOR UPDATE",
          [input.embeddingIndexId, row.codeChunkId],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (
            previous.content_hash !== row.contentHash ||
            previous.input_hash !== row.inputHash ||
            Number(previous.dimensions) !== input.dimensions
          ) {
            throw new DomainError(
              "EMBEDDING_INPUT_STALE",
              "An existing embedding row belongs to a different input.",
            );
          }
          continue;
        }
        await client.query(
          "INSERT INTO code_chunk_embeddings (embedding_index_id, snapshot_id, code_chunk_id, content_hash, input_hash, dimensions, embedding) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7::vector)",
          [
            input.embeddingIndexId,
            input.snapshotId,
            row.codeChunkId,
            row.contentHash,
            row.inputHash,
            input.dimensions,
            embedding,
          ],
        );
      }
      const counts = await client.query<{ total: number; embedded: number }>(
        "SELECT " +
          "(SELECT count(*) FROM code_chunks WHERE snapshot_id = $2)::integer AS total, " +
          "(SELECT count(*) FROM code_chunk_embeddings e JOIN code_chunks c ON c.id = e.code_chunk_id " +
          "AND c.snapshot_id = e.snapshot_id WHERE e.embedding_index_id = $1 AND e.content_hash = c.content_hash)::integer AS embedded",
        [input.embeddingIndexId, input.snapshotId],
      );
      const count = counts.rows[0] ?? { total: 0, embedded: 0 };
      await client.query(
        "UPDATE snapshot_embedding_indexes SET total_chunks = $2, embedded_chunks = $3, updated_at = now() WHERE id = $1",
        [input.embeddingIndexId, Number(count.total), Number(count.embedded)],
      );
      const progress =
        Number(count.total) === 0
          ? 1
          : Math.min(0.99, Number(count.embedded) / Number(count.total));
      await client.query(
        "UPDATE analysis_jobs SET progress = $2, processed = $3, total = $4, phase = 'embedding' WHERE id = $1",
        [input.jobId, progress, Number(count.embedded), Number(count.total)],
      );
      await this.appendJobEvent(client, input.jobId, "progress", {
        phase: "embedding",
        progress,
        processed: Number(count.embedded),
        total: Number(count.total),
        message: input.message,
        dimensions: input.dimensions,
      });
    });
  }

  async completeEmbeddingJob(
    jobId: string,
    embeddingIndexId: string,
    snapshotId: string,
    workerId: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const lease = await client.query<{ id: string }>(
        "SELECT j.id FROM analysis_jobs j WHERE j.id = $1 AND j.embedding_index_id = $2 " +
          "AND j.snapshot_id = $3 AND j.lease_owner = $4 AND j.status = 'running' FOR UPDATE",
        [jobId, embeddingIndexId, snapshotId, workerId],
      );
      if (lease.rowCount !== 1) {
        throw new DomainError("JOB_LEASE_LOST", "The embedding job lease is no longer owned.", {
          retryable: true,
        });
      }
      const counts = await client.query<{ total: number; embedded: number; dimensions: number }>(
        "SELECT " +
          "(SELECT count(*) FROM code_chunks WHERE snapshot_id = $2)::integer AS total, " +
          "(SELECT count(*) FROM code_chunk_embeddings e JOIN code_chunks c ON c.id = e.code_chunk_id " +
          "AND c.snapshot_id = e.snapshot_id WHERE e.embedding_index_id = $1 AND e.content_hash = c.content_hash)::integer AS embedded, " +
          "(SELECT count(DISTINCT e.dimensions) FROM code_chunk_embeddings e WHERE e.embedding_index_id = $1)::integer AS dimensions",
        [embeddingIndexId, snapshotId],
      );
      const count = counts.rows[0] ?? { total: 0, embedded: 0, dimensions: 0 };
      if (Number(count.total) !== Number(count.embedded) || Number(count.dimensions) > 1) {
        throw new DomainError(
          "EMBEDDING_INDEX_INCOMPLETE",
          "The embedding index is not complete or contains mixed dimensions.",
          { retryable: true },
        );
      }
      await client.query(
        "UPDATE snapshot_embedding_indexes SET status = 'ready', total_chunks = $2, embedded_chunks = $3, " +
          "ready_at = now(), updated_at = now(), error_code = NULL, error_message = NULL, error_retryable = false " +
          "WHERE id = $1",
        [embeddingIndexId, Number(count.total), Number(count.embedded)],
      );
      await client.query(
        "UPDATE analysis_jobs SET status = 'succeeded', phase = 'completed', progress = 1, processed = $2, total = $2, " +
          "lease_owner = NULL, lease_expires_at = NULL, finished_at = now(), error_code = NULL, error_message = NULL, error_details_json = NULL " +
          "WHERE id = $1",
        [jobId, Number(count.total)],
      );
      await this.appendJobEvent(client, jobId, "completed", {
        phase: "completed",
        progress: 1,
        embeddingIndexId,
        snapshotId,
        embeddedChunks: Number(count.embedded),
        totalChunks: Number(count.total),
      });
    });
  }

  async cancelEmbeddingJob(
    jobId: string,
    embeddingIndexId: string,
    snapshotId: string,
    workerId: string,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const cancelled = await client.query(
        "UPDATE analysis_jobs SET status = 'cancelled', phase = 'cancelled', progress = 1, " +
          "lease_owner = NULL, lease_expires_at = NULL, finished_at = now() " +
          "WHERE id = $1 AND embedding_index_id = $2 AND snapshot_id = $3 AND lease_owner = $4 AND status = 'running' RETURNING id",
        [jobId, embeddingIndexId, snapshotId, workerId],
      );
      if (cancelled.rowCount !== 1) {
        throw new DomainError("JOB_LEASE_LOST", "The embedding job lease is no longer owned.", {
          retryable: true,
        });
      }
      await client.query(
        "UPDATE snapshot_embedding_indexes SET status = 'cancelled', updated_at = now() WHERE id = $1",
        [embeddingIndexId],
      );
      await this.appendJobEvent(client, jobId, "cancelled", {
        phase: "cancelled",
        progress: 1,
        embeddingIndexId,
      });
    });
  }

  async failEmbeddingJob(
    jobId: string,
    embeddingIndexId: string,
    snapshotId: string,
    workerId: string,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const jobResult = await client.query<{ attempt_count: number; max_attempts: number }>(
        "SELECT attempt_count, max_attempts FROM analysis_jobs WHERE id = $1 AND embedding_index_id = $2 " +
          "AND snapshot_id = $3 AND lease_owner = $4 AND status = 'running' FOR UPDATE",
        [jobId, embeddingIndexId, snapshotId, workerId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        throw new DomainError("JOB_LEASE_LOST", "The embedding job lease is no longer owned.", {
          retryable: true,
        });
      }
      const shouldRetry = retryable && job.attempt_count < job.max_attempts;
      const status = shouldRetry ? "queued" : "failed";
      await client.query(
        "UPDATE analysis_jobs SET status = $2, phase = $3, error_code = $4, error_message = $5, " +
          "error_details_json = jsonb_build_object('retryable', $6::boolean), lease_owner = NULL, " +
          "lease_expires_at = NULL, available_at = CASE WHEN $2 = 'queued' THEN now() + interval '2 seconds' ELSE now() END, " +
          "finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1",
        [jobId, status, shouldRetry ? "retrying" : "failed", code, message, retryable],
      );
      await client.query(
        "UPDATE snapshot_embedding_indexes SET status = $2, error_code = $3, error_message = $4, " +
          "error_retryable = $5, updated_at = now(), failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END " +
          "WHERE id = $1",
        [embeddingIndexId, status, code, message, retryable],
      );
      await this.appendJobEvent(client, jobId, shouldRetry ? "warning" : "failed", {
        phase: shouldRetry ? "retrying" : "failed",
        progress: 1,
        embeddingIndexId,
        code,
        message,
        retryable: shouldRetry,
      });
    });
  }

  async searchTextEvidence(
    snapshotId: string,
    query: string,
    limit = 20,
  ): Promise<RetrievalSearchRecord[]> {
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      snapshot_file_id: string;
      path: string;
      symbol_id: string | null;
      symbol: string | null;
      start_line: number;
      end_line: number;
      content: string;
      content_hash: string;
      score: number;
    }>(
      "WITH search_query AS (SELECT plainto_tsquery('simple', $2) AS query) " +
        "SELECT c.id, c.snapshot_id, rs.commit_sha, c.snapshot_file_id, f.path, c.symbol_id, " +
        "s.name AS symbol, c.start_line, c.end_line, c.content, c.content_hash, " +
        "GREATEST(ts_rank_cd(c.search_vector, search_query.query), similarity(f.path, $2)) AS score " +
        "FROM code_chunks c JOIN snapshot_files f ON f.id = c.snapshot_file_id " +
        "JOIN repository_snapshots rs ON rs.id = c.snapshot_id CROSS JOIN search_query " +
        "LEFT JOIN symbols s ON s.id = c.symbol_id " +
        "WHERE c.snapshot_id = $1 AND rs.status = 'ready' AND (" +
        "c.search_vector @@ search_query.query OR f.path ILIKE '%' || $2 || '%'" +
        ") ORDER BY score DESC, f.path ASC, c.start_line ASC, c.id ASC LIMIT $3",
      [snapshotId, normalized, boundedLimit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      fileId: row.snapshot_file_id,
      path: row.path,
      symbolId: row.symbol_id,
      symbol: row.symbol,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      contentHash: row.content_hash,
      score: Number(row.score),
      channel: "text" as const,
    }));
  }

  async searchSymbolEvidence(
    snapshotId: string,
    query: string,
    limit = 20,
  ): Promise<RetrievalSearchRecord[]> {
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      snapshot_file_id: string;
      path: string;
      symbol_id: string | null;
      symbol: string | null;
      start_line: number;
      end_line: number;
      content: string;
      content_hash: string;
      score: number;
    }>(
      "SELECT c.id, c.snapshot_id, rs.commit_sha, c.snapshot_file_id, f.path, c.symbol_id, " +
        "s.name AS symbol, c.start_line, c.end_line, c.content, c.content_hash, " +
        "GREATEST(" +
        "CASE WHEN lower(s.name) = lower($2) THEN 1 ELSE 0 END, " +
        "CASE WHEN lower(COALESCE(s.qualified_name, '')) = lower($2) THEN 0.95 ELSE 0 END, " +
        "similarity(s.name, $2), similarity(COALESCE(s.qualified_name, ''), $2), similarity(f.path, $2)" +
        ") AS score " +
        "FROM code_chunks c JOIN snapshot_files f ON f.id = c.snapshot_file_id " +
        "JOIN repository_snapshots rs ON rs.id = c.snapshot_id " +
        "JOIN symbols s ON s.id = c.symbol_id " +
        "WHERE c.snapshot_id = $1 AND rs.status = 'ready' AND (" +
        "s.name ILIKE '%' || $2 || '%' OR s.qualified_name ILIKE '%' || $2 || '%' OR f.path ILIKE '%' || $2 || '%'" +
        ") ORDER BY score DESC, f.path ASC, c.start_line ASC, c.id ASC LIMIT $3",
      [snapshotId, normalized, boundedLimit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      fileId: row.snapshot_file_id,
      path: row.path,
      symbolId: row.symbol_id,
      symbol: row.symbol,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      contentHash: row.content_hash,
      score: Number(row.score),
      channel: "symbol" as const,
    }));
  }

  async searchSemanticEvidence(options: EmbeddingSearchOptions): Promise<RetrievalSearchRecord[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new DomainError("RETRIEVAL_INPUT_INVALID", "The semantic result limit is invalid.");
    }
    const profile = await this.pool.query<{
      status: EmbeddingIndex["status"];
      dimensions: number | null;
      snapshot_id: string;
    }>("SELECT status, dimensions, snapshot_id FROM snapshot_embedding_indexes WHERE id = $1", [
      options.embeddingIndexId,
    ]);
    const profileRow = profile.rows[0];
    if (!profileRow || profileRow.snapshot_id !== options.snapshotId) {
      throw new DomainError(
        "EMBEDDING_INDEX_NOT_FOUND",
        "The embedding profile does not belong to this snapshot.",
      );
    }
    if (profileRow.status !== "ready") {
      throw new DomainError(
        "EMBEDDING_INDEX_NOT_READY",
        "The embedding profile is not ready for queries.",
        {
          retryable: true,
        },
      );
    }
    if (
      profileRow.dimensions !== null &&
      options.queryVector.length !== Number(profileRow.dimensions)
    ) {
      throw new DomainError(
        "EMBEDDING_DIMENSION_MISMATCH",
        "The query vector dimensions do not match the embedding profile.",
      );
    }
    const query = vectorLiteral(options.queryVector);
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(options.limit)));
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      snapshot_file_id: string;
      path: string;
      symbol_id: string | null;
      symbol: string | null;
      start_line: number;
      end_line: number;
      content: string;
      content_hash: string;
      score: number;
    }>(
      "SELECT c.id, c.snapshot_id, rs.commit_sha, c.snapshot_file_id, f.path, c.symbol_id, " +
        "s.name AS symbol, c.start_line, c.end_line, c.content, c.content_hash, " +
        "1 - (e.embedding <=> $3::vector) AS score " +
        "FROM code_chunk_embeddings e " +
        "JOIN code_chunks c ON c.id = e.code_chunk_id AND c.snapshot_id = e.snapshot_id " +
        "JOIN snapshot_files f ON f.id = c.snapshot_file_id " +
        "JOIN repository_snapshots rs ON rs.id = c.snapshot_id " +
        "LEFT JOIN symbols s ON s.id = c.symbol_id " +
        "JOIN snapshot_embedding_indexes i ON i.id = e.embedding_index_id AND i.snapshot_id = e.snapshot_id " +
        "WHERE e.embedding_index_id = $1 AND e.snapshot_id = $2 AND i.status = 'ready' " +
        "AND e.dimensions = i.dimensions AND e.content_hash = c.content_hash " +
        "ORDER BY e.embedding <=> $3::vector, f.path ASC, c.start_line ASC, c.id ASC LIMIT $4",
      [options.embeddingIndexId, options.snapshotId, query, boundedLimit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      fileId: row.snapshot_file_id,
      path: row.path,
      symbolId: row.symbol_id,
      symbol: row.symbol,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      contentHash: row.content_hash,
      score: Number(row.score),
      channel: "semantic" as const,
    }));
  }

  async listJobEvents(jobId: string, afterId = 0): Promise<JobEventRecord[]> {
    const result = await this.pool.query<{
      id: string | number;
      event_type: string;
      payload_json: Record<string, unknown>;
      created_at: Date | string;
    }>(
      "SELECT id, event_type, payload_json, created_at FROM job_events " +
        "WHERE job_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200",
      [jobId, afterId],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      type: row.event_type,
      payload: row.payload_json,
      createdAt: iso(row.created_at),
    }));
  }

  async claimIndexJob(workerId: string, leaseSeconds: number): Promise<ClaimedIndexJob | null> {
    return withTransaction(this.pool, async (client) => {
      const claimed = await client.query<{
        id: string;
        repository_id: string;
        snapshot_id: string;
        workspace_id: string;
        attempt_count: number;
        max_attempts: number;
      }>(
        "WITH candidate AS (" +
          "SELECT id FROM analysis_jobs " +
          "WHERE job_type = 'index_snapshot' " +
          "AND ((status = 'queued' AND available_at <= now()) " +
          "OR (status = 'running' AND lease_expires_at < now())) " +
          "AND attempt_count < max_attempts " +
          "ORDER BY priority ASC, created_at ASC " +
          "FOR UPDATE SKIP LOCKED LIMIT 1" +
          ") UPDATE analysis_jobs jobs SET " +
          "status = 'running', lease_owner = $1, " +
          "lease_expires_at = now() + ($2 * interval '1 second'), " +
          "available_at = now(), " +
          "attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), " +
          "phase = 'starting', progress = 0, processed = NULL, total = NULL, " +
          "error_code = NULL, error_message = NULL, error_details_json = NULL, finished_at = NULL " +
          "FROM candidate WHERE jobs.id = candidate.id " +
          "RETURNING jobs.id, jobs.repository_id, jobs.snapshot_id, jobs.workspace_id, " +
          "jobs.attempt_count, jobs.max_attempts",
        [workerId, leaseSeconds],
      );

      const job = claimed.rows[0];
      if (!job) {
        return null;
      }

      const details = await client.query<{
        canonical_url: string;
        clone_url: string;
        owner_name: string;
        repo_name: string;
        requested_ref: string | null;
        ignore_patterns: string[];
      }>(
        "SELECT r.canonical_url, r.clone_url, r.owner_name, r.repo_name, " +
          "s.requested_ref, r.ignore_patterns " +
          "FROM repositories r JOIN repository_snapshots s ON s.repository_id = r.id " +
          "WHERE r.id = $1 AND s.id = $2",
        [job.repository_id, job.snapshot_id],
      );
      const detail = details.rows[0];
      if (!detail) {
        throw new DomainError(
          "JOB_RESOURCE_MISSING",
          "The repository or snapshot no longer exists.",
        );
      }

      await this.appendJobEvent(client, job.id, "started", {
        phase: "starting",
        progress: 0,
        attempt: job.attempt_count,
      });

      return {
        id: job.id,
        repositoryId: job.repository_id,
        snapshotId: job.snapshot_id,
        workspaceId: job.workspace_id,
        canonicalUrl: detail.canonical_url,
        cloneUrl: detail.clone_url,
        owner: detail.owner_name,
        name: detail.repo_name,
        requestedRef: detail.requested_ref,
        ignore: detail.ignore_patterns ?? [],
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
      };
    });
  }

  async heartbeatJob(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE analysis_jobs SET lease_expires_at = now() + ($3 * interval '1 second') " +
        "WHERE id = $1 AND lease_owner = $2 AND status = 'running'",
      [jobId, workerId, leaseSeconds],
    );
    return result.rowCount === 1;
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    const result = await this.pool.query<{ cancelled: boolean }>(
      "SELECT cancel_requested_at IS NOT NULL AS cancelled FROM analysis_jobs WHERE id = $1",
      [jobId],
    );
    return result.rows[0]?.cancelled ?? true;
  }

  async requestCancellation(snapshotId: string): Promise<void> {
    await this.pool.query(
      "UPDATE analysis_jobs SET cancel_requested_at = COALESCE(cancel_requested_at, now()) " +
        "WHERE snapshot_id = $1 AND status IN ('queued', 'running')",
      [snapshotId],
    );
  }

  async updateJobProgress(jobId: string, snapshotId: string, progress: JobProgress): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        "UPDATE analysis_jobs SET phase = $2, progress = $3, processed = $4, total = $5 " +
          "WHERE id = $1 AND status = 'running'",
        [
          jobId,
          progress.phase,
          progress.progress,
          progress.processed ?? null,
          progress.total ?? null,
        ],
      );
      if (progress.snapshotStatus) {
        await client.query(
          "UPDATE repository_snapshots SET status = $2 WHERE id = $1 AND status NOT IN ('ready', 'failed', 'cancelled')",
          [snapshotId, progress.snapshotStatus],
        );
      }
      await this.appendJobEvent(client, jobId, "progress", {
        phase: progress.phase,
        progress: progress.progress,
        processed: progress.processed ?? null,
        total: progress.total ?? null,
        message: progress.message,
      });
    });
  }

  async cancelJob(jobId: string, snapshotId: string, workerId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const cancelled = await client.query(
        "UPDATE analysis_jobs SET status = 'cancelled', finished_at = now(), " +
          "phase = 'cancelled', progress = 1, lease_owner = NULL, lease_expires_at = NULL " +
          "WHERE id = $1 AND snapshot_id = $2 AND lease_owner = $3 AND status = 'running' " +
          "RETURNING id",
        [jobId, snapshotId, workerId],
      );
      if (cancelled.rowCount !== 1) {
        throw new DomainError(
          "JOB_LEASE_LOST",
          "The indexing job lease was lost before cancellation.",
          { retryable: true },
        );
      }
      await client.query("UPDATE repository_snapshots SET status = 'cancelled' WHERE id = $1", [
        snapshotId,
      ]);
      await this.appendJobEvent(client, jobId, "cancelled", {
        phase: "cancelled",
        progress: 1,
      });
    });
  }

  async failJob(
    jobId: string,
    snapshotId: string,
    workerId: string,
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const jobResult = await client.query<{ attempt_count: number; max_attempts: number }>(
        "SELECT attempt_count, max_attempts FROM analysis_jobs " +
          "WHERE id = $1 AND snapshot_id = $2 AND lease_owner = $3 AND status = 'running' " +
          "FOR UPDATE",
        [jobId, snapshotId, workerId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        throw new DomainError(
          "JOB_LEASE_LOST",
          "The indexing job lease was lost before failure handling.",
          { retryable: true },
        );
      }
      const shouldRetry = retryable && job.attempt_count < job.max_attempts;
      await client.query(
        "UPDATE analysis_jobs SET status = $2, error_code = $3, error_message = $4, " +
          "error_details_json = jsonb_build_object('retryable', $5::boolean), " +
          "lease_owner = NULL, lease_expires_at = NULL, " +
          "available_at = CASE WHEN $2 = 'queued' THEN now() + (LEAST(30, GREATEST(1, attempt_count * attempt_count)) * interval '1 second') ELSE now() END, " +
          "finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END " +
          "WHERE id = $1",
        [jobId, shouldRetry ? "queued" : "failed", code, message, retryable],
      );
      await client.query(
        "UPDATE repository_snapshots SET status = $2, error_code = $3, error_message = $4, " +
          "failed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END WHERE id = $1",
        [snapshotId, shouldRetry ? "requested" : "failed", code, message],
      );
      await this.appendJobEvent(client, jobId, shouldRetry ? "warning" : "failed", {
        phase: shouldRetry ? "retrying" : "failed",
        progress: 1,
        code,
        message,
        retryable: shouldRetry,
      });
    });
  }

  async completeIndexJob(
    jobId: string,
    snapshotId: string,
    repositoryId: string,
    workerId: string,
    indexed: IndexedRepository,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const lease = await client.query<{ id: string }>(
        "SELECT id FROM analysis_jobs " +
          "WHERE id = $1 AND snapshot_id = $2 AND lease_owner = $3 AND status = 'running' " +
          "FOR UPDATE",
        [jobId, snapshotId, workerId],
      );
      if (lease.rowCount !== 1) {
        throw new DomainError(
          "JOB_LEASE_LOST",
          "The indexing job lease is no longer owned by this worker.",
          { retryable: true },
        );
      }

      await client.query("DELETE FROM snapshot_files WHERE snapshot_id = $1", [snapshotId]);
      const indexVersionResult = await client.query<{ next_version: number }>(
        "SELECT COALESCE(MAX(index_version), 0) + 1 AS next_version " +
          "FROM repository_snapshots " +
          "WHERE repository_id = $1 AND commit_sha = $2 AND parser_version = (" +
          "SELECT parser_version FROM repository_snapshots WHERE id = $3" +
          ") AND id <> $3",
        [repositoryId, indexed.commitSha, snapshotId],
      );
      const indexVersion = indexVersionResult.rows[0]?.next_version ?? 1;
      await client.query(
        "UPDATE repository_snapshots SET commit_sha = $2, ref_name = COALESCE($3, ref_name), " +
          "index_version = $4, base_snapshot_id = $5, index_mode = $6, tree_hash = $7, " +
          "status = 'building_graph', error_code = NULL, error_message = NULL " +
          "WHERE id = $1",
        [
          snapshotId,
          indexed.commitSha,
          indexed.branch,
          indexVersion,
          indexed.baseSnapshotId,
          indexed.indexMode,
          indexed.treeHash,
        ],
      );

      const fileIdByPath = new Map<string, string>();
      for (const file of indexed.files) {
        const fileId = createId();
        fileIdByPath.set(file.path, fileId);
        await client.query(
          "INSERT INTO content_blobs (hash, inline_content, byte_size, mime_type) " +
            "VALUES ($1, $2, $3, $4) ON CONFLICT (hash) DO NOTHING",
          [file.contentHash, file.content, file.byteSize, "text/plain"],
        );
        const parsed = indexed.parsedFiles.some((item) => item.path === file.path);
        await client.query(
          "INSERT INTO snapshot_files (" +
            "id, snapshot_id, path, blob_hash, language, byte_size, line_count, " +
            "is_generated, is_binary, parse_status" +
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)",
          [
            fileId,
            snapshotId,
            file.path,
            file.contentHash,
            file.language,
            file.byteSize,
            file.lineCount,
            file.isGenerated,
            parsed ? "parsed" : "unsupported",
          ],
        );
      }

      const symbolIdByStableKey = new Map<string, string>();
      const symbolByStableKey = new Map<
        string,
        {
          id: string;
          name: string;
          qualifiedName: string | null;
          path: string;
          startLine: number;
          endLine: number;
          contentHash: string;
        }
      >();
      for (const parsedFile of indexed.parsedFiles) {
        const fileId = fileIdByPath.get(parsedFile.path);
        if (!fileId) continue;
        for (const symbol of parsedFile.symbols) {
          const symbolId = createId();
          symbolIdByStableKey.set(symbol.stableKey, symbolId);
          symbolByStableKey.set(symbol.stableKey, {
            id: symbolId,
            name: symbol.name,
            qualifiedName: symbol.qualifiedName,
            path: parsedFile.path,
            startLine: symbol.startLine,
            endLine: symbol.endLine,
            contentHash: symbol.contentHash,
          });
          await client.query(
            "INSERT INTO symbols (" +
              "id, snapshot_id, snapshot_file_id, stable_key, kind, name, qualified_name, " +
              "signature, start_line, start_column, end_line, end_column, doc_text, content_hash" +
              ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
            [
              symbolId,
              snapshotId,
              fileId,
              symbol.stableKey,
              symbol.kind,
              symbol.name,
              symbol.qualifiedName,
              symbol.signature,
              symbol.startLine,
              symbol.startColumn,
              symbol.endLine,
              symbol.endColumn,
              symbol.docText,
              symbol.contentHash,
            ],
          );
        }
      }

      const symbolCandidates = [...symbolByStableKey.values()];
      for (const parsedFile of indexed.parsedFiles) {
        for (const edge of parsedFile.edges) {
          const fromSymbolId = symbolIdByStableKey.get(edge.fromStableKey);
          if (!fromSymbolId) continue;
          let toSymbolId = edge.targetStableKey
            ? symbolIdByStableKey.get(edge.targetStableKey)
            : undefined;
          let unresolvedTarget =
            edge.unresolvedTarget ??
            (edge.type === "calls" ? edge.evidence.referenceTarget : undefined);
          if (!toSymbolId && edge.type === "calls" && unresolvedTarget) {
            const simpleTarget = unresolvedTarget.split(".").at(-1) ?? unresolvedTarget;
            const matches = symbolCandidates.filter(
              (candidate) =>
                candidate.name === simpleTarget ||
                candidate.qualifiedName === unresolvedTarget ||
                candidate.qualifiedName?.endsWith(`.${simpleTarget}`),
            );
            if (matches.length === 1) {
              toSymbolId = matches[0]?.id;
              unresolvedTarget = undefined;
            }
          }
          if (toSymbolId) unresolvedTarget = undefined;
          if (!toSymbolId && !unresolvedTarget) continue;
          await client.query(
            "INSERT INTO symbol_edges (" +
              "id, snapshot_id, from_symbol_id, to_symbol_id, unresolved_target, " +
              "relation_type, confidence, evidence_json" +
              ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) ON CONFLICT DO NOTHING",
            [
              createId(),
              snapshotId,
              fromSymbolId,
              toSymbolId ?? null,
              unresolvedTarget ?? null,
              edge.type,
              edge.confidence,
              JSON.stringify(edge.evidence),
            ],
          );
        }
      }

      // Call-target resolution can collapse syntactically different unresolved references onto
      // the same canonical relationship (for example `run` and `service.run`). The partial unique
      // indexes on symbol_edges are the final graph authority, so publish their committed count
      // instead of a pre-resolution parser estimate.
      const edgeCountResult = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM symbol_edges WHERE snapshot_id = $1",
        [snapshotId],
      );
      const persistedStats = {
        ...indexed.stats,
        edges: edgeCountResult.rows[0]?.count ?? 0,
      };

      const parsedByPath = new Map(indexed.parsedFiles.map((item) => [item.path, item]));
      for (const file of indexed.files) {
        const fileId = fileIdByPath.get(file.path);
        if (!fileId) continue;
        const parsedFile = parsedByPath.get(file.path);
        const chunkSymbols = parsedFile?.symbols.filter((symbol) => symbol.kind !== "module") ?? [];
        for (const chunk of fileTextChunks(file.content)) {
          await client.query(
            "INSERT INTO code_chunks (" +
              "id, snapshot_id, snapshot_file_id, chunk_type, start_line, end_line, " +
              "content, content_hash, token_count" +
              ") VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8)",
            [
              createId(),
              snapshotId,
              fileId,
              chunk.startLine,
              chunk.endLine,
              chunk.content,
              hashText(chunk.content),
              approximateTokens(chunk.content),
            ],
          );
        }
        for (const symbol of chunkSymbols) {
          const symbolId = symbolIdByStableKey.get(symbol.stableKey);
          if (!symbolId) continue;
          const content = sourceSlice(file.content, symbol.startLine, symbol.endLine);
          if (content.trim().length === 0) continue;
          await client.query(
            "INSERT INTO code_chunks (" +
              "id, snapshot_id, snapshot_file_id, symbol_id, chunk_type, " +
              "start_line, end_line, content, content_hash, token_count" +
              ") VALUES ($1, $2, $3, $4, 'symbol', $5, $6, $7, $8, $9)",
            [
              createId(),
              snapshotId,
              fileId,
              symbolId,
              symbol.startLine,
              symbol.endLine,
              content,
              hashText(content),
              approximateTokens(content),
            ],
          );
        }
      }

      await client.query(
        "UPDATE repository_snapshots SET status = 'ready', stats_json = $2::jsonb, " +
          "ready_at = now(), failed_at = NULL, error_code = NULL, error_message = NULL " +
          "WHERE id = $1",
        [snapshotId, JSON.stringify(persistedStats)],
      );
      await client.query(
        "UPDATE repositories r SET latest_ready_snapshot_id = $2, " +
          "default_branch = COALESCE(r.default_branch, $3), updated_at = now() " +
          "FROM repository_snapshots s WHERE r.id = $1 AND s.id = $2 AND s.promote_latest = true",
        [repositoryId, snapshotId, indexed.branch],
      );
      await client.query(
        "UPDATE analysis_jobs SET status = 'succeeded', phase = 'completed', progress = 1, " +
          "processed = total, lease_owner = NULL, lease_expires_at = NULL, finished_at = now(), " +
          "error_code = NULL, error_message = NULL, error_details_json = NULL WHERE id = $1",
        [jobId],
      );
      await this.appendJobEvent(client, jobId, "completed", {
        phase: "completed",
        progress: 1,
        snapshotId,
        commitSha: indexed.commitSha,
        stats: persistedStats,
      });
    });
  }

  async getSnapshotGraphData(snapshotId: string): Promise<SnapshotGraphData | null> {
    const snapshot = await this.getSnapshot(snapshotId);
    if (!snapshot) return null;
    const [fileResult, symbolResult, edgeResult] = await Promise.all([
      this.pool.query<{
        id: string;
        path: string;
        language: string | null;
        byte_size: string | number;
        line_count: number;
        blob_hash: string;
        inline_content: string;
        parse_status: string;
      }>(
        "SELECT f.id, f.path, f.language, f.byte_size, f.line_count, f.blob_hash, " +
          "b.inline_content, f.parse_status FROM snapshot_files f " +
          "JOIN content_blobs b ON b.hash = f.blob_hash " +
          "WHERE f.snapshot_id = $1 ORDER BY f.path",
        [snapshotId],
      ),
      this.pool.query<{
        id: string;
        snapshot_file_id: string;
        path: string;
        stable_key: string;
        kind: string;
        name: string;
        qualified_name: string | null;
        signature: string | null;
        start_line: number;
        end_line: number;
        content_hash: string;
      }>(
        "SELECT s.id, s.snapshot_file_id, f.path, s.stable_key, s.kind, s.name, " +
          "s.qualified_name, s.signature, s.start_line, s.end_line, s.content_hash " +
          "FROM symbols s JOIN snapshot_files f ON f.id = s.snapshot_file_id " +
          "WHERE s.snapshot_id = $1 ORDER BY f.path, s.start_line",
        [snapshotId],
      ),
      this.pool.query<{
        id: string;
        from_symbol_id: string;
        to_symbol_id: string | null;
        unresolved_target: string | null;
        relation_type: string;
        confidence: number;
        evidence_json: Record<string, unknown>;
      }>(
        "SELECT id, from_symbol_id, to_symbol_id, unresolved_target, relation_type, " +
          "confidence, evidence_json FROM symbol_edges WHERE snapshot_id = $1",
        [snapshotId],
      ),
    ]);

    const files: SnapshotFileRecord[] = fileResult.rows.map((row) => ({
      id: row.id,
      path: row.path,
      language: row.language,
      byteSize: Number(row.byte_size),
      lineCount: row.line_count,
      blobHash: row.blob_hash,
      content: row.inline_content,
      parseStatus: row.parse_status,
    }));
    const symbols: SymbolRecord[] = symbolResult.rows.map((row) => ({
      id: row.id,
      fileId: row.snapshot_file_id,
      path: row.path,
      stableKey: row.stable_key,
      kind: row.kind,
      name: row.name,
      qualifiedName: row.qualified_name,
      signature: row.signature,
      startLine: row.start_line,
      endLine: row.end_line,
      contentHash: row.content_hash,
    }));
    const edges: SymbolEdgeRecord[] = edgeResult.rows.map((row) => ({
      id: row.id,
      fromSymbolId: row.from_symbol_id,
      toSymbolId: row.to_symbol_id,
      unresolvedTarget: row.unresolved_target,
      relationType: row.relation_type,
      confidence: Number(row.confidence),
      evidence: row.evidence_json,
    }));
    return { snapshot, files, symbols, edges };
  }

  async getSourceFile(
    snapshotId: string,
    path: string,
    startLine?: number,
    endLine?: number,
  ): Promise<SourceFile | null> {
    const result = await this.pool.query<{
      id: string;
      path: string;
      language: string | null;
      line_count: number;
      blob_hash: string;
      inline_content: string;
      commit_sha: string;
    }>(
      "SELECT f.id, f.path, f.language, f.line_count, f.blob_hash, b.inline_content, " +
        "s.commit_sha FROM snapshot_files f " +
        "JOIN content_blobs b ON b.hash = f.blob_hash " +
        "JOIN repository_snapshots s ON s.id = f.snapshot_id " +
        "WHERE f.snapshot_id = $1 AND f.path = $2 AND s.status = 'ready'",
      [snapshotId, path],
    );
    const row = result.rows[0];
    if (!row) return null;
    const maximumLine = Math.max(1, row.line_count);
    const from = Math.min(startLine ?? 1, maximumLine);
    const to = Math.min(Math.max(endLine ?? maximumLine, from), maximumLine);
    const truncated = from > 1 || to < maximumLine;
    return {
      id: row.id,
      path: row.path,
      language: row.language,
      content: truncated ? sourceSlice(row.inline_content, from, to) : row.inline_content,
      lineCount: row.line_count,
      startLine: from,
      commitSha: row.commit_sha,
      blobHash: row.blob_hash,
      truncated,
    };
  }

  async getSnapshotSymbolEvidence(
    snapshotId: string,
    symbolId: string,
  ): Promise<SnapshotSymbolEvidence | null> {
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      parser_version: string;
      snapshot_file_id: string;
      path: string;
      language: string | null;
      blob_hash: string;
      inline_content: string;
      stable_key: string;
      kind: SnapshotSymbolEvidence["kind"];
      name: string;
      qualified_name: string | null;
      signature: string | null;
      start_line: number;
      end_line: number;
    }>(
      "SELECT symbol.id, symbol.snapshot_id, snapshot.commit_sha, snapshot.parser_version, " +
        "symbol.snapshot_file_id, file.path, file.language, file.blob_hash, blob.inline_content, " +
        "symbol.stable_key, symbol.kind, symbol.name, symbol.qualified_name, symbol.signature, " +
        "symbol.start_line, symbol.end_line FROM symbols symbol " +
        "JOIN repository_snapshots snapshot ON snapshot.id = symbol.snapshot_id " +
        "JOIN snapshot_files file ON file.id = symbol.snapshot_file_id " +
        "JOIN content_blobs blob ON blob.hash = file.blob_hash " +
        "WHERE symbol.snapshot_id = $1 AND symbol.id = $2 " +
        "AND snapshot.status = 'ready' AND snapshot.commit_sha IS NOT NULL",
      [snapshotId, symbolId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const content = sourceSlice(row.inline_content, row.start_line, row.end_line);
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      parserVersion: row.parser_version,
      fileId: row.snapshot_file_id,
      path: row.path,
      language: row.language,
      blobHash: row.blob_hash,
      stableKey: row.stable_key,
      kind: row.kind,
      name: row.name,
      qualifiedName: row.qualified_name,
      signature: row.signature,
      startLine: row.start_line,
      endLine: row.end_line,
      content,
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    };
  }

  async listSnapshotFiles(
    snapshotId: string,
    options: ListSnapshotFilesOptions = {},
  ): Promise<SnapshotFilePage> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const result = await this.pool.query<{
      id: string;
      path: string;
      language: string | null;
      byte_size: string | number;
      line_count: number;
      blob_hash: string;
      parse_status: string;
    }>(
      "SELECT f.id, f.path, f.language, f.byte_size, f.line_count, f.blob_hash, " +
        "f.parse_status FROM snapshot_files f " +
        "JOIN repository_snapshots s ON s.id = f.snapshot_id " +
        "WHERE f.snapshot_id = $1 AND s.status = 'ready' " +
        "AND ($2::text IS NULL OR f.path > $2) " +
        "AND ($3::text IS NULL OR f.path LIKE $3 || '%') " +
        "AND ($4::text IS NULL OR f.language = $4) " +
        "AND ($5::text IS NULL OR f.path ILIKE '%' || $5 || '%') " +
        "ORDER BY f.path ASC LIMIT $6",
      [
        snapshotId,
        options.afterPath ?? null,
        options.pathPrefix ?? null,
        options.language ?? null,
        options.query ?? null,
        limit + 1,
      ],
    );
    const pageRows = result.rows.slice(0, limit);
    return {
      files: pageRows.map((row) => ({
        id: row.id,
        path: row.path,
        language: row.language,
        byteSize: Number(row.byte_size),
        lineCount: row.line_count,
        blobHash: row.blob_hash,
        parseStatus: row.parse_status,
      })),
      nextCursor: result.rows.length > limit ? (pageRows.at(-1)?.path ?? null) : null,
    };
  }

  async searchEvidence(
    snapshotId: string,
    query: string,
    limit = 20,
  ): Promise<SearchEvidenceRecord[]> {
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    const result = await this.pool.query<{
      id: string;
      snapshot_id: string;
      commit_sha: string;
      snapshot_file_id: string;
      path: string;
      symbol_id: string | null;
      symbol: string | null;
      start_line: number;
      end_line: number;
      content: string;
      content_hash: string;
      score: number;
    }>(
      "WITH search_query AS (SELECT plainto_tsquery('simple', $2) AS query) " +
        "SELECT c.id, c.snapshot_id, rs.commit_sha, c.snapshot_file_id, f.path, " +
        "c.symbol_id, s.name AS symbol, c.start_line, c.end_line, c.content, c.content_hash, " +
        "GREATEST(" +
        "ts_rank_cd(c.search_vector, search_query.query), " +
        "similarity(f.path, $2), similarity(COALESCE(s.name, ''), $2)" +
        ") AS score " +
        "FROM code_chunks c " +
        "JOIN snapshot_files f ON f.id = c.snapshot_file_id " +
        "JOIN repository_snapshots rs ON rs.id = c.snapshot_id " +
        "LEFT JOIN symbols s ON s.id = c.symbol_id " +
        "CROSS JOIN search_query " +
        "WHERE c.snapshot_id = $1 AND rs.status = 'ready' AND (" +
        "c.search_vector @@ search_query.query OR f.path ILIKE '%' || $2 || '%' " +
        "OR s.name ILIKE '%' || $2 || '%' OR s.qualified_name ILIKE '%' || $2 || '%'" +
        ") ORDER BY score DESC, f.path ASC, c.start_line ASC LIMIT $3",
      [snapshotId, normalized, Math.min(100, Math.max(1, limit))],
    );
    return result.rows.map((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      commitSha: row.commit_sha,
      fileId: row.snapshot_file_id,
      path: row.path,
      symbolId: row.symbol_id,
      symbol: row.symbol,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      contentHash: row.content_hash,
      score: Number(row.score),
    }));
  }

  async saveAnswer(input: SaveAnswerInput): Promise<string> {
    if (input.evidence.some((item) => item.snapshotId !== input.snapshotId)) {
      throw new DomainError(
        "EVIDENCE_SCOPE_INVALID",
        "Answer evidence must belong to the selected snapshot.",
      );
    }
    return withTransaction(this.pool, async (client) => {
      const conversationId = createId();
      const userMessageId = createId();
      const assistantMessageId = createId();
      await client.query(
        "INSERT INTO conversations (" +
          "id, workspace_id, repository_id, snapshot_id, created_by, title" +
          ") VALUES ($1, $2, $3, $4, $5, $6)",
        [
          conversationId,
          input.workspaceId,
          input.repositoryId,
          input.snapshotId,
          PUBLIC_USER_ID,
          input.question.slice(0, 120),
        ],
      );
      await client.query(
        "INSERT INTO messages (id, conversation_id, role, content) " +
          "VALUES ($1, $2, 'user', $3)",
        [userMessageId, conversationId, input.question],
      );
      await client.query(
        "INSERT INTO messages (" +
          "id, conversation_id, role, content, answer_status, model_provider, " +
          "model_name, prompt_version, latency_ms" +
          ") VALUES ($1, $2, 'assistant', $3, $4, $5, $6, 'grounded-v1', $7)",
        [
          assistantMessageId,
          conversationId,
          JSON.stringify(input.answer),
          input.answer.status,
          input.answer.provider,
          input.answer.model,
          input.latencyMs,
        ],
      );
      const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
      for (const [ordinal, citation] of input.answer.citations.entries()) {
        const evidence = evidenceById.get(citation.evidenceId);
        if (!evidence) {
          throw new DomainError(
            "EVIDENCE_NOT_FOUND",
            "A verified answer citation is missing its source evidence.",
          );
        }
        await client.query(
          "INSERT INTO message_citations (" +
            "id, message_id, snapshot_file_id, symbol_id, evidence_id, start_line, end_line, " +
            "quote, evidence_hash, retrieval_score, ordinal" +
            ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
          [
            createId(),
            assistantMessageId,
            evidence.fileId,
            evidence.symbolId,
            evidence.id,
            citation.startLine,
            citation.endLine,
            citation.quote,
            evidence.contentHash,
            evidence.score,
            ordinal,
          ],
        );
      }
      return assistantMessageId;
    });
  }

  async createShareReport(
    repositoryId: string,
    snapshotId: string,
    title: string,
    content: ShareReportContent,
  ): Promise<{ id: string; slug: string }> {
    const repository = await this.getRepository(repositoryId);
    const snapshot = await this.getSnapshot(snapshotId);
    if (
      !repository ||
      !snapshot ||
      snapshot.repositoryId !== repositoryId ||
      snapshot.status !== "ready" ||
      !snapshot.commitSha
    ) {
      throw new DomainError(
        "SNAPSHOT_NOT_READY",
        "A share report can only be created for a ready snapshot.",
      );
    }
    const id = createId();
    const slug =
      repository.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-") +
      "-" +
      snapshot.commitSha.slice(0, 7) +
      "-" +
      // UUIDv7 starts with a timestamp, so its first characters are shared by
      // reports created in the same millisecond. Keep the random tail in the
      // public slug to make concurrent share creation collision-resistant.
      id
        .replaceAll("-", "")
        .slice(-16);
    await this.pool.query(
      "INSERT INTO share_reports (" +
        "id, repository_id, snapshot_id, slug, title, report_type, visibility, content_version, generated_content_json, created_by" +
        ") VALUES ($1, $2, $3, $4, $5, $6, 'public', $7, $8::jsonb, $9)",
      [
        id,
        repositoryId,
        snapshotId,
        slug,
        title,
        content.version === 2 ? "architecture_story" : "architecture_tour",
        content.version === 2 ? 2 : 1,
        JSON.stringify(content),
        PUBLIC_USER_ID,
      ],
    );
    return { id, slug };
  }

  async getShareReport(slug: string): Promise<ShareReportRecord | null> {
    const result = await this.pool.query<{
      id: string;
      repository_id: string;
      snapshot_id: string;
      slug: string;
      title: string;
      generated_content_json: ShareReportContent;
      created_at: Date | string;
    }>(
      "SELECT id, repository_id, snapshot_id, slug, title, generated_content_json, created_at " +
        "FROM share_reports WHERE slug = $1 AND visibility = 'public' AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > now())",
      [slug],
    );
    const row = result.rows[0];
    if (!row) return null;
    const [repository, snapshot] = await Promise.all([
      this.getRepository(row.repository_id),
      this.getSnapshot(row.snapshot_id),
    ]);
    if (!repository || !snapshot) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      repository,
      snapshot,
      content: shareReportContentSchema.parse(row.generated_content_json),
      createdAt: iso(row.created_at),
    };
  }

  private async appendJobEvent(
    client: DatabaseClient,
    jobId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      "INSERT INTO job_events (job_id, event_type, payload_json) VALUES ($1, $2, $3::jsonb)",
      [jobId, type, JSON.stringify(payload)],
    );
  }
}
