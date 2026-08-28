import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { DomainError } from "@repovista/domain";

export const NOTIFICATION_EVENT_TYPES = [
  "guardrail_review.updated",
  "guardrail_review.cleared",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
}

function blockedIpv4(value: string): boolean {
  const parts = value.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [first, second] = parts as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function blockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(".")) {
    const mapped = normalized.slice(normalized.lastIndexOf(":") + 1);
    if (isIP(mapped) === 4) return blockedIpv4(mapped);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

/** Return true for address ranges that must never be used as webhook targets. */
export function isBlockedIp(value: string): boolean {
  const kind = isIP(value);
  if (kind === 4) return blockedIpv4(value);
  if (kind === 6) return blockedIpv6(value);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "metadata.google.com") return true;
  return isIP(host) !== 0 ? isBlockedIp(host) : false;
}

export function validateNotificationUrl(value: string, production = false): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DomainError("NOTIFICATION_URL_INVALID", "The notification URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new DomainError("NOTIFICATION_URL_INVALID", "Notification URLs must use HTTP or HTTPS.");
  }
  if (production && parsed.protocol !== "https:") {
    throw new DomainError(
      "NOTIFICATION_URL_INVALID",
      "Production notification URLs must use HTTPS.",
    );
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new DomainError(
      "NOTIFICATION_URL_INVALID",
      "Notification URLs cannot contain credentials or a fragment.",
    );
  }
  if (parsed.hostname.length > 253 || isBlockedHostname(parsed.hostname)) {
    throw new DomainError(
      "NOTIFICATION_URL_INVALID",
      "The notification URL targets a blocked or invalid host.",
    );
  }
  const normalized = parsed.toString();
  if (normalized.length > 2_048) {
    throw new DomainError(
      "NOTIFICATION_URL_INVALID",
      "Notification URLs must be at most 2,048 characters.",
    );
  }
  return normalized;
}

export function deriveNotificationSigningSecret(masterSecret: string, endpointId: string): string {
  if (masterSecret.length < 16) {
    throw new DomainError(
      "NOTIFICATION_CONFIG_INVALID",
      "NOTIFICATION_SIGNING_SECRET must contain at least 16 characters.",
    );
  }
  const digest = createHmac("sha256", masterSecret)
    .update(`repovista:notification:${endpointId}`, "utf8")
    .digest("base64url");
  return `rvwh_${digest}`;
}

export function signNotificationPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

export function notificationBackoffMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.min(10, attempt - 1));
}

export function isRetryableNotificationStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

export function notificationEventTypeForReviewAction(
  action: "guardrail_review.upsert" | "guardrail_review.clear",
): NotificationEventType {
  return action === "guardrail_review.clear"
    ? "guardrail_review.cleared"
    : "guardrail_review.updated";
}
