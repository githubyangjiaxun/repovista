// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./auth-provider";
import { ImportRepositoryForm } from "./import-repository-form";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

function submitImportForm(): void {
  const form = screen.getByRole("button", { name: "Analyze repository" }).closest("form");
  if (!form) throw new Error("Expected the analyze button to belong to a form.");
  fireEvent.submit(form);
}

describe("ImportRepositoryForm", () => {
  beforeEach(() => {
    router.push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("rejects non-GitHub URLs before calling the API", async () => {
    render(<ImportRepositoryForm />);
    fireEvent.change(screen.getByLabelText("Public GitHub repository"), {
      target: { value: "https://example.com/acme/demo" },
    });
    submitImportForm();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use a public HTTPS github.com repository URL.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts analysis and routes to the recoverable job page", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            repositoryId: "01900000-0000-7000-8000-000000000001",
            snapshotId: "01900000-0000-7000-8000-000000000002",
            jobId: "01900000-0000-7000-8000-000000000003",
            status: "queued",
          },
          meta: { requestId: "request-1" },
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<ImportRepositoryForm initialUrl="https://github.com/acme/demo" />);

    submitImportForm();

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        "/jobs/01900000-0000-7000-8000-000000000003?repositoryId=01900000-0000-7000-8000-000000000001&snapshotId=01900000-0000-7000-8000-000000000002",
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/repositories",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("imports an installed private repository without exposing clone credentials", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/session")) {
        return new Response(
          JSON.stringify({
            data: {
              authenticated: true,
              user: {
                id: "01900000-0000-7000-8000-000000000010",
                login: "owner",
                displayName: "Owner",
                avatarUrl: null,
              },
              workspace: {
                id: "01900000-0000-7000-8000-000000000011",
                name: "Private team",
                slug: "private-team",
                kind: "team",
                visibility: "private",
                role: "owner",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              workspaces: [],
              csrfToken: "csrf_test_abcdefghijklmnopqrstuvwxyz0123456789",
              capabilities: { githubLogin: true, githubApp: true, privateRepositories: true },
            },
            meta: { requestId: "request-session" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/integrations/github/installations")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                installationId: 42,
                accountId: 7,
                accountLogin: "acme",
                accountType: "Organization",
                repositorySelection: "selected",
                suspendedAt: null,
                lastSyncedAt: null,
                repositoryCount: 1,
              },
            ],
            meta: { requestId: "request-installations" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/integrations/github/installations/42/repositories")) {
        return new Response(
          JSON.stringify({
            data: {
              repositories: [
                {
                  id: 99,
                  name: "secret-demo",
                  full_name: "acme/secret-demo",
                  private: true,
                  html_url: "https://github.com/acme/secret-demo",
                  clone_url: "https://github.com/acme/secret-demo.git",
                  default_branch: "main",
                  owner: { login: "acme" },
                },
              ],
              totalCount: 1,
            },
            meta: { requestId: "request-repositories" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/v1/repositories") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            data: {
              repositoryId: "01900000-0000-7000-8000-000000000001",
              snapshotId: "01900000-0000-7000-8000-000000000002",
              jobId: "01900000-0000-7000-8000-000000000003",
              status: "queued",
            },
            meta: { requestId: "request-import" },
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <AuthProvider>
        <ImportRepositoryForm />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("tab", { name: /Installed repositories/ }));
    const repositorySelect = await screen.findByLabelText("Installed GitHub repository");
    await waitFor(() =>
      expect(repositorySelect).toHaveValue("https://github.com/acme/secret-demo"),
    );
    expect(screen.getByText(/Private source stays inside/)).toBeInTheDocument();
    submitImportForm();

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    const request = post?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      url: "https://github.com/acme/secret-demo",
      installationId: 42,
      ignore: ["dist", "build", "docs/generated"],
    });
    expect(String(request.body)).not.toContain("clone_url");
    expect(String(request.body)).not.toContain("token");
    expect((request.headers as Headers).get("X-RepoVista-CSRF")).toBe(
      "csrf_test_abcdefghijklmnopqrstuvwxyz0123456789",
    );
  });
});
