import { describe, expect, it } from "vitest";
import {
  BUILT_IN_GUARDRAIL_PROFILE,
  buildGuardrailReport,
  buildSarifReport,
  compareGuardrailExplanations,
  compareGuardrailReports,
  DEFAULT_GUARDRAIL_THRESHOLDS,
  guardrailFindingSubjectKey,
  guardrailProfileFingerprint,
} from "./index.js";

const snapshot = {
  id: "01900000-0000-7000-8000-000000000001",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  parserVersion: "tree-sitter-ts-js-py-go-v1",
  requestedAt: "2026-08-23T00:00:00.000Z",
  readyAt: "2026-08-23T00:00:01.000Z",
};

const file = (id: string, path: string, lineCount = 10, parseStatus = "parsed") => ({
  id,
  path,
  language: "typescript",
  byteSize: lineCount * 20,
  lineCount,
  parseStatus,
});

const moduleSymbol = (id: string, fileId: string, path: string) => ({
  id,
  fileId,
  path,
  kind: "module",
  name: path.split("/").at(-1) ?? path,
  qualifiedName: path,
  startLine: 1,
  endLine: 1,
});

const edge = (
  id: string,
  fromSymbolId: string,
  toSymbolId: string | null,
  relationType = "imports",
  evidence: Record<string, unknown> = {},
) => ({
  id,
  fromSymbolId,
  toSymbolId,
  unresolvedTarget: toSymbolId ? null : "./missing",
  relationType,
  confidence: 1,
  evidence,
});

function profile(id: string, profileKey: string, thresholds = DEFAULT_GUARDRAIL_THRESHOLDS) {
  return {
    id,
    workspaceId: "01900000-0000-7000-8000-000000000099",
    profileKey,
    name: `${profileKey} guardrails`,
    description: "A deterministic test policy.",
    version: 1,
    algorithmVersion: "architecture-guardrails-v1",
    thresholds,
    fingerprint: guardrailProfileFingerprint({ profileKey, version: 1, thresholds }),
    builtIn: false,
    createdBy: "01900000-0000-7000-8000-000000000098",
    createdAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("architecture guardrails", () => {
  it("finds cycles, large files, unresolved imports, and parse gaps deterministically", () => {
    const files = [
      file("f1", "src/a/a.ts", 10),
      file("f2", "src/b/b.ts", 10),
      file("f3", "src/huge.ts", 801),
      file("f4", "src/broken.ts", 2, "failed"),
    ];
    const symbols = [
      moduleSymbol("s1", "f1", "src/a/a.ts"),
      moduleSymbol("s2", "f2", "src/b/b.ts"),
      moduleSymbol("s3", "f3", "src/huge.ts"),
      moduleSymbol("s4", "f4", "src/broken.ts"),
    ];
    const edges = [
      edge("e1", "s1", "s2", "imports", { path: "src/a/a.ts", startLine: 3, endLine: 3 }),
      edge("e2", "s2", "s1", "imports", { path: "src/b/b.ts", startLine: 4, endLine: 4 }),
      edge("e3", "s3", null, "imports", {
        path: "src/huge.ts",
        startLine: 8,
        importSource: "./missing",
      }),
    ];
    const first = buildGuardrailReport({ snapshot, files, symbols, edges });
    const second = buildGuardrailReport({ snapshot, files, symbols, edges });
    expect(first).toEqual(second);
    expect(first.status).toBe("fail");
    expect(first.findings.map((item) => item.ruleId)).toEqual([
      "dependency_cycle",
      "large_file",
      "parse_failure",
      "unresolved_import",
    ]);
    expect(first.generatedAt).toBe(snapshot.readyAt);
    expect(first.thresholds).toEqual(DEFAULT_GUARDRAIL_THRESHOLDS);
    expect(first.profile).toEqual(BUILT_IN_GUARDRAIL_PROFILE);
  });

  it("creates stable policy fingerprints independent of threshold object key order", () => {
    const first = guardrailProfileFingerprint({
      profileKey: "strict",
      version: 3,
      thresholds: DEFAULT_GUARDRAIL_THRESHOLDS,
    });
    const second = guardrailProfileFingerprint({
      profileKey: "strict",
      version: 3,
      thresholds: {
        highFanIn: DEFAULT_GUARDRAIL_THRESHOLDS.highFanIn,
        largeSymbolLines: DEFAULT_GUARDRAIL_THRESHOLDS.largeSymbolLines,
        largeFileBytes: DEFAULT_GUARDRAIL_THRESHOLDS.largeFileBytes,
        largeFileLines: DEFAULT_GUARDRAIL_THRESHOLDS.largeFileLines,
        cycleMaxLength: DEFAULT_GUARDRAIL_THRESHOLDS.cycleMaxLength,
      },
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("creates stable cross-snapshot subject keys without using snapshot fingerprints", () => {
    const baseReport = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000020" },
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
    });
    const headReport = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000021" },
      files: [file("f1", "src/main.ts", 900)],
      symbols: [],
      edges: [],
    });
    const base = baseReport.findings[0];
    const head = headReport.findings[0];
    expect(base?.fingerprint).not.toBe(head?.fingerprint);
    expect(base && guardrailFindingSubjectKey(base)).toBe(head && guardrailFindingSubjectKey(head));
    expect(base && guardrailFindingSubjectKey(base)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(compareGuardrailReports(baseReport, headReport).findings[0]?.key).toBe(
      base && guardrailFindingSubjectKey(base),
    );
  });

  it("rejects invalid profile fingerprints and threshold overrides", () => {
    const strict = profile("01900000-0000-7000-8000-000000000090", "strict");
    expect(() =>
      buildGuardrailReport({
        snapshot,
        files: [],
        symbols: [],
        edges: [],
        profile: { ...strict, fingerprint: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrow(/fingerprint is invalid/);
    expect(() =>
      buildGuardrailReport({
        snapshot,
        files: [],
        symbols: [],
        edges: [],
        profile: strict,
        thresholds: { highFanIn: strict.thresholds.highFanIn + 1 },
      }),
    ).toThrow(/cannot be overridden/);
  });

  it("counts only non-containment incoming edges for fan-in", () => {
    const files = [file("f1", "src/main.ts"), file("f2", "src/one.ts"), file("f3", "src/two.ts")];
    const symbols = [
      moduleSymbol("m1", "f1", "src/main.ts"),
      {
        ...moduleSymbol("m2", "f2", "src/one.ts"),
        id: "target",
        kind: "function",
        startLine: 2,
        endLine: 4,
      },
      moduleSymbol("m3", "f3", "src/two.ts"),
    ];
    const edges = [
      edge("contains", "m1", "target", "contains"),
      edge("call", "m3", "target", "calls", { path: "src/two.ts", startLine: 2 }),
    ];
    const report = buildGuardrailReport({
      snapshot,
      files,
      symbols,
      edges,
      thresholds: { highFanIn: 1 },
    });
    expect(report.findings.some((item) => item.ruleId === "high_fan_in")).toBe(true);
    expect(report.findings.find((item) => item.ruleId === "high_fan_in")?.metric.incoming).toBe(1);
  });

  it("emits SARIF without source contents", () => {
    const report = buildGuardrailReport({
      snapshot,
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
    });
    const sarif = buildSarifReport(report);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results).toHaveLength(1);
    expect(JSON.stringify(sarif)).not.toContain("export function");
  });

  it("compares immutable reports with stable added, resolved, changed, and unchanged states", () => {
    const base = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000010" },
      files: [file("f1", "src/main.ts", 801), file("f2", "src/old.ts", 801)],
      symbols: [],
      edges: [],
    });
    const head = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000011" },
      files: [file("f1", "src/main.ts", 900), file("f3", "src/new.ts", 801)],
      symbols: [],
      edges: [],
    });
    const comparison = compareGuardrailReports(base, head);
    expect(comparison.overall).toBe("regressed");
    expect(comparison.summary).toMatchObject({ added: 1, resolved: 1, changed: 1 });
    expect(comparison.findings.map((item) => item.status)).toEqual([
      "changed",
      "added",
      "resolved",
    ]);
    expect(comparison.findings[0]?.base?.path).toBe("src/main.ts");
    expect(comparison.findings[0]?.head?.metric.lines).toBe(900);
  });

  it("counts severity upgrades as regressions and downgrades as improvements", () => {
    const base = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000012" },
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
    });
    const warning = {
      ...base,
      findings: base.findings.map((item) => ({ ...item, severity: "info" as const })),
    };
    const improved = compareGuardrailReports(base, warning);
    expect(improved.overall).toBe("improved");
    expect(improved.summary.improvements).toBe(1);
    const regressed = compareGuardrailReports(warning, base);
    expect(regressed.overall).toBe("regressed");
    expect(regressed.summary.regressions).toBe(1);
  });

  it("rejects reports with different thresholds", () => {
    const base = buildGuardrailReport({
      snapshot,
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
    });
    const incompatible = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000013" },
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
      thresholds: { largeFileLines: 900 },
    });
    expect(() => compareGuardrailReports(base, incompatible)).toThrow(/incompatible thresholds/);
  });

  it("rejects reports with different policy fingerprints even when thresholds match", () => {
    const base = buildGuardrailReport({
      snapshot,
      files: [],
      symbols: [],
      edges: [],
      profile: profile("01900000-0000-7000-8000-000000000091", "strict"),
    });
    const head = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000092" },
      files: [],
      symbols: [],
      edges: [],
      profile: profile("01900000-0000-7000-8000-000000000093", "team"),
    });
    expect(base.thresholds).toEqual(head.thresholds);
    expect(() => compareGuardrailReports(base, head)).toThrow(/incompatible policy profiles/);
  });

  it("treats legacy reports without profile provenance as the built-in default", () => {
    const legacy = buildGuardrailReport({
      snapshot,
      files: [],
      symbols: [],
      edges: [],
      thresholds: DEFAULT_GUARDRAIL_THRESHOLDS,
    });
    const current = buildGuardrailReport({
      snapshot: { ...snapshot, id: "01900000-0000-7000-8000-000000000094" },
      files: [],
      symbols: [],
      edges: [],
    });
    expect(legacy.profile).toBeNull();
    expect(compareGuardrailReports(legacy, current).profile).toEqual(BUILT_IN_GUARDRAIL_PROFILE);
  });

  it("frames logical Finding identity without delimiter collisions", () => {
    const first = {
      id: "large_symbol:first",
      fingerprint: `sha256:${"1".repeat(64)}`,
      ruleId: "large_symbol" as const,
      severity: "warning" as const,
      title: "Large symbol",
      message: "Widget is large.",
      path: "src/a|b.ts",
      startLine: 2,
      endLine: 200,
      metric: { lines: 199, symbol: "Widget" },
      evidence: [
        {
          path: "src/a|b.ts",
          startLine: 2,
          endLine: 200,
          description: "Symbol source range.",
        },
      ],
    };
    const delimiterCollision = {
      ...first,
      id: "large_symbol:second",
      fingerprint: `sha256:${"2".repeat(64)}`,
      path: "src/a",
      metric: { lines: 199, symbol: "b.ts|Widget" },
    };
    const sameLogicalFinding = {
      ...first,
      id: "large_symbol:later",
      fingerprint: `sha256:${"3".repeat(64)}`,
      severity: "error" as const,
      message: "Widget is much larger in the later Snapshot.",
      endLine: 400,
      metric: { lines: 399, symbol: "Widget" },
    };

    expect(guardrailFindingSubjectKey(first)).not.toBe(
      guardrailFindingSubjectKey(delimiterCollision),
    );
    expect(guardrailFindingSubjectKey(first)).toBe(guardrailFindingSubjectKey(sameLogicalFinding));
  });

  it("keeps equivalent object key order and duplicate pairing deterministic", () => {
    const base = buildGuardrailReport({
      snapshot,
      files: [file("f1", "src/main.ts", 801), file("f2", "src/other.ts", 801)],
      symbols: [],
      edges: [],
    });
    const reordered = {
      ...base,
      thresholds: {
        highFanIn: base.thresholds.highFanIn,
        largeFileBytes: base.thresholds.largeFileBytes,
        cycleMaxLength: base.thresholds.cycleMaxLength,
        largeSymbolLines: base.thresholds.largeSymbolLines,
        largeFileLines: base.thresholds.largeFileLines,
      },
      findings: [...base.findings].reverse().map((finding, index) => ({
        ...finding,
        id: `duplicate-${index}`,
        metric: Object.fromEntries(Object.entries(finding.metric).reverse()),
        evidence: finding.evidence.map((item) => ({
          description: item.description,
          endLine: item.endLine,
          startLine: item.startLine,
          path: item.path,
        })),
      })),
    };
    const comparison = compareGuardrailReports(base, reordered);
    expect(comparison.overall).toBe("unchanged");
    expect(comparison.summary.unchanged).toBe(2);
    expect(compareGuardrailReports(base, reordered).findings).toEqual(comparison.findings);
  });

  it("compares verified explanation fields without assigning quality labels", () => {
    const finding = buildGuardrailReport({
      snapshot,
      files: [file("f1", "src/main.ts", 801)],
      symbols: [],
      edges: [],
    }).findings[0];
    expect(finding).toBeDefined();
    if (!finding) return;
    const subjectKey = guardrailFindingSubjectKey(finding);
    const base = {
      id: "01900000-0000-7000-8000-000000000030",
      subjectKey,
      snapshot: {
        id: snapshot.id,
        commitSha: snapshot.commitSha,
        parserVersion: snapshot.parserVersion,
        algorithmVersion: "architecture-guardrails-v1",
      },
      profile: BUILT_IN_GUARDRAIL_PROFILE,
      profileFingerprint: BUILT_IN_GUARDRAIL_PROFILE.fingerprint,
      finding,
      answer: {
        summary: "Base explanation.",
        steps: [],
        limitations: [],
        status: "grounded" as const,
        citations: [],
        provider: "fake",
        model: "evidence-demo-v1",
      },
      promptVersion: "guardrail-explanation-v1",
      createdAt: "2026-08-25T00:00:00.000Z",
    };
    const head = {
      ...base,
      id: "01900000-0000-7000-8000-000000000031",
      snapshot: {
        ...base.snapshot,
        id: "01900000-0000-7000-8000-000000000032",
        commitSha: "1111111111111111111111111111111111111111",
      },
      answer: { ...base.answer, summary: "Head explanation." },
      createdAt: "2026-08-26T00:00:00.000Z",
    };
    const result = compareGuardrailExplanations(base, head);
    expect(result.changed).toBe(true);
    expect(result.differences.provenance.commitSha).toBe("changed");
    expect(result.differences.finding.severity).toBe("same");
    expect(result.differences.answer.summary).toBe("changed");
    expect(JSON.stringify(result)).not.toContain("improved");
    expect(JSON.stringify(result)).not.toContain("regressed");
  });
});
