// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
