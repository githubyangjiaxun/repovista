import { loadConfig } from "@repovista/config";
import type { DatabasePool, RepoVistaStore } from "@repovista/database";
import { PUBLIC_WORKSPACE_ID } from "@repovista/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const fileId = "01900000-0000-7000-8000-000000000004";
const symbolId = "01900000-0000-7000-8000-000000000005";
const messageId = "01900000-0000-7000-8000-000000000006";

const repository = {
  id: repositoryId,
  owner: "acme",
  name: "demo",
  canonicalUrl: "https://github.com/acme/demo",
  defaultBranch: "main",
  latestSnapshotId: snapshotId,
  latestSnapshotStatus: "ready" as const,
  latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const snapshot = {
  id: snapshotId,
  repositoryId,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  refName: "main",
  status: "ready" as const,
  parserVersion: "tree-sitter-ts-v1",
  stats: { files: 1, symbols: 1, edges: 0, languages: { typescript: 1 }, warnings: 0 },
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:01.000Z",
  failure: null,
};

function createStore(): RepoVistaStore {
  return {
    ping: vi.fn(async () => undefined),
    createRepositoryImport: vi.fn(async () => ({
      repositoryId,
      snapshotId,
      jobId,
      status: "queued" as const,
    })),
    listRepositories: vi.fn(async () => [repository]),
    getRepository: vi.fn(async () => repository),
    listSnapshots: vi.fn(async () => [snapshot]),
    getSnapshot: vi.fn(async () => snapshot),
    requestCancellation: vi.fn(async () => undefined),
    getJob: vi.fn(async () => ({
      id: jobId,
      snapshotId,
      type: "index_snapshot",
      status: "succeeded" as const,
      phase: "completed",
      progress: 1,
      processed: 1,
      total: 1,
      retryable: false,
      error: null,
    })),
    listJobEvents: vi.fn(async () => [
      {
        id: 1,
        type: "completed",
        payload: { snapshotId },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]),
    getSnapshotGraphData: vi.fn(async () => ({
      snapshot,
      files: [
        {
          id: fileId,
          path: "src/index.ts",
          language: "typescript",
          byteSize: 38,
          lineCount: 1,
          blobHash: "sha256:file",
          content: "export function hello() { return 1; }",
          parseStatus: "parsed",
        },
      ],
      symbols: [
        {
          id: symbolId,
          fileId,
          path: "src/index.ts",
          stableKey: "module:src/index.ts",
          kind: "module",
          name: "index.ts",
          qualifiedName: "src/index.ts",
          signature: null,
          startLine: 1,
          endLine: 1,
          contentHash: "sha256:file",
        },
      ],
      edges: [],
    })),
    listSnapshotFiles: vi.fn(async () => ({ files: [], nextCursor: null })),
    getSourceFile: vi.fn(async () => ({
      id: fileId,
      path: "src/index.ts",
      language: "typescript",
      content: "export function hello() { return 1; }",
      lineCount: 1,
      startLine: 1,
      commitSha: snapshot.commitSha,
      blobHash: "sha256:file",
      truncated: false,
    })),
    searchEvidence: vi.fn(async () => [
      {
        id: "evidence-1",
        snapshotId,
        commitSha: snapshot.commitSha,
        fileId,
        path: "src/index.ts",
        symbolId,
        symbol: "hello",
        startLine: 1,
        endLine: 1,
        content: "export function hello() { return 1; }",
        contentHash: "sha256:evidence",
        score: 1,
      },
    ]),
    saveAnswer: vi.fn(async () => messageId),
    createShareReport: vi.fn(async () => ({ id: messageId, slug: "acme-demo-report" })),
    getShareReport: vi.fn(async () => null),
  } as unknown as RepoVistaStore;
}

function createTestApp(store = createStore()) {
  const config = loadConfig({ APP_ENV: "test", LOG_LEVEL: "fatal", MODEL_PROVIDER: "fake" });
  const pool = { end: vi.fn(async () => undefined) } as unknown as DatabasePool;
  return { ...buildApp({ config, pool, store }), store };
}

const openApps: ReturnType<typeof createTestApp>["app"][] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("RepoVista API", () => {
  it("queues a validated public GitHub repository", async () => {
    const { app, store } = createTestApp();
    openApps.push(app);
    const result = await app.inject({
      method: "POST",
      url: "/v1/repositories",
      payload: { url: "https://github.com/acme/demo", ref: "main", ignore: ["generated"] },
    });

    expect(result.statusCode).toBe(202);
    expect(result.json().data).toMatchObject({ repositoryId, snapshotId, jobId });
    expect(store.createRepositoryImport).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: PUBLIC_WORKSPACE_ID, requestedRef: "main" }),
    );
    expect(result.headers["x-request-id"]).toBeTruthy();
  });

  it.each([
    ["a ref that starts with an option", "--upload-pack=malicious"],
    ["a ref with parent traversal", "feature..main"],
    ["a reflog expression", "main@{1}"],
  ])("rejects %s", async (_label, ref) => {
    const { app, store } = createTestApp();
    openApps.push(app);

    const result = await app.inject({
      method: "POST",
      url: "/v1/repositories",
      payload: { url: "https://github.com/acme/demo", ref },
    });

    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe("REPOSITORY_REF_INVALID");
    expect(store.createRepositoryImport).not.toHaveBeenCalled();
  });

  it("rejects unsafe ignored paths", async () => {
    const { app, store } = createTestApp();
    openApps.push(app);

    const result = await app.inject({
      method: "POST",
      url: "/v1/repositories",
      payload: { url: "https://github.com/acme/demo", ignore: ["generated/../secret"] },
    });

    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe("SOURCE_PATH_INVALID");
    expect(store.createRepositoryImport).not.toHaveBeenCalled();
  });

  it("rejects source directory traversal", async () => {
    const { app } = createTestApp();
    openApps.push(app);
    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/source?path=../secret`,
    });

    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe("SOURCE_PATH_INVALID");
  });

  it("returns a deterministic architecture map", async () => {
    const { app } = createTestApp();
    openApps.push(app);
    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/map?level=file`,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({
      level: "file",
      snapshot: { id: snapshotId, commitSha: snapshot.commitSha },
    });
    expect(result.json().data.nodes).toHaveLength(1);
  });

  it("answers from retrieved evidence with the transparent fake provider", async () => {
    const { app, store } = createTestApp();
    openApps.push(app);
    const result = await app.inject({
      method: "POST",
      url: `/v1/repositories/${repositoryId}/ask`,
      payload: { question: "Where is hello implemented?", provider: "fake" },
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().data.answer).toMatchObject({
      status: "grounded",
      provider: "fake",
    });
    expect(result.json().data.answer.citations).toHaveLength(1);
    expect(store.saveAnswer).toHaveBeenCalledOnce();
  });

  it("classifies malformed model output as an upstream failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "not-json" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const store = createStore();
    const config = loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "fatal",
      MODEL_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "http://model.test/v1",
      CHAT_MODEL: "test-model",
    });
    const pool = { end: vi.fn(async () => undefined) } as unknown as DatabasePool;
    const { app } = buildApp({ config, pool, store });
    openApps.push(app);

    const result = await app.inject({
      method: "POST",
      url: `/v1/repositories/${repositoryId}/ask`,
      payload: { question: "Where is hello implemented?" },
    });

    expect(result.statusCode).toBe(502);
    expect(result.json().error).toMatchObject({
      code: "AI_OUTPUT_INVALID",
      retryable: false,
    });
    expect(store.saveAnswer).not.toHaveBeenCalled();
  });

  it("streams persisted job events as SSE", async () => {
    const { app } = createTestApp();
    openApps.push(app);
    const result = await app.inject({ method: "GET", url: `/v1/jobs/${jobId}/events` });

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("text/event-stream");
    expect(result.body).toContain("event: completed");
    expect(result.body).toContain(`"snapshotId":"${snapshotId}"`);
  });
});
