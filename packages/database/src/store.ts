import { createHash } from "node:crypto";
import type {
  Job,
  RepositorySummary,
  Snapshot,
  SnapshotStats,
  SourceFile,
} from "@repovista/contracts";
import {
  createId,
  DomainError,
  type IndexedRepository,
  type JobProgress,
  PUBLIC_USER_ID,
} from "@repovista/domain";
import type { DatabaseClient, DatabasePool } from "./pool.js";
import { withTransaction } from "./pool.js";
import type {
  ClaimedIndexJob,
  CreateImportInput,
  CreateImportResult,
  JobEventRecord,
  ListSnapshotFilesOptions,
  SaveAnswerInput,
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
  stats_json: SnapshotStats;
  error_code: string | null;
  error_message: string | null;
  requested_at: Date | string;
  ready_at: Date | string | null;
}

interface JobRow {
  id: string;
  snapshot_id: string;
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
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
    stats: row.stats_json ?? {
      files: 0,
      symbols: 0,
      edges: 0,
      languages: {},
      warnings: 0,
    },
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

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
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

  async listRepositories(workspaceId: string): Promise<RepositorySummary[]> {
    const result = await this.pool.query<RepositoryRow>(
      "SELECT r.id, r.owner_name, r.repo_name, r.canonical_url, r.default_branch, " +
        "r.latest_ready_snapshot_id, s.status AS latest_snapshot_status, " +
        "s.commit_sha AS latest_commit_sha, r.created_at, r.updated_at " +
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
        "s.commit_sha AS latest_commit_sha, r.created_at, r.updated_at " +
        "FROM repositories r " +
        "LEFT JOIN repository_snapshots s ON s.id = r.latest_ready_snapshot_id " +
        "WHERE r.id = $1",
      [repositoryId],
    );
    const row = result.rows[0];
    return row ? mapRepository(row) : null;
  }

  async listSnapshots(repositoryId: string): Promise<Snapshot[]> {
    const result = await this.pool.query<SnapshotRow>(
      "SELECT id, repository_id, commit_sha, ref_name, status, parser_version, " +
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
        "stats_json, error_code, error_message, requested_at, ready_at " +
        "FROM repository_snapshots WHERE id = $1",
      [snapshotId],
    );
    const row = result.rows[0];
    return row ? mapSnapshot(row) : null;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const result = await this.pool.query<JobRow>(
      "SELECT id, snapshot_id, job_type, status, phase, progress, processed, total, " +
        "attempt_count, max_attempts, error_code, error_message, " +
        "COALESCE((error_details_json->>'retryable')::boolean, false) " +
        "AND status IN ('queued', 'failed') AS error_retryable " +
        "FROM analysis_jobs WHERE id = $1",
      [jobId],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
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
          "AND (status = 'queued' OR (status = 'running' AND lease_expires_at < now())) " +
          "AND attempt_count < max_attempts " +
          "ORDER BY priority ASC, created_at ASC " +
          "FOR UPDATE SKIP LOCKED LIMIT 1" +
          ") UPDATE analysis_jobs jobs SET " +
          "status = 'running', lease_owner = $1, " +
          "lease_expires_at = now() + ($2 * interval '1 second'), " +
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
        "UPDATE repository_snapshots SET commit_sha = $2, ref_name = $3, " +
          "index_version = $4, status = 'building_graph', error_code = NULL, error_message = NULL " +
          "WHERE id = $1",
        [snapshotId, indexed.commitSha, indexed.branch, indexVersion],
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
          let unresolvedTarget = edge.unresolvedTarget;
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
        [snapshotId, JSON.stringify(indexed.stats)],
      );
      await client.query(
        "UPDATE repositories SET latest_ready_snapshot_id = $2, " +
          "default_branch = COALESCE(default_branch, $3), updated_at = now() WHERE id = $1",
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
        stats: indexed.stats,
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
      id.slice(0, 8);
    await this.pool.query(
      "INSERT INTO share_reports (" +
        "id, repository_id, snapshot_id, slug, title, visibility, generated_content_json, created_by" +
        ") VALUES ($1, $2, $3, $4, $5, 'public', $6::jsonb, $7)",
      [id, repositoryId, snapshotId, slug, title, JSON.stringify(content), PUBLIC_USER_ID],
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
      content: row.generated_content_json,
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
