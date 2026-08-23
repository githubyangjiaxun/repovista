// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardrailsPanel } from "./guardrails-panel";

const snapshotId = "01900000-0000-7000-8000-000000000002";

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    headers: { "Content-Type": "application/json" },
  });
}

const report = {
  algorithmVersion: "architecture-guardrails-v1",
  snapshot: {
    id: snapshotId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    parserVersion: "tree-sitter-ts-js-py-go-v1",
  },
  generatedAt: "2026-08-23T00:00:00.000Z",
  status: "fail",
  summary: { total: 1, errors: 1, warnings: 0, infos: 0 },
  thresholds: {
    cycleMaxLength: 12,
    largeFileLines: 800,
    largeFileBytes: 102400,
    largeSymbolLines: 150,
    highFanIn: 20,
  },
  findings: [
    {
      id: "dependency_cycle:abc",
      fingerprint: "sha256:abc",
      ruleId: "dependency_cycle",
      severity: "error",
      title: "Package dependency cycle",
      message: "Packages src/a and src/b form a dependency cycle.",
      path: "src/a/index.ts",
      startLine: 3,
      endLine: 3,
      metric: { packageCount: 2, packages: "src/a,src/b" },
      evidence: [{ path: "src/a/index.ts", startLine: 3, endLine: 3, description: "Cycle edge." }],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GuardrailsPanel", () => {
  it("renders deterministic findings and opens fixed evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(report)),
    );
    const openSource = vi.fn();
    render(<GuardrailsPanel onOpenSource={openSource} snapshotId={snapshotId} />);

    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();
    expect(screen.getByText(/1 errors/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open evidence/ }));
    expect(openSource).toHaveBeenCalledWith("src/a/index.ts", 3, 3);
  });

  it("downloads SARIF with credentials", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        envelope({
          ...report,
          status: "pass",
          findings: [],
          summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"version":"2.1.0","runs":[]}', {
          headers: {
            "Content-Disposition": 'attachment; filename="guardrails.sarif"',
            "Content-Type": "application/sarif+json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchImplementation);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:guardrails"),
      revokeObjectURL: vi.fn(),
    });
    render(<GuardrailsPanel onOpenSource={vi.fn()} snapshotId={snapshotId} />);
    await screen.findByText("All checks passed");
    fireEvent.click(screen.getByRole("button", { name: "Download SARIF" }));
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
    expect(fetchImplementation.mock.calls[1]?.[1]).toMatchObject({ credentials: "include" });
  });
});
