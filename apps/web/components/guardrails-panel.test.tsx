// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { Snapshot } from "@repovista/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const baselineSnapshot: Snapshot = {
  id: "01900000-0000-7000-8000-000000000008",
  repositoryId: "01900000-0000-7000-8000-000000000001",
  commitSha: "1111111111111111111111111111111111111111",
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-ts-js-py-go-v1",
  stats: {
    files: 1,
    symbols: 1,
    edges: 0,
    languages: { typescript: 1 },
    warnings: 0,
    indexing: null,
  },
  baseSnapshotId: null,
  indexMode: "full",
  treeHash: null,
  requestedAt: "2026-08-22T00:00:00.000Z",
  readyAt: "2026-08-22T00:00:01.000Z",
  failure: null,
};

const comparison = {
  algorithmVersion: "architecture-guardrails-v1",
  base: {
    ...report,
    snapshot: {
      ...report.snapshot,
      id: baselineSnapshot.id,
      commitSha: baselineSnapshot.commitSha,
    },
  },
  head: report,
  overall: "regressed" as const,
  summary: {
    total: 3,
    added: 1,
    resolved: 1,
    unchanged: 0,
    changed: 1,
    regressions: 1,
    improvements: 1,
  },
  findings: [
    {
      key: "large_file|src/new.ts",
      status: "added" as const,
      base: null,
      head: {
        ...report.findings[0],
        id: "large_file:new",
        ruleId: "large_file" as const,
        title: "Large source file",
        message: "src/new.ts is large.",
        path: "src/new.ts",
        startLine: 1,
        endLine: 801,
      },
    },
    {
      key: "dependency_cycle|src/a,src/b",
      status: "changed" as const,
      base: report.findings[0],
      head: { ...report.findings[0], message: "The cycle changed." },
    },
    {
      key: "parse_failure|src/old.ts",
      status: "resolved" as const,
      base: {
        ...report.findings[0],
        id: "parse_failure:old",
        ruleId: "parse_failure" as const,
        severity: "warning" as const,
        title: "File was not fully parsed",
        message: "src/old.ts was not fully parsed.",
        path: "src/old.ts",
        startLine: 1,
        endLine: 1,
      },
      head: null,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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

  it("compares a selected Ready baseline and opens evidence on both snapshots", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(report);
      if (url.includes(`/v1/snapshots/${snapshotId}/guardrails/compare`)) {
        expect(url).toContain(`baseSnapshotId=${baselineSnapshot.id}`);
        return envelope(comparison);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImplementation);
    const onOpenSnapshotSource = vi.fn();
    render(
      <GuardrailsPanel
        availableSnapshots={[baselineSnapshot]}
        onOpenSnapshotSource={onOpenSnapshotSource}
        onOpenSource={vi.fn()}
        snapshotId={snapshotId}
      />,
    );

    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Baseline snapshot" }), {
      target: { value: baselineSnapshot.id },
    });
    expect(await screen.findByText("Baseline comparison: regressed")).toBeInTheDocument();
    expect(screen.getByText(/1 added · 1 resolved · 1 changed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Base · src\/a\/index\.ts:3/ }));
    fireEvent.click(screen.getByRole("button", { name: /Head · src\/new\.ts:1/ }));
    expect(onOpenSnapshotSource).toHaveBeenNthCalledWith(
      1,
      baselineSnapshot.id,
      "src/a/index.ts",
      3,
      3,
    );
    expect(onOpenSnapshotSource).toHaveBeenNthCalledWith(2, snapshotId, "src/new.ts", 1, 801);
  });

  it("shows comparison request IDs without hiding the current report", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(report);
      return new Response(
        JSON.stringify({
          error: {
            code: "GUARDRAIL_COMPARISON_INCOMPATIBLE",
            message: "The snapshots use different parser versions.",
            requestId: "compare-request-42",
            retryable: false,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchImplementation);
    render(
      <GuardrailsPanel
        availableSnapshots={[baselineSnapshot]}
        onOpenSource={vi.fn()}
        snapshotId={snapshotId}
      />,
    );
    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Baseline snapshot" }), {
      target: { value: baselineSnapshot.id },
    });
    expect(
      await screen.findByText(
        "The snapshots use different parser versions. Request ID: compare-request-42",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Package dependency cycle")).toBeInTheDocument();
  });

  it("ignores an older comparison response after the baseline changes", async () => {
    const secondBaseline: Snapshot = {
      ...baselineSnapshot,
      id: "01900000-0000-7000-8000-000000000009",
      commitSha: "2222222222222222222222222222222222222222",
      requestedAt: "2026-08-21T00:00:00.000Z",
      readyAt: "2026-08-21T00:00:01.000Z",
    };
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(report);
      if (url.includes(`baseSnapshotId=${baselineSnapshot.id}`)) return firstRequest.promise;
      if (url.includes(`baseSnapshotId=${secondBaseline.id}`)) return secondRequest.promise;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImplementation);
    render(
      <GuardrailsPanel
        availableSnapshots={[baselineSnapshot, secondBaseline]}
        onOpenSource={vi.fn()}
        snapshotId={snapshotId}
      />,
    );
    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();

    const selector = screen.getByRole("combobox", { name: "Baseline snapshot" });
    fireEvent.change(selector, { target: { value: baselineSnapshot.id } });
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
    fireEvent.change(selector, { target: { value: secondBaseline.id } });
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(3));

    const improvedComparison = {
      ...comparison,
      base: {
        ...comparison.base,
        snapshot: {
          ...comparison.base.snapshot,
          id: secondBaseline.id,
          commitSha: secondBaseline.commitSha,
        },
      },
      overall: "improved" as const,
      summary: {
        total: 1,
        added: 0,
        resolved: 1,
        unchanged: 0,
        changed: 0,
        regressions: 0,
        improvements: 1,
      },
      findings: [comparison.findings[2]],
    };
    await act(async () => secondRequest.resolve(envelope(improvedComparison)));
    expect(await screen.findByText("Baseline comparison: improved")).toBeInTheDocument();

    await act(async () => firstRequest.resolve(envelope(comparison)));
    await waitFor(() =>
      expect(screen.getByText("Baseline comparison: improved")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Baseline comparison: regressed")).not.toBeInTheDocument();
  });
});
