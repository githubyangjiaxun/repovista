import { createHash, randomUUID } from "node:crypto";
import type { IndexedRepository } from "@repovista/domain";
import { PUBLIC_WORKSPACE_ID } from "@repovista/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";
import { RepoVistaStore } from "./store.js";

const databaseUrl = process.env.DATABASE_TEST_URL;
const integration = describe.runIf(databaseUrl !== undefined);

integration("RepoVistaStore with PostgreSQL", () => {
  let pool: DatabasePool;
  let store: RepoVistaStore;
  const repositoryIds = new Set<string>();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required.");
    pool = createDatabasePool(databaseUrl, 4);
    await migrateDatabase(pool);
    store = new RepoVistaStore(pool);
  }, 30_000);

  afterAll(async () => {
    if (repositoryIds.size > 0) {
      await pool.query("DELETE FROM repositories WHERE id = ANY($1::uuid[])", [[...repositoryIds]]);
      await pool.query(
        "DELETE FROM content_blobs b WHERE NOT EXISTS (" +
          "SELECT 1 FROM snapshot_files f WHERE f.blob_hash = b.hash" +
          ")",
      );
    }
    await pool?.end();
  });

  it("persists a complete snapshot and serves graph, source, search, answers, and shares", async () => {
    const suffix = randomUUID();
    const imported = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-test/${suffix}.git`,
      },
      ignore: [],
      parserVersion: "integration-test-v1",
    });
    repositoryIds.add(imported.repositoryId);
    const job = await store.claimIndexJob("integration-worker", 30);
    expect(job).toMatchObject({ id: imported.jobId, snapshotId: imported.snapshotId });
    if (!job) throw new Error("Expected a claimed job.");

    const content = [
      'const moduleEntryMarker = "module-entry-marker";',
      "export function hello(name: string) {",
      '  return "Hello " + name;',
      "}",
    ].join("\n");
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const moduleKey = "module:src/index.ts";
    const functionKey = "function:src/index.ts:hello:test";
    const indexed: IndexedRepository = {
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      branch: "main",
      files: [
        {
          path: "src/index.ts",
          absolutePath: "/tmp/repovista-integration/src/index.ts",
          language: "typescript",
          byteSize: Buffer.byteLength(content),
          lineCount: 4,
          content,
          contentHash,
          isGenerated: false,
        },
      ],
      parsedFiles: [
        {
          path: "src/index.ts",
          moduleStableKey: moduleKey,
          imports: [],
          symbols: [
            {
              stableKey: moduleKey,
              kind: "module",
              name: "index.ts",
              qualifiedName: "src/index.ts",
              signature: null,
              startLine: 1,
              startColumn: 0,
              endLine: 4,
              endColumn: 0,
              docText: null,
              contentHash,
            },
            {
              stableKey: functionKey,
              kind: "function",
              name: "hello",
              qualifiedName: "hello",
              signature: "hello(name: string)",
              startLine: 2,
              startColumn: 0,
              endLine: 4,
              endColumn: 1,
              docText: null,
              contentHash,
            },
          ],
          edges: [
            {
              fromStableKey: moduleKey,
              targetStableKey: functionKey,
              type: "contains",
              confidence: 1,
              evidence: {
                path: "src/index.ts",
                startLine: 2,
                endLine: 4,
                syntaxType: "function_declaration",
              },
            },
          ],
        },
      ],
      stats: {
        files: 1,
        symbols: 2,
        edges: 1,
        languages: { typescript: 1 },
        warnings: 0,
        indexing: null,
      },
      baseSnapshotId: null,
      indexMode: "full",
      treeHash: "sha256:integration-tree",
    };

    await store.completeIndexJob(
      job.id,
      job.snapshotId,
      job.repositoryId,
      "integration-worker",
      indexed,
    );

    const [snapshot, completedJob, graph, source, boundedSource, filePage, evidence, fileEvidence] =
      await Promise.all([
        store.getSnapshot(job.snapshotId),
        store.getJob(job.id),
        store.getSnapshotGraphData(job.snapshotId),
        store.getSourceFile(job.snapshotId, "src/index.ts"),
        store.getSourceFile(job.snapshotId, "src/index.ts", 999, 1_000),
        store.listSnapshotFiles(job.snapshotId),
        store.searchEvidence(job.snapshotId, "hello", 10),
        store.searchEvidence(job.snapshotId, "module-entry-marker", 10),
      ]);
    expect(snapshot).toMatchObject({ status: "ready", commitSha: indexed.commitSha });
    expect(snapshot).toMatchObject({
      baseSnapshotId: null,
      indexMode: "full",
      treeHash: "sha256:integration-tree",
    });
    expect(completedJob).toMatchObject({ status: "succeeded", progress: 1 });
    expect(graph?.symbols).toHaveLength(2);
    expect(graph?.edges).toHaveLength(1);
    expect(source?.content).toBe(content);
    expect(source?.startLine).toBe(1);
    expect(boundedSource).toMatchObject({ startLine: 4, content: "}" });
    expect(filePage.files).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ path: "src/index.ts", symbol: "hello" });
    expect(fileEvidence[0]).toMatchObject({ path: "src/index.ts", symbol: null, startLine: 1 });

    const firstEvidence = evidence[0];
    if (!firstEvidence) throw new Error("Expected searchable evidence.");
    const answer = {
      summary: "hello returns a greeting.",
      steps: [{ text: "It formats the supplied name.", evidenceIds: [firstEvidence.id] }],
      limitations: [],
      status: "grounded" as const,
      citations: [
        {
          evidenceId: firstEvidence.id,
          path: firstEvidence.path,
          symbol: firstEvidence.symbol,
          startLine: firstEvidence.startLine,
          endLine: firstEvidence.endLine,
          quote: firstEvidence.content,
        },
      ],
      provider: "fake",
      model: "integration-test",
    };
    const messageId = await store.saveAnswer({
      workspaceId: PUBLIC_WORKSPACE_ID,
      repositoryId: job.repositoryId,
      snapshotId: job.snapshotId,
      question: "What does hello do?",
      answer,
      evidence,
      latencyMs: 1,
    });
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/);

    const share = await store.createShareReport(
      job.repositoryId,
      job.snapshotId,
      "Integration report",
      { overview: answer.summary, readingPath: [], map: { nodes: [], edges: [] } },
    );
    const loadedShare = await store.getShareReport(share.slug);
    expect(loadedShare).toMatchObject({
      title: "Integration report",
      snapshot: { id: job.snapshotId },
    });

    const secondShare = await store.createShareReport(
      job.repositoryId,
      job.snapshotId,
      "Integration report 2",
      { overview: answer.summary, readingPath: [], map: { nodes: [], edges: [] } },
    );
    expect(secondShare.slug).not.toBe(share.slug);
    expect(await store.getShareReport(secondShare.slug)).toMatchObject({
      title: "Integration report 2",
      snapshot: { id: job.snapshotId },
    });

    const base = await store.getIncrementalIndexBase(
      imported.repositoryId,
      "integration-test-v1",
      randomUUID(),
    );
    expect(base).toMatchObject({
      snapshotId: imported.snapshotId,
      commitSha: indexed.commitSha,
      files: [
        {
          path: "src/index.ts",
          contentHash,
          language: "typescript",
          parseStatus: "parsed",
        },
      ],
      parsedFiles: [
        expect.objectContaining({
          path: "src/index.ts",
          moduleStableKey: moduleKey,
          imports: [],
        }),
      ],
    });
    expect(base?.parsedFiles[0]?.symbols).toHaveLength(2);
    expect(base?.parsedFiles[0]?.edges).toHaveLength(1);

    const incrementalImport = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-test/${suffix}.git`,
      },
      requestedRef: "next",
      ignore: [],
      parserVersion: "integration-test-v1",
    });
    const incrementalJob = await store.claimIndexJob("integration-worker", 30);
    expect(incrementalJob).toMatchObject({ id: incrementalImport.jobId });
    if (!incrementalJob) throw new Error("Expected an incremental job.");
    const incrementalIndexed: IndexedRepository = {
      ...indexed,
      commitSha: "1123456789abcdef0123456789abcdef01234567",
      baseSnapshotId: imported.snapshotId,
      indexMode: "incremental",
      treeHash: "sha256:integration-tree-next",
      stats: {
        ...indexed.stats,
        indexing: {
          mode: "incremental",
          baseSnapshotId: imported.snapshotId,
          baseCommitSha: indexed.commitSha,
          scannedFiles: 1,
          changedFiles: 0,
          reusedFiles: 1,
          parsedFiles: 0,
          deletedFiles: 0,
        },
      },
    };
    await store.completeIndexJob(
      incrementalJob.id,
      incrementalJob.snapshotId,
      incrementalJob.repositoryId,
      "integration-worker",
      incrementalIndexed,
    );
    const [incrementalSnapshot, incrementalGraph, updatedRepository] = await Promise.all([
      store.getSnapshot(incrementalJob.snapshotId),
      store.getSnapshotGraphData(incrementalJob.snapshotId),
      store.getRepository(imported.repositoryId),
    ]);
    expect(incrementalSnapshot).toMatchObject({
      status: "ready",
      indexMode: "incremental",
      baseSnapshotId: imported.snapshotId,
      treeHash: "sha256:integration-tree-next",
      stats: { indexing: { reusedFiles: 1, parsedFiles: 0 } },
    });
    expect(incrementalGraph?.files).toHaveLength(1);
    expect(incrementalGraph?.symbols).toHaveLength(2);
    expect(updatedRepository?.latestSnapshotId).toBe(incrementalJob.snapshotId);
  });

  it("allows only the lease owner to fail a job and preserves retryability", async () => {
    const suffix = randomUUID();
    const imported = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-test/${suffix}.git`,
      },
      ignore: [],
      parserVersion: "integration-test-v1",
    });
    repositoryIds.add(imported.repositoryId);
    const job = await store.claimIndexJob("lease-owner", 30);
    expect(job?.id).toBe(imported.jobId);
    if (!job) throw new Error("Expected a claimed job.");

    await expect(
      store.failJob(
        job.id,
        job.snapshotId,
        "different-worker",
        "REPOSITORY_CLONE_FAILED",
        "Clone failed.",
        true,
      ),
    ).rejects.toMatchObject({ code: "JOB_LEASE_LOST" });
    expect(await store.getJob(job.id)).toMatchObject({ status: "running", retryable: false });

    await store.failJob(
      job.id,
      job.snapshotId,
      "lease-owner",
      "REPOSITORY_CLONE_FAILED",
      "Clone failed.",
      true,
    );
    expect(await store.getJob(job.id)).toMatchObject({
      status: "queued",
      retryable: true,
      error: { code: "REPOSITORY_CLONE_FAILED" },
    });
  });

  it("enqueues GitHub pushes idempotently and records automation metadata", async () => {
    const suffix = randomUUID();
    const input = {
      deliveryId: `delivery-${suffix}`,
      eventName: "push",
      payloadSha256: `sha256:${"a".repeat(64)}`,
      push: {
        owner: "repovista-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-test/${suffix}.git`,
        providerRepoId: "123456",
        defaultBranch: "main",
        after: "2123456789abcdef0123456789abcdef01234567",
        ref: "refs/heads/main",
        deleted: false,
        isPrivate: false,
        installationId: 789,
      },
    };

    const concurrent = await Promise.all([
      store.processGitHubWebhook(input, "integration-test-v2"),
      store.processGitHubWebhook(input, "integration-test-v2"),
    ]);
    const created = concurrent.find((result) => result.status === "enqueued");
    const concurrentDuplicate = concurrent.find((result) => result.status === "duplicate");
    expect(created).toMatchObject({ status: "enqueued", duplicate: false, reason: null });
    expect(concurrentDuplicate).toMatchObject({
      status: "duplicate",
      duplicate: true,
      repositoryId: created?.repositoryId,
      snapshotId: created?.snapshotId,
      jobId: created?.jobId,
    });
    if (!created) throw new Error("Expected one concurrent delivery to enqueue resources.");
    if (!created.repositoryId || !created.snapshotId || !created.jobId) {
      throw new Error("Expected webhook resources.");
    }
    repositoryIds.add(created.repositoryId);
    const replayed = await store.processGitHubWebhook(input, "integration-test-v2");
    expect(replayed).toEqual({ ...created, status: "duplicate", duplicate: true });
    await expect(
      store.processGitHubWebhook(
        { ...input, payloadSha256: `sha256:${"b".repeat(64)}` },
        "integration-test-v2",
      ),
    ).rejects.toMatchObject({ code: "GITHUB_WEBHOOK_DELIVERY_CONFLICT" });

    const [repository, snapshot, job] = await Promise.all([
      store.getRepository(created.repositoryId),
      store.getSnapshot(created.snapshotId),
      store.getJob(created.jobId),
    ]);
    expect(repository).toMatchObject({
      autoUpdateEnabled: true,
      defaultBranch: "main",
    });
    expect(repository?.lastWebhookAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot).toMatchObject({
      commitSha: null,
      refName: input.push.defaultBranch,
      status: "requested",
      parserVersion: "integration-test-v2",
    });
    expect(job).toMatchObject({ status: "queued", snapshotId: created.snapshotId });
    await pool.query("UPDATE analysis_jobs SET priority = -100 WHERE id = $1", [created.jobId]);
    const claimed = await store.claimIndexJob("github-integration-worker", 30);
    expect(claimed).toMatchObject({
      id: created.jobId,
      requestedRef: input.push.after,
    });
    if (!claimed) throw new Error("Expected the GitHub webhook job to be claimed.");
    await store.completeIndexJob(
      claimed.id,
      claimed.snapshotId,
      claimed.repositoryId,
      "github-integration-worker",
      {
        commitSha: input.push.after,
        branch: null,
        baseSnapshotId: null,
        indexMode: "full",
        treeHash: `sha256:${"e".repeat(64)}`,
        files: [],
        parsedFiles: [],
        stats: {
          files: 0,
          symbols: 0,
          edges: 0,
          languages: {},
          warnings: 0,
          indexing: {
            mode: "full",
            baseSnapshotId: null,
            baseCommitSha: null,
            scannedFiles: 0,
            changedFiles: 0,
            reusedFiles: 0,
            parsedFiles: 0,
            deletedFiles: 0,
          },
        },
      },
    );
    expect(await store.getSnapshot(created.snapshotId)).toMatchObject({
      commitSha: input.push.after,
      refName: input.push.defaultBranch,
      status: "ready",
    });

    const ignored = await store.processGitHubWebhook(
      {
        ...input,
        deliveryId: `ignored-${suffix}`,
        payloadSha256: `sha256:${"c".repeat(64)}`,
        push: { ...input.push, ref: "refs/heads/feature" },
      },
      "integration-test-v2",
    );
    expect(ignored).toMatchObject({
      status: "ignored",
      duplicate: false,
      reason: "non_default_branch",
      repositoryId: null,
    });

    const unknown = await store.processGitHubWebhook(
      {
        deliveryId: `unknown-${suffix}`,
        eventName: "issues",
        payloadSha256: `sha256:${"d".repeat(64)}`,
        push: null,
      },
      "integration-test-v2",
    );
    expect(unknown).toMatchObject({
      status: "ignored",
      duplicate: false,
      reason: "event_not_supported",
      repositoryId: null,
    });
  });
});
