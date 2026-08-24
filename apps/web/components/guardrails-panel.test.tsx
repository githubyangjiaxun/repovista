// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import type { AuthSession, Snapshot } from "@repovista/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiCsrfToken } from "@/lib/api";
import { GuardrailsPanel } from "./guardrails-panel";

const auth = vi.hoisted(() => ({ current: { session: null as AuthSession | null } }));
vi.mock("@/components/auth-provider", () => ({ useOptionalAuth: () => auth.current }));

const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const profileId = "01900000-0000-7000-8000-000000000003";

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    headers: { "Content-Type": "application/json" },
  });
}

const defaultProfile = {
  id: "00000000-0000-7000-8000-000000000003",
  workspaceId: null,
  profileKey: "default",
  name: "Default architecture guardrails",
  description: "The deterministic RepoVista baseline thresholds.",
  version: 1,
  algorithmVersion: "architecture-guardrails-v1",
  thresholds: {
    cycleMaxLength: 12,
    largeFileLines: 800,
    largeFileBytes: 102_400,
    largeSymbolLines: 150,
    highFanIn: 20,
  },
  fingerprint: `sha256:${"a".repeat(64)}`,
  builtIn: true,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const strictProfile = {
  ...defaultProfile,
  id: profileId,
  workspaceId: "01900000-0000-7000-8000-000000000010",
  profileKey: "strict",
  name: "Strict architecture guardrails",
  description: "Lower deterministic thresholds.",
  version: 2,
  thresholds: {
    cycleMaxLength: 8,
    largeFileLines: 600,
    largeFileBytes: 80_000,
    largeSymbolLines: 100,
    highFanIn: 15,
  },
  fingerprint: `sha256:${"b".repeat(64)}`,
  builtIn: false,
  createdBy: "01900000-0000-7000-8000-000000000011",
  createdAt: "2026-08-24T00:00:00.000Z",
};

const report = {
  algorithmVersion: "architecture-guardrails-v1",
  profile: strictProfile,
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
  profile: strictProfile,
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

function policyResponse(url: string): Response | null {
  if (url.endsWith("/v1/guardrail-profiles")) {
    return envelope([defaultProfile, strictProfile]);
  }
  if (url.endsWith(`/v1/repositories/${repositoryId}/guardrail-profile`)) {
    return envelope(strictProfile);
  }
  return null;
}

function standardFetch(reportValue: typeof report = report) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const policy = policyResponse(url);
    if (policy) return policy;
    if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(reportValue);
    throw new Error(`Unexpected request: ${url}`);
  });
}

function authenticatedSession(role: "owner" | "editor" | "viewer"): AuthSession {
  const workspace = {
    id: "01900000-0000-7000-8000-000000000010",
    name: "Architecture team",
    slug: "architecture-team",
    kind: "team" as const,
    visibility: "private" as const,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    authenticated: true,
    user: {
      id: "01900000-0000-7000-8000-000000000011",
      login: "architect",
      displayName: "Architect",
      avatarUrl: null,
    },
    workspace,
    workspaces: [workspace],
    csrfToken: "csrf_test_abcdefghijklmnopqrstuvwxyz0123456789",
    capabilities: { githubLogin: true, githubApp: true, privateRepositories: true },
  };
}

beforeEach(() => {
  auth.current.session = null;
  setApiCsrfToken(null);
});

afterEach(() => {
  cleanup();
  setApiCsrfToken(null);
  vi.unstubAllGlobals();
});

describe("GuardrailsPanel", () => {
  it("renders deterministic findings and opens fixed evidence", async () => {
    vi.stubGlobal("fetch", standardFetch());
    const openSource = vi.fn();
    render(
      <GuardrailsPanel
        onOpenSource={openSource}
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );

    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();
    expect(screen.getByText(/1 errors/)).toBeInTheDocument();
    expect(screen.getByText("strict v2")).toBeInTheDocument();
    expect(screen.getByTitle(strictProfile.fingerprint)).toHaveTextContent("sha256:bbbbbbbbbbbb");
    fireEvent.click(screen.getByRole("button", { name: /Open evidence/ }));
    expect(openSource).toHaveBeenCalledWith("src/a/index.ts", 3, 3);
  });

  it("lets Editors assign a reviewed profile only to future Snapshots", async () => {
    auth.current.session = authenticatedSession("editor");
    setApiCsrfToken(auth.current.session.csrfToken);
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/guardrail-profiles")) {
        return envelope([defaultProfile, strictProfile]);
      }
      if (url.endsWith(`/v1/repositories/${repositoryId}/guardrail-profile`)) {
        if (init?.method === "PUT") return envelope(defaultProfile);
        return envelope(strictProfile);
      }
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(report);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImplementation);
    render(
      <GuardrailsPanel
        onOpenSource={vi.fn()}
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );

    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();
    const selector = await screen.findByRole("combobox", {
      name: "Repository Guardrail profile",
    });
    fireEvent.change(selector, { target: { value: defaultProfile.id } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to future Snapshots" }));

    expect(
      await screen.findByText("default v1 will apply to newly created Snapshots only."),
    ).toBeInTheDocument();
    const assignment = fetchImplementation.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/v1/repositories/${repositoryId}/guardrail-profile`) &&
        init?.method === "PUT",
    );
    expect(JSON.parse(String(assignment?.[1]?.body))).toEqual({ profileId: null });
    expect(new Headers(assignment?.[1]?.headers).get("X-RepoVista-CSRF")).toBe(
      auth.current.session.csrfToken,
    );
    expect(screen.getByText(/This Snapshot is immutable/)).toBeInTheDocument();
  });

  it("keeps policy assignment read-only for Viewers", async () => {
    auth.current.session = authenticatedSession("viewer");
    vi.stubGlobal("fetch", standardFetch());
    render(
      <GuardrailsPanel
        onOpenSource={vi.fn()}
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );

    expect(await screen.findByText("Viewer access is read-only.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Repository Guardrail profile" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Apply to future Snapshots" }),
    ).not.toBeInTheDocument();
  });

  it("downloads SARIF with credentials", async () => {
    const cleanReport = {
      ...report,
      status: "pass",
      findings: [],
      summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
    };
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const policy = policyResponse(url);
      if (policy) return policy;
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(cleanReport);
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails/sarif`)) {
        return new Response('{"version":"2.1.0","runs":[]}', {
          headers: {
            "Content-Disposition": 'attachment; filename="guardrails.sarif"',
            "Content-Type": "application/sarif+json",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImplementation);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:guardrails"),
      revokeObjectURL: vi.fn(),
    });
    render(
      <GuardrailsPanel
        onOpenSource={vi.fn()}
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );
    await screen.findByText("All checks passed");
    fireEvent.click(screen.getByRole("button", { name: "Download SARIF" }));
    await waitFor(() =>
      expect(
        fetchImplementation.mock.calls.some(([input]) =>
          String(input).endsWith("/guardrails/sarif"),
        ),
      ).toBe(true),
    );
    const sarifCall = fetchImplementation.mock.calls.find(([input]) =>
      String(input).endsWith("/guardrails/sarif"),
    );
    expect(sarifCall?.[1]).toMatchObject({ credentials: "include" });
  });

  it("compares a selected Ready baseline and opens evidence on both snapshots", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const policy = policyResponse(url);
      if (policy) return policy;
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
        repositoryId={repositoryId}
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
      const policy = policyResponse(url);
      if (policy) return policy;
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
        repositoryId={repositoryId}
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
      const policy = policyResponse(url);
      if (policy) return policy;
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
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );
    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();

    const selector = screen.getByRole("combobox", { name: "Baseline snapshot" });
    fireEvent.change(selector, { target: { value: baselineSnapshot.id } });
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(4));
    fireEvent.change(selector, { target: { value: secondBaseline.id } });
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(5));

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

  it("ignores stale policy responses after the repository changes", async () => {
    const nextRepositoryId = "01900000-0000-7000-8000-000000000099";
    const teamProfile = {
      ...strictProfile,
      id: "01900000-0000-7000-8000-000000000098",
      profileKey: "team",
      name: "Team architecture guardrails",
      version: 1,
      fingerprint: `sha256:${"c".repeat(64)}`,
    };
    const oldList = deferred<Response>();
    const oldCurrent = deferred<Response>();
    let profileLists = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/v1/snapshots/${snapshotId}/guardrails`)) return envelope(report);
      if (url.endsWith("/v1/guardrail-profiles")) {
        profileLists += 1;
        return profileLists === 1 ? oldList.promise : envelope([defaultProfile, teamProfile]);
      }
      if (url.endsWith(`/v1/repositories/${repositoryId}/guardrail-profile`)) {
        return oldCurrent.promise;
      }
      if (url.endsWith(`/v1/repositories/${nextRepositoryId}/guardrail-profile`)) {
        return envelope(teamProfile);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchImplementation);
    const view = render(
      <GuardrailsPanel
        onOpenSource={vi.fn()}
        repositoryId={repositoryId}
        snapshotId={snapshotId}
      />,
    );
    expect(await screen.findByText("Package dependency cycle")).toBeInTheDocument();

    view.rerender(
      <GuardrailsPanel
        onOpenSource={vi.fn()}
        repositoryId={nextRepositoryId}
        snapshotId={snapshotId}
      />,
    );
    expect(await screen.findByText(/Current default: team v1/)).toBeInTheDocument();

    await act(async () => {
      oldList.resolve(envelope([defaultProfile, strictProfile]));
      oldCurrent.resolve(envelope(strictProfile));
    });
    await waitFor(() => expect(screen.getByText(/Current default: team v1/)).toBeInTheDocument());
    expect(screen.queryByText(/Current default: strict v2/)).not.toBeInTheDocument();
  });
});
