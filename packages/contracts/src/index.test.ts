import { describe, expect, it } from "vitest";
import {
  batchGuardrailReviewsRequestSchema,
  batchGuardrailReviewsResponseSchema,
  createNotificationEndpointResponseSchema,
  guardrailReviewHistoryPageSchema,
  guardrailReviewSchema,
  guardrailReviewsResponseSchema,
  notificationDeliveryPageSchema,
  notificationEndpointSchema,
  notificationEventTypesSchema,
  updateGuardrailReviewRequestSchema,
} from "./index.js";

const userId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const subjectKey = `sha256:${"a".repeat(64)}`;

describe("Guardrail review contracts", () => {
  it("accepts a bounded reviewed record and nullable reviewer", () => {
    const review = guardrailReviewSchema.parse({
      findingId: "large_file:abcd",
      subjectKey,
      status: "accepted_risk",
      note: "Known legacy boundary.",
      reviewer: { userId, login: "reviewer", displayName: "Reviewer" },
      reviewedAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(review.status).toBe("accepted_risk");
    expect(
      guardrailReviewsResponseSchema.parse({
        snapshot: { id: snapshotId, commitSha: "a".repeat(40) },
        reviews: [review],
      }).reviews,
    ).toHaveLength(1);
  });

  it("rejects unknown fields and overlong notes", () => {
    expect(() =>
      updateGuardrailReviewRequestSchema.parse({ status: "acknowledged", extra: true }),
    ).toThrow();
    expect(() =>
      updateGuardrailReviewRequestSchema.parse({ status: "acknowledged", note: "x".repeat(2_001) }),
    ).toThrow();
  });

  it("counts review note limits by Unicode characters", () => {
    const accepted = "🙂".repeat(2_000);
    expect(
      updateGuardrailReviewRequestSchema.parse({ status: "acknowledged", note: accepted }).note,
    ).toBe(accepted);
    expect(() =>
      updateGuardrailReviewRequestSchema.parse({ status: "acknowledged", note: `${accepted}🙂` }),
    ).toThrow(/2,000 Unicode characters/);
  });

  it("validates review history without accepting note bodies", () => {
    const entry = {
      id: 42,
      snapshotId,
      findingId: "large_file:abcd",
      subjectKey,
      action: "guardrail_review.upsert" as const,
      fromStatus: "unreviewed" as const,
      toStatus: "accepted_risk" as const,
      fromNoteLength: 0,
      toNoteLength: 12,
      noteChanged: true,
      actorKind: "session" as const,
      actorLogin: "reviewer",
      createdAt: "2026-08-28T00:00:00.000Z",
    };
    expect(guardrailReviewHistoryPageSchema.parse({ entries: [entry], nextCursor: null })).toEqual({
      entries: [entry],
      nextCursor: null,
    });
    expect(() =>
      guardrailReviewHistoryPageSchema.parse({ entries: [{ ...entry, note: "secret" }] }),
    ).toThrow();
  });

  it("validates notification endpoint, one-time secret response, and delivery page", () => {
    const endpoint = notificationEndpointSchema.parse({
      id: "01900000-0000-7000-8000-000000000003",
      workspaceId: "01900000-0000-7000-8000-000000000004",
      name: "Team relay",
      url: "https://hooks.example.com/repovista",
      eventTypes: ["guardrail_review.updated"],
      enabled: true,
      createdBy: userId,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
    });
    expect(
      createNotificationEndpointResponseSchema.parse({
        endpoint,
        signingSecret: `rvwh_${"a".repeat(43)}`,
      }).endpoint.id,
    ).toBe(endpoint.id);
    expect(() => notificationEndpointSchema.parse({ ...endpoint, eventTypes: [] })).toThrow();
    expect(() =>
      notificationEndpointSchema.parse({
        ...endpoint,
        eventTypes: ["guardrail_review.updated", "guardrail_review.updated"],
      }),
    ).toThrow(/unique/);
    expect(
      notificationDeliveryPageSchema.parse({ deliveries: [], nextCursor: null }).deliveries,
    ).toEqual([]);
    expect(endpoint.adapter).toBe("generic");
    expect(
      notificationEventTypesSchema.parse([
        "guardrail_review.updated",
        "guardrail_review.cleared",
        "guardrail_review.batch_updated",
      ]),
    ).toHaveLength(3);
    expect(() =>
      notificationEventTypesSchema.parse([
        "guardrail_review.batch_updated",
        "guardrail_review.batch_updated",
      ]),
    ).toThrow(/unique/);
  });

  it("enforces atomic batch bounds, unique findings, Unicode notes, and note-free responses", () => {
    const item = { findingId: "large_file:abcd", status: "acknowledged" as const, note: "  🙂  " };
    expect(batchGuardrailReviewsRequestSchema.parse({ items: [item] }).items[0]?.note).toBe("🙂");
    expect(
      batchGuardrailReviewsRequestSchema.parse({
        items: Array.from({ length: 50 }, (_, index) => ({
          findingId: `finding-${index}`,
          status: "false_positive" as const,
          note: "",
        })),
      }).items,
    ).toHaveLength(50);
    expect(() =>
      batchGuardrailReviewsRequestSchema.parse({
        items: Array.from({ length: 51 }, (_, index) => ({
          findingId: `finding-${index}`,
          status: "acknowledged" as const,
        })),
      }),
    ).toThrow();
    expect(() =>
      batchGuardrailReviewsRequestSchema.parse({
        items: [item, item],
      }),
    ).toThrow(/unique/);
    expect(() =>
      batchGuardrailReviewsRequestSchema.parse({
        items: [{ ...item, note: "🙂".repeat(2_001) }],
      }),
    ).toThrow(/2,000/);

    const response = {
      batchId: snapshotId,
      snapshot: { id: snapshotId, commitSha: "a".repeat(40) },
      applied: [
        {
          findingId: item.findingId,
          subjectKey,
          status: item.status,
          noteLength: 1,
          changed: true,
        },
      ],
      changed: 1,
      unchanged: 0,
      idempotentReplay: false,
    };
    expect(batchGuardrailReviewsResponseSchema.parse(response)).toMatchObject({ changed: 1 });
    expect(() =>
      batchGuardrailReviewsResponseSchema.parse({
        ...response,
        applied: [{ ...response.applied[0], note: "secret" }],
      }),
    ).toThrow();
    expect(() => batchGuardrailReviewsResponseSchema.parse({ ...response, changed: 0 })).toThrow(
      /count/,
    );
  });
});
