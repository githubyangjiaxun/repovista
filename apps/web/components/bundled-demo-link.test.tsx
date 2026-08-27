// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { BUNDLED_DEMO_REPOSITORY } from "@repovista/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BundledDemoLink } from "./bundled-demo-link";

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "demo-link-test" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BundledDemoLink", () => {
  it("links directly to the ready bundled Head snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope([
          {
            id: "01900000-0000-7000-8000-000000000101",
            owner: BUNDLED_DEMO_REPOSITORY.owner,
            name: BUNDLED_DEMO_REPOSITORY.name,
            canonicalUrl: BUNDLED_DEMO_REPOSITORY.canonicalUrl,
            defaultBranch: BUNDLED_DEMO_REPOSITORY.defaultBranch,
            latestSnapshotId: "01900000-0000-7000-8000-000000000102",
            latestSnapshotStatus: "ready",
            latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
            autoUpdateEnabled: false,
            lastWebhookAt: null,
            createdAt: "2026-08-25T00:00:00.000Z",
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
        ]),
      ),
    );

    render(<BundledDemoLink />);
    const link = await screen.findByRole("link", { name: /Open the bundled demo/ });
    expect(link).toHaveAttribute(
      "href",
      "/repositories/01900000-0000-7000-8000-000000000101?snapshotId=01900000-0000-7000-8000-000000000102",
    );
  });

  it("falls back to the repository list when discovery fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    render(<BundledDemoLink />);
    expect(await screen.findByRole("link", { name: /Browse demo repositories/ })).toHaveAttribute(
      "href",
      "/repositories",
    );
  });
});
