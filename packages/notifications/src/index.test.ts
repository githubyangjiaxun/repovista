import { describe, expect, it } from "vitest";
import {
  deriveNotificationSigningSecret,
  isBlockedHostname,
  isBlockedIp,
  isRetryableNotificationStatus,
  notificationBackoffMs,
  renderNotificationPayload,
  signNotificationPayload,
  validateNotificationAdapterUrl,
  validateNotificationUrl,
} from "./index.js";

describe("notification safety and signing", () => {
  it("rejects private, loopback, link-local, and metadata addresses", () => {
    for (const value of [
      "127.0.0.1",
      "10.0.0.4",
      "172.16.0.10",
      "192.168.1.4",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
    ]) {
      expect(isBlockedIp(value)).toBe(true);
    }
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("hooks.example.com")).toBe(false);
  });

  it("validates protocol, credentials, fragments, and production HTTPS", () => {
    expect(validateNotificationUrl("https://hooks.example.com/a")).toBe(
      "https://hooks.example.com/a",
    );
    expect(() => validateNotificationUrl("http://hooks.example.com", true)).toThrow("HTTPS");
    expect(() => validateNotificationUrl("https://user:pass@hooks.example.com")).toThrow(
      "credentials",
    );
    expect(() => validateNotificationUrl("https://hooks.example.com/#fragment")).toThrow(
      "fragment",
    );
    expect(() => validateNotificationUrl("https://127.0.0.1/", false)).toThrow("blocked");
  });

  it("derives stable endpoint secrets and signs timestamp plus body", () => {
    const secret = deriveNotificationSigningSecret("master-secret-012345", "endpoint-1");
    expect(secret).toMatch(/^rvwh_[A-Za-z0-9_-]+$/);
    expect(deriveNotificationSigningSecret("master-secret-012345", "endpoint-1")).toBe(secret);
    expect(deriveNotificationSigningSecret("master-secret-012345", "endpoint-2")).not.toBe(secret);
    expect(signNotificationPayload("secret", "1700000000", '{"ok":true}')).toBe(
      "sha256=c1afc7c2df3db0690d7d75954610ed1a1d959ce96355ccb8c0a8bc09fd0cfc27",
    );
  });

  it("uses bounded exponential backoff and retries only transient statuses", () => {
    expect(notificationBackoffMs(1)).toBe(1_000);
    expect(notificationBackoffMs(2)).toBe(2_000);
    expect(notificationBackoffMs(11)).toBe(15 * 60_000);
    expect(isRetryableNotificationStatus(429)).toBe(true);
    expect(isRetryableNotificationStatus(503)).toBe(true);
    expect(isRetryableNotificationStatus(400)).toBe(false);
    expect(isRetryableNotificationStatus(301)).toBe(false);
  });

  it("keeps generic payloads lossless and renders bounded Slack blocks", () => {
    const payload = {
      schemaVersion: "repovista.notification.v1",
      eventId: "42",
      eventType: "guardrail_review.batch_updated",
      snapshotId: "snapshot-1234567890",
      commitSha: "abcdef0123456789abcdef0123456789abcdef01",
      changes: Array.from({ length: 50 }, (_, index) => ({
        findingId: `finding-${index}<unsafe>`,
        fromStatus: "unreviewed",
        toStatus: "acknowledged",
        noteChanged: index % 2 === 0,
      })),
      secret: "must-not-be-rendered",
    };
    expect(renderNotificationPayload("generic", payload)).toBe(payload);
    const rendered = renderNotificationPayload("slack", payload) as {
      text: string;
      blocks: Array<{ text?: { text?: string } }>;
    };
    expect(rendered.text).toContain("guardrail_review.batch_updated");
    expect(rendered.text).toContain("50 Findings");
    expect(JSON.stringify(rendered)).not.toContain("must-not-be-rendered");
    expect(JSON.stringify(rendered)).toContain("&lt;unsafe&gt;");
    expect(rendered.blocks.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(rendered)).toContain("note changed");
  });

  it("renders a single review transition and enforces Slack host policy", () => {
    const rendered = renderNotificationPayload("slack", {
      eventType: "guardrail_review.updated",
      findingId: "large_file:abc",
      transition: {
        fromStatus: "unreviewed",
        toStatus: "accepted_risk",
        noteChanged: false,
      },
    });
    expect(JSON.stringify(rendered)).toContain("large_file:abc");
    expect(() =>
      validateNotificationAdapterUrl("slack", "https://hooks.example.com/relay"),
    ).toThrow(/hooks\.slack/);
    expect(() =>
      validateNotificationAdapterUrl("slack", "http://hooks.slack.com/services/x"),
    ).toThrow(/HTTPS/);
    expect(() =>
      validateNotificationAdapterUrl("slack", "https://hooks.slack.com:8443/services/x"),
    ).toThrow(/default port/);
    expect(validateNotificationAdapterUrl("slack", "https://hooks.slack.com/services/x")).toBe(
      "https://hooks.slack.com/services/x",
    );
    expect(validateNotificationAdapterUrl("slack", "https://hooks.slack-gov.com/services/x")).toBe(
      "https://hooks.slack-gov.com/services/x",
    );
  });
});
