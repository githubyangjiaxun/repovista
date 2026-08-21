import type { PullRequestAnalysisJob } from "@repovista/database";
import { describe, expect, it, vi } from "vitest";
import {
  executePullRequestAnalysisJob,
  type PullRequestAnalysisConfig,
  type PullRequestAnalysisStore,
} from "./pull-request-analyzer.js";

const job: PullRequestAnalysisJob = {
  id: "01900000-0000-7000-8000-000000000101",
  analysisId: "01900000-0000-7000-8000-000000000102",
  repositoryId: "01900000-0000-7000-8000-000000000103",
  workspaceId: "00000000-0000-7000-8000-000000000002",
  owner: "acme",
  name: "demo",
  cloneUrl: "https://github.com/acme/demo.git",
  visibility: "public",
  githubInstallationId: null,
  githubInstallationSuspended: false,
  prNumber: 42,
  title: "Change greeting",
  canonicalUrl: "https://github.com/acme/demo/pull/42",
  baseSha: "1111111111111111111111111111111111111111",
  headSha: "2222222222222222222222222222222222222222",
  parserVersion: "tree-sitter-ts-js-py-go-v1",
  algorithmVersion: "reverse-bfs-risk-v1",
  providerFiles: [],
  attemptCount: 1,
  maxAttempts: 3,
};

const config: PullRequestAnalysisConfig = {
  JOB_LEASE_SECONDS: 30,
  WORKER_ID: "test-worker",
};

function graph(snapshotId: string, commitSha: string, contentHash: string) {
  const fileId = snapshotId.replace(/.$/, "4");
  const symbolId = snapshotId.replace(/.$/, "5");
  return {
    snapshot: {
      id: snapshotId,
      repositoryId: job.repositoryId,
      commitSha,
      refName: null,
      status: "ready" as const,
      parserVersion: job.parserVersion,
      baseSnapshotId: null,
      indexMode: "full" as const,
      treeHash: "sha256:tree",
      stats: {
        files: 1,
        symbols: 1,
        edges: 0,
        languages: { typescript: 1 },
        warnings: 0,
        indexing: null,
      },
      requestedAt: "2026-01-01T00:00:00.000Z",
      readyAt: "2026-01-01T00:00:01.000Z",
      failure: null,
    },
    files: [
      {
        id: fileId,
        path: "src/index.ts",
        language: "typescript",
        byteSize: 20,
        lineCount: 1,
        blobHash: contentHash,
        content: "export function run() {}",
        parseStatus: "parsed",
      },
    ],
    symbols: [
      {
        id: symbolId,
        fileId,
        path: "src/index.ts",
        stableKey: "function:src/index.ts:run",
        kind: "function",
        name: "run",
        qualifiedName: "run",
        signature: "run()",
        startLine: 1,
        endLine: 1,
        contentHash,
      },
    ],
    edges: [],
  };
}

function createStore(): PullRequestAnalysisStore {
  return {
    attachPullRequestSnapshots: vi.fn(async () => undefined),
    cancelPullRequestAnalysis: vi.fn(async () => undefined),
    claimPullRequestAnalysisJob: vi.fn(async () => null),
    completePullRequestAnalysis: vi.fn(async () => undefined),
    deferPullRequestAnalysis: vi.fn(async () => undefined),
    ensureSnapshotForCommit: vi.fn(async (input) => ({
      snapshotId:
        input.commitSha === job.baseSha
          ? "01900000-0000-7000-8000-000000000111"
          : "01900000-0000-7000-8000-000000000112",
      jobId: null,
      status: "ready" as const,
    })),
    failPullRequestAnalysis: vi.fn(async () => undefined),
    getSnapshotGraphData: vi.fn(async (snapshotId) =>
      snapshotId.endsWith("111")
        ? graph(snapshotId, job.baseSha, "sha256:old")
        : graph(snapshotId, job.headSha, "sha256:new"),
    ),
    heartbeatJob: vi.fn(async () => true),
    isCancellationRequested: vi.fn(async () => false),
    updatePullRequestAnalysisProgress: vi.fn(async () => undefined),
  };
}

describe("executePullRequestAnalysisJob", () => {
  it("defers without consuming an attempt while snapshots are being indexed", async () => {
    const store = createStore();
    vi.mocked(store.ensureSnapshotForCommit).mockResolvedValue({
      snapshotId: "01900000-0000-7000-8000-000000000111",
      jobId: "01900000-0000-7000-8000-000000000113",
      status: "queued",
    });
    await expect(executePullRequestAnalysisJob(store, job, config)).resolves.toBe("deferred");
    expect(store.attachPullRequestSnapshots).toHaveBeenCalled();
    expect(store.deferPullRequestAnalysis).toHaveBeenCalledWith(
      job.id,
      job.analysisId,
      config.WORKER_ID,
      expect.stringContaining("Waiting for base"),
    );
    expect(store.completePullRequestAnalysis).not.toHaveBeenCalled();
  });

  it("computes and persists a fixed two-snapshot impact result", async () => {
    const store = createStore();
    await expect(executePullRequestAnalysisJob(store, job, config)).resolves.toBe("succeeded");
    expect(store.completePullRequestAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: job.analysisId,
        baseSnapshotId: "01900000-0000-7000-8000-000000000111",
        headSnapshotId: "01900000-0000-7000-8000-000000000112",
        computation: expect.objectContaining({
          stats: expect.objectContaining({ changedFiles: 1, changedSymbols: 1 }),
        }),
      }),
    );
    expect(store.failPullRequestAnalysis).not.toHaveBeenCalled();
  });

  it("fails a private analysis when its installation was disconnected", async () => {
    const store = createStore();
    await expect(
      executePullRequestAnalysisJob(
        store,
        { ...job, visibility: "private", githubInstallationId: null },
        config,
      ),
    ).resolves.toBe("failed");
    expect(store.failPullRequestAnalysis).toHaveBeenCalledWith(
      job.id,
      job.analysisId,
      config.WORKER_ID,
      "GITHUB_INSTALLATION_NOT_FOUND",
      expect.any(String),
      false,
    );
    expect(store.ensureSnapshotForCommit).not.toHaveBeenCalled();
  });

  it("rejects a snapshot whose fixed commit does not match the PR", async () => {
    const store = createStore();
    vi.mocked(store.getSnapshotGraphData).mockResolvedValue(
      graph(
        "01900000-0000-7000-8000-000000000111",
        "3333333333333333333333333333333333333333",
        "sha256:bad",
      ),
    );
    await expect(executePullRequestAnalysisJob(store, job, config)).resolves.toBe("failed");
    expect(store.failPullRequestAnalysis).toHaveBeenCalledWith(
      job.id,
      job.analysisId,
      config.WORKER_ID,
      "PR_SNAPSHOT_INVARIANT_FAILED",
      expect.any(String),
      false,
    );
  });

  it("honors cancellation before computing or persisting a result", async () => {
    const store = createStore();
    vi.mocked(store.isCancellationRequested)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(executePullRequestAnalysisJob(store, job, config)).resolves.toBe("cancelled");
    expect(store.cancelPullRequestAnalysis).toHaveBeenCalledWith(
      job.id,
      job.analysisId,
      config.WORKER_ID,
    );
    expect(store.getSnapshotGraphData).not.toHaveBeenCalled();
    expect(store.completePullRequestAnalysis).not.toHaveBeenCalled();
  });
});
