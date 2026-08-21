import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({
  getAll: vi.fn(() => [{ name: "repovista_session", value: "opaque-session" }]),
}));

vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { generateMetadata } from "./page";

function report(visibility: "private" | "public") {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    slug: "architecture-story",
    title: "Architecture story",
    visibility,
    repository: {},
    snapshot: {},
    content: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("share metadata", () => {
  beforeEach(() => {
    cookieStore.getAll.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards only browser cookies and prevents private reports from being indexed", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ data: report("private"), meta: { requestId: "request-metadata" } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "architecture-story" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false, noarchive: true });
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Cookie")).toBe("repovista_session=opaque-session");
    expect(new Headers(request.headers).has("Authorization")).toBe(false);
  });

  it("keeps public reports indexable and unavailable reports private", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: report("public"), meta: { requestId: "request-public" } }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "public-story" }) }),
    ).resolves.toMatchObject({ robots: { index: true, follow: true } });

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "missing-story" }) }),
    ).resolves.toMatchObject({ robots: { index: false } });
  });
});
