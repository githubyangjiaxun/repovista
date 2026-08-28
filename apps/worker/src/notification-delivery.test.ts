import type { ClaimedNotificationDelivery } from "@repovista/database";
import { describe, expect, it, vi } from "vitest";
import {
  executeNextNotificationDelivery,
  executeNotificationDelivery,
  type NotificationDeliveryConfig,
  type NotificationDeliveryDependencies,
  type NotificationDeliveryStore,
} from "./notification-delivery.js";

const delivery: ClaimedNotificationDelivery = {
  id: "01900000-0000-7000-8000-000000000301",
  workspaceId: "01900000-0000-7000-8000-000000000302",
  endpointId: "01900000-0000-7000-8000-000000000303",
  url: "https://hooks.example.com/repovista",
  eventType: "guardrail_review.updated",
  eventKey: "123",
  payload: {
    schemaVersion: "repovista.notification.v1",
    eventId: "123",
    eventType: "guardrail_review.updated",
    workspaceId: "01900000-0000-7000-8000-000000000302",
  },
  attemptCount: 1,
  maxAttempts: 3,
};

const config: NotificationDeliveryConfig = {
  APP_ENV: "development",
  JOB_LEASE_SECONDS: 30,
  NOTIFICATION_REQUEST_TIMEOUT_MS: 1_000,
  NOTIFICATION_SIGNING_SECRET: "master-secret-012345",
  WORKER_ID: "notification-test-worker",
};

function createStore(
  overrides: Partial<NotificationDeliveryStore> = {},
): NotificationDeliveryStore {
  return {
    claimNotificationDelivery: vi.fn(async () => delivery),
    heartbeatNotificationDelivery: vi.fn(async () => true),
    completeNotificationDelivery: vi.fn(async () => true),
    failNotificationDelivery: vi.fn(async () => "queued" as const),
    ...overrides,
  };
}

function dependencies(
  fetchImplementation: typeof fetch,
  overrides: Partial<NotificationDeliveryDependencies> = {},
): NotificationDeliveryDependencies {
  return {
    fetch: fetchImplementation,
    lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("notification delivery worker", () => {
  it("claims, signs, and completes a successful delivery", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchImplementation = vi.fn(async (url: string | URL, init?: RequestInit) => {
      request = { url: String(url), init: init ?? {} };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const store = createStore();

    await expect(
      executeNotificationDelivery(store, delivery, config, dependencies(fetchImplementation)),
    ).resolves.toBe("succeeded");
    expect(store.completeNotificationDelivery).toHaveBeenCalledWith(
      delivery.id,
      config.WORKER_ID,
      204,
    );
    expect(store.failNotificationDelivery).not.toHaveBeenCalled();
    expect(request?.url).toBe(delivery.url);
    expect(request?.init.method).toBe("POST");
    const headers = new Headers(request?.init.headers);
    expect(headers.get("X-RepoVista-Event")).toBe(delivery.eventType);
    expect(headers.get("X-RepoVista-Delivery")).toBe(delivery.id);
    expect(headers.get("X-RepoVista-Timestamp")).toBe("1700000000");
    expect(headers.get("X-RepoVista-Signature")).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("queues transient HTTP failures and permanently fails client errors", async () => {
    const retryStore = createStore({
      failNotificationDelivery: vi.fn(async () => "queued" as const),
    });
    const retryFetch = vi.fn(
      async () => new Response("busy", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(
      executeNotificationDelivery(retryStore, delivery, config, dependencies(retryFetch)),
    ).resolves.toBe("failed");
    expect(retryStore.failNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429, retryable: true }),
    );

    const permanentStore = createStore({
      failNotificationDelivery: vi.fn(async () => "failed" as const),
    });
    const permanentFetch = vi.fn(
      async () => new Response("bad", { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      executeNotificationDelivery(permanentStore, delivery, config, dependencies(permanentFetch)),
    ).resolves.toBe("failed");
    expect(permanentStore.failNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, retryable: false }),
    );
  });

  it("blocks DNS results in private networks and does not call fetch", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const store = createStore();
    await expect(
      executeNotificationDelivery(
        store,
        delivery,
        config,
        dependencies(fetchImplementation, {
          lookup: async () => [{ address: "10.0.0.8", family: 4 }],
        }),
      ),
    ).resolves.toBe("failed");
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(store.failNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, statusCode: null }),
    );
  });

  it("does not claim work when signing is not configured", async () => {
    const store = createStore();
    await expect(
      executeNextNotificationDelivery(store, { ...config, NOTIFICATION_SIGNING_SECRET: undefined }),
    ).resolves.toBe(false);
    expect(store.claimNotificationDelivery).not.toHaveBeenCalled();
  });
});
