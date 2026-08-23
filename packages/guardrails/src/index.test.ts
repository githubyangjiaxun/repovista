import { describe, expect, it } from "vitest";
import { buildGuardrailReport, buildSarifReport, DEFAULT_GUARDRAIL_THRESHOLDS } from "./index.js";

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
});
