import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AppConfig } from "@repovista/config";
import type { ClaimedNotificationDelivery, RepoVistaStore } from "@repovista/database";
import { DomainError, isDomainError } from "@repovista/domain";
import {
  deriveNotificationSigningSecret,
  isBlockedHostname,
  isBlockedIp,
  isRetryableNotificationStatus,
  type NotificationAdapterId,
  renderNotificationPayload,
  signNotificationPayload,
  validateNotificationAdapterUrl,
} from "@repovista/notifications";

export type NotificationDeliveryStore = Pick<
  RepoVistaStore,
  | "claimNotificationDelivery"
  | "heartbeatNotificationDelivery"
  | "completeNotificationDelivery"
  | "failNotificationDelivery"
>;

export type NotificationDeliveryConfig = Pick<
  AppConfig,
  | "APP_ENV"
  | "JOB_LEASE_SECONDS"
  | "NOTIFICATION_REQUEST_TIMEOUT_MS"
  | "NOTIFICATION_SIGNING_SECRET"
  | "WORKER_ID"
>;

export interface NotificationDnsAddress {
  address: string;
  family: number;
}

export interface NotificationDeliveryDependencies {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<readonly NotificationDnsAddress[]>;
  now: () => number;
}

export type NotificationDeliveryOutcome = "failed" | "lease-lost" | "succeeded";

const defaultDependencies: NotificationDeliveryDependencies = {
  fetch,
  lookup: async (hostname) => {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses;
  },
  now: Date.now,
};

function safeFailureMessage(error: unknown): string {
  if (isDomainError(error)) return error.message.slice(0, 500);
  if (error instanceof Error && error.name === "AbortError") {
    return "The notification webhook request timed out.";
  }
  return "The notification webhook request failed before receiving a response.";
}

function retryableFailure(error: unknown): boolean {
  if (isDomainError(error)) return error.retryable;
  return true;
}

async function assertSafeResolvedHost(
  adapter: NotificationAdapterId,
  url: string,
  production: boolean,
  resolve: NotificationDeliveryDependencies["lookup"],
): Promise<string> {
  const normalized = validateNotificationAdapterUrl(adapter, url, production);
  const parsed = new URL(normalized);
  // URL.hostname includes brackets for IPv6 in some Node versions.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) {
    throw new DomainError(
      "NOTIFICATION_HOST_BLOCKED",
      "The notification webhook host is blocked by SSRF policy.",
    );
  }
  // Literal addresses have already been checked by validateNotificationUrl.
  if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new DomainError(
      "NOTIFICATION_HOST_BLOCKED",
      "The notification webhook host is blocked by SSRF policy.",
    );
  }
  if (hostname !== parsed.hostname || hostname.includes(":")) {
    // A literal IPv6 address is safe after the check above; no DNS lookup is
    // needed. The second condition also handles URL implementations that
    // return a bracketed hostname.
    return normalized;
  }
  let addresses: readonly NotificationDnsAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new DomainError(
      "NOTIFICATION_HOST_UNAVAILABLE",
      "The notification webhook host could not be resolved.",
      { retryable: true },
    );
  }
  if (addresses.length === 0) {
    throw new DomainError(
      "NOTIFICATION_HOST_UNAVAILABLE",
      "The notification webhook host could not be resolved.",
      { retryable: true },
    );
  }
  if (addresses.some((address) => isBlockedIp(address.address))) {
    throw new DomainError(
      "NOTIFICATION_HOST_BLOCKED",
      "The notification webhook host resolves to a blocked network address.",
    );
  }
  return normalized;
}

class DeliveryLease {
  private timer: ReturnType<typeof setInterval> | null = null;
  private renewal: Promise<void> | null = null;
  private lost = false;

  constructor(
    private readonly store: NotificationDeliveryStore,
    private readonly delivery: ClaimedNotificationDelivery,
    private readonly config: NotificationDeliveryConfig,
  ) {}

  start(onLost: () => void): void {
    const interval = Math.max(1_000, Math.floor((this.config.JOB_LEASE_SECONDS * 1_000) / 3));
    this.timer = setInterval(() => {
      void this.renew().then(() => {
        if (this.lost) onLost();
      });
    }, interval);
    this.timer.unref();
  }

  async checkpoint(): Promise<void> {
    await this.renew();
    if (this.lost) this.throwLost();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.renewal?.catch(() => undefined);
  }

  private async renew(): Promise<void> {
    if (this.lost) return;
    if (this.renewal) {
      await this.renewal;
      return;
    }
    const renewal = (async () => {
      try {
        this.lost = !(await this.store.heartbeatNotificationDelivery(
          this.delivery.id,
          this.config.WORKER_ID,
          this.config.JOB_LEASE_SECONDS,
        ));
      } catch {
        this.lost = true;
      }
    })();
    this.renewal = renewal;
    await renewal;
    if (this.renewal === renewal) this.renewal = null;
  }

  private throwLost(): never {
    throw new DomainError(
      "NOTIFICATION_DELIVERY_LEASE_LOST",
      "The notification delivery lease is no longer owned.",
      { retryable: true },
    );
  }
}

function failureDetails(error: unknown): {
  error: string;
  retryable: boolean;
  statusCode: number | null;
} {
  if (isDomainError(error)) {
    return { error: safeFailureMessage(error), retryable: error.retryable, statusCode: null };
  }
  return { error: safeFailureMessage(error), retryable: retryableFailure(error), statusCode: null };
}

export async function executeNotificationDelivery(
  store: NotificationDeliveryStore,
  delivery: ClaimedNotificationDelivery,
  config: NotificationDeliveryConfig,
  dependencies: Partial<NotificationDeliveryDependencies> = {},
): Promise<NotificationDeliveryOutcome> {
  const resolved = { ...defaultDependencies, ...dependencies };
  const lease = new DeliveryLease(store, delivery, config);
  const controller = new AbortController();
  let leaseLost = false;
  lease.start(() => {
    leaseLost = true;
    controller.abort();
  });

  try {
    await lease.checkpoint();
    if (!config.NOTIFICATION_SIGNING_SECRET) {
      throw new DomainError(
        "NOTIFICATION_CONFIG_INVALID",
        "Outbound notification signing is not configured on this worker.",
        { retryable: true },
      );
    }
    const adapter = delivery.adapter ?? "generic";
    const url = await assertSafeResolvedHost(
      adapter,
      delivery.url,
      config.APP_ENV === "production",
      resolved.lookup,
    );
    const body = JSON.stringify(renderNotificationPayload(adapter, delivery.payload));
    const timestamp = String(Math.floor(resolved.now() / 1_000));
    const secret = deriveNotificationSigningSecret(
      config.NOTIFICATION_SIGNING_SECRET,
      delivery.endpointId,
    );
    const timeout = setTimeout(() => controller.abort(), config.NOTIFICATION_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await resolved.fetch(url, {
        method: "POST",
        body,
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RepoVista-Notification/1.4",
          "X-RepoVista-Event": delivery.eventType,
          "X-RepoVista-Delivery": delivery.id,
          "X-RepoVista-Timestamp": timestamp,
          "X-RepoVista-Signature": signNotificationPayload(secret, timestamp, body),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (leaseLost) return "lease-lost";
    if (response.status >= 200 && response.status < 300) {
      const completed = await store.completeNotificationDelivery(
        delivery.id,
        config.WORKER_ID,
        response.status,
      );
      return completed ? "succeeded" : "lease-lost";
    }
    const retryable = isRetryableNotificationStatus(response.status);
    const status = await store.failNotificationDelivery({
      id: delivery.id,
      workerId: config.WORKER_ID,
      statusCode: response.status,
      error: `The notification webhook responded with HTTP ${response.status}.`,
      retryable,
    });
    return status === "queued" || status === "failed" ? "failed" : "lease-lost";
  } catch (error) {
    if (leaseLost || (isDomainError(error) && error.code === "NOTIFICATION_DELIVERY_LEASE_LOST")) {
      return "lease-lost";
    }
    const details = failureDetails(error);
    try {
      await store.failNotificationDelivery({
        id: delivery.id,
        workerId: config.WORKER_ID,
        statusCode: details.statusCode,
        error: details.error,
        retryable: details.retryable,
      });
      return "failed";
    } catch (failureError) {
      if (isDomainError(failureError) && failureError.code === "NOTIFICATION_DELIVERY_LEASE_LOST") {
        return "lease-lost";
      }
      throw failureError;
    }
  } finally {
    await lease.stop();
  }
}

export async function executeNextNotificationDelivery(
  store: NotificationDeliveryStore,
  config: NotificationDeliveryConfig,
  dependencies: Partial<NotificationDeliveryDependencies> = {},
): Promise<boolean> {
  // Leave queued rows untouched while signing is disabled. This lets an
  // operator restore the secret without losing attempts or silently marking
  // deliveries as permanently failed.
  if (!config.NOTIFICATION_SIGNING_SECRET) return false;
  const delivery = await store.claimNotificationDelivery(
    config.WORKER_ID,
    config.JOB_LEASE_SECONDS,
  );
  if (!delivery) return false;
  await executeNotificationDelivery(store, delivery, config, dependencies);
  return true;
}
