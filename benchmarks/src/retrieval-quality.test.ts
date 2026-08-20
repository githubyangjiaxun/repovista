import { describe, expect, it } from "vitest";
import { buildRetrievalQualityReport } from "./retrieval-quality.js";

describe("retrieval quality benchmark", () => {
  it("reports deterministic Recall@K and MRR@10 for every retrieval mode", () => {
    const report = buildRetrievalQualityReport();

    expect(report.testOnly).toBe(true);
    expect(report.corpusDocuments).toBe(10);
    expect(report.queries).toBe(5);
    expect(Object.keys(report.metrics)).toEqual(["text", "symbol", "semantic", "hybrid"]);
    expect(report.metrics.semantic.recallAt1).toBe(1);
    expect(report.metrics.hybrid.recallAt3).toBeGreaterThanOrEqual(report.metrics.text.recallAt3);
    expect(report.metrics.hybrid.mrrAt10).toBeGreaterThanOrEqual(report.metrics.text.mrrAt10);
    expect(buildRetrievalQualityReport()).toEqual(report);
  });
});
