import { createHmac } from "node:crypto";
import { CSRF_COOKIE, hashSecret, SESSION_COOKIE } from "@repovista/auth";
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
const analysisId = "01900000-0000-7000-8000-000000000007";
const baseSnapshotId = "01900000-0000-7000-8000-000000000008";
const headSnapshotId = "01900000-0000-7000-8000-000000000009";
const baseSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";
const ownerUserId = "01900000-0000-7000-8000-000000000010";
const memberUserId = "01900000-0000-7000-8000-000000000011";
const workspaceId = "01900000-0000-7000-8000-000000000012";

const pullRequestAnalysis = {
  id: analysisId,
  repositoryId,
  prNumber: 42,
  title: "Change greeting",
  url: "https://github.com/acme/demo/pull/42",
  baseSha,
  headSha,
  baseSnapshotId,
  headSnapshotId,
  parserVersion: "tree-sitter-ts-js-py-go-v1",
  algorithmVersion: "reverse-bfs-risk-v1",
  revision: 1,
  status: "ready" as const,
  progress: 1,
  stats: {
    changedFiles: 1,
    changedSymbols: 1,
    directImpacts: 1,
    transitiveImpacts: 0,
    unknownImpacts: 0,
    truncated: false,
  },
  failure: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
};

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
  const workspace = {
    id: workspaceId,
    name: "Acme team",
    slug: "acme-team",
    kind: "team" as const,
    visibility: "private" as const,
    role: "owner" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const member = {
    userId: memberUserId,
    login: "octocat",
    displayName: "Octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    role: "viewer" as const,
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    ping: vi.fn(async () => undefined),
    createOAuthState: vi.fn(async () => undefined),
    consumeOAuthState: vi.fn(async () => null),
    createInstallationState: vi.fn(async () => undefined),
    consumeInstallationState: vi.fn(async () => null),
    resolveSession: vi.fn(async () => null),
    resolveApiToken: vi.fn(async () => null),
    listWorkspaceMembers: vi.fn(async () => [member]),
    listAuditEvents: vi.fn(async () => []),
    addWorkspaceMember: vi.fn(async (_workspace, _actor, _login, role) => ({ ...member, role })),
    updateWorkspaceMemberRole: vi.fn(async (_workspace, _actor, _target, role) => ({
      ...member,
      role,
    })),
    removeWorkspaceMember: vi.fn(async () => undefined),
    listUserWorkspaces: vi.fn(async () => [workspace]),
    createRepositoryImport: vi.fn(async () => ({
      repositoryId,
      snapshotId,
      jobId,
      status: "queued" as const,
    })),
    createPullRequestAnalysis: vi.fn(async () => ({
      analysisId,
      jobId,
      revision: 1,
      status: "queued" as const,
    })),
    listRepositories: vi.fn(async () => [repository]),
    getRepository: vi.fn(async () => repository),
    listSnapshots: vi.fn(async () => [snapshot]),
    getSnapshot: vi.fn(async () => snapshot),
    getPullRequestAnalysis: vi.fn(async () => pullRequestAnalysis),
    getPullRequestAnalysisJobId: vi.fn(async () => jobId),
    getPullRequestImpactPage: vi.fn(async () => ({
      analysis: pullRequestAnalysis,
      files: [],
      symbols: [],
      impacts: [],
      nextCursor: null,
    })),
    requestCancellation: vi.fn(async () => undefined),
    getJob: vi.fn(async () => ({
      id: jobId,
      snapshotId,
      analysisId: null,
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
    getSnapshotSymbolEvidence: vi.fn(async () => ({
      id: symbolId,
      snapshotId,
      commitSha: snapshot.commitSha,
      parserVersion: snapshot.parserVersion,
      fileId,
      path: "src/index.ts",
      language: "typescript",
      blobHash: "sha256:file",
      stableKey: "module:src/index.ts",
      kind: "module" as const,
      name: "index.ts",
      qualifiedName: "src/index.ts",
      signature: null,
      startLine: 1,
      endLine: 1,
      content: "export function hello() { return 1; }",
      contentHash: "sha256:symbol-evidence",
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
    getRetrievalStatus: vi.fn(async () => ({
      snapshotId,
      text: { ready: true, reason: null },
      symbol: { ready: true, reason: null },
      semantic: {
        configured: false,
        queryable: false,
        reason: "provider_disabled" as const,
        currentIndex: null,
        latestIndex: null,
      },
    })),
    searchTextEvidence: vi.fn(async () => [
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
        channel: "text" as const,
      },
    ]),
    searchSymbolEvidence: vi.fn(async () => [
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
        channel: "symbol" as const,
      },
    ]),
    searchSemanticEvidence: vi.fn(async () => []),
    createOrRetryEmbeddingIndex: vi.fn(async () => {
      throw new DomainError("EMBEDDING_PROVIDER_DISABLED", "Embedding is disabled.");
    }),
    saveAnswer: vi.fn(async () => messageId),
    createShareReport: vi.fn(async () => ({ id: messageId, slug: "acme-demo-report" })),
    getShareReport: vi.fn(async () => null),
    getShareReportAccess: vi.fn(async () => null),
    processGitHubWebhook: vi.fn(async (input) => {
      const synchronized = ["installation", "installation_repositories", "pull_request"].includes(
        input.eventName,
      );
      return {
        status:
          input.eventName === "push"
            ? ("enqueued" as const)
            : synchronized
              ? ("synchronized" as const)
              : ("ignored" as const),
        duplicate: false,
        deliveryId: input.deliveryId,
        reason:
          input.eventName === "push" || synchronized
            ? null
            : input.eventName === "ping"
              ? "ping"
              : "event_not_supported",
        repositoryId:
          input.eventName === "push" || input.eventName === "pull_request" ? repositoryId : null,
        snapshotId: input.eventName === "push" ? snapshotId : null,
        jobId: input.eventName === "push" ? jobId : null,
      };
    }),
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

function authenticateOwner(store: RepoVistaStore) {
  const sessionToken = "session_token_abcdefghijklmnopqrstuvwxyz123456";
  const csrfToken = "csrf_token_abcdefghijklmnopqrstuvwxyz123456789";
  vi.mocked(store.resolveSession).mockResolvedValue({
    principal: {
      kind: "session",
      userId: ownerUserId,
      workspaceId,
      role: "owner",
      scopes: ["repo:read", "repo:write", "workspace:admin"],
      sessionId: "01900000-0000-7000-8000-000000000013",
      tokenId: null,
      csrfTokenHash: hashSecret(csrfToken),
    },
    user: {
      id: ownerUserId,
      login: "owner",
      displayName: "Workspace Owner",
      avatarUrl: null,
    },
    workspace: {
      id: workspaceId,
      name: "Acme team",
      slug: "acme-team",
      kind: "team",
      visibility: "private",
      role: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });
  return {
    cookie: `${SESSION_COOKIE}=${sessionToken}; ${CSRF_COOKIE}=${csrfToken}`,
    csrfToken,
  };
}

function authenticateToken(
  store: RepoVistaStore,
  options: {
    role?: "owner" | "editor" | "viewer";
    scopes?: ("repo:read" | "repo:write" | "workspace:admin")[];
  } = {},
) {
  const token = "rv_test_token_abcdefghijklmnopqrstuvwxyz0123456789";
  vi.mocked(store.resolveApiToken).mockResolvedValue({
    kind: "token",
    userId: ownerUserId,
    workspaceId,
    role: options.role ?? "owner",
    scopes: options.scopes ?? ["repo:read", "repo:write", "workspace:admin"],
    sessionId: null,
    tokenId: "01900000-0000-7000-8000-000000000014",
    csrfTokenHash: null,
  });
  return { authorization: `Bearer ${token}` };
}

describe("RepoVista API", () => {
  it("keeps OAuth return paths local and redirects failures with stable codes", async () => {
    const store = createStore();
    const { app } = createTestApp(store, {
      GITHUB_APP_CLIENT_ID: "client-id",
      GITHUB_APP_CLIENT_SECRET: "client-secret",
    });
    openApps.push(app);

    const started = await app.inject({
      method: "GET",
      url: "/v1/auth/github/start?returnTo=https%3A%2F%2Fevil.example%2Fsteal",
    });
    expect(started.statusCode).toBe(302);
    expect(started.headers.location).toContain("https://github.com/login/oauth/authorize");
    expect(store.createOAuthState).toHaveBeenCalledWith(
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      "/repositories",
      expect.any(Date),
    );

    const state = "oauth_state_abcdefghijklmnopqrstuvwxyz123456789";
    vi.mocked(store.consumeOAuthState).mockResolvedValue("/settings");
    const denied = await app.inject({
      method: "GET",
      url: `/v1/auth/github/callback?error=access_denied&state=${state}`,
      headers: { cookie: `repovista_oauth_state=${state}` },
    });
    expect(denied.statusCode).toBe(302);
    expect(denied.headers.location).toBe(
      "http://localhost:3000/auth/error?code=OAUTH_ACCESS_DENIED",
    );
    expect(denied.headers.location).not.toContain("access_denied");
    expect(String(denied.headers["set-cookie"])).toContain("Max-Age=0");

    const invalidState = await app.inject({
      method: "GET",
      url: `/v1/auth/github/callback?code=secret-code&state=${state}`,
      headers: { cookie: "repovista_oauth_state=different_state_abcdefghijklmnopqrstuvwxyz123" },
    });
    expect(invalidState.statusCode).toBe(302);
    expect(invalidState.headers.location).toBe(
      "http://localhost:3000/auth/error?code=OAUTH_STATE_INVALID",
    );
    expect(invalidState.headers.location).not.toContain("secret-code");
  });

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
      "tree-sitter-ts-js-py-go-v1",
    );
  });

  it("validates installation, repository grant, and pull request webhook boundaries", async () => {
    const store = createStore();
    const secret = "test-secret";
    const { app } = createTestApp(store, { GITHUB_WEBHOOK_SECRET: secret });
    openApps.push(app);
    const send = async (delivery: string, event: string, body: object) => {
      const payload = JSON.stringify(body);
      const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      return app.inject({
        method: "POST",
        url: "/v1/integrations/github/webhooks",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": delivery,
          "x-github-event": event,
          "x-hub-signature-256": signature,
        },
        payload,
      });
    };

    const suspendedAt = "2026-08-22T00:00:00.000Z";
    const installation = await send("delivery-installation", "installation", {
      action: "suspend",
      installation: { id: 456, suspended_at: suspendedAt },
    });
    expect(installation.statusCode).toBe(200);
    expect(installation.json().data.status).toBe("synchronized");
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "installation",
        installation: {
          action: "suspend",
          installationId: 456,
          suspendedAt: new Date(suspendedAt),
        },
      }),
      "tree-sitter-ts-js-py-go-v1",
    );

    const grants = await send("delivery-grants", "installation_repositories", {
      action: "removed",
      installation: { id: 456 },
      repositories_added: [],
      repositories_removed: [{ id: 123 }, { id: 124 }],
    });
    expect(grants.statusCode).toBe(200);
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        installationRepositories: {
          action: "removed",
          installationId: 456,
          providerRepoIds: ["123", "124"],
        },
      }),
      "tree-sitter-ts-js-py-go-v1",
    );

    const pullRequest = await send("delivery-pr", "pull_request", {
      action: "synchronize",
      number: 42,
      pull_request: { number: 42 },
      repository: {
        id: 123,
        name: "demo",
        full_name: "acme/demo",
        html_url: "https://github.com/acme/demo",
        default_branch: "main",
        private: true,
        owner: { login: "acme" },
      },
      installation: { id: 456 },
    });
    expect(pullRequest.statusCode).toBe(200);
    expect(store.processGitHubWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequest: expect.objectContaining({
          action: "synchronize",
          installationId: 456,
          providerRepoId: "123",
          canonicalUrl: "https://github.com/acme/demo",
          isPrivate: true,
          number: 42,
        }),
      }),
      "tree-sitter-ts-js-py-go-v1",
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
      "tree-sitter-ts-js-py-go-v1",
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
      "tree-sitter-ts-js-py-go-v1",
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

  it("isolates workspace member administration behind owner sessions and CSRF", async () => {
    const store = createStore();
    const auth = authenticateOwner(store);
    const { app } = createTestApp(store);
    openApps.push(app);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${workspaceId}/members`,
      headers: { cookie: auth.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toMatchObject([{ userId: memberUserId, role: "viewer" }]);

    const otherWorkspace = await app.inject({
      method: "GET",
      url: "/v1/workspaces/01900000-0000-7000-8000-000000000099/members",
      headers: { cookie: auth.cookie },
    });
    expect(otherWorkspace.statusCode).toBe(404);
    expect(otherWorkspace.json().error.code).toBe("WORKSPACE_NOT_FOUND");

    const missingCsrf = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/members`,
      headers: { cookie: auth.cookie },
      payload: { login: "octocat", role: "editor" },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json().error.code).toBe("CSRF_INVALID");

    const headers = {
      cookie: auth.cookie,
      origin: "http://localhost:3000",
      "x-repovista-csrf": auth.csrfToken,
    };
    const added = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${workspaceId}/members`,
      headers,
      payload: { login: "octocat", role: "editor" },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().data).toMatchObject({ userId: memberUserId, role: "editor" });
    expect(store.addWorkspaceMember).toHaveBeenCalledWith(
      workspaceId,
      ownerUserId,
      "octocat",
      "editor",
    );

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${workspaceId}/members/${memberUserId}`,
      headers,
      payload: { role: "owner" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.role).toBe("owner");

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${workspaceId}/members/${memberUserId}`,
      headers,
    });
    expect(removed.statusCode).toBe(204);
    expect(store.removeWorkspaceMember).toHaveBeenCalledWith(
      workspaceId,
      ownerUserId,
      memberUserId,
    );
  });

  it("binds Bearer workspace discovery to the token workspace", async () => {
    const store = createStore();
    const otherWorkspace = {
      id: "01900000-0000-7000-8000-000000000015",
      name: "Unrelated workspace",
      slug: "unrelated-workspace",
      kind: "team" as const,
      visibility: "private" as const,
      role: "owner" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const ownWorkspace = (await store.listUserWorkspaces(ownerUserId))[0];
    if (!ownWorkspace) throw new Error("Expected the test workspace fixture.");
    vi.mocked(store.listUserWorkspaces).mockResolvedValue([ownWorkspace, otherWorkspace]);
    const headers = authenticateToken(store);
    const { app } = createTestApp(store);
    openApps.push(app);

    const session = await app.inject({ method: "GET", url: "/v1/auth/session", headers });
    const workspaces = await app.inject({ method: "GET", url: "/v1/workspaces", headers });

    expect(session.statusCode).toBe(200);
    expect(session.json().data.workspaces).toEqual([expect.objectContaining({ id: workspaceId })]);
    expect(workspaces.statusCode).toBe(200);
    expect(workspaces.json().data).toEqual([expect.objectContaining({ id: workspaceId })]);
    expect(session.body).not.toContain(otherWorkspace.id);
    expect(workspaces.body).not.toContain(otherWorkspace.id);
  });

  it("allows scoped Bearer writes without CSRF and rejects ambiguous credentials", async () => {
    const store = createStore();
    const headers = authenticateToken(store, {
      role: "editor",
      scopes: ["repo:read", "repo:write"],
    });
    const { app } = createTestApp(store);
    openApps.push(app);

    const created = await app.inject({
      method: "POST",
      url: "/v1/repositories",
      headers,
      payload: { url: "https://github.com/acme/demo", ignore: [] },
    });
    expect(created.statusCode).toBe(202);

    const ambiguous = await app.inject({
      method: "GET",
      url: "/v1/workspaces",
      headers: {
        ...headers,
        cookie: `${SESSION_COOKIE}=session_token_abcdefghijklmnopqrstuvwxyz123456`,
      },
    });
    expect(ambiguous.statusCode).toBe(401);
    expect(ambiguous.json().error.code).toBe("AUTH_AMBIGUOUS");
  });

  it("keeps audit and cross-workspace member reads inside the active workspace", async () => {
    const store = createStore();
    const { cookie } = authenticateOwner(store);
    vi.mocked(store.listAuditEvents).mockResolvedValue([
      {
        id: 1,
        actorKind: "session",
        actorLogin: "owner",
        action: "workspace.member_add",
        resourceType: "member",
        resourceId: memberUserId,
        metadata: { role: "viewer" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const { app } = createTestApp(store);
    openApps.push(app);

    const audit = await app.inject({
      method: "GET",
      url: "/v1/audit-events?limit=25",
      headers: { cookie },
    });
    expect(audit.statusCode).toBe(200);
    expect(store.listAuditEvents).toHaveBeenCalledWith(workspaceId, 25);

    const foreignWorkspace = "01900000-0000-7000-8000-000000000015";
    const foreignMembers = await app.inject({
      method: "GET",
      url: `/v1/workspaces/${foreignWorkspace}/members`,
      headers: { cookie },
    });
    expect(foreignMembers.statusCode).toBe(404);
    expect(foreignMembers.json().error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(store.listWorkspaceMembers).not.toHaveBeenCalledWith(foreignWorkspace);
  });

  it("loads a public share through its public workspace for an authenticated user", async () => {
    const store = createStore();
    const { cookie } = authenticateOwner(store);
    const publicWorkspaceId = PUBLIC_WORKSPACE_ID;
    vi.mocked(store.getShareReportAccess).mockResolvedValue({
      repositoryId,
      workspaceId: publicWorkspaceId,
      visibility: "public",
      githubInstallationId: null,
      role: "owner",
    });
    vi.mocked(store.getShareReport).mockResolvedValue({
      id: messageId,
      slug: "public-report",
      title: "Public report",
      visibility: "public",
      repository,
      snapshot: { ...snapshot, indexMode: "full" as const },
      content: {
        overview: "Public overview",
        readingPath: [],
        map: { nodes: [], edges: [], truncated: false },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const { app } = createTestApp(store);
    openApps.push(app);

    const result = await app.inject({
      method: "GET",
      url: "/v1/share-reports/public-report",
      headers: { cookie },
    });

    expect(result.statusCode).toBe(200);
    expect(store.getShareReport).toHaveBeenCalledWith("public-report", publicWorkspaceId);
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

  it("fetches public PR metadata/files and queues an immutable impact analysis", async () => {
    const store = createStore();
    const { app } = createTestApp(store, { GITHUB_API_ORIGIN: "https://api.github.test" });
    openApps.push(app);
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/pulls/42")) {
        return new Response(
          JSON.stringify({
            number: 42,
            title: "Change greeting",
            html_url: "https://github.com/acme/demo/pull/42",
            base: { sha: baseSha, repo: { full_name: "acme/demo", private: false } },
            head: { sha: headSha },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      expect(url).toContain("/pulls/42/files?");
      return new Response(
        JSON.stringify([
          {
            filename: "src/index.ts",
            status: "modified",
            additions: 2,
            deletions: 1,
            patch: "@@ -1 +1 @@",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await app.inject({
      method: "POST",
      url: `/v1/repositories/${repositoryId}/pull-requests`,
      payload: { number: 42 },
    });

    expect(result.statusCode).toBe(202);
    expect(result.json().data).toMatchObject({ analysisId, jobId, revision: 1, status: "queued" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.createPullRequestAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId,
        prNumber: 42,
        baseSha,
        headSha,
        providerFiles: [expect.objectContaining({ path: "src/index.ts", additions: 2 })],
      }),
    );
  });

  it("serves analysis status and cursor-aware impact data", async () => {
    const store = createStore();
    const { app } = createTestApp(store);
    openApps.push(app);

    const status = await app.inject({
      method: "GET",
      url: `/v1/pull-request-analyses/${analysisId}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toMatchObject({ id: analysisId, status: "ready" });

    const impact = await app.inject({
      method: "GET",
      url: `/v1/pull-request-analyses/${analysisId}/impact?limit=10&cursor=next_page_token`,
    });
    expect(impact.statusCode).toBe(200);
    expect(store.getPullRequestImpactPage).toHaveBeenCalledWith(analysisId, 10, "next_page_token");
  });

  it("maps GitHub rate limits and malformed PR responses to stable errors", async () => {
    const { app } = createTestApp(createStore(), { GITHUB_API_ORIGIN: "https://api.github.test" });
    openApps.push(app);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "rate limit" }), {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" },
          }),
      ),
    );

    const result = await app.inject({
      method: "POST",
      url: `/v1/repositories/${repositoryId}/pull-requests`,
      payload: { number: 42 },
    });
    expect(result.statusCode).toBe(429);
    expect(result.json().error).toMatchObject({ code: "GITHUB_RATE_LIMITED", retryable: true });
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

  it("returns symbol evidence only for the fixed ready snapshot", async () => {
    const { app, store } = createTestApp();
    openApps.push(app);
    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/symbols/${symbolId}`,
    });

    expect(result.statusCode).toBe(200);
    expect(result.json().data).toMatchObject({
      id: symbolId,
      snapshotId,
      commitSha: snapshot.commitSha,
      path: "src/index.ts",
      startLine: 1,
    });
    expect(store.getSnapshotSymbolEvidence).toHaveBeenCalledWith(snapshotId, symbolId);
  });

  it("creates a deterministic architecture story v2 pinned to the ready snapshot", async () => {
    const store = createStore();
    const { app } = createTestApp(store);
    openApps.push(app);

    const result = await app.inject({
      method: "POST",
      url: "/v1/share-reports",
      payload: { snapshotId, title: "Fixed story" },
    });

    expect(result.statusCode).toBe(201);
    expect(store.createShareReport).toHaveBeenCalledWith(
      repositoryId,
      snapshotId,
      "Fixed story",
      expect.objectContaining({
        version: 2,
        algorithmVersion: "architecture-story-v2",
        provenance: expect.objectContaining({
          snapshotId,
          commitSha: snapshot.commitSha,
          retrievalProfile: null,
        }),
      }),
    );
  });

  it("downloads deterministic Markdown and safely escaped SVG for the requested snapshot", async () => {
    const { app } = createTestApp();
    openApps.push(app);
    const markdown = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/exports/markdown`,
    });

    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(markdown.headers["content-disposition"]).toMatch(
      /^attachment; filename="acme-demo-[a-f0-9]{12}-architecture\.md"$/,
    );
    expect(markdown.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(markdown.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
    expect(markdown.headers["x-content-type-options"]).toBe("nosniff");
    expect(markdown.body).toContain(snapshot.commitSha);
    expect(markdown.body).toContain(snapshotId);
    expect(markdown.body).toContain(snapshot.parserVersion);
    expect(markdown.body).not.toContain('"data"');

    const store = createStore();
    const graphData = await store.getSnapshotGraphData(snapshotId);
    if (!graphData) throw new Error("Expected graph data fixture.");
    vi.mocked(store.getRepository).mockResolvedValue({
      ...repository,
      owner: "acme & <team>",
      name: 'demo "map"',
    });
    vi.mocked(store.getSnapshotGraphData).mockResolvedValue({
      ...graphData,
      files: graphData.files.map((file) => ({ ...file, path: "src/a&b/<entry>.ts" })),
      symbols: graphData.symbols.map((symbol) => ({
        ...symbol,
        path: "src/a&b/<entry>.ts",
        name: 'hello & <world> "quoted"',
        qualifiedName: "hello & <world> 'quoted'",
      })),
    });
    const special = createTestApp(store);
    openApps.push(special.app);
    const firstSvg = await special.app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/exports/svg?level=symbol`,
    });
    const secondSvg = await special.app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/exports/svg?level=symbol`,
    });

    expect(firstSvg.statusCode).toBe(200);
    expect(firstSvg.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(firstSvg.headers["content-disposition"]).toMatch(/-symbol-map\.svg"$/);
    expect(firstSvg.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(firstSvg.body).toBe(secondSvg.body);
    expect(firstSvg.body).toContain("&amp;");
    expect(firstSvg.body).toContain("&lt;team&gt;");
    expect(firstSvg.body).toContain("&quot;");
    expect(firstSvg.body).toContain("&apos;");
    expect(firstSvg.body).not.toContain("<team>");
  });

  it("marks private exports as non-cacheable while retaining workspace access checks", async () => {
    const store = createStore();
    const privateStore = store as unknown as {
      getSnapshotAccess: ReturnType<typeof vi.fn>;
      getRepository: ReturnType<typeof vi.fn>;
    };
    privateStore.getSnapshotAccess = vi.fn(async () => ({
      repositoryId,
      workspaceId,
      visibility: "private" as const,
      githubInstallationId: null,
      role: "owner" as const,
    }));
    privateStore.getRepository.mockResolvedValue({ ...repository, visibility: "private" });
    const auth = authenticateOwner(store);
    const { app } = createTestApp(store);
    openApps.push(app);

    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/exports/markdown`,
      headers: { cookie: auth.cookie },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
  });

  it("returns deterministic guardrails and a source-free SARIF export", async () => {
    const store = createStore();
    const graphData = await store.getSnapshotGraphData(snapshotId);
    if (!graphData) throw new Error("Expected graph data fixture.");
    vi.mocked(store.getSnapshotGraphData).mockResolvedValue({
      ...graphData,
      files: graphData.files.map((file) => ({ ...file, lineCount: 801, byteSize: 120_000 })),
    });
    const { app } = createTestApp(store);
    openApps.push(app);

    const report = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/guardrails`,
    });
    const sarif = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/guardrails/sarif`,
    });

    expect(report.statusCode).toBe(200);
    expect(report.json().data).toMatchObject({
      algorithmVersion: "architecture-guardrails-v1",
      status: "warn",
      snapshot: { id: snapshotId, commitSha: snapshot.commitSha },
      summary: { total: 1, warnings: 1 },
    });
    expect(report.json().data.findings[0]).toMatchObject({
      ruleId: "large_file",
      path: "src/index.ts",
    });
    expect(sarif.statusCode).toBe(200);
    expect(sarif.headers["content-type"]).toBe("application/sarif+json; charset=utf-8");
    expect(sarif.headers["content-disposition"]).toBe(
      `attachment; filename="repovista-${snapshotId}-guardrails.sarif"`,
    );
    expect(sarif.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(sarif.json()).toMatchObject({ version: "2.1.0" });
    expect(sarif.body).not.toContain("export function hello");
  });

  it("marks private Guardrails SARIF as non-cacheable", async () => {
    const store = createStore();
    const privateStore = store as unknown as {
      getSnapshotAccess: ReturnType<typeof vi.fn>;
    };
    privateStore.getSnapshotAccess = vi.fn(async () => ({
      repositoryId,
      workspaceId,
      visibility: "private" as const,
      githubInstallationId: null,
      role: "owner" as const,
    }));
    const auth = authenticateOwner(store);
    const { app } = createTestApp(store);
    openApps.push(app);

    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/guardrails/sarif`,
      headers: { cookie: auth.cookie },
    });

    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
  });

  it("rejects export requests until the exact snapshot is ready", async () => {
    const store = createStore();
    const graphData = await store.getSnapshotGraphData(snapshotId);
    if (!graphData) throw new Error("Expected graph data fixture.");
    vi.mocked(store.getSnapshotGraphData).mockResolvedValue({
      ...graphData,
      snapshot: { ...graphData.snapshot, commitSha: null, status: "parsing" },
    });
    const { app } = createTestApp(store);
    openApps.push(app);
    const result = await app.inject({
      method: "GET",
      url: `/v1/snapshots/${snapshotId}/exports/markdown`,
    });

    expect(result.statusCode).toBe(409);
    expect(result.json().error.code).toBe("SNAPSHOT_NOT_READY");
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
