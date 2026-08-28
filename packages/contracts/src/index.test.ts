import { describe, expect, it } from "vitest";
import {
  guardrailReviewSchema,
  guardrailReviewsResponseSchema,
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
});
