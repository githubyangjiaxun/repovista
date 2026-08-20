import type { AppConfig } from "@repovista/config";
import type { PullRequestAnalysisJob, RepoVistaStore } from "@repovista/database";
import { DomainError, isDomainError } from "@repovista/domain";
import { computePullRequestImpact } from "@repovista/impact";

function mergeProviderFiles(
  computed: ReturnType<typeof computePullRequestImpact>["files"],
  provider: PullRequestAnalysisJob["providerFiles"],
) {
  const byPath = new Map(computed.map((file) => [file.path, file]));
  for (const file of provider) {
    const staticFile = byPath.get(file.path);
    byPath.set(file.path, {
      ...staticFile,
      ...file,
      baseBlobHash: staticFile?.baseBlobHash ?? file.baseBlobHash,
      headBlobHash: staticFile?.headBlobHash ?? file.headBlobHash,
    });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export type PullRequestAnalysisStore = Pick<
  RepoVistaStore,
  | "attachPullRequestSnapshots"
  | "cancelPullRequestAnalysis"
  | "claimPullRequestAnalysisJob"
  | "completePullRequestAnalysis"
  | "deferPullRequestAnalysis"
  | "ensureSnapshotForCommit"
  | "failPullRequestAnalysis"
  | "getSnapshotGraphData"
  | "heartbeatJob"
  | "isCancellationRequested"
  | "updatePullRequestAnalysisProgress"
>;

export type PullRequestAnalysisConfig = Pick<AppConfig, "JOB_LEASE_SECONDS" | "WORKER_ID">;
export type PullRequestAnalysisOutcome =
  | "cancelled"
  | "deferred"
  | "failed"
  | "lease-lost"
  | "succeeded";

class AnalysisLease {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lost = false;

  constructor(
    private readonly store: PullRequestAnalysisStore,
    private readonly job: PullRequestAnalysisJob,
    private readonly config: PullRequestAnalysisConfig,
  ) {}

  start(): void {
    const interval = Math.max(1_000, Math.floor((this.config.JOB_LEASE_SECONDS * 1_000) / 3));
    this.timer = setInterval(() => void this.heartbeat(), interval);
    this.timer.unref();
  }

  async checkpoint(): Promise<void> {
    await this.heartbeat();
    if (this.lost) {
      throw new DomainError("JOB_LEASE_LOST", "The pull request analysis lease was lost.", {
        retryable: true,
      });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async heartbeat(): Promise<void> {
    if (this.lost) return;
    try {
      this.lost = !(await this.store.heartbeatJob(
        this.job.id,
        this.config.WORKER_ID,
        this.config.JOB_LEASE_SECONDS,
      ));
    } catch {
      this.lost = true;
    }
  }
}

function failure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (isDomainError(error)) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "PULL_REQUEST_ANALYSIS_FAILED",
    message: error instanceof Error ? error.message : "Pull request analysis failed unexpectedly.",
    retryable: false,
  };
}

export async function executePullRequestAnalysisJob(
  store: PullRequestAnalysisStore,
  job: PullRequestAnalysisJob,
  config: PullRequestAnalysisConfig,
): Promise<PullRequestAnalysisOutcome> {
  const lease = new AnalysisLease(store, job, config);
  lease.start();
  try {
    await lease.checkpoint();
    if (await store.isCancellationRequested(job.id)) {
      await store.cancelPullRequestAnalysis(job.id, job.analysisId, config.WORKER_ID);
      return "cancelled";
    }
    await store.updatePullRequestAnalysisProgress(job.id, job.analysisId, config.WORKER_ID, {
      phase: "ensuring_snapshots",
      value: 0.15,
      message: "Ensuring immutable base and head snapshots.",
    });
    const base = await store.ensureSnapshotForCommit({
      repositoryId: job.repositoryId,
      workspaceId: job.workspaceId,
      commitSha: job.baseSha,
      parserVersion: job.parserVersion,
    });
    const head =
      job.baseSha.toLowerCase() === job.headSha.toLowerCase()
        ? base
        : await store.ensureSnapshotForCommit({
            repositoryId: job.repositoryId,
            workspaceId: job.workspaceId,
            commitSha: job.headSha,
            parserVersion: job.parserVersion,
          });
    await store.attachPullRequestSnapshots(job.analysisId, base.snapshotId, head.snapshotId);
    if (base.status !== "ready" || head.status !== "ready") {
      lease.stop();
      await store.deferPullRequestAnalysis(
        job.id,
        job.analysisId,
        config.WORKER_ID,
        `Waiting for base (${base.status}) and head (${head.status}) snapshots.`,
      );
      return "deferred";
    }

    await lease.checkpoint();
    if (await store.isCancellationRequested(job.id)) {
      lease.stop();
      await store.cancelPullRequestAnalysis(job.id, job.analysisId, config.WORKER_ID);
      return "cancelled";
    }
    await store.updatePullRequestAnalysisProgress(job.id, job.analysisId, config.WORKER_ID, {
      phase: "computing_impact",
      value: 0.65,
      message: "Computing changed symbols and reverse dependency impact.",
    });
    const [baseGraph, headGraph] = await Promise.all([
      store.getSnapshotGraphData(base.snapshotId),
      store.getSnapshotGraphData(head.snapshotId),
    ]);
    if (!baseGraph || !headGraph) {
      throw new DomainError("PR_SNAPSHOT_NOT_FOUND", "A pull request snapshot no longer exists.");
    }
    if (
      baseGraph.snapshot.status !== "ready" ||
      headGraph.snapshot.status !== "ready" ||
      baseGraph.snapshot.commitSha?.toLowerCase() !== job.baseSha.toLowerCase() ||
      headGraph.snapshot.commitSha?.toLowerCase() !== job.headSha.toLowerCase() ||
      baseGraph.snapshot.parserVersion !== job.parserVersion ||
      headGraph.snapshot.parserVersion !== job.parserVersion
    ) {
      throw new DomainError(
        "PR_SNAPSHOT_INVARIANT_FAILED",
        "The pull request snapshots do not match the fixed commits and parser version.",
      );
    }
    const computation = computePullRequestImpact(
      {
        side: "base",
        snapshotId: base.snapshotId,
        commitSha: job.baseSha,
        files: baseGraph.files,
        symbols: baseGraph.symbols,
        edges: baseGraph.edges,
      },
      {
        side: "head",
        snapshotId: head.snapshotId,
        commitSha: job.headSha,
        files: headGraph.files,
        symbols: headGraph.symbols,
        edges: headGraph.edges,
      },
    );
    computation.files = mergeProviderFiles(computation.files, job.providerFiles);
    computation.stats.changedFiles = computation.files.length;
    await lease.checkpoint();
    if (await store.isCancellationRequested(job.id)) {
      lease.stop();
      await store.cancelPullRequestAnalysis(job.id, job.analysisId, config.WORKER_ID);
      return "cancelled";
    }
    lease.stop();
    await store.completePullRequestAnalysis({
      jobId: job.id,
      analysisId: job.analysisId,
      workerId: config.WORKER_ID,
      computation,
      baseSnapshotId: base.snapshotId,
      headSnapshotId: head.snapshotId,
    });
    return "succeeded";
  } catch (error) {
    if (isDomainError(error) && error.code === "JOB_LEASE_LOST") return "lease-lost";
    const details = failure(error);
    try {
      await store.failPullRequestAnalysis(
        job.id,
        job.analysisId,
        config.WORKER_ID,
        details.code,
        details.message,
        details.retryable,
      );
      return "failed";
    } catch (failureError) {
      if (isDomainError(failureError) && failureError.code === "JOB_LEASE_LOST")
        return "lease-lost";
      throw failureError;
    }
  } finally {
    lease.stop();
  }
}

export async function executeNextPullRequestAnalysisJob(
  store: PullRequestAnalysisStore,
  config: PullRequestAnalysisConfig,
): Promise<boolean> {
  const job = await store.claimPullRequestAnalysisJob(config.WORKER_ID, config.JOB_LEASE_SECONDS);
  if (!job) return false;
  await executePullRequestAnalysisJob(store, job, config);
  return true;
}
