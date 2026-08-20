import { describe, expect, it } from "vitest";
import type { ImpactEdge, ImpactFile, ImpactSymbol, SnapshotSideInput } from "./index.js";
import { computePullRequestImpact } from "./index.js";

function file(path: string, content: string, hash: string) {
  return {
    id: `file-${path}`,
    path,
    language: "typescript",
    byteSize: content.length,
    lineCount: content.split(/\n/).length,
    blobHash: hash,
    content,
    parseStatus: "parsed",
  };
}

function symbol(id: string, stableKey: string, name: string, path = "src/index.ts", hash = id) {
  return {
    id,
    fileId: `file-${path}`,
    path,
    stableKey,
    kind: "function",
    name,
    qualifiedName: name,
    signature: `${name}()`,
    startLine: 1,
    endLine: 1,
    contentHash: `sha256:${hash}`,
  };
}

function side(
  sideName: "base" | "head",
  commitSha: string,
  files: ImpactFile[],
  symbols: ImpactSymbol[],
  edges: ImpactEdge[],
): SnapshotSideInput {
  return {
    side: sideName,
    snapshotId: `${sideName}-snapshot-id`,
    commitSha,
    files,
    symbols,
    edges,
  } as const;
}

describe("computePullRequestImpact", () => {
  it("computes changed, direct, transitive impacts deterministically", () => {
    const changed = symbol(
      "changed",
      "function:src/index.ts:changed",
      "changed",
      "src/index.ts",
      "new",
    );
    const direct = symbol("direct", "function:src/direct.ts:direct", "direct", "src/direct.ts");
    const transitive = symbol(
      "transitive",
      "function:src/transitive.ts:transitive",
      "transitive",
      "src/transitive.ts",
    );
    const unchanged = symbol(
      "unchanged",
      "function:src/index.ts:changed",
      "changed",
      "src/index.ts",
      "old",
    );
    const base = side(
      "base",
      "1111111111111111111111111111111111111111",
      [
        file("src/index.ts", "old", "old"),
        file("src/direct.ts", "direct", "direct"),
        file("src/transitive.ts", "transitive", "transitive"),
      ],
      [unchanged, direct, transitive],
      [
        {
          id: "edge-base-1",
          fromSymbolId: direct.id,
          toSymbolId: unchanged.id,
          unresolvedTarget: null,
          relationType: "calls",
          confidence: 1,
          evidence: { path: "src/direct.ts", startLine: 1, endLine: 1, syntaxType: "call" },
        },
        {
          id: "edge-base-2",
          fromSymbolId: transitive.id,
          toSymbolId: direct.id,
          unresolvedTarget: null,
          relationType: "calls",
          confidence: 1,
          evidence: { path: "src/transitive.ts", startLine: 1, endLine: 1, syntaxType: "call" },
        },
      ],
    );
    const headChanged = symbol(
      "changed-head",
      "function:src/index.ts:changed",
      "changed",
      "src/index.ts",
      "new",
    );
    const head = side(
      "head",
      "2222222222222222222222222222222222222222",
      [
        file("src/index.ts", "new", "new"),
        file("src/direct.ts", "direct", "direct"),
        file("src/transitive.ts", "transitive", "transitive"),
      ],
      [headChanged, direct, transitive],
      [
        {
          id: "edge-head-1",
          fromSymbolId: direct.id,
          toSymbolId: headChanged.id,
          unresolvedTarget: null,
          relationType: "calls",
          confidence: 1,
          evidence: { path: "src/direct.ts", startLine: 1, endLine: 1, syntaxType: "call" },
        },
        {
          id: "edge-head-2",
          fromSymbolId: transitive.id,
          toSymbolId: direct.id,
          unresolvedTarget: null,
          relationType: "calls",
          confidence: 1,
          evidence: { path: "src/transitive.ts", startLine: 1, endLine: 1, syntaxType: "call" },
        },
      ],
    );
    const result = computePullRequestImpact(base, head);
    expect(result.files).toEqual([
      expect.objectContaining({ path: "src/index.ts", changeType: "modified" }),
    ]);
    expect(result.symbols).toEqual([
      expect.objectContaining({ stableKey: changed.stableKey, changeType: "modified" }),
    ]);
    expect(
      result.impacts
        .map((item) => [item.name, item.impactType])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ).toEqual([
      ["changed", "changed"],
      ["direct", "direct"],
      ["transitive", "transitive"],
    ]);
    const transitiveImpact = result.impacts.find((item) => item.name === "transitive");
    expect(transitiveImpact?.paths).toHaveLength(2);
    expect(transitiveImpact?.paths[0]).toMatchObject({
      fromSymbolId: transitive.id,
      toSymbolId: direct.id,
      relationType: "calls",
    });
    expect(transitiveImpact?.paths.every((item) => item.evidenceId !== null)).toBe(true);
    expect(
      transitiveImpact?.paths.every((item) =>
        transitiveImpact.evidence.some((evidence) => evidence.id === item.evidenceId),
      ),
    ).toBe(true);
    expect(result.stats).toMatchObject({
      changedFiles: 1,
      changedSymbols: 1,
      directImpacts: 1,
      transitiveImpacts: 1,
    });
  });

  it("keeps deleted symbols on the base side with fixed evidence", () => {
    const deleted = symbol(
      "deleted",
      "function:src/deleted.ts:gone",
      "gone",
      "src/deleted.ts",
      "gone",
    );
    const caller = symbol("caller", "function:src/caller.ts:caller", "caller", "src/caller.ts");
    const base = side(
      "base",
      "1111111111111111111111111111111111111111",
      [file("src/deleted.ts", "gone", "gone"), file("src/caller.ts", "caller", "caller")],
      [deleted, caller],
      [
        {
          id: "edge-delete",
          fromSymbolId: caller.id,
          toSymbolId: deleted.id,
          unresolvedTarget: null,
          relationType: "calls",
          confidence: 0.8,
          evidence: { path: "src/caller.ts", startLine: 1, endLine: 1, syntaxType: "call" },
        },
      ],
    );
    const head = side(
      "head",
      "2222222222222222222222222222222222222222",
      [file("src/caller.ts", "caller", "caller")],
      [caller],
      [],
    );
    const result = computePullRequestImpact(base, head);
    expect(result.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ changeType: "deleted", side: "base" })]),
    );
    expect(result.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "caller", side: "base", impactType: "direct" }),
      ]),
    );
  });

  it("marks a result unknown instead of inventing missing source evidence", () => {
    const before = symbol("before", "function:src/missing.ts:run", "run", "src/missing.ts", "old");
    const after = symbol("after", "function:src/missing.ts:run", "run", "src/missing.ts", "new");
    const result = computePullRequestImpact(
      side("base", "1111111111111111111111111111111111111111", [], [before], []),
      side("head", "2222222222222222222222222222222222222222", [], [after], []),
    );

    expect(result.impacts).toEqual([
      expect.objectContaining({ impactType: "unknown", evidence: [] }),
    ]);
    expect(result.stats).toMatchObject({ unknownImpacts: 1 });
  });
});
