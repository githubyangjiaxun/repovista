import { createHash, randomUUID } from "node:crypto";
import type { IndexedRepository } from "@repovista/domain";
import { PUBLIC_WORKSPACE_ID } from "@repovista/domain";
import { computePullRequestImpact } from "@repovista/impact";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate.js";
import { createDatabasePool, type DatabasePool, withTransaction } from "./pool.js";
import { RepoVistaStore } from "./store.js";
import type { CreatePullRequestAnalysisInput } from "./types.js";

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
    const functionSymbolId = graph?.symbols.find((symbol) => symbol.stableKey === functionKey)?.id;
    if (!functionSymbolId) throw new Error("Expected the indexed function symbol.");
    const symbolEvidence = await store.getSnapshotSymbolEvidence(job.snapshotId, functionSymbolId);
    expect(symbolEvidence).toMatchObject({
      id: functionSymbolId,
      snapshotId: job.snapshotId,
      commitSha: indexed.commitSha,
      path: "src/index.ts",
      name: "hello",
      startLine: 2,
      endLine: 4,
    });
    expect(symbolEvidence?.content).toContain("export function hello");

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
      {
        version: 2,
        algorithmVersion: "architecture-story-v2",
        headline: "Integration story",
        overview: answer.summary,
        metrics: {
          files: 1,
          symbols: 2,
          edges: 1,
          languages: [{ name: "typescript", files: 1 }],
        },
        map: { nodes: [], edges: [], truncated: false },
        keyModules: [],
        readingPath: [],
        evidenceHighlights: [],
        provenance: {
          snapshotId: job.snapshotId,
          commitSha: indexed.commitSha,
          parserVersion: "integration-test-v1",
          generatedAt: snapshot?.readyAt ?? "2026-01-01T00:00:00.000Z",
          generatedAtSource: "snapshot_ready_at",
          retrievalProfile: null,
        },
      },
    );
    expect(secondShare.slug).not.toBe(share.slug);
    expect(await store.getShareReport(secondShare.slug)).toMatchObject({
      title: "Integration report 2",
      snapshot: { id: job.snapshotId },
      content: { version: 2, provenance: { snapshotId: job.snapshotId } },
    });
    const shareShape = await pool.query<{ content_version: number; report_type: string }>(
      "SELECT report_type, content_version FROM share_reports WHERE slug = $1",
      [secondShare.slug],
    );
    expect(shareShape.rows[0]).toEqual({
      report_type: "architecture_story",
      content_version: 2,
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

  it("reports the canonical edge count after unresolved calls resolve to one target", async () => {
    const suffix = randomUUID();
    const imported = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-edge-count-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-edge-count-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-edge-count-test/${suffix}.git`,
      },
      ignore: [],
      parserVersion: "integration-edge-count-v1",
    });
    repositoryIds.add(imported.repositoryId);
    const job = await store.claimIndexJob("edge-count-worker", 30);
    if (!job) throw new Error("Expected an edge-count index job.");
    const content = [
      "export function target() { return 1; }",
      "export function caller() { return target(); }",
    ].join("\n");
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const moduleKey = "module:src/index.ts";
    const targetKey = "function:src/index.ts:target:edge-count";
    const callerKey = "function:src/index.ts:caller:edge-count";
    const symbol = (
      stableKey: string,
      name: string,
      startLine: number,
    ): IndexedRepository["parsedFiles"][number]["symbols"][number] => ({
      stableKey,
      kind: name === "index.ts" ? "module" : "function",
      name,
      qualifiedName: name === "index.ts" ? "src/index.ts" : name,
      signature: name === "index.ts" ? null : `${name}()`,
      startLine,
      startColumn: 0,
      endLine: startLine,
      endColumn: 1,
      docText: null,
      contentHash,
    });
    await store.completeIndexJob(job.id, job.snapshotId, job.repositoryId, "edge-count-worker", {
      commitSha: "abcdef0123456789abcdef0123456789abcdef01",
      branch: "main",
      baseSnapshotId: null,
      indexMode: "full",
      treeHash: "sha256:edge-count-tree",
      files: [
        {
          path: "src/index.ts",
          absolutePath: `/tmp/${suffix}/src/index.ts`,
          language: "typescript",
          byteSize: Buffer.byteLength(content),
          lineCount: 2,
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
            symbol(moduleKey, "index.ts", 1),
            symbol(targetKey, "target", 1),
            symbol(callerKey, "caller", 2),
          ],
          edges: ["target", "service.target"].map((referenceTarget, index) => ({
            fromStableKey: callerKey,
            unresolvedTarget: referenceTarget,
            type: "calls" as const,
            confidence: 0.7,
            evidence: {
              path: "src/index.ts",
              startLine: 2,
              endLine: 2,
              syntaxType: "call_expression",
              referenceTarget,
              importedNames: [String(index)],
            },
          })),
        },
      ],
      stats: {
        files: 1,
        symbols: 3,
        edges: 2,
        languages: { typescript: 1 },
        warnings: 0,
        indexing: null,
      },
    });

    const [snapshot, graph, events] = await Promise.all([
      store.getSnapshot(job.snapshotId),
      store.getSnapshotGraphData(job.snapshotId),
      store.listJobEvents(job.id),
    ]);
    expect(graph?.edges).toHaveLength(1);
    expect(snapshot?.stats.edges).toBe(1);
    expect(events.at(-1)?.payload).toMatchObject({ stats: { edges: 1 } });
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

    // This test intentionally leaves its job retryable. Remove its isolated fixture now so the
    // global queue cannot feed that job to a later claim-oriented integration test.
    await pool.query("DELETE FROM repositories WHERE id = $1", [imported.repositoryId]);
    repositoryIds.delete(imported.repositoryId);
  });

  it("survives a checked-out transaction connection being terminated", async () => {
    await expect(
      withTransaction(pool, async (client) => {
        const backend = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid()::integer AS pid",
        );
        const pid = backend.rows[0]?.pid;
        if (!pid) throw new Error("Expected a PostgreSQL backend PID.");
        const terminated = await pool.query<{ terminated: boolean }>(
          "SELECT pg_terminate_backend($1)::boolean AS terminated",
          [pid],
        );
        expect(terminated.rows[0]?.terminated).toBe(true);
        await client.query("SELECT 1");
      }),
    ).rejects.toThrow();

    await expect(pool.query("SELECT 1 AS healthy")).resolves.toMatchObject({
      rows: [{ healthy: 1 }],
    });
  });

  it("persists versioned embedding indexes with idempotent profiles, partial recovery, and strict dimensions", async () => {
    const suffix = randomUUID();
    const imported = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-embedding-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-embedding-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-embedding-test/${suffix}.git`,
      },
      ignore: [],
      parserVersion: "embedding-integration-v1",
    });
    repositoryIds.add(imported.repositoryId);
    const indexJob = await store.claimIndexJob("embedding-index-worker", 30);
    if (!indexJob) throw new Error("Expected an embedding fixture index job.");
    const content = [
      "export function semanticGreeting(name: string) {",
      "  return `Hello ` + name;",
      "}",
    ].join("\n");
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const moduleKey = "module:src/semantic.ts";
    const symbolKey = "function:src/semantic.ts:semanticGreeting:embedding";
    await store.completeIndexJob(
      indexJob.id,
      indexJob.snapshotId,
      indexJob.repositoryId,
      "embedding-index-worker",
      {
        commitSha: "456789abcdef0123456789abcdef0123456789ab",
        branch: "main",
        baseSnapshotId: null,
        indexMode: "full",
        treeHash: "sha256:embedding-fixture-tree",
        files: [
          {
            path: "src/semantic.ts",
            absolutePath: `/tmp/${suffix}/src/semantic.ts`,
            language: "typescript",
            byteSize: Buffer.byteLength(content),
            lineCount: 3,
            content,
            contentHash,
            isGenerated: false,
          },
        ],
        parsedFiles: [
          {
            path: "src/semantic.ts",
            moduleStableKey: moduleKey,
            imports: [],
            symbols: [
              {
                stableKey: moduleKey,
                kind: "module",
                name: "semantic.ts",
                qualifiedName: "src/semantic.ts",
                signature: null,
                startLine: 1,
                startColumn: 0,
                endLine: 3,
                endColumn: 0,
                docText: null,
                contentHash,
              },
              {
                stableKey: symbolKey,
                kind: "function",
                name: "semanticGreeting",
                qualifiedName: "semanticGreeting",
                signature: "semanticGreeting(name: string)",
                startLine: 1,
                startColumn: 0,
                endLine: 3,
                endColumn: 1,
                docText: null,
                contentHash,
              },
            ],
            edges: [],
          },
        ],
        stats: {
          files: 1,
          symbols: 2,
          edges: 0,
          languages: { typescript: 1 },
          warnings: 0,
          indexing: null,
        },
      },
    );

    const profileInput = {
      snapshotId: indexJob.snapshotId,
      workspaceId: PUBLIC_WORKSPACE_ID,
      provider: "ollama" as const,
      model: "test-embedding-a",
      inputVersion: "code-chunk-v1",
    };
    const [first, concurrent] = await Promise.all([
      store.createOrRetryEmbeddingIndex(profileInput),
      store.createOrRetryEmbeddingIndex(profileInput),
    ]);
    expect(first.embeddingIndex.id).toBe(concurrent.embeddingIndex.id);
    expect(concurrent.reused || first.reused).toBe(true);
    expect(first.jobId).toBeTruthy();

    const otherProfile = await store.createOrRetryEmbeddingIndex({
      ...profileInput,
      provider: "openai-compatible",
      model: "test-embedding-b",
    });
    expect(otherProfile.embeddingIndex.id).not.toBe(first.embeddingIndex.id);

    const chunks = await store.listEmbeddingBatch(first.embeddingIndex.id, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const embeddingJob = await store.claimEmbeddingJob("embedding-worker-a", 30);
    expect(embeddingJob).toMatchObject({
      id: first.jobId,
      embeddingIndexId: first.embeddingIndex.id,
      snapshotId: indexJob.snapshotId,
    });
    if (!embeddingJob) throw new Error("Expected a claimed embedding job.");
    const firstChunk = chunks[0];
    if (!firstChunk) throw new Error("Expected an embedding chunk.");
    await store.saveEmbeddingBatch({
      jobId: embeddingJob.id,
      embeddingIndexId: embeddingJob.embeddingIndexId,
      snapshotId: embeddingJob.snapshotId,
      workerId: "embedding-worker-a",
      dimensions: 3,
      rows: [
        {
          codeChunkId: firstChunk.id,
          contentHash: firstChunk.contentHash,
          inputHash: "sha256:embedding-input-1",
          embedding: [1, 0, 0],
        },
      ],
      processed: 1,
      total: chunks.length,
      message: "partial batch",
    });
    await expect(
      store.saveEmbeddingBatch({
        jobId: embeddingJob.id,
        embeddingIndexId: embeddingJob.embeddingIndexId,
        snapshotId: embeddingJob.snapshotId,
        workerId: "embedding-worker-a",
        dimensions: 4,
        rows: [],
        processed: 1,
        total: chunks.length,
        message: "mixed dimensions",
      }),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
    await store.failEmbeddingJob(
      embeddingJob.id,
      embeddingJob.embeddingIndexId,
      embeddingJob.snapshotId,
      "embedding-worker-a",
      "EMBEDDING_PROVIDER_UNAVAILABLE",
      "fixture failure",
      false,
    );
    const failed = await store.getEmbeddingIndex(first.embeddingIndex.id);
    expect(failed).toMatchObject({ status: "failed", embeddedChunks: 1, dimensions: 3 });

    const retried = await store.createOrRetryEmbeddingIndex(profileInput);
    expect(retried.embeddingIndex).toMatchObject({
      id: first.embeddingIndex.id,
      status: "queued",
      embeddedChunks: 1,
      revision: 2,
    });
    const retryJob = await store.claimEmbeddingJob("embedding-worker-b", 30);
    expect(retryJob).toMatchObject({ embeddingIndexId: first.embeddingIndex.id });
    if (!retryJob) throw new Error("Expected the retried embedding job.");
    const remaining = chunks.slice(1);
    await store.saveEmbeddingBatch({
      jobId: retryJob.id,
      embeddingIndexId: retryJob.embeddingIndexId,
      snapshotId: retryJob.snapshotId,
      workerId: "embedding-worker-b",
      dimensions: 3,
      rows: remaining.map((chunk) => ({
        codeChunkId: chunk.id,
        contentHash: chunk.contentHash,
        inputHash: `sha256:${chunk.id}`,
        embedding: [0, 1, 0],
      })),
      processed: chunks.length,
      total: chunks.length,
      message: "recovered batch",
    });
    await store.completeEmbeddingJob(
      retryJob.id,
      retryJob.embeddingIndexId,
      retryJob.snapshotId,
      "embedding-worker-b",
    );
    const ready = await store.getEmbeddingIndex(first.embeddingIndex.id);
    expect(ready).toMatchObject({
      status: "ready",
      dimensions: 3,
      totalChunks: chunks.length,
      embeddedChunks: chunks.length,
    });
    await expect(
      store.searchSemanticEvidence({
        snapshotId: indexJob.snapshotId,
        embeddingIndexId: first.embeddingIndex.id,
        queryVector: [1, 0],
        limit: 5,
      }),
    ).rejects.toMatchObject({ code: "EMBEDDING_DIMENSION_MISMATCH" });
    const semantic = await store.searchSemanticEvidence({
      snapshotId: indexJob.snapshotId,
      embeddingIndexId: first.embeddingIndex.id,
      queryVector: [1, 0, 0],
      limit: 5,
    });
    expect(semantic.length).toBeGreaterThan(0);
    expect(semantic[0]?.id).toBe(firstChunk.id);
    expect(semantic.every((item) => item.channel === "semantic")).toBe(true);

    await pool.query("DELETE FROM repositories WHERE id = $1", [imported.repositoryId]);
    const cascaded = await pool.query<{ indexes: string; embeddings: string }>(
      "SELECT " +
        "(SELECT count(*) FROM snapshot_embedding_indexes WHERE snapshot_id = $1)::text AS indexes, " +
        "(SELECT count(*) FROM code_chunk_embeddings WHERE snapshot_id = $1)::text AS embeddings",
      [indexJob.snapshotId],
    );
    expect(cascaded.rows[0]).toEqual({ indexes: "0", embeddings: "0" });
    repositoryIds.delete(imported.repositoryId);
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

  it("persists PR impact evidence transactionally and paginates by a stable cursor", async () => {
    const suffix = randomUUID();
    const parserVersion = "integration-pr-impact-v1";
    const algorithmVersion = "reverse-bfs-risk-v1";
    const imported = await store.createRepositoryImport({
      workspaceId: PUBLIC_WORKSPACE_ID,
      identity: {
        owner: "repovista-pr-test",
        name: suffix,
        canonicalUrl: `https://github.com/repovista-pr-test/${suffix}`,
        cloneUrl: `https://github.com/repovista-pr-test/${suffix}.git`,
      },
      requestedRef: "base",
      ignore: [],
      parserVersion,
    });
    repositoryIds.add(imported.repositoryId);

    const baseContent = [
      "export function changed() {",
      "  return 1;",
      "}",
      "",
      "export function direct() {",
      "  return changed();",
      "}",
    ].join("\n");
    const headContent = [
      "export function changed() {",
      "  return 2;",
      "}",
      "",
      "export function direct() {",
      "  return changed();",
      "}",
    ].join("\n");
    const indexSnapshot = async (requestedRef: string, commitSha: string, content: string) => {
      const created =
        requestedRef === "base"
          ? imported
          : await store.createRepositoryImport({
              workspaceId: PUBLIC_WORKSPACE_ID,
              identity: {
                owner: "repovista-pr-test",
                name: suffix,
                canonicalUrl: `https://github.com/repovista-pr-test/${suffix}`,
                cloneUrl: `https://github.com/repovista-pr-test/${suffix}.git`,
              },
              requestedRef,
              ignore: [],
              parserVersion,
            });
      const job = await store.claimIndexJob("pr-impact-indexer", 30);
      expect(job?.id).toBe(created.jobId);
      if (!job) throw new Error("Expected an index job.");
      const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      const moduleKey = "module:src/index.ts";
      const changedKey = "function:src/index.ts:changed:integration";
      const directKey = "function:src/index.ts:direct:integration";
      await store.completeIndexJob(job.id, job.snapshotId, job.repositoryId, "pr-impact-indexer", {
        commitSha,
        branch: requestedRef,
        baseSnapshotId: null,
        indexMode: "full",
        treeHash: `sha256:${requestedRef}`,
        files: [
          {
            path: "src/index.ts",
            absolutePath: `/tmp/${suffix}/src/index.ts`,
            language: "typescript",
            byteSize: Buffer.byteLength(content),
            lineCount: content.split("\n").length,
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
                endLine: 6,
                endColumn: 0,
                docText: null,
                contentHash: `sha256:module-${requestedRef}`,
              },
              {
                stableKey: changedKey,
                kind: "function",
                name: "changed",
                qualifiedName: "changed",
                signature: "changed()",
                startLine: 1,
                startColumn: 0,
                endLine: 3,
                endColumn: 1,
                docText: null,
                contentHash: `sha256:changed-${requestedRef}`,
              },
              {
                stableKey: directKey,
                kind: "function",
                name: "direct",
                qualifiedName: "direct",
                signature: "direct()",
                startLine: 5,
                startColumn: 0,
                endLine: 7,
                endColumn: 1,
                docText: null,
                contentHash: "sha256:direct-stable",
              },
            ],
            edges: [
              {
                fromStableKey: moduleKey,
                targetStableKey: changedKey,
                type: "contains",
                confidence: 1,
                evidence: {
                  path: "src/index.ts",
                  startLine: 1,
                  endLine: 3,
                  syntaxType: "contains",
                },
              },
              {
                fromStableKey: moduleKey,
                targetStableKey: directKey,
                type: "contains",
                confidence: 1,
                evidence: {
                  path: "src/index.ts",
                  startLine: 5,
                  endLine: 7,
                  syntaxType: "contains",
                },
              },
              {
                fromStableKey: directKey,
                targetStableKey: changedKey,
                type: "calls",
                confidence: 1,
                evidence: {
                  path: "src/index.ts",
                  startLine: 6,
                  endLine: 6,
                  syntaxType: "call",
                },
              },
            ],
          },
        ],
        stats: {
          files: 1,
          symbols: 3,
          edges: 3,
          languages: { typescript: 1 },
          warnings: 0,
          indexing: null,
        },
      });
      return job.snapshotId;
    };

    const baseSnapshot = await indexSnapshot(
      "base",
      "1111111111111111111111111111111111111111",
      baseContent,
    );
    const headSnapshot = await indexSnapshot(
      "head",
      "2222222222222222222222222222222222222222",
      headContent,
    );
    const [baseGraph, headGraph] = await Promise.all([
      store.getSnapshotGraphData(baseSnapshot),
      store.getSnapshotGraphData(headSnapshot),
    ]);
    if (!baseGraph || !headGraph) throw new Error("Expected PR graphs.");
    const analysisInput: CreatePullRequestAnalysisInput = {
      workspaceId: PUBLIC_WORKSPACE_ID,
      repositoryId: imported.repositoryId,
      prNumber: 42,
      title: "Change changed result",
      canonicalUrl: `https://github.com/repovista-pr-test/${suffix}/pull/42`,
      baseSha: baseGraph.snapshot.commitSha ?? "",
      headSha: headGraph.snapshot.commitSha ?? "",
      parserVersion,
      algorithmVersion,
      providerFiles: [
        {
          path: "src/index.ts",
          oldPath: null,
          changeType: "modified",
          baseBlobHash: null,
          headBlobHash: null,
          additions: 1,
          deletions: 1,
          binary: false,
        },
      ],
    };
    const [created, replay] = await Promise.all([
      store.createPullRequestAnalysis(analysisInput),
      store.createPullRequestAnalysis(analysisInput),
    ]);
    expect(replay).toMatchObject({ analysisId: created.analysisId, revision: created.revision });
    expect(await store.getJob(created.jobId)).toMatchObject({
      snapshotId: null,
      analysisId: created.analysisId,
      type: "pull_request_analysis",
    });
    const analysisJob = await store.claimPullRequestAnalysisJob("pr-impact-worker", 30);
    expect(analysisJob).toMatchObject({ analysisId: created.analysisId });
    if (!analysisJob) throw new Error("Expected a PR analysis job.");
    const computation = computePullRequestImpact(
      {
        side: "base",
        snapshotId: baseSnapshot,
        commitSha: baseGraph.snapshot.commitSha ?? "",
        files: baseGraph.files,
        symbols: baseGraph.symbols,
        edges: baseGraph.edges,
      },
      {
        side: "head",
        snapshotId: headSnapshot,
        commitSha: headGraph.snapshot.commitSha ?? "",
        files: headGraph.files,
        symbols: headGraph.symbols,
        edges: headGraph.edges,
      },
    );
    await store.completePullRequestAnalysis({
      jobId: analysisJob.id,
      analysisId: created.analysisId,
      workerId: "pr-impact-worker",
      computation,
      baseSnapshotId: baseSnapshot,
      headSnapshotId: headSnapshot,
    });
    const ready = await store.getPullRequestAnalysis(created.analysisId);
    expect(ready).toMatchObject({ status: "ready", stats: computation.stats });
    const firstPage = await store.getPullRequestImpactPage(created.analysisId, 1);
    expect(firstPage?.impacts).toHaveLength(1);
    expect(firstPage?.nextCursor).toEqual(expect.any(String));
    expect(firstPage?.impacts[0]?.evidence[0]?.id).toMatch(/^impact-evidence:/);
    const impactWithPath =
      firstPage?.impacts.find((impact) => impact.paths.length > 0) ??
      (await store.getPullRequestImpactPage(created.analysisId, 100))?.impacts.find(
        (impact) => impact.paths.length > 0,
      );
    expect(impactWithPath?.paths[0]?.evidenceId).toMatch(/^impact-evidence:/);
    const secondPage = await store.getPullRequestImpactPage(
      created.analysisId,
      10,
      firstPage?.nextCursor ?? undefined,
    );
    expect(secondPage?.impacts.length).toBeGreaterThan(0);
    expect(new Set(secondPage?.impacts.map((impact) => impact.id)).size).toBe(
      secondPage?.impacts.length,
    );

    const invalidRevision = await store.createPullRequestAnalysis({
      ...analysisInput,
      forceRevision: 2,
    });
    const invalidJob = await store.claimPullRequestAnalysisJob("pr-impact-worker", 30);
    expect(invalidJob).toMatchObject({ analysisId: invalidRevision.analysisId });
    if (!invalidJob) throw new Error("Expected the invalid revision job.");
    const corruptedComputation = structuredClone(computation);
    const corruptedEvidence = corruptedComputation.impacts
      .flatMap((impact) => impact.evidence)
      .at(0);
    if (!corruptedEvidence) throw new Error("Expected fixed evidence.");
    corruptedEvidence.quote = `${corruptedEvidence.quote}\ncorrupted`;
    await expect(
      store.completePullRequestAnalysis({
        jobId: invalidJob.id,
        analysisId: invalidRevision.analysisId,
        workerId: "pr-impact-worker",
        computation: corruptedComputation,
        baseSnapshotId: baseSnapshot,
        headSnapshotId: headSnapshot,
      }),
    ).rejects.toMatchObject({ code: "PR_EVIDENCE_INVARIANT_FAILED" });
    const rolledBack = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pull_request_impacts WHERE analysis_id = $1",
      [invalidRevision.analysisId],
    );
    expect(rolledBack.rows[0]?.count).toBe("0");
    await store.failPullRequestAnalysis(
      invalidJob.id,
      invalidRevision.analysisId,
      "pr-impact-worker",
      "PR_EVIDENCE_INVARIANT_FAILED",
      "Corrupted evidence was rejected.",
      false,
    );

    const deferredRevision = await store.createPullRequestAnalysis({
      ...analysisInput,
      forceRevision: 3,
    });
    const deferredJob = await store.claimPullRequestAnalysisJob("pr-impact-worker", 30);
    expect(deferredJob).toMatchObject({ analysisId: deferredRevision.analysisId });
    if (!deferredJob) throw new Error("Expected the deferred revision job.");
    await store.deferPullRequestAnalysis(
      deferredJob.id,
      deferredRevision.analysisId,
      "pr-impact-worker",
      "Waiting for immutable snapshots.",
    );
    expect(await store.claimPullRequestAnalysisJob("pr-impact-worker", 30)).toBeNull();
    const deferredAvailability = await pool.query<{ delayed: boolean }>(
      "SELECT available_at > now() AS delayed FROM analysis_jobs WHERE id = $1",
      [deferredJob.id],
    );
    expect(deferredAvailability.rows[0]?.delayed).toBe(true);

    const ensured = await Promise.all([
      store.ensureSnapshotForCommit({
        repositoryId: imported.repositoryId,
        workspaceId: PUBLIC_WORKSPACE_ID,
        commitSha: "3333333333333333333333333333333333333333",
        parserVersion,
      }),
      store.ensureSnapshotForCommit({
        repositoryId: imported.repositoryId,
        workspaceId: PUBLIC_WORKSPACE_ID,
        commitSha: "3333333333333333333333333333333333333333",
        parserVersion,
      }),
    ]);
    expect(ensured[0]).toEqual(ensured[1]);
  });
});
