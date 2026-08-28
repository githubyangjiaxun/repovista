import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { emptyCliConfig, loadCliConfig, saveCliConfig, upsertCliProfile } from "./config.js";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const fileId = "01900000-0000-7000-8000-000000000004";
const symbolId = "01900000-0000-7000-8000-000000000005";
const messageId = "01900000-0000-7000-8000-000000000006";
const userId = "01900000-0000-7000-8000-000000000010";
const profileId = "01900000-0000-7000-8000-000000000011";
const subjectKey = `sha256:${"c".repeat(64)}`;

const guardrailProfile = {
  id: profileId,
  workspaceId: "01900000-0000-7000-8000-000000000012",
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
  createdBy: userId,
  createdAt: "2026-08-24T00:00:00.000Z",
};

const defaultGuardrailProfile = {
  ...guardrailProfile,
  id: "00000000-0000-7000-8000-000000000003",
  workspaceId: null,
  profileKey: "default",
  name: "Default architecture guardrails",
  description: "The deterministic RepoVista baseline thresholds.",
  version: 1,
  thresholds: {
    cycleMaxLength: 12,
    largeFileLines: 800,
    largeFileBytes: 102_400,
    largeSymbolLines: 150,
    highFanIn: 20,
  },
  fingerprint: `sha256:${"b".repeat(64)}`,
  builtIn: true,
  createdBy: null,
};

const queuedJob = {
  id: jobId,
  snapshotId,
  type: "index_snapshot",
  status: "queued",
  phase: null,
  progress: 0,
  processed: null,
  total: null,
  retryable: false,
  error: null,
};

const succeededJob = {
  ...queuedJob,
  status: "succeeded",
  phase: "completed",
  progress: 1,
  processed: 12,
  total: 12,
};

const retrievalTrace = {
  requestedMode: "hybrid",
  usedChannels: ["text", "symbol"],
  degraded: true,
  degradationReason: "provider_disabled",
  channels: [
    { channel: "text", status: "used", candidateCount: 1, reason: null, latencyMs: 1 },
    { channel: "symbol", status: "used", candidateCount: 1, reason: null, latencyMs: 1 },
    {
      channel: "semantic",
      status: "unavailable",
      candidateCount: 0,
      reason: "provider_disabled",
      latencyMs: 0,
    },
  ],
  embeddingIndex: null,
};

const snapshot = {
  id: snapshotId,
  repositoryId,
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-ts-v1",
  stats: {
    files: 12,
    symbols: 30,
    edges: 24,
    languages: { typescript: 12 },
    warnings: 0,
    indexing: null,
  },
  baseSnapshotId: null,
  indexMode: "full",
  treeHash: null,
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:03.000Z",
  failure: null,
};

const guardrailFinding = {
  id: "large_file:abc",
  fingerprint: `sha256:${"d".repeat(64)}`,
  ruleId: "large_file",
  severity: "warning",
  title: "Large source file",
  message: "src/index.ts is large.",
  path: "src/index.ts",
  startLine: 1,
  endLine: 801,
  metric: { lines: 801, bytes: 120000 },
  evidence: [{ path: "src/index.ts", startLine: 1, endLine: 801, description: "File size." }],
} as const;

function guardrailExplanationFixture(
  id: string,
  targetSnapshotId: string,
  commitSha: string,
  summary: string,
) {
  return {
    id,
    subjectKey,
    snapshot: {
      id: targetSnapshotId,
      commitSha,
      parserVersion: snapshot.parserVersion,
      algorithmVersion: "architecture-guardrails-v1",
    },
    profile: defaultGuardrailProfile,
    profileFingerprint: defaultGuardrailProfile.fingerprint,
    finding: guardrailFinding,
    answer: {
      summary,
      steps: [{ text: "Inspect the fixed source range.", evidenceIds: ["guardrail-evidence:1"] }],
      limitations: ["AI does not change the Finding."],
      status: "grounded",
      citations: [
        {
          evidenceId: "guardrail-evidence:1",
          path: guardrailFinding.path,
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
  } as const;
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-1" } }), {
    headers: { "Content-Type": "application/json" },
  });
}

function harness(fetchImplementation: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    dependencies: {
      env: {},
      fetch: fetchImplementation,
      output: {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      },
      sleep: vi.fn(async () => undefined),
    },
    stderr,
    stdout,
  };
}

describe("RepoVista CLI", () => {
  it("reports the released CLI version without contacting the API", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const { dependencies, stdout, stderr } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(["--version"], dependencies);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["1.4.0"]);
    expect(stderr).toEqual([]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("queues an analysis with ref and repeated ignore paths", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      envelope({ repositoryId, snapshotId, jobId, status: "queued" }),
    );
    const { dependencies, stderr, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      [
        "analyze",
        "https://github.com/acme/demo",
        "--ref",
        "main",
        "--ignore",
        "dist",
        "--ignore=generated",
        "--api-url",
        "http://api.example/",
        "--json",
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({ repositoryId, snapshotId, jobId });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("http://api.example/v1/repositories");
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      url: "https://github.com/acme/demo",
      ref: "main",
      ignore: ["dist", "generated"],
    });
  });

  it("waits for indexing and returns the immutable snapshot", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ repositoryId, snapshotId, jobId, status: "queued" }))
      .mockResolvedValueOnce(envelope(queuedJob))
      .mockResolvedValueOnce(envelope(succeededJob))
      .mockResolvedValueOnce(envelope(snapshot));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["analyze", "https://github.com/acme/demo", "--wait", "--poll-interval", "1ms", "--json"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.join("\n"));
    expect(result.job.status).toBe("succeeded");
    expect(result.snapshot).toMatchObject({ id: snapshotId, status: "ready" });
    expect(dependencies.sleep).toHaveBeenCalledWith(1);
  });

  it("returns a distinct exit code for a failed remote job", async () => {
    const failedJob = {
      ...queuedJob,
      status: "failed",
      phase: "cloning",
      error: { code: "CLONE_FAILED", message: "Repository could not be cloned." },
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(failedJob));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(["status", jobId, "--json"], dependencies);

    expect(exitCode).toBe(3);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({
      status: "failed",
      error: { code: "CLONE_FAILED" },
    });
  });

  it("prints grounded answers with source ranges", async () => {
    const result = {
      messageId,
      answer: {
        summary: "The server starts in src/server.ts.",
        steps: [{ text: "The entry point calls listen().", evidenceIds: ["evidence-1"] }],
        limitations: [],
        status: "grounded",
        citations: [
          {
            evidenceId: "evidence-1",
            path: "src/server.ts",
            symbol: "start",
            startLine: 10,
            endLine: 14,
            quote: "await app.listen();",
          },
        ],
        provider: "fake",
        model: "evidence-only-v1",
      },
      evidence: [
        {
          id: "evidence-1",
          snapshotId,
          commitSha: snapshot.commitSha,
          fileId,
          path: "src/server.ts",
          symbolId,
          symbol: "start",
          startLine: 10,
          endLine: 14,
          content: "await app.listen();",
          contentHash: "sha256:evidence",
          score: 1,
          signals: [
            { channel: "text", rank: 1, rawScore: 1 },
            { channel: "symbol", rank: 1, rawScore: 1 },
          ],
        },
      ],
      trace: retrievalTrace,
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(result));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["ask", repositoryId, "Where", "does", "the", "server", "start?", "--provider", "fake"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("src/server.ts:10-14 (start)");
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      question: "Where does the server start?",
      provider: "fake",
    });
  });

  it("searches an immutable snapshot with explicit mode and transparent ranking", async () => {
    const result = {
      query: "where is response compression",
      trace: retrievalTrace,
      results: [
        {
          id: "evidence-1",
          snapshotId,
          commitSha: snapshot.commitSha,
          fileId,
          path: "src/server.ts",
          symbolId,
          symbol: "start",
          startLine: 10,
          endLine: 14,
          content: "app.register(compression);",
          contentHash: "sha256:evidence",
          score: 0.032,
          signals: [
            { channel: "text", rank: 2, rawScore: 0.2 },
            { channel: "symbol", rank: 1, rawScore: 0.9 },
          ],
        },
      ],
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(result));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      [
        "search",
        snapshotId,
        "where",
        "is",
        "response",
        "compression",
        "--mode",
        "hybrid",
        "--limit",
        "5",
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("src/server.ts:10-14");
    expect(stdout.join("\n")).toContain("text#2:0.2000");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/v1/snapshots/${snapshotId}/search?q=where+is+response+compression&mode=hybrid&limit=5`,
    );
  });

  it("queues an embedding index and waits for its job", async () => {
    const embeddingIndex = {
      id: "01900000-0000-7000-8000-000000000010",
      snapshotId,
      provider: "ollama",
      model: "nomic-embed-text",
      inputVersion: "code-chunk-v1",
      status: "queued",
      dimensions: null,
      totalChunks: 12,
      embeddedChunks: 0,
      revision: 1,
      jobId,
      failure: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      readyAt: null,
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope({ embeddingIndex, jobId, reused: false }))
      .mockResolvedValueOnce(envelope(queuedJob))
      .mockResolvedValueOnce(envelope(succeededJob));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["embed", snapshotId, "--wait", "--poll-interval", "1ms", "--json"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({
      embeddingIndex: { id: embeddingIndex.id },
      job: { status: "succeeded" },
    });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/v1/snapshots/${snapshotId}/embeddings`,
    );
  });

  it("prints guardrails, writes SARIF, and returns exit code 2 for errors", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "repovista-guardrails-"));
    const sarifPath = path.join(directory, "report.sarif");
    const report = {
      algorithmVersion: "architecture-guardrails-v1",
      snapshot: {
        id: snapshotId,
        commitSha: snapshot.commitSha,
        parserVersion: snapshot.parserVersion,
      },
      generatedAt: snapshot.readyAt,
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
          evidence: [
            {
              path: "src/a/index.ts",
              startLine: 3,
              endLine: 3,
              description: "Cycle edge.",
            },
          ],
        },
      ],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(report))
      .mockResolvedValueOnce(
        new Response('{"version":"2.1.0","runs":[]}', {
          headers: {
            "Content-Type": "application/sarif+json",
            "Content-Disposition": 'attachment; filename="guardrails.sarif"',
          },
        }),
      );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    try {
      const exitCode = await runCli(["guardrails", snapshotId, "--sarif", sarifPath], dependencies);
      expect(exitCode).toBe(2);
      expect(stdout.join("\n")).toContain("dependency_cycle");
      expect(stdout.join("\n")).toContain(`SARIF: ${sarifPath}`);
      expect(await readFile(sarifPath, "utf8")).toContain('"version":"2.1.0"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns zero for a clean guardrails report", async () => {
    const clean = {
      algorithmVersion: "architecture-guardrails-v1",
      snapshot: {
        id: snapshotId,
        commitSha: snapshot.commitSha,
        parserVersion: snapshot.parserVersion,
      },
      generatedAt: snapshot.readyAt,
      status: "pass",
      summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
      thresholds: {
        cycleMaxLength: 12,
        largeFileLines: 800,
        largeFileBytes: 102400,
        largeSymbolLines: 150,
        highFanIn: 20,
      },
      findings: [],
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(clean));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    const exitCode = await runCli(["guardrails", snapshotId, "--json"], dependencies);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({ status: "pass" });
  });

  it("lists and mutates human Guardrail reviews without changing CI semantics", async () => {
    const review = {
      findingId: guardrailFinding.id,
      subjectKey,
      status: "accepted_risk" as const,
      note: "Known boundary",
      reviewer: { userId, login: "reviewer", displayName: "Reviewer" },
      reviewedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const reviews = {
      snapshot: { id: snapshotId, commitSha: snapshot.commitSha },
      reviews: [review],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(reviews))
      .mockResolvedValueOnce(envelope(review))
      .mockResolvedValueOnce(
        envelope({
          ...review,
          status: "unreviewed",
          note: "",
          reviewer: null,
          reviewedAt: null,
          updatedAt: null,
        }),
      );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    expect(await runCli(["guardrails", "reviews", "list", snapshotId], dependencies)).toBe(0);
    expect(stdout.join("\n")).toContain("Reviewed: 1/1");
    expect(stdout.join("\n")).toContain(
      "Deterministic Guardrail status and CI decisions are unchanged by reviews.",
    );
    stdout.length = 0;
    expect(
      await runCli(
        [
          "guardrails",
          "reviews",
          "set",
          snapshotId,
          guardrailFinding.id,
          "accepted_risk",
          "--note",
          "Known boundary",
        ],
        dependencies,
      ),
    ).toBe(0);
    expect(stdout.join("\n")).toContain("accepted_risk");
    stdout.length = 0;
    expect(
      await runCli(
        ["guardrails", "reviews", "clear", snapshotId, guardrailFinding.id],
        dependencies,
      ),
    ).toBe(0);
    expect(stdout.join("\n")).toContain("cleared (unreviewed)");
    expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain("/guardrails/reviews/");
    expect(
      JSON.parse(String((fetchImplementation.mock.calls[1]?.[1] as RequestInit).body)),
    ).toEqual({ status: "accepted_risk", note: "Known boundary" });
  });

  it("applies a bounded batch review with an idempotency key", async () => {
    const batch = {
      batchId: jobId,
      snapshot: { id: snapshotId, commitSha: snapshot.commitSha },
      applied: [
        {
          findingId: guardrailFinding.id,
          subjectKey,
          status: "accepted_risk" as const,
          noteLength: 14,
          changed: true,
        },
      ],
      changed: 1,
      unchanged: 0,
      idempotentReplay: false,
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(batch));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    const exitCode = await runCli(
      [
        "guardrails",
        "reviews",
        "batch",
        snapshotId,
        "--item",
        `${guardrailFinding.id}=accepted_risk`,
        "--note",
        "Known boundary",
        "--idempotency-key",
        "batch-42",
      ],
      dependencies,
    );
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Guardrail review batch applied");
    expect(stdout.join("\n")).toContain("Changed: 1 · Unchanged: 0");
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe("batch-42");
    expect(JSON.parse(String(request.body))).toEqual({
      items: [{ findingId: guardrailFinding.id, status: "accepted_risk", note: "Known boundary" }],
    });
  });

  it("supports colon-delimited batch items without truncating colon-containing Finding IDs", async () => {
    const batch = {
      batchId: jobId,
      snapshot: { id: snapshotId, commitSha: snapshot.commitSha },
      applied: [
        {
          findingId: guardrailFinding.id,
          subjectKey,
          status: "acknowledged" as const,
          noteLength: 0,
          changed: true,
        },
      ],
      changed: 1,
      unchanged: 0,
      idempotentReplay: false,
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(batch));
    const { dependencies } = harness(fetchImplementation as typeof fetch);
    expect(
      await runCli(
        [
          "guardrails",
          "reviews",
          "batch",
          snapshotId,
          "--item",
          `${guardrailFinding.id}:acknowledged`,
        ],
        dependencies,
      ),
    ).toBe(0);
    expect(
      JSON.parse(String((fetchImplementation.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual({
      items: [{ findingId: guardrailFinding.id, status: "acknowledged", note: "" }],
    });
  });

  it("writes a separate review JSON export with restrictive file permissions", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "repovista-guardrails-json-"));
    const jsonPath = path.join(directory, "report.json");
    const clean = {
      algorithmVersion: "architecture-guardrails-v1",
      snapshot: {
        id: snapshotId,
        commitSha: snapshot.commitSha,
        parserVersion: snapshot.parserVersion,
      },
      generatedAt: snapshot.readyAt,
      status: "pass" as const,
      summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
      thresholds: {
        cycleMaxLength: 12,
        largeFileLines: 800,
        largeFileBytes: 102400,
        largeSymbolLines: 150,
        highFanIn: 20,
      },
      findings: [],
    };
    const exported = {
      schemaVersion: "repovista.guardrails.v1",
      deterministic: clean,
      reviews: [],
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(clean))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(exported), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="guardrails.json"',
          },
        }),
      );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    try {
      expect(
        await runCli(["guardrails", snapshotId, "--json-export", jsonPath], dependencies),
      ).toBe(0);
      expect(JSON.parse(await readFile(jsonPath, "utf8"))).toMatchObject({
        schemaVersion: "repovista.guardrails.v1",
        deterministic: { status: "pass" },
        reviews: [],
      });
      const mode = (await import("node:fs/promises"))
        .stat(jsonPath)
        .then((item) => item.mode & 0o777);
      await expect(mode).resolves.toBe(0o600);
      expect(stdout.join("\n")).toContain(`JSON export: ${jsonPath}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prints a verified Guardrail explanation with fixed provenance", async () => {
    const finding = {
      id: "large_file:abc",
      fingerprint: `sha256:${"c".repeat(64)}`,
      ruleId: "large_file",
      severity: "warning",
      title: "Large source file",
      message: "src/index.ts is large.",
      path: "src/index.ts",
      startLine: 1,
      endLine: 801,
      metric: { lines: 801, bytes: 120000 },
      evidence: [{ path: "src/index.ts", startLine: 1, endLine: 801, description: "File size." }],
    };
    const result = {
      reused: false,
      explanation: {
        id: messageId,
        subjectKey,
        snapshot: {
          id: snapshotId,
          commitSha: snapshot.commitSha,
          parserVersion: snapshot.parserVersion,
          algorithmVersion: "architecture-guardrails-v1",
        },
        profile: defaultGuardrailProfile,
        profileFingerprint: defaultGuardrailProfile.fingerprint,
        finding,
        answer: {
          summary: "The file exceeds the deterministic threshold.",
          steps: [
            { text: "Inspect the fixed source range.", evidenceIds: ["guardrail-evidence:1"] },
          ],
          limitations: ["AI does not change the Finding."],
          status: "grounded",
          citations: [
            {
              evidenceId: "guardrail-evidence:1",
              path: finding.path,
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
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(result));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    const exitCode = await runCli(
      ["guardrails", "explain", snapshotId, finding.id, "--provider", "fake"],
      dependencies,
    );
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Verified explanation");
    expect(stdout.join("\n")).toContain("guardrail-explanation-v1");
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ findingId: finding.id, provider: "fake" });
  });

  it("prints paginated verified explanation history", async () => {
    const explanation = guardrailExplanationFixture(
      messageId,
      snapshotId,
      snapshot.commitSha,
      "The file exceeds the deterministic threshold.",
    );
    const history = {
      subjectKey,
      finding: guardrailFinding,
      explanations: [
        {
          id: explanation.id,
          subjectKey,
          snapshot: explanation.snapshot,
          profileFingerprint: explanation.profileFingerprint,
          finding: guardrailFinding,
          answer: {
            status: explanation.answer.status,
            summary: explanation.answer.summary,
            provider: explanation.answer.provider,
            model: explanation.answer.model,
            stepCount: explanation.answer.steps.length,
            citationCount: explanation.answer.citations.length,
            limitationCount: explanation.answer.limitations.length,
          },
          promptVersion: explanation.promptVersion,
          createdAt: explanation.createdAt,
        },
      ],
      nextCursor: "next-page",
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(history));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      [
        "guardrails",
        "explanations",
        "history",
        snapshotId,
        guardrailFinding.id,
        "--limit",
        "10",
        "--cursor",
        "current-page",
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Verified explanation history");
    expect(stdout.join("\n")).toContain(subjectKey);
    expect(stdout.join("\n")).toContain("Next cursor: next-page");
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      `findingId=${encodeURIComponent(guardrailFinding.id)}&cursor=current-page&limit=10`,
    );
  });

  it("compares verified explanations without ranking their quality", async () => {
    const base = guardrailExplanationFixture(
      messageId,
      snapshotId,
      snapshot.commitSha,
      "The file exceeds the deterministic threshold.",
    );
    const head = {
      ...guardrailExplanationFixture(
        userId,
        repositoryId,
        "1123456789abcdef0123456789abcdef01234567",
        "The fixed file remains over the configured threshold.",
      ),
      createdAt: "2026-08-25T00:00:00.000Z",
    };
    const comparison = {
      subjectKey,
      changed: true,
      base,
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
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(comparison));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["guardrails", "explanations", "compare", repositoryId, messageId, userId],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("Verified explanation comparison: changed");
    expect(stdout.join("\n")).toContain("summary: changed");
    expect(stdout.join("\n")).toContain("does not rank explanation quality");
    expect(stdout.join("\n")).not.toContain("regressed");
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toContain(
      `baseExplanationId=${messageId}&headExplanationId=${userId}`,
    );
  });

  it("compares guardrails and returns exit code 2 for regressions", async () => {
    const clean = {
      algorithmVersion: "architecture-guardrails-v1",
      snapshot: {
        id: snapshotId,
        commitSha: snapshot.commitSha,
        parserVersion: snapshot.parserVersion,
      },
      generatedAt: snapshot.readyAt,
      status: "pass" as const,
      summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
      thresholds: {
        cycleMaxLength: 12,
        largeFileLines: 800,
        largeFileBytes: 102400,
        largeSymbolLines: 150,
        highFanIn: 20,
      },
      findings: [],
    };
    const base = {
      ...clean,
      snapshot: { ...clean.snapshot, id: snapshotId },
    };
    const head = { ...clean, snapshot: { ...clean.snapshot, id: repositoryId } };
    const comparison = {
      algorithmVersion: "architecture-guardrails-v1",
      base,
      head,
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
          head: {
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
            evidence: [
              { path: "src/index.ts", startLine: 1, endLine: 801, description: "File size." },
            ],
          },
        },
      ],
    };
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(comparison));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);
    const exitCode = await runCli(
      ["guardrails", "compare", snapshotId, repositoryId],
      dependencies,
    );
    expect(exitCode).toBe(2);
    expect(stdout.join("\n")).toContain("Guardrails comparison: regressed");
    expect(stdout.join("\n")).toContain("[added] large_file");
  });

  it("lists immutable Guardrail policy profile versions", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      envelope([defaultGuardrailProfile, guardrailProfile]),
    );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(["guardrails", "profiles"], dependencies);

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("built-in  default v1");
    expect(stdout.join("\n")).toContain("strict v2");
    expect(stdout.join("\n")).toContain(guardrailProfile.fingerprint);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "http://localhost:4000/v1/guardrail-profiles",
    );
  });

  it("creates a policy profile from bounded threshold options", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(guardrailProfile));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      [
        "guardrails",
        "profile",
        "create",
        "strict",
        "--name",
        "Strict architecture guardrails",
        "--description",
        "Lower deterministic thresholds.",
        "--cycle-max-length",
        "8",
        "--large-file-lines",
        "600",
        "--large-file-bytes",
        "80000",
        "--large-symbol-lines",
        "100",
        "--high-fan-in",
        "15",
        "--json",
      ],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toMatchObject({ id: profileId, version: 2 });
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({
      profileKey: "strict",
      name: "Strict architecture guardrails",
      description: "Lower deterministic thresholds.",
      thresholds: guardrailProfile.thresholds,
    });
  });

  it("assigns the built-in default only to future repository snapshots", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => envelope(defaultGuardrailProfile));
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["guardrails", "profile", "assign", repositoryId, "default"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("default v1 for new snapshots");
    expect(stdout.join("\n")).toContain("Existing snapshots keep their original policy profile.");
    const request = fetchImplementation.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("PUT");
    expect(JSON.parse(String(request.body))).toEqual({ profileId: null });
  });

  it("rejects reserved or out-of-range profile inputs before contacting the API", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const reserved = harness(fetchImplementation as typeof fetch);
    expect(
      await runCli(
        ["guardrails", "profile", "create", "default", "--name", "Reserved"],
        reserved.dependencies,
      ),
    ).toBe(2);
    const invalid = harness(fetchImplementation as typeof fetch);
    expect(
      await runCli(
        [
          "guardrails",
          "profile",
          "create",
          "strict",
          "--name",
          "Strict",
          "--cycle-max-length",
          "1",
        ],
        invalid.dependencies,
      ),
    ).toBe(2);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects invalid search modes and limits before contacting the API", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const first = harness(fetchImplementation as typeof fetch);
    expect(
      await runCli(["search", snapshotId, "handler", "--mode", "magic"], first.dependencies),
    ).toBe(2);
    const second = harness(fetchImplementation as typeof fetch);
    expect(
      await runCli(["search", snapshotId, "handler", "--limit", "101"], second.dependencies),
    ).toBe(2);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("checks API readiness without expecting a data envelope", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(["doctor"], dependencies);

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(["RepoVista API is ready at http://localhost:4000."]);
  });

  it("accepts global options before the command", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { dependencies, stdout } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(
      ["--api-url", "https://api.example", "--json", "doctor"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toEqual({
      apiUrl: "https://api.example",
      status: "ok",
    });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://api.example/v1/health/ready");
  });

  it("rejects invalid identifiers before making a request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const { dependencies, stderr } = harness(fetchImplementation as typeof fetch);

    const exitCode = await runCli(["status", "not-a-uuid"], dependencies);

    expect(exitCode).toBe(2);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(stderr.join("\n")).toContain("Job ID must be a valid UUID");
  });

  it("logs in from injected hidden input, persists a 0600 profile, and never prints the token", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "repovista-cli-auth-"));
    const configPath = path.join(directory, "config.json");
    const token = "rv_testtoken_abcdefghijklmnopqrstuvwxyz0123456789";
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      return envelope({
        authenticated: true,
        user: {
          id: userId,
          login: "octocat",
          displayName: "Octocat",
          avatarUrl: null,
        },
        workspace: {
          id: repositoryId,
          name: "Private workspace",
          slug: "private-workspace",
          kind: "team",
          visibility: "private",
          role: "owner",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        workspaces: [],
        csrfToken: null,
        capabilities: { githubLogin: true, githubApp: true, privateRepositories: true },
      });
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const login = await runCli(["auth", "login", "--json"], {
        configPath,
        fetch: fetchImplementation,
        readToken: async () => token,
        output: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
      });

      expect(login).toBe(0);
      expect(stdout.join("\n")).not.toContain(token);
      expect(stderr.join("\n")).not.toContain(token);
      const persisted = await loadCliConfig(configPath);
      expect(persisted.profiles[repositoryId]?.token).toBe(token);
      expect((await readFile(configPath)).length).toBeGreaterThan(0);

      stdout.length = 0;
      stderr.length = 0;
      const status = await runCli(["auth", "status", "--json"], {
        configPath,
        fetch: fetchImplementation,
        output: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) },
      });
      expect(status).toBe(0);
      expect(stdout.join("\n")).not.toContain(token);
      expect(stderr.join("\n")).not.toContain(token);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a token command-line argument and keeps workspace profiles token-free in output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "repovista-cli-workspace-"));
    const configPath = path.join(directory, "config.json");
    const firstWorkspace = repositoryId;
    const secondWorkspace = snapshotId;
    let config = emptyCliConfig();
    config = upsertCliProfile(config, {
      workspaceId: firstWorkspace,
      workspaceName: "Alpha",
      apiUrl: "https://api.example",
      token: "rv_alpha_abcdefghijklmnopqrstuvwxyz0123456789",
      login: "alpha",
    });
    config = upsertCliProfile(config, {
      workspaceId: secondWorkspace,
      workspaceName: "Beta",
      apiUrl: "https://api.example",
      token: "rv_beta_abcdefghijklmnopqrstuvwxyz0123456789",
      login: "beta",
    });
    try {
      await saveCliConfig(configPath, config);
      const output: string[] = [];
      const usage = await runCli(["auth", "login", "--token", "rv_should_not_be_here"], {
        configPath,
        output: { stdout: (line) => output.push(line), stderr: (line) => output.push(line) },
      });
      expect(usage).toBe(2);
      expect(output.join("\n")).toContain("Unknown option: --token");
      expect(output.join("\n")).not.toContain("rv_should_not_be_here");

      output.length = 0;
      const listed = await runCli(["workspace", "list", "--json"], {
        configPath,
        output: { stdout: (line) => output.push(line), stderr: (line) => output.push(line) },
      });
      expect(listed).toBe(0);
      expect(output.join("\n")).not.toContain("rv_alpha_");
      expect(output.join("\n")).not.toContain("rv_beta_");
      expect(JSON.parse(output.join("\n"))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workspaceId: firstWorkspace, active: false }),
          expect.objectContaining({ workspaceId: secondWorkspace, active: true }),
        ]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
