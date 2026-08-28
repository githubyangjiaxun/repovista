import { CSRF_COOKIE, hashSecret, SESSION_COOKIE } from "@repovista/auth";
import { loadConfig } from "@repovista/config";
import type { DatabasePool, RepoVistaStore } from "@repovista/database";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";

const workspaceId = "01900000-0000-7000-8000-000000000401";
const ownerId = "01900000-0000-7000-8000-000000000402";
const endpointId = "01900000-0000-7000-8000-000000000403";
const deliveryId = "01900000-0000-7000-8000-000000000404";
const session = "session_token_abcdefghijklmnopqrstuvwxyz123456";
const csrf = "csrf_token_abcdefghijklmnopqrstuvwxyz123456789";

const endpoint = {
  id: endpointId,
  workspaceId,
  name: "Team relay",
  url: "https://hooks.example.com/repovista",
  adapter: "generic" as const,
  eventTypes: ["guardrail_review.updated", "guardrail_review.cleared"] as const,
  enabled: true,
  createdBy: ownerId,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
};

const delivery = {
  id: deliveryId,
  workspaceId,
  endpointId,
  eventType: "guardrail_review.updated" as const,
  adapter: "generic" as const,
  eventKey: "test:event",
  status: "queued" as const,
  attemptCount: 0,
  maxAttempts: 5,
  nextAttemptAt: "2026-08-28T00:00:00.000Z",
  lastStatusCode: null,
  lastError: null,
  deliveredAt: null,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

function createStore(): RepoVistaStore {
  const store = {
    ping: vi.fn(async () => undefined),
    resolveSession: vi.fn(async () => ({
      principal: {
        kind: "session" as const,
        userId: ownerId,
        workspaceId,
        role: "owner" as const,
        scopes: ["repo:read", "repo:write", "workspace:admin"] as const,
        sessionId: "01900000-0000-7000-8000-000000000405",
        tokenId: null,
        csrfTokenHash: hashSecret(csrf),
      },
      user: { id: ownerId, login: "owner", displayName: "Owner", avatarUrl: null },
      workspace: {
        id: workspaceId,
        name: "Team",
        slug: "team",
        kind: "team" as const,
        visibility: "private" as const,
        role: "owner" as const,
        createdAt: "2026-08-28T00:00:00.000Z",
      },
    })),
    resolveApiToken: vi.fn(async () => null),
    listNotificationEndpoints: vi.fn(async () => [endpoint]),
    createNotificationEndpoint: vi.fn(async () => endpoint),
    updateNotificationEndpoint: vi.fn(async () => endpoint),
    deleteNotificationEndpoint: vi.fn(async () => undefined),
    queueNotificationTest: vi.fn(async () => delivery),
    listNotificationDeliveries: vi.fn(async () => ({ deliveries: [delivery], nextCursor: null })),
  } as unknown as RepoVistaStore;
  return store;
}

function appFor(store: RepoVistaStore) {
  const config = loadConfig({
    APP_ENV: "test",
    LOG_LEVEL: "fatal",
    MODEL_PROVIDER: "fake",
    NOTIFICATION_SIGNING_SECRET: "master-secret-012345",
  });
  return buildApp({
    config,
    pool: { end: vi.fn(async () => undefined) } as unknown as DatabasePool,
    store,
  }).app;
}

const headers = {
  cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`,
  origin: "http://localhost:3000",
  "x-repovista-csrf": csrf,
};

describe("notification API routes", () => {
  it("supports owner CRUD, one-time secret response, test queue, and delivery listing", async () => {
    const store = createStore();
    const app = appFor(store);
    try {
      const listed = await app.inject({
        method: "GET",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints`,
        headers,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data[0].id).toBe(endpointId);

      const created = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints`,
        headers,
        payload: { name: "Relay", url: "https://hooks.example.com/new" },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.signingSecret).toMatch(/^rvwh_/);
      expect(created.json().data.signingSecret).not.toContain("master-secret");

      const tested = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints/${endpointId}/test`,
        headers,
        payload: {},
      });
      expect(tested.statusCode).toBe(202);
      expect(tested.json().data.id).toBe(deliveryId);

      const deliveries = await app.inject({
        method: "GET",
        url: `/v1/workspaces/${workspaceId}/notification-deliveries?limit=20`,
        headers,
      });
      expect(deliveries.statusCode).toBe(200);
      expect(deliveries.json().data.deliveries).toHaveLength(1);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints/${endpointId}`,
        headers,
      });
      expect(deleted.statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it("rejects insecure and cross-workspace endpoint mutations", async () => {
    const store = createStore();
    const app = appFor(store);
    try {
      const insecure = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints`,
        headers,
        payload: { name: "Bad", url: "http://127.0.0.1/hook" },
      });
      expect(insecure.statusCode).toBe(400);
      expect(insecure.json().error.code).toBe("NOTIFICATION_URL_INVALID");

      const foreign = await app.inject({
        method: "GET",
        url: "/v1/workspaces/01900000-0000-7000-8000-000000000499/notification-endpoints",
        headers,
      });
      expect(foreign.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("validates Slack adapter hosts and forwards the adapter on CRUD", async () => {
    const store = createStore();
    const app = appFor(store);
    try {
      const slackUrl = "https://hooks.slack.com/services/T000/B000/fixture";
      const created = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints`,
        headers,
        payload: {
          name: "Slack relay",
          url: slackUrl,
          adapter: "slack",
          eventTypes: ["guardrail_review.batch_updated"],
        },
      });
      expect(created.statusCode).toBe(201);
      expect(store.createNotificationEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ adapter: "slack", url: slackUrl }),
      );

      const updated = await app.inject({
        method: "PATCH",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints/${endpointId}`,
        headers,
        payload: {
          name: "Slack relay updated",
          url: slackUrl,
          adapter: "slack",
          eventTypes: ["guardrail_review.updated"],
        },
      });
      expect(updated.statusCode).toBe(200);
      expect(store.updateNotificationEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ adapter: "slack", url: slackUrl }),
      );

      const rejected = await app.inject({
        method: "POST",
        url: `/v1/workspaces/${workspaceId}/notification-endpoints`,
        headers,
        payload: {
          name: "Not Slack",
          url: "https://hooks.example.com/relay",
          adapter: "slack",
        },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe("NOTIFICATION_URL_INVALID");
    } finally {
      await app.close();
    }
  });
});
