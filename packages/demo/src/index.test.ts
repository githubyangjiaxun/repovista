import { BUNDLED_DEMO_REPOSITORY } from "@repovista/contracts";
import { linkParsedImports } from "@repovista/graph";
import { buildGuardrailReport } from "@repovista/guardrails";
import { PARSER_VERSION, parseRepository } from "@repovista/parser";
import { describe, expect, it } from "vitest";
import { type loadBundledDemoVersion, loadBundledDemoVersions } from "./index.js";

function guardrailReport(version: Awaited<ReturnType<typeof loadBundledDemoVersion>>) {
  const parsed = linkParsedImports(version.files, parseRepository(version.files));
  const fileId = new Map(version.files.map((file) => [file.path, `file:${file.path}`]));
  const symbols = parsed.flatMap((file) =>
    file.symbols.map((symbol) => ({
      id: symbol.stableKey,
      fileId: fileId.get(file.path) as string,
      path: file.path,
      kind: symbol.kind,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    })),
  );
  return buildGuardrailReport({
    snapshot: {
      id: `demo-${version.key}`,
      commitSha: version.commitSha,
      parserVersion: PARSER_VERSION,
      requestedAt: "2026-08-25T00:00:00.000Z",
      readyAt: "2026-08-25T00:00:01.000Z",
    },
    files: version.files.map((file) => ({
      id: fileId.get(file.path) as string,
      path: file.path,
      language: file.language,
      byteSize: file.byteSize,
      lineCount: file.lineCount,
      parseStatus: "parsed",
    })),
    symbols,
    edges: parsed.flatMap((file, fileIndex) =>
      file.edges.map((edge, edgeIndex) => ({
        id: `edge:${fileIndex}:${edgeIndex}`,
        fromSymbolId: edge.fromStableKey,
        toSymbolId: edge.targetStableKey ?? null,
        unresolvedTarget: edge.unresolvedTarget ?? null,
        relationType: edge.type,
        confidence: edge.confidence,
        evidence: edge.evidence,
      })),
    ),
  });
}

describe("bundled demo fixture", () => {
  it("loads stable, distinct revisions with no external repository dependency", async () => {
    const first = await loadBundledDemoVersions();
    const second = await loadBundledDemoVersions();

    expect(first.base.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(first.head.commitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(first.base.commitSha).not.toBe(first.head.commitSha);
    expect(second.base.commitSha).toBe(first.base.commitSha);
    expect(second.head.commitSha).toBe(first.head.commitSha);
    expect(new URL(BUNDLED_DEMO_REPOSITORY.canonicalUrl).hostname).toBe("repovista-demo.invalid");
  });

  it("provides a measurable incremental change set", async () => {
    const { base, head } = await loadBundledDemoVersions();
    const baseByPath = new Map(base.files.map((file) => [file.path, file]));
    const headByPath = new Map(head.files.map((file) => [file.path, file]));
    const changed = head.files.filter(
      (file) => baseByPath.get(file.path)?.contentHash !== file.contentHash,
    );
    const reused = head.files.filter(
      (file) => baseByPath.get(file.path)?.contentHash === file.contentHash,
    );
    const deleted = base.files.filter((file) => !headByPath.has(file.path));

    expect(changed.map((file) => file.path)).toEqual(["python/trends.py", "src/core/service.ts"]);
    expect(reused).toHaveLength(5);
    expect(deleted.map((file) => file.path)).toEqual(["src/legacy/flags.ts"]);
  });

  it("parses three languages and keeps one stable dependency-cycle subject", async () => {
    const { base, head } = await loadBundledDemoVersions();
    for (const version of [base, head]) {
      expect(new Set(version.files.map((file) => file.language))).toEqual(
        new Set(["typescript", "python", "go"]),
      );
      const report = guardrailReport(version);
      const cycle = report.findings.find((finding) => finding.ruleId === "dependency_cycle");
      expect(cycle?.metric).toMatchObject({ packages: "src/api,src/core" });
      expect(cycle?.evidence.length).toBeGreaterThan(0);
    }
  });
});
