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
      },
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
});
