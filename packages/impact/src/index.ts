import { createHash } from "node:crypto";
import type {
  PullRequestChangeType,
  PullRequestFileChange,
  PullRequestImpactType,
  PullRequestRiskBreakdown,
  PullRequestRiskLevel,
  PullRequestSnapshotSide,
  PullRequestSymbolChangeType,
  RelationType,
} from "@repovista/contracts";
export const IMPACT_ALGORITHM_VERSION = "reverse-bfs-risk-v1";
export const MAX_IMPACT_DEPTH = 5;
export const MAX_IMPACT_NODES = 2_000;

export interface SnapshotSideInput {
  side: PullRequestSnapshotSide;
  snapshotId: string;
  commitSha: string;
  files: readonly ImpactFile[];
  symbols: readonly ImpactSymbol[];
  edges: readonly ImpactEdge[];
}

export interface ImpactFile {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  blobHash: string;
  content: string;
  parseStatus: string;
}

export interface ImpactSymbol {
  id: string;
  fileId: string;
  path: string;
  stableKey: string;
  kind: string;
  name: string;
  qualifiedName: string | null;
  signature: string | null;
  startLine: number;
  endLine: number;
  contentHash: string;
}

export interface ImpactEdge {
  id: string;
  fromSymbolId: string;
  toSymbolId: string | null;
  unresolvedTarget: string | null;
  relationType: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface SymbolChangeResult {
  id: string;
  side: PullRequestSnapshotSide;
  symbolId: string | null;
  stableKey: string;
  path: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  changeType: PullRequestSymbolChangeType;
}

export interface ImpactPathResult {
  ordinal: number;
  fromSymbolId: string | null;
  toSymbolId: string | null;
  fromStableKey: string | null;
  toStableKey: string | null;
  fromPath: string | null;
  toPath: string | null;
  relationType: RelationType;
  confidence: number;
  edgeId: string | null;
  evidenceId: string | null;
}

export interface ImpactEvidenceResult {
  id: string;
  snapshotId: string;
  commitSha: string;
  fileId: string;
  symbolId: string | null;
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
  contentHash: string;
  relationType: RelationType | null;
  algorithmVersion: string;
}

export interface ImpactResult {
  id: string;
  side: PullRequestSnapshotSide;
  symbolId: string | null;
  stableKey: string;
  path: string;
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  impactType: PullRequestImpactType;
  distance: number;
  riskScore: number;
  riskLevel: PullRequestRiskLevel;
  riskBreakdown: PullRequestRiskBreakdown;
  truncated: boolean;
  paths: ImpactPathResult[];
  evidence: ImpactEvidenceResult[];
}

export interface ImpactComputation {
  files: PullRequestFileChange[];
  symbols: SymbolChangeResult[];
  impacts: ImpactResult[];
  stats: {
    changedFiles: number;
    changedSymbols: number;
    directImpacts: number;
    transitiveImpacts: number;
    unknownImpacts: number;
    truncated: boolean;
  };
}

const impactRelations = new Set<RelationType>([
  "calls",
  "imports",
  "extends",
  "implements",
  "reads",
  "writes",
]);

function stableId(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function fileMap(files: readonly ImpactFile[]): Map<string, ImpactFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function symbolMap(symbols: readonly ImpactSymbol[]): Map<string, ImpactSymbol> {
  return new Map(symbols.map((symbol) => [symbol.stableKey, symbol]));
}

function quoteFor(file: ImpactFile, startLine: number, endLine: number): string {
  return file.content
    .split(/\r?\n/)
    .slice(Math.max(0, startLine - 1), Math.max(startLine, endLine))
    .join("\n")
    .slice(0, 8_000);
}

function quoteHash(quote: string): string {
  return `sha256:${createHash("sha256").update(quote).digest("hex")}`;
}

function evidenceForSymbol(
  snapshot: SnapshotSideInput,
  symbol: ImpactSymbol,
  idSuffix: string,
  relationType: RelationType | null,
  requestedRange?: { startLine: number; endLine: number },
): ImpactEvidenceResult | null {
  const file = fileMap(snapshot.files).get(symbol.path);
  if (!file || file.lineCount < 1) return null;
  const startLine = Math.min(
    file.lineCount,
    Math.max(1, requestedRange?.startLine ?? symbol.startLine),
  );
  const endLine = Math.min(
    file.lineCount,
    Math.max(startLine, requestedRange?.endLine ?? symbol.endLine),
  );
  const quote = quoteFor(file, startLine, endLine);
  return {
    id: stableId("impact-evidence", `${snapshot.side}:${symbol.stableKey}:${idSuffix}`),
    snapshotId: snapshot.snapshotId,
    commitSha: snapshot.commitSha,
    fileId: symbol.fileId,
    symbolId: symbol.id,
    path: symbol.path,
    startLine,
    endLine,
    quote,
    contentHash: quoteHash(quote),
    relationType,
    algorithmVersion: IMPACT_ALGORITHM_VERSION,
  };
}

function edgeRange(
  edge: ImpactEdge,
  fallback: ImpactSymbol,
): { startLine: number; endLine: number } {
  const rawStart = edge.evidence.startLine;
  const rawEnd = edge.evidence.endLine;
  const startLine =
    typeof rawStart === "number" && Number.isInteger(rawStart) && rawStart > 0
      ? rawStart
      : fallback.startLine;
  const endLine =
    typeof rawEnd === "number" && Number.isInteger(rawEnd) && rawEnd >= startLine
      ? rawEnd
      : Math.max(startLine, fallback.endLine);
  return { startLine, endLine };
}

function riskLevel(score: number): PullRequestRiskLevel {
  if (score >= 0.85) return "critical";
  if (score >= 0.65) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

function languageWeight(path: string): number {
  if (path.endsWith(".go")) return 0.95;
  if (path.endsWith(".py")) return 0.85;
  if (/\.(ts|tsx)$/.test(path)) return 0.8;
  if (/\.(js|jsx|mjs|cjs)$/.test(path)) return 0.75;
  return 0.45;
}

function publicApiWeight(symbol: ImpactSymbol): number {
  if (/^[A-Z]/.test(symbol.name)) return 1;
  if (symbol.kind === "interface" || symbol.kind === "type") return 0.9;
  if (symbol.kind === "module") return 0.75;
  return 0.35;
}

function riskFor(
  symbol: ImpactSymbol,
  distance: number,
  fanIn: number,
  changed: boolean,
): { score: number; breakdown: PullRequestRiskBreakdown; level: PullRequestRiskLevel } {
  const changedSymbolWeight = changed ? 1 : Math.min(1, 0.35 + distance / MAX_IMPACT_DEPTH);
  const reverseFanInWeight = Math.min(1, fanIn / 8);
  const apiWeight = publicApiWeight(symbol);
  const langWeight = languageWeight(symbol.path);
  const score = Math.min(
    1,
    Math.max(
      0,
      0.45 * changedSymbolWeight + 0.3 * reverseFanInWeight + 0.15 * apiWeight + 0.1 * langWeight,
    ),
  );
  const breakdown = {
    changedSymbolWeight,
    reverseFanInWeight,
    publicApiWeight: apiWeight,
    languageWeight: langWeight,
  } satisfies PullRequestRiskBreakdown;
  return { score, breakdown, level: riskLevel(score) };
}

function fileChanges(base: SnapshotSideInput, head: SnapshotSideInput): PullRequestFileChange[] {
  const baseFiles = fileMap(base.files);
  const headFiles = fileMap(head.files);
  const paths = [...new Set([...baseFiles.keys(), ...headFiles.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const changes: PullRequestFileChange[] = [];
  for (const path of paths) {
    const before = baseFiles.get(path);
    const after = headFiles.get(path);
    let changeType: PullRequestChangeType;
    if (!before) changeType = "added";
    else if (!after) changeType = "deleted";
    else if (before.blobHash === after.blobHash) changeType = "unchanged";
    else changeType = "modified";
    if (changeType === "unchanged") continue;
    changes.push({
      path,
      oldPath: null,
      changeType,
      baseBlobHash: before?.blobHash ?? null,
      headBlobHash: after?.blobHash ?? null,
      additions: null,
      deletions: null,
      binary: false,
    });
  }
  // A path-only comparison cannot prove renames. Keep the conservative modified/add/delete
  // classification until GitHub's file metadata supplies an explicit previous path.
  return changes;
}

function symbolChanges(
  base: SnapshotSideInput,
  head: SnapshotSideInput,
): { changes: SymbolChangeResult[]; changedKeys: Set<string> } {
  const before = symbolMap(base.symbols);
  const after = symbolMap(head.symbols);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b));
  const changes: SymbolChangeResult[] = [];
  const changedKeys = new Set<string>();
  for (const stableKey of keys) {
    const left = before.get(stableKey);
    const right = after.get(stableKey);
    if (!left && right) {
      changedKeys.add(stableKey);
      changes.push({
        id: stableId("symbol-change", `${head.side}:${stableKey}`),
        side: head.side,
        symbolId: right.id,
        stableKey,
        path: right.path,
        name: right.name,
        kind: right.kind,
        startLine: right.startLine,
        endLine: right.endLine,
        changeType: "added",
      });
      continue;
    }
    if (left && !right) {
      changedKeys.add(stableKey);
      changes.push({
        id: stableId("symbol-change", `${base.side}:${stableKey}`),
        side: base.side,
        symbolId: left.id,
        stableKey,
        path: left.path,
        name: left.name,
        kind: left.kind,
        startLine: left.startLine,
        endLine: left.endLine,
        changeType: "deleted",
      });
      continue;
    }
    if (left && right && left.contentHash !== right.contentHash) {
      changedKeys.add(stableKey);
      changes.push({
        id: stableId("symbol-change", `${head.side}:${stableKey}`),
        side: head.side,
        symbolId: right.id,
        stableKey,
        path: right.path,
        name: right.name,
        kind: right.kind,
        startLine: right.startLine,
        endLine: right.endLine,
        changeType: "modified",
      });
    }
  }
  return { changes, changedKeys };
}

interface ReverseNode {
  symbol: ImpactSymbol;
  distance: number;
  path: ImpactEdge[];
  sourceStableKey: string;
}

function reverseImpacts(
  snapshot: SnapshotSideInput,
  changedKeys: ReadonlySet<string>,
): { nodes: ReverseNode[]; truncated: boolean } {
  const symbolsById = new Map(snapshot.symbols.map((symbol) => [symbol.id, symbol]));
  const incoming = new Map<string, ImpactEdge[]>();
  for (const edge of snapshot.edges) {
    if (!edge.toSymbolId || !impactRelations.has(edge.relationType as RelationType)) continue;
    const target = symbolsById.get(edge.toSymbolId)?.stableKey;
    if (!target) continue;
    const list = incoming.get(target) ?? [];
    list.push(edge);
    incoming.set(target, list);
  }
  const visited = new Map<string, ReverseNode>();
  const queue: { stableKey: string; distance: number; path: ImpactEdge[]; source: string }[] = [];
  for (const changed of [...changedKeys].sort()) {
    queue.push({ stableKey: changed, distance: 0, path: [], source: changed });
  }
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const edges = incoming.get(current.stableKey) ?? [];
    for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
      const from = symbolsById.get(edge.fromSymbolId);
      if (!from) continue;
      if (changedKeys.has(from.stableKey)) continue;
      const distance = current.distance + 1;
      if (distance > MAX_IMPACT_DEPTH) {
        truncated = true;
        continue;
      }
      if (visited.has(from.stableKey)) continue;
      const path = [...current.path, edge];
      const node = { symbol: from, distance, path, sourceStableKey: current.source };
      visited.set(from.stableKey, node);
      if (visited.size >= MAX_IMPACT_NODES) {
        truncated = true;
        break;
      }
      queue.push({ stableKey: from.stableKey, distance, path, source: current.source });
    }
    if (visited.size >= MAX_IMPACT_NODES) break;
  }
  return { nodes: [...visited.values()], truncated };
}

function makeImpact(
  snapshot: SnapshotSideInput,
  node: ReverseNode,
  changedKeys: ReadonlySet<string>,
  fanInByStableKey: ReadonlyMap<string, number>,
): ImpactResult {
  const changed = changedKeys.has(node.symbol.stableKey);
  const risk = riskFor(
    node.symbol,
    node.distance,
    fanInByStableKey.get(node.symbol.stableKey) ?? 0,
    changed,
  );
  const symbolsById = new Map(snapshot.symbols.map((symbol) => [symbol.id, symbol]));
  const evidence: ImpactEvidenceResult[] = [];
  const primaryEvidence = evidenceForSymbol(snapshot, node.symbol, "symbol", null);
  if (primaryEvidence) evidence.push(primaryEvidence);
  const paths: ImpactPathResult[] = [...node.path].reverse().map((edge, ordinal) => {
    const from = symbolsById.get(edge.fromSymbolId);
    const to = edge.toSymbolId ? symbolsById.get(edge.toSymbolId) : undefined;
    const relationType = edge.relationType as RelationType;
    const edgeEvidence = from
      ? evidenceForSymbol(
          snapshot,
          from,
          `path:${node.symbol.stableKey}:${ordinal}:${edge.id}`,
          relationType,
          edgeRange(edge, from),
        )
      : null;
    if (edgeEvidence) evidence.push(edgeEvidence);
    return {
      ordinal,
      fromSymbolId: from?.id ?? null,
      toSymbolId: to?.id ?? null,
      fromStableKey: from?.stableKey ?? null,
      toStableKey: to?.stableKey ?? null,
      fromPath: from?.path ?? null,
      toPath: to?.path ?? null,
      relationType,
      confidence: edge.confidence,
      edgeId: edge.id,
      evidenceId: edgeEvidence?.id ?? null,
    };
  });
  const unknown = !primaryEvidence || paths.some((path) => path.evidenceId === null);
  return {
    id: stableId("impact", `${snapshot.side}:${node.symbol.stableKey}`),
    side: snapshot.side,
    symbolId: node.symbol.id,
    stableKey: node.symbol.stableKey,
    path: node.symbol.path,
    name: node.symbol.name,
    kind: node.symbol.kind,
    startLine: node.symbol.startLine,
    endLine: node.symbol.endLine,
    impactType: unknown
      ? "unknown"
      : changed
        ? "changed"
        : node.distance === 1
          ? "direct"
          : "transitive",
    distance: node.distance,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskBreakdown: risk.breakdown,
    truncated: false,
    paths,
    evidence,
  };
}

function fanIn(snapshot: SnapshotSideInput): Map<string, number> {
  const byId = new Map(snapshot.symbols.map((symbol) => [symbol.id, symbol.stableKey]));
  const result = new Map<string, number>();
  for (const edge of snapshot.edges) {
    const target = edge.toSymbolId ? byId.get(edge.toSymbolId) : undefined;
    if (target) result.set(target, (result.get(target) ?? 0) + 1);
  }
  return result;
}

export function computePullRequestImpact(
  base: SnapshotSideInput,
  head: SnapshotSideInput,
): ImpactComputation {
  if (base.side !== "base" || head.side !== "head") {
    throw new Error("Impact computation requires base and head snapshot sides.");
  }
  const files = fileChanges(base, head);
  const baseSymbols = symbolChanges(base, head);
  const headChanged = new Set(
    baseSymbols.changes
      .filter((change) => change.side === "head")
      .map((change) => change.stableKey),
  );
  const baseChanged = new Set(
    baseSymbols.changes
      .filter((change) => change.side === "base")
      .map((change) => change.stableKey),
  );
  const baseReverse = reverseImpacts(base, baseChanged);
  const headReverse = reverseImpacts(head, headChanged);
  const baseFanIn = fanIn(base);
  const headFanIn = fanIn(head);
  const changedImpacts: ImpactResult[] = [];
  for (const change of baseSymbols.changes) {
    const snapshot = change.side === "base" ? base : head;
    const symbol = snapshot.symbols.find((item) => item.stableKey === change.stableKey);
    if (!symbol) continue;
    const risk = riskFor(
      symbol,
      0,
      (change.side === "base" ? baseFanIn : headFanIn).get(change.stableKey) ?? 0,
      true,
    );
    const evidence = evidenceForSymbol(snapshot, symbol, "symbol", null);
    changedImpacts.push({
      id: stableId("impact", `${snapshot.side}:${symbol.stableKey}`),
      side: snapshot.side,
      symbolId: symbol.id,
      stableKey: symbol.stableKey,
      path: symbol.path,
      name: symbol.name,
      kind: symbol.kind,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      impactType: evidence ? "changed" : "unknown",
      distance: 0,
      riskScore: risk.score,
      riskLevel: risk.level,
      riskBreakdown: risk.breakdown,
      truncated: false,
      paths: [],
      evidence: evidence ? [evidence] : [],
    });
  }
  const impacted = [
    ...headReverse.nodes.map((node) => makeImpact(head, node, headChanged, headFanIn)),
    ...baseReverse.nodes.map((node) => makeImpact(base, node, baseChanged, baseFanIn)),
  ];
  const impacts = [...changedImpacts, ...impacted]
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        a.path.localeCompare(b.path) ||
        a.startLine - b.startLine ||
        a.id.localeCompare(b.id),
    )
    .map((impact) => ({ ...impact, truncated: headReverse.truncated || baseReverse.truncated }));
  return {
    files,
    symbols: baseSymbols.changes,
    impacts,
    stats: {
      changedFiles: files.length,
      changedSymbols: baseSymbols.changes.length,
      directImpacts: impacts.filter((impact) => impact.impactType === "direct").length,
      transitiveImpacts: impacts.filter((impact) => impact.impactType === "transitive").length,
      unknownImpacts: impacts.filter((impact) => impact.impactType === "unknown").length,
      truncated: headReverse.truncated || baseReverse.truncated,
    },
  };
}
