import { DomainError, type ParsedFile, type ScannedFile } from "@repovista/domain";
import { describe, expect, it, vi } from "vitest";
import {
  executeIndexJob,
  type IndexerConfig,
  type IndexerDependencies,
  type IndexerStore,
  planIncrementalIndex,
  treeHash,
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
    getIncrementalIndexBase: vi.fn(async () => null),
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
        baseSnapshotId: null,
        indexMode: "full",
        treeHash: expect.stringMatching(/^sha256:/),
        stats: {
          files: 1,
          symbols: 1,
          edges: 0,
          languages: { typescript: 1 },
          warnings: 0,
          indexing: {
            mode: "full",
            baseSnapshotId: null,
            baseCommitSha: null,
            scannedFiles: 1,
            changedFiles: 1,
            reusedFiles: 0,
            parsedFiles: 1,
            deletedFiles: 0,
          },
        },
      }),
    );
    expect(store.failJob).not.toHaveBeenCalled();
    expect(dependencies.removeWorkspace).toHaveBeenCalledWith("/tmp/repovista-test");
  });

  it("reuses compatible parsed files and parses only changed files", async () => {
    const unchanged = { ...sourceFile };
    const changed = {
      ...sourceFile,
      path: "src/changed.ts",
      contentHash: "sha256:changed",
    };
    const changedParsed: ParsedFile = {
      ...parsedFile,
      path: changed.path,
      moduleStableKey: `module:${changed.path}`,
      symbols: [
        {
          stableKey: `module:${changed.path}`,
          kind: "module",
          name: "changed.ts",
          qualifiedName: changed.path,
          signature: null,
          startLine: 1,
          startColumn: 0,
          endLine: 1,
          endColumn: 0,
          docText: null,
          contentHash: changed.contentHash,
        },
      ],
    };
    const store = createStore();
    vi.mocked(store.getIncrementalIndexBase).mockResolvedValue({
      snapshotId: "01900000-0000-7000-8000-000000000010",
      commitSha: "1111111111111111111111111111111111111111",
      parserVersion: "tree-sitter-ts-v1",
      files: [
        {
          path: unchanged.path,
          contentHash: unchanged.contentHash,
          language: unchanged.language,
          parseStatus: "parsed",
        },
        {
          path: changed.path,
          contentHash: "sha256:old",
          language: changed.language,
          parseStatus: "parsed",
        },
      ],
      parsedFiles: [parsedFile],
    });
    const dependencies = createDependencies({
      scanWorkspace: vi.fn(async () => [unchanged, changed]),
      parseRepository: vi.fn(() => [changedParsed]),
    });

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("succeeded");

    expect(dependencies.parseRepository).toHaveBeenCalledTimes(1);
    expect(dependencies.parseRepository).toHaveBeenCalledWith([changed]);
    expect(dependencies.linkParsedImports).toHaveBeenCalledWith(
      [unchanged, changed],
      [parsedFile, changedParsed],
    );
    expect(store.completeIndexJob).toHaveBeenCalledWith(
      job.id,
      job.snapshotId,
      job.repositoryId,
      config.WORKER_ID,
      expect.objectContaining({
        indexMode: "incremental",
        baseSnapshotId: "01900000-0000-7000-8000-000000000010",
        stats: expect.objectContaining({
          indexing: expect.objectContaining({
            changedFiles: 1,
            reusedFiles: 1,
            parsedFiles: 1,
          }),
        }),
      }),
    );
  });

  it("cancels before cloning when cancellation was requested", async () => {
    const store = createStore(true);
    const dependencies = createDependencies();

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("cancelled");

    expect(store.cancelJob).toHaveBeenCalledWith(job.id, job.snapshotId, config.WORKER_ID);
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
      config.WORKER_ID,
      "REPOSITORY_CLONE_FAILED",
      "Clone failed.",
      true,
    );
    expect(dependencies.removeWorkspace).toHaveBeenCalledWith("/tmp/repovista-test");
  });

  it("does not overwrite a job after failure handling loses the lease", async () => {
    const store = createStore();
    vi.mocked(store.failJob).mockRejectedValue(
      new DomainError("JOB_LEASE_LOST", "Another worker owns this job.", { retryable: true }),
    );
    const dependencies = createDependencies({
      cloneRepository: vi.fn(async () => {
        throw new DomainError("REPOSITORY_CLONE_FAILED", "Clone failed.", { retryable: true });
      }),
    });

    await expect(executeIndexJob(store, job, config, dependencies)).resolves.toBe("lease-lost");
    expect(store.completeIndexJob).not.toHaveBeenCalled();
    expect(dependencies.removeWorkspace).toHaveBeenCalledWith("/tmp/repovista-test");
  });
});

describe("planIncrementalIndex", () => {
  it("creates a full plan with a deterministic tree hash", () => {
    const plan = planIncrementalIndex([sourceFile], null);

    expect(plan).toMatchObject({
      mode: "full",
      baseSnapshotId: null,
      changedFiles: 1,
      deletedFiles: 0,
      filesToParse: [sourceFile],
      reusedParsedFiles: [],
    });
    expect(plan.treeHash).toBe(treeHash([sourceFile]));
    expect(treeHash([sourceFile])).toBe(treeHash([sourceFile]));
  });

  it("reuses unchanged parsed files and reparses additions and changes", () => {
    const changed = { ...sourceFile, path: "src/changed.ts", contentHash: "sha256:new" };
    const added = { ...sourceFile, path: "src/added.ts", contentHash: "sha256:added" };
    const unsupported = {
      ...sourceFile,
      path: "README.md",
      language: "markdown",
      contentHash: "sha256:readme",
    };
    const plan = planIncrementalIndex([sourceFile, changed, added, unsupported], {
      snapshotId: "01900000-0000-7000-8000-000000000010",
      commitSha: "1111111111111111111111111111111111111111",
      parserVersion: "tree-sitter-ts-v1",
      files: [
        {
          path: sourceFile.path,
          contentHash: sourceFile.contentHash,
          language: sourceFile.language,
          parseStatus: "parsed",
        },
        {
          path: changed.path,
          contentHash: "sha256:old",
          language: changed.language,
          parseStatus: "parsed",
        },
        {
          path: "src/deleted.ts",
          contentHash: "sha256:deleted",
          language: "typescript",
          parseStatus: "parsed",
        },
      ],
      parsedFiles: [parsedFile],
    });

    expect(plan).toMatchObject({
      mode: "incremental",
      baseSnapshotId: "01900000-0000-7000-8000-000000000010",
      baseCommitSha: "1111111111111111111111111111111111111111",
      changedFiles: 3,
      deletedFiles: 1,
    });
    expect(plan.reusedParsedFiles).toEqual([parsedFile]);
    expect(plan.filesToParse.map((file) => file.path)).toEqual(["src/changed.ts", "src/added.ts"]);
  });

  it("does not reuse a file when language or parse status changed", () => {
    const plan = planIncrementalIndex([sourceFile], {
      snapshotId: "01900000-0000-7000-8000-000000000011",
      commitSha: "2222222222222222222222222222222222222222",
      parserVersion: "tree-sitter-ts-v1",
      files: [
        {
          path: sourceFile.path,
          contentHash: sourceFile.contentHash,
          language: "javascript",
          parseStatus: "failed",
        },
      ],
      parsedFiles: [parsedFile],
    });

    expect(plan.changedFiles).toBe(1);
    expect(plan.reusedParsedFiles).toEqual([]);
    expect(plan.filesToParse).toEqual([sourceFile]);
  });

  it("retries an unchanged parseable file when the baseline parse failed", () => {
    const plan = planIncrementalIndex([sourceFile], {
      snapshotId: "01900000-0000-7000-8000-000000000012",
      commitSha: "3333333333333333333333333333333333333333",
      parserVersion: "tree-sitter-ts-js-v2",
      files: [
        {
          path: sourceFile.path,
          contentHash: sourceFile.contentHash,
          language: sourceFile.language,
          parseStatus: "failed",
        },
      ],
      parsedFiles: [],
    });

    expect(plan.changedFiles).toBe(0);
    expect(plan.reusedParsedFiles).toEqual([]);
    expect(plan.filesToParse).toEqual([sourceFile]);
  });
});
