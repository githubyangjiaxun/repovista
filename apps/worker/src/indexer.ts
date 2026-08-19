import path from "node:path";
import type { AppConfig } from "@repovista/config";
import type { ClaimedIndexJob, RepoVistaStore } from "@repovista/database";
import {
  DomainError,
  type IndexedRepository,
  isDomainError,
  type ParsedFile,
  type ScannedFile,
} from "@repovista/domain";
import { cloneRepository, createWorkspace, removeWorkspace, scanWorkspace } from "@repovista/git";
import { linkParsedImports } from "@repovista/graph";
import { parseRepository } from "@repovista/parser";

export type IndexerStore = Pick<
  RepoVistaStore,
  | "cancelJob"
  | "claimIndexJob"
  | "completeIndexJob"
  | "failJob"
  | "heartbeatJob"
  | "isCancellationRequested"
  | "updateJobProgress"
>;

export type IndexerConfig = Pick<
  AppConfig,
  | "JOB_LEASE_SECONDS"
  | "JOB_TIMEOUT_SECONDS"
  | "REPOSITORY_MAX_BYTES"
  | "REPOSITORY_MAX_FILES"
  | "SOURCE_FILE_MAX_BYTES"
  | "WORKER_ID"
>;

export interface IndexerDependencies {
  cloneRepository: typeof cloneRepository;
  createWorkspace: typeof createWorkspace;
  linkParsedImports: typeof linkParsedImports;
  parseRepository: typeof parseRepository;
  removeWorkspace: typeof removeWorkspace;
  scanWorkspace: typeof scanWorkspace;
}

export type IndexJobOutcome = "cancelled" | "failed" | "lease-lost" | "succeeded";

const defaultDependencies: IndexerDependencies = {
  cloneRepository,
  createWorkspace,
  linkParsedImports,
  parseRepository,
  removeWorkspace,
  scanWorkspace,
};

class CancellationRequested extends Error {
  constructor() {
    super("The indexing job was cancelled.");
    this.name = "CancellationRequested";
  }
}

class JobLeaseGuard {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private renewal: Promise<void> | null = null;
  private leaseLost = false;
  private heartbeatFailure: unknown;

  constructor(
    private readonly store: IndexerStore,
    private readonly job: ClaimedIndexJob,
    private readonly config: IndexerConfig,
  ) {}

  start(): void {
    const heartbeatInterval = Math.max(
      1_000,
      Math.floor((this.config.JOB_LEASE_SECONDS * 1_000) / 3),
    );
    this.heartbeatTimer = setInterval(() => {
      void this.renew().catch(() => undefined);
    }, heartbeatInterval);
    this.heartbeatTimer.unref();
  }

  async checkpoint(): Promise<void> {
    await this.renew();
    if (await this.store.isCancellationRequested(this.job.id)) {
      throw new CancellationRequested();
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.renewal?.catch(() => undefined);
  }

  private async renew(): Promise<void> {
    if (this.leaseLost) {
      throw new DomainError("JOB_LEASE_LOST", "The worker no longer owns the indexing job.", {
        retryable: true,
        cause: this.heartbeatFailure,
      });
    }
    if (this.renewal) {
      await this.renewal;
      return;
    }

    const renewal = (async () => {
      try {
        const owned = await this.store.heartbeatJob(
          this.job.id,
          this.config.WORKER_ID,
          this.config.JOB_LEASE_SECONDS,
        );
        if (!owned) {
          this.leaseLost = true;
        }
      } catch (error) {
        this.leaseLost = true;
        this.heartbeatFailure = error;
      }
    })();
    this.renewal = renewal;
    await renewal;
    if (this.renewal === renewal) {
      this.renewal = null;
    }
    if (this.leaseLost) {
      throw new DomainError("JOB_LEASE_LOST", "The worker no longer owns the indexing job.", {
        retryable: true,
        cause: this.heartbeatFailure,
      });
    }
  }
}

function calculateStats(files: readonly ScannedFile[], parsedFiles: readonly ParsedFile[]) {
  const languages: Record<string, number> = {};
  for (const file of files) {
    const language = file.language ?? "other";
    languages[language] = (languages[language] ?? 0) + 1;
  }
  return {
    files: files.length,
    symbols: parsedFiles.reduce((total, file) => total + file.symbols.length, 0),
    edges: parsedFiles.reduce((total, file) => total + file.edges.length, 0),
    languages,
    warnings: 0,
  };
}

function failureDetails(error: unknown): { code: string; message: string; retryable: boolean } {
  if (isDomainError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "INDEXING_FAILED",
    message: error instanceof Error ? error.message : "The indexing job failed unexpectedly.",
    retryable: false,
  };
}

async function parseInBatches(
  store: IndexerStore,
  lease: JobLeaseGuard,
  job: ClaimedIndexJob,
  files: readonly ScannedFile[],
  dependencies: IndexerDependencies,
): Promise<ParsedFile[]> {
  const parseable = files.filter(
    (file) => file.language === "typescript" || file.language === "javascript",
  );
  const parsedFiles: ParsedFile[] = [];
  const batchSize = 25;

  if (parseable.length === 0) {
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "parsing",
      phase: "parsing",
      progress: 0.7,
      processed: 0,
      total: 0,
      message: "No TypeScript or JavaScript files require parsing.",
    });
    return parsedFiles;
  }

  for (let offset = 0; offset < parseable.length; offset += batchSize) {
    await lease.checkpoint();
    const batch = parseable.slice(offset, offset + batchSize);
    parsedFiles.push(...dependencies.parseRepository(batch));
    const processed = Math.min(offset + batch.length, parseable.length);
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "parsing",
      phase: "parsing",
      progress: 0.45 + (processed / parseable.length) * 0.25,
      processed,
      total: parseable.length,
      message: `Parsed ${processed} of ${parseable.length} source files.`,
    });
  }
  return parsedFiles;
}

export async function executeIndexJob(
  store: IndexerStore,
  job: ClaimedIndexJob,
  config: IndexerConfig,
  dependencies: IndexerDependencies = defaultDependencies,
): Promise<IndexJobOutcome> {
  const lease = new JobLeaseGuard(store, job, config);
  let workspace: string | null = null;
  lease.start();

  try {
    await lease.checkpoint();
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "cloning",
      phase: "cloning",
      progress: 0.05,
      message: `Cloning ${job.owner}/${job.name}.`,
    });
    workspace = await dependencies.createWorkspace(`repovista-${job.id.slice(0, 8)}-`);
    const repositoryDirectory = path.join(workspace, "repository");
    const clone = await dependencies.cloneRepository({
      cloneUrl: job.cloneUrl,
      destination: repositoryDirectory,
      ref: job.requestedRef,
      timeoutMs: config.JOB_TIMEOUT_SECONDS * 1_000,
    });

    await lease.checkpoint();
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "scanning",
      phase: "scanning",
      progress: 0.25,
      message: "Scanning repository files.",
    });
    const files = await dependencies.scanWorkspace({
      directory: repositoryDirectory,
      maxFiles: config.REPOSITORY_MAX_FILES,
      maxBytes: config.REPOSITORY_MAX_BYTES,
      maxFileBytes: config.SOURCE_FILE_MAX_BYTES,
      ignore: job.ignore,
    });

    await lease.checkpoint();
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "parsing",
      phase: "parsing",
      progress: 0.45,
      processed: 0,
      total: files.length,
      message: `Preparing to parse ${files.length} files.`,
    });
    const parsedFiles = await parseInBatches(store, lease, job, files, dependencies);

    await lease.checkpoint();
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "building_graph",
      phase: "building_graph",
      progress: 0.75,
      message: "Resolving local imports and symbol relationships.",
    });
    const linkedFiles = dependencies.linkParsedImports(files, parsedFiles);
    const indexed: IndexedRepository = {
      commitSha: clone.commitSha,
      branch: clone.branch,
      files: [...files],
      parsedFiles: linkedFiles,
      stats: calculateStats(files, linkedFiles),
    };

    await lease.checkpoint();
    await store.updateJobProgress(job.id, job.snapshotId, {
      status: "running",
      snapshotStatus: "building_graph",
      phase: "persisting",
      progress: 0.9,
      processed: indexed.stats.symbols,
      total: indexed.stats.symbols,
      message: "Persisting the repository snapshot.",
    });
    await lease.stop();
    await store.completeIndexJob(
      job.id,
      job.snapshotId,
      job.repositoryId,
      config.WORKER_ID,
      indexed,
    );
    return "succeeded";
  } catch (error) {
    if (error instanceof CancellationRequested) {
      try {
        await store.cancelJob(job.id, job.snapshotId, config.WORKER_ID);
        return "cancelled";
      } catch (cancelError) {
        if (isDomainError(cancelError) && cancelError.code === "JOB_LEASE_LOST") {
          return "lease-lost";
        }
        throw cancelError;
      }
    }
    if (isDomainError(error) && error.code === "JOB_LEASE_LOST") {
      return "lease-lost";
    }
    const failure = failureDetails(error);
    try {
      await store.failJob(
        job.id,
        job.snapshotId,
        config.WORKER_ID,
        failure.code,
        failure.message,
        failure.retryable,
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
    if (workspace) {
      await dependencies.removeWorkspace(workspace);
    }
  }
}

export async function executeNextIndexJob(
  store: IndexerStore,
  config: IndexerConfig,
  dependencies: IndexerDependencies = defaultDependencies,
): Promise<boolean> {
  const job = await store.claimIndexJob(config.WORKER_ID, config.JOB_LEASE_SECONDS);
  if (!job) return false;
  await executeIndexJob(store, job, config, dependencies);
  return true;
}
