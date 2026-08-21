// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { AuthSession } from "@repovista/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiCsrfToken } from "@/lib/api";
import { SiteHeader } from "./site-header";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const auth = vi.hoisted(() => ({
  current: {
    session: null as AuthSession | null,
    loading: false,
    refresh: vi.fn(async () => undefined),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => auth.current }));

const workspace = {
  id: "01900000-0000-7000-8000-000000000011",
  name: "Private team",
  slug: "private-team",
  kind: "team" as const,
  visibility: "private" as const,
  role: "owner" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const authenticatedSession: AuthSession = {
  authenticated: true,
  user: {
    id: "01900000-0000-7000-8000-000000000010",
    login: "owner",
    displayName: "Owner",
    avatarUrl: null,
  },
  workspace,
  workspaces: [
    workspace,
    {
      ...workspace,
      id: "01900000-0000-7000-8000-000000000012",
      name: "Second team",
      slug: "second-team",
    },
  ],
  csrfToken: "csrf_test_abcdefghijklmnopqrstuvwxyz0123456789",
  capabilities: { githubLogin: true, githubApp: true, privateRepositories: true },
};

describe("SiteHeader", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    auth.current.loading = false;
    auth.current.session = null;
    auth.current.refresh.mockReset();
    auth.current.refresh.mockResolvedValue(undefined);
    setApiCsrfToken(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    setApiCsrfToken(null);
    vi.unstubAllGlobals();
  });

  it("shows GitHub sign-in only when login is configured", () => {
    auth.current.session = {
      authenticated: false,
      user: null,
      workspace: null,
      workspaces: [],
      csrfToken: null,
      capabilities: { githubLogin: true, githubApp: false, privateRepositories: false },
    };

    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute(
      "href",
      "http://localhost:4000/v1/auth/github/start?returnTo=%2Frepositories",
    );
  });

  it("switches workspace with CSRF and refreshes workspace-scoped navigation", async () => {
    auth.current.session = authenticatedSession;
    setApiCsrfToken(authenticatedSession.csrfToken);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: workspace, meta: { requestId: "request-switch" } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<SiteHeader />);

    fireEvent.change(screen.getByLabelText("Current workspace"), {
      target: { value: "01900000-0000-7000-8000-000000000012" },
    });

    await waitFor(() => expect(auth.current.refresh).toHaveBeenCalled());
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("PUT");
    expect(request.credentials).toBe("include");
    expect((request.headers as Headers).get("X-RepoVista-CSRF")).toBe(
      authenticatedSession.csrfToken,
    );
    expect(JSON.parse(String(request.body))).toEqual({
      workspaceId: "01900000-0000-7000-8000-000000000012",
    });
    expect(router.push).toHaveBeenCalledWith("/repositories");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("logs out successfully on an empty 204 response", async () => {
    auth.current.session = authenticatedSession;
    setApiCsrfToken(authenticatedSession.csrfToken);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: /Logout/ }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(auth.current.refresh).toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });
});
