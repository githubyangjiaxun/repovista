import { describe, expect, it, vi } from "vitest";
import { ApiError, RepoVistaClient } from "./api-client.js";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const profileId = "01900000-0000-7000-8000-000000000004";
const explanationId2 = "01900000-0000-7000-8000-000000000007";
const subjectKey = `sha256:${"b".repeat(64)}`;

const guardrailProfile = {
  id: profileId,
  workspaceId: "01900000-0000-7000-8000-000000000005",
  profileKey: "strict",
  name: "Strict architecture guardrails",
  description: "Lower deterministic thresholds.",
  version: 2,
  algorithmVersion: "architecture-guardrails-v1",
  thresholds: {
    cycleMaxLength: 8,
    largeFileLines: 600,
    largeFileBytes: 80_000,
    largeSymbolLines: 100,
    highFanIn: 15,
  },
  fingerprint: `sha256:${"a".repeat(64)}`,
  builtIn: false,
  createdBy: "01900000-0000-7000-8000-000000000006",
  createdAt: "2026-08-24T00:00:00.000Z",
};

const guardrailReport = {
  algorithmVersion: "architecture-guardrails-v1",
  snapshot: {
    id: snapshotId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    parserVersion: "tree-sitter-ts-js-py-go-v1",
  },
  generatedAt: "2026-01-01T00:00:03.000Z",
  status: "warn",
  summary: { total: 1, errors: 0, warnings: 1, infos: 0 },
  thresholds: {
    cycleMaxLength: 12,
    largeFileLines: 800,
    largeFileBytes: 102400,
    largeSymbolLines: 150,
    highFanIn: 20,
  },
  findings: [
    {
      id: "large_file:abc",
      fingerprint: "sha256:abc",
      ruleId: "large_file",
      severity: "warning",
      title: "Large source file",
      message: "src/index.ts is large.",
      path: "src/index.ts",
      startLine: 1,
      endLine: 801,
      metric: { lines: 801, bytes: 120000 },
      evidence: [{ path: "src/index.ts", startLine: 1, endLine: 801, description: "File size." }],
    },
  ],
} as const;

const guardrailExplanationResult = {
  reused: false,
  explanation: {
    id: jobId,
    subjectKey,
    snapshot: {
      ...guardrailReport.snapshot,
      algorithmVersion: guardrailReport.algorithmVersion,
    },
    profile: guardrailProfile,
    profileFingerprint: guardrailProfile.fingerprint,
    finding: guardrailReport.findings[0],
    answer: {
      summary: "The file is larger than the fixed threshold.",
      steps: [{ text: "Inspect the fixed source range.", evidenceIds: ["guardrail-evidence:1"] }],
      limitations: [],
      status: "grounded",
      citations: [
        {
          evidenceId: "guardrail-evidence:1",
          path: "src/index.ts",
          symbol: null,
          startLine: 1,
          endLine: 10,
          quote: "const value = 1;",
        },
      ],
      provider: "fake",
      model: "evidence-demo-v1",
    },
    promptVersion: "guardrail-explanation-v1",
    createdAt: "2026-08-24T00:00:00.000Z",
  },
};

const guardrailExplanationHistory = {
  subjectKey,
  finding: guardrailReport.findings[0],
  explanations: [
    {
      id: jobId,
      subjectKey,
      snapshot: guardrailExplanationResult.explanation.snapshot,
      profileFingerprint: guardrailProfile.fingerprint,
      finding: {
        id: guardrailReport.findings[0].id,
        fingerprint: guardrailReport.findings[0].fingerprint,
        ruleId: guardrailReport.findings[0].ruleId,
        severity: guardrailReport.findings[0].severity,
        title: guardrailReport.findings[0].title,
        message: guardrailReport.findings[0].message,
        path: guardrailReport.findings[0].path,
        startLine: guardrailReport.findings[0].startLine,
        endLine: guardrailReport.findings[0].endLine,
      },
      answer: {
        status: "grounded",
        summary: guardrailExplanationResult.explanation.answer.summary,
        provider: "fake",
        model: "evidence-demo-v1",
        stepCount: 1,
        citationCount: 1,
        limitationCount: 0,
      },
      promptVersion: "guardrail-explanation-v1",
      createdAt: "2026-08-24T00:00:00.000Z",
    },
  ],
  nextCursor: "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI0VDAwOjAwOjAwLjAwMFoifQ",
};

function jsonResponse(payload: unknown, status = 200, requestId = "request-1"): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
    status,
  });
}

describe("RepoVistaClient", () => {
  it("posts repository imports and validates the response contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: { repositoryId, snapshotId, jobId, status: "queued" },
        meta: { requestId: "request-1" },
      }),
    );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000/",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(
      client.createRepository({
        url: "https://github.com/acme/demo",
        ref: "main",
        ignore: ["dist"],
      }),
    ).resolves.toEqual({ repositoryId, snapshotId, jobId, status: "queued" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://localhost:4000/v1/repositories",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect((request.headers as Headers).get("User-Agent")).toBe("RepoVista-CLI/1.1.0");
    expect(JSON.parse(String(request.body))).toEqual({
      url: "https://github.com/acme/demo",
      ref: "main",
      ignore: ["dist"],
    });
  });

  it("surfaces structured API failures with their request ID", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "SNAPSHOT_NOT_READY",
            message: "The snapshot is still indexing.",
            requestId: "request-failure",
            retryable: true,
          },
        },
        409,
        "request-failure",
      ),
    );
    const client = new RepoVistaClient({
      apiUrl: "https://repovista.example",
      fetch: fetchImplementation as typeof fetch,
    });

    const error = await client.getSnapshot(snapshotId).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "SNAPSHOT_NOT_READY",
      requestId: "request-failure",
      retryable: true,
      status: 409,
    });
  });

  it("rejects successful responses that drift from the shared contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: { id: jobId, status: "mystery" },
        meta: { requestId: "request-drift" },
      }),
    );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(client.getJob(jobId)).rejects.toMatchObject({
      code: "API_RESPONSE_INVALID",
      requestId: "request-drift",
    });
  });

  it("validates API origins before making a network request", () => {
    expect(() => new RepoVistaClient({ apiUrl: "file:///tmp/api" })).toThrowError(
      expect.objectContaining({ code: "API_URL_INVALID" }),
    );
  });

  it("lists, creates, and assigns versioned Guardrail policy profiles", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [guardrailProfile], meta: { requestId: "request-list" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: guardrailProfile, meta: { requestId: "request-create" } }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: guardrailProfile, meta: { requestId: "request-assign" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: guardrailProfile, meta: { requestId: "request-current" } }),
      );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      apiToken: "rv_testtoken_abcdefghijklmnopqrstuvwxyz0123456789",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(client.listGuardrailProfiles()).resolves.toEqual([guardrailProfile]);
    await expect(
      client.createGuardrailProfile({
        profileKey: guardrailProfile.profileKey,
        name: guardrailProfile.name,
        description: guardrailProfile.description,
        thresholds: guardrailProfile.thresholds,
      }),
    ).resolves.toEqual(guardrailProfile);
    await expect(client.assignRepositoryGuardrailProfile(repositoryId, profileId)).resolves.toEqual(
      guardrailProfile,
    );
    await expect(client.getRepositoryGuardrailProfile(repositoryId)).resolves.toEqual(
      guardrailProfile,
    );

    expect(fetchImplementation.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://localhost:4000/v1/guardrail-profiles",
      "http://localhost:4000/v1/guardrail-profiles",
      `http://localhost:4000/v1/repositories/${repositoryId}/guardrail-profile`,
      `http://localhost:4000/v1/repositories/${repositoryId}/guardrail-profile`,
    ]);
    const createRequest = fetchImplementation.mock.calls[1]?.[1] as RequestInit;
    expect(createRequest.method).toBe("POST");
    expect(JSON.parse(String(createRequest.body))).toEqual({
      profileKey: guardrailProfile.profileKey,
      name: guardrailProfile.name,
      description: guardrailProfile.description,
      thresholds: guardrailProfile.thresholds,
    });
    const assignRequest = fetchImplementation.mock.calls[2]?.[1] as RequestInit;
    expect(assignRequest.method).toBe("PUT");
    expect(JSON.parse(String(assignRequest.body))).toEqual({ profileId });
  });

  it("loads a guardrail report and downloads SARIF with bearer auth", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: guardrailReport, meta: { requestId: "request-guardrails" } }),
      )
      .mockResolvedValueOnce(
        new Response('{"version":"2.1.0","runs":[]}', {
          status: 200,
          headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": 'attachment; filename="guardrails.sarif"',
          },
        }),
      );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      apiToken: "rv_testtoken_abcdefghijklmnopqrstuvwxyz0123456789",
      fetch: fetchImplementation as typeof fetch,
    });

    await expect(client.getGuardrails(snapshotId)).resolves.toMatchObject({ status: "warn" });
    await expect(client.downloadGuardrailsSarif(snapshotId)).resolves.toEqual({
      body: '{"version":"2.1.0","runs":[]}',
      filename: "guardrails.sarif",
    });
    const sarifRequest = fetchImplementation.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(sarifRequest.headers).get("Authorization")).toMatch(/^Bearer rv_/);
  });

  it("creates an immutable verified Guardrail explanation", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        { data: guardrailExplanationResult, meta: { requestId: "request-explain" } },
        201,
      ),
    );
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      fetch: fetchImplementation,
    });
    await expect(
      client.createGuardrailExplanation(snapshotId, {
        findingId: guardrailReport.findings[0].id,
        provider: "fake",
      }),
    ).resolves.toEqual(guardrailExplanationResult);
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({
      findingId: guardrailReport.findings[0].id,
      provider: "fake",
    });
  });

  it("loads explanation history and compares two verified explanations", async () => {
    const head = {
      ...guardrailExplanationResult.explanation,
      id: explanationId2,
      snapshot: {
        ...guardrailExplanationResult.explanation.snapshot,
        id: repositoryId,
        commitSha: "1123456789abcdef0123456789abcdef01234567",
      },
      answer: {
        ...guardrailExplanationResult.explanation.answer,
        summary: "The fixed file remains larger than the configured threshold.",
      },
      createdAt: "2026-08-25T00:00:00.000Z",
    };
    const comparison = {
      subjectKey,
      changed: true,
      base: guardrailExplanationResult.explanation,
      head,
      differences: {
        provenance: {
          snapshotId: "changed",
          commitSha: "changed",
          parserVersion: "same",
          algorithmVersion: "same",
          profileFingerprint: "same",
          provider: "same",
          model: "same",
          promptVersion: "same",
        },
        finding: {
          id: "same",
          fingerprint: "same",
          severity: "same",
          title: "same",
          message: "same",
          path: "same",
          range: "same",
          metric: "same",
          evidence: "same",
        },
        answer: {
          status: "same",
          summary: "changed",
          steps: "same",
          limitations: "same",
          citations: "same",
        },
      },
    } as const;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: guardrailExplanationHistory, meta: { requestId: "history" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: comparison, meta: { requestId: "comparison" } }));
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      fetch: fetchImplementation,
    });

    await expect(
      client.listGuardrailExplanationHistory(snapshotId, guardrailReport.findings[0].id, {
        cursor: "next-page",
        limit: 10,
      }),
    ).resolves.toEqual(guardrailExplanationHistory);
    await expect(
      client.compareGuardrailExplanations(repositoryId, jobId, explanationId2),
    ).resolves.toEqual(comparison);

    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      `http://localhost:4000/v1/snapshots/${snapshotId}/guardrails/explanations?findingId=large_file%3Aabc&cursor=next-page&limit=10`,
    );
    expect(String(fetchImplementation.mock.calls[1]?.[0])).toBe(
      `http://localhost:4000/v1/repositories/${repositoryId}/guardrails/explanations/compare?baseExplanationId=${jobId}&headExplanationId=${explanationId2}`,
    );
  });

  it("loads a guardrail baseline comparison and validates its envelope", async () => {
    const comparison = {
      algorithmVersion: "architecture-guardrails-v1",
      base: guardrailReport,
      head: { ...guardrailReport, snapshot: { ...guardrailReport.snapshot, id: repositoryId } },
      overall: "regressed",
      summary: {
        total: 1,
        added: 1,
        resolved: 0,
        unchanged: 0,
        changed: 0,
        regressions: 1,
        improvements: 0,
      },
      findings: [
        {
          key: "large_file|src/index.ts",
          status: "added",
          base: null,
          head: guardrailReport.findings[0],
        },
      ],
    } as const;
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        `http://localhost:4000/v1/snapshots/${repositoryId}/guardrails/compare?baseSnapshotId=${snapshotId}`,
      );
      expect(new Headers(init?.headers).get("User-Agent")).toBe("RepoVista-CLI/1.1.0");
      return jsonResponse({ data: comparison, meta: { requestId: "request-compare" } });
    });
    const client = new RepoVistaClient({
      apiUrl: "http://localhost:4000",
      apiToken: "rv_testtoken_abcdefghijklmnopqrstuvwxyz0123456789",
      fetch: fetchImplementation as typeof fetch,
    });
    await expect(client.compareGuardrails(snapshotId, repositoryId)).resolves.toMatchObject({
      overall: "regressed",
      summary: { regressions: 1 },
    });
  });
});
