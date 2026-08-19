import { createHmac } from "node:crypto";
import { loadConfig } from "@repovista/config";
import type { DatabasePool, RepoVistaStore } from "@repovista/database";
import { DomainError, PUBLIC_WORKSPACE_ID } from "@repovista/domain";
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
  autoUpdateEnabled: false,
  lastWebhookAt: null,
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
  stats: {
    files: 1,
    symbols: 1,
    edges: 0,
    languages: { typescript: 1 },
    warnings: 0,
    indexing: null,
  },
  baseSnapshotId: null,
  indexMode: "full",
  treeHash: null,
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
    processGitHubWebhook: vi.fn(async (input) => ({
      status: input.eventName === "push" ? ("enqueued" as const) : ("ignored" as const),
      duplicate: false,
      deliveryId: input.deliveryId,
      reason:
        input.eventName === "push"
          ? null
          : input.eventName === "ping"
            ? "ping"
            : "event_not_supported",
      repositoryId: input.eventName === "push" ? repositoryId : null,
      snapshotId: input.eventName === "push" ? snapshotId : null,
      jobId: input.eventName === "push" ? jobId : null,
    })),
  } as unknown as RepoVistaStore;
}

function createTestApp(store = createStore(), environment: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "fatal",
    MODEL_PROVIDER: "fake",
    ...environment,
  });
  const pool = { end: vi.fn(async () => undefined) } as unknown as DatabasePool;
  return { ...buildApp({ config, pool, store }), store };
}

const openApps: ReturnType<typeof createTestApp>["app"][] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("RepoVista API", () => {
  it("reports GitHub automation without exposing the webhook secret", async () => {
    const { app } = createTestApp(createStore(), {
      GITHUB_WEBHOOK_SECRET: "test-secret",
      GITHUB_APP_SLUG: "repovista-test",
    });
    openApps.push(app);
    const result = await app.inject({ method: "GET", url: "/v1/integrations/github" });

    expect(result.statusCode).toBe(200);
    expect(result.json().data).toEqual({
      enabled: true,
      appSlug: "repovista-test",
      events: ["ping", "push"],
      scope: "public-repositories",
    });
    expect(result.body).not.toContain("test-secret");
  });

  it("verifies and enqueues a signed public default-branch push", async () => {
    const store = createStore();
    const secret = "test-secret";
    const { app } = createTestApp(store, { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(app);
    const payload = JSON.stringify({
      after: "1123456789abcdef0123456789abcdef01234567",
      deleted: false,
      ref: "refs/heads/main",
      repository: {
        id: 123,
        name: "demo",
        full_name: "acme/demo",
        html_url: "https://github.com/acme/demo",
        default_branch: "main",
        private: false,
        owner: { login: "acme" },
      },
      installation: { id: 456 },
    });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const result = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-1",
        "x-github-event": "push",
        "x-hub-signature-256": signature,
      },
      payload,
    });

    expect(result.statusCode).toBe(202);
    expect(result.json().data).toMatchObject({ status: "enqueued", deliveryId: "delivery-1" });
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-1",
        push: expect.objectContaining({
          canonicalUrl: "https://github.com/acme/demo",
          after: "1123456789abcdef0123456789abcdef01234567",
          installationId: 456,
        }),
      }),
      "tree-sitter-ts-js-py-v1",
    );
  });

  it("records a signed unknown GitHub event and safely ignores it", async () => {
    const store = createStore();
    const secret = "test-secret";
    const { app } = createTestApp(store, { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(app);
    const payload = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const result = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-unknown",
        "x-github-event": "issues",
        "x-hub-signature-256": signature,
      },
      payload,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({
      status: "ignored",
      reason: "event_not_supported",
    });
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-unknown",
        eventName: "issues",
        push: null,
      }),
      "tree-sitter-ts-js-py-v1",
    );
  });

  it("accepts a signed GitHub ping without creating an indexing job", async () => {
    const store = createStore();
    const secret = "test-secret";
    const { app } = createTestApp(store, { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(app);
    const payload = JSON.stringify({ zen: "Keep it logically awesome." });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const result = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-ping",
        "x-github-event": "ping",
        "x-hub-signature-256": signature,
      },
      payload,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({ status: "ignored", reason: "ping" });
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "ping", push: null }),
      "tree-sitter-ts-js-py-v1",
    );
  });

  it("rejects invalid signatures and disabled webhooks", async () => {
    const enabled = createTestApp(createStore(), { GITHUB_WEBHOOK_SECRET: "test-secret" });
    openApps.push(enabled.app);
    const invalid = await enabled.app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-2",
        "x-github-event": "ping",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      payload: JSON.stringify({ zen: "safe" }),
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe("GITHUB_WEBHOOK_SIGNATURE_INVALID");

    const disabled = createTestApp();
    openApps.push(disabled.app);
    const unavailable = await disabled.app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("GITHUB_APP_DISABLED");
  });

  it("verifies raw webhook bytes before parsing JSON and maps delivery conflicts to 409", async () => {
    const secret = "test-secret";
    const malformed = "{not-json";
    const { app } = createTestApp(createStore(), { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(app);
    const invalidSignature = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-malformed-1",
        "x-github-event": "ping",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      payload: malformed,
    });
    expect(invalidSignature.statusCode).toBe(401);
    expect(invalidSignature.json().error.code).toBe("GITHUB_WEBHOOK_SIGNATURE_INVALID");

    const malformedSignature = `sha256=${createHmac("sha256", secret)
      .update(malformed)
      .digest("hex")}`;
    const malformedPayload = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-malformed-2",
        "x-github-event": "ping",
        "x-hub-signature-256": malformedSignature,
      },
      payload: malformed,
    });
    expect(malformedPayload.statusCode).toBe(400);
    expect(malformedPayload.json().error.code).toBe("GITHUB_WEBHOOK_PAYLOAD_INVALID");

    const conflictStore = createStore();
    vi.mocked(conflictStore.processGitHubWebhook).mockRejectedValueOnce(
      new DomainError(
        "GITHUB_WEBHOOK_DELIVERY_CONFLICT",
        "The delivery ID was received with a different payload.",
      ),
    );
    const conflictApp = createTestApp(conflictStore, { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(conflictApp.app);
    const payload = JSON.stringify({ zen: "safe" });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    const conflict = await conflictApp.app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhooks",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-conflict",
        "x-github-event": "ping",
        "x-hub-signature-256": signature,
      },
      payload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("GITHUB_WEBHOOK_DELIVERY_CONFLICT");
  });
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
