import { DomainError, type ParsedFile, type ScannedFile } from "@repovista/domain";
import { describe, expect, it, vi } from "vitest";
import {
  executeIndexJob,
  type IndexerConfig,
  type IndexerDependencies,
  type IndexerStore,
} from "./indexer.js";

const job = {
  id: "01900000-0000-7000-8000-000000000001",
  repositoryId: "01900000-0000-7000-8000-000000000002",
  snapshotId: "01900000-0000-7000-8000-000000000003",
  workspaceId: "00000000-0000-7000-8000-000000000002",
  canonicalUrl: "https://github.com/acme/demo",
  cloneUrl: "https://github.com/acme/demo.git",
  owner: "acme",
  name: "demo",
  requestedRef: null,
  ignore: [],
  attemptCount: 1,
  maxAttempts: 3,
};

const config: IndexerConfig = {
  JOB_LEASE_SECONDS: 30,
  JOB_TIMEOUT_SECONDS: 60,
  REPOSITORY_MAX_BYTES: 1_000_000,
  REPOSITORY_MAX_FILES: 1_000,
  SOURCE_FILE_MAX_BYTES: 100_000,
  WORKER_ID: "test-worker",
};

const sourceFile: ScannedFile = {
  path: "src/index.ts",
  absolutePath: "/tmp/repovista-test/repository/src/index.ts",
  language: "typescript",
  byteSize: 33,
  lineCount: 1,
  content: "export function hello() { return 1; }",
  contentHash: "sha256:test",
  isGenerated: false,
};

const parsedFile: ParsedFile = {
  path: sourceFile.path,
  moduleStableKey: `module:${sourceFile.path}`,
  imports: [],
  edges: [],
  symbols: [
    {
      stableKey: `module:${sourceFile.path}`,
      kind: "module",
      name: "index.ts",
      qualifiedName: sourceFile.path,
      signature: null,
      startLine: 1,
      startColumn: 0,
      endLine: 1,
      endColumn: 0,
      docText: null,
      contentHash: sourceFile.contentHash,
    },
  ],
};

function createStore(cancelled = false): IndexerStore {
  return {
    cancelJob: vi.fn(async () => undefined),
    claimIndexJob: vi.fn(async () => null),
    completeIndexJob: vi.fn(async () => undefined),
    failJob: vi.fn(async () => undefined),
    heartbeatJob: vi.fn(async () => true),
    isCancellationRequested: vi.fn(async () => cancelled),
    updateJobProgress: vi.fn(async () => undefined),
  };
}

function createDependencies(overrides: Partial<IndexerDependencies> = {}): IndexerDependencies {
  return {
    createWorkspace: vi.fn(async () => "/tmp/repovista-test"),
    cloneRepository: vi.fn(async () => ({
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      branch: "main",
    })),
    scanWorkspace: vi.fn(async () => [sourceFile]),
    parseRepository: vi.fn(() => [parsedFile]),
    linkParsedImports: vi.fn((_files, parsedFiles) => [...parsedFiles]),
    removeWorkspace: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("executeIndexJob", () => {
  it("indexes and persists a repository snapshot", async () => {
    const store = createStore();
    const dependencies = createDependencies();

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("succeeded");

    expect(store.completeIndexJob).toHaveBeenCalledWith(
      job.id,
      job.snapshotId,
      job.repositoryId,
      config.WORKER_ID,
      expect.objectContaining({
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        branch: "main",
        stats: {
          files: 1,
          symbols: 1,
          edges: 0,
          languages: { typescript: 1 },
          warnings: 0,
        },
      }),
    );
    expect(store.failJob).not.toHaveBeenCalled();
    expect(dependencies.removeWorkspace).toHaveBeenCalledWith("/tmp/repovista-test");
  });

  it("cancels before cloning when cancellation was requested", async () => {
    const store = createStore(true);
    const dependencies = createDependencies();

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("cancelled");

    expect(store.cancelJob).toHaveBeenCalledWith(job.id, job.snapshotId);
    expect(dependencies.cloneRepository).not.toHaveBeenCalled();
    expect(store.completeIndexJob).not.toHaveBeenCalled();
  });

  it("records retryable domain failures and cleans the workspace", async () => {
    const store = createStore();
    const dependencies = createDependencies({
      cloneRepository: vi.fn(async () => {
        throw new DomainError("REPOSITORY_CLONE_FAILED", "Clone failed.", { retryable: true });
      }),
    });

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("failed");

    expect(store.failJob).toHaveBeenCalledWith(
      job.id,
      job.snapshotId,
      "REPOSITORY_CLONE_FAILED",
      "Clone failed.",
      true,
    );
    expect(dependencies.removeWorkspace).toHaveBeenCalledWith("/tmp/repovista-test");
  });
});
