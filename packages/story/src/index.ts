import { createHash } from "node:crypto";
import path from "node:path";
import {
  type ArchitectureStoryV2,
  architectureStoryV2Schema,
  type Snapshot,
  type StoryRetrievalProfile,
} from "@repovista/contracts";
import { DomainError } from "@repovista/domain";
import { buildGraphView, type GraphInput } from "@repovista/graph";

export const STORY_ALGORITHM_VERSION = "architecture-story-v2";

export interface StoryRepository {
  owner: string;
  name: string;
}

export interface StoryFile {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  content: string;
}

export interface StorySymbol {
  id: string;
  fileId: string;
  path: string;
  stableKey: string;
  kind: string;
  name: string;
  qualifiedName: string | null;
  startLine: number;
  endLine: number;
}

export interface StoryEdge {
  id: string;
  fromSymbolId: string;
  toSymbolId: string | null;
  unresolvedTarget: string | null;
  relationType: string;
  confidence: number;
}

export interface BuildArchitectureStoryInput {
  repository: StoryRepository;
  snapshot: Snapshot;
  files: readonly StoryFile[];
  symbols: readonly StorySymbol[];
  edges: readonly StoryEdge[];
  retrievalProfile?: StoryRetrievalProfile | null;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function packageName(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "root" : directory.split("/").slice(0, 2).join("/");
}

function entryHint(value: string): number {
  const normalized = value.toLowerCase();
  return /(^|\/)(index|main|server|app|cli|router|routes|worker)(\.|\/|$)/.test(normalized) ? 1 : 0;
}

function filePriority(filePath: string): number {
  const lower = filePath.toLowerCase();
  if (/(^|\/)readme(\.[a-z0-9]+)?$/.test(lower)) return 100;
  if (["package.json", "go.mod", "pyproject.toml", "cargo.toml"].includes(lower)) return 95;
  if (entryHint(lower)) return 85;
  if (lower.startsWith("src/") || lower.startsWith("app/")) return 60;
  if (lower.includes("test") || lower.includes("fixture")) return 15;
  return 30;
}

function reasonForReadingPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (/(^|\/)readme(\.[a-z0-9]+)?$/.test(lower)) {
    return "Start with the repository's own public orientation and usage contract.";
  }
  if (["package.json", "go.mod", "pyproject.toml", "cargo.toml"].includes(lower)) {
    return "Inspect the manifest to understand the runtime, dependencies, and package boundary.";
  }
  if (entryHint(lower)) {
    return "This path matches an application or library entry-point convention.";
  }
  return "This file represents one of the most connected modules in the indexed architecture.";
}

function quoteRange(
  content: string,
  startLine: number,
  endLine: number,
  maximumCharacters = 1_200,
) {
  const lines = content.split(/\r?\n/);
  const selected = lines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
  const quote = selected.join("\n").slice(0, maximumCharacters);
  return quote.length > 0 ? quote : lines.slice(0, 20).join("\n").slice(0, maximumCharacters);
}

function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function sortedGraphInput(input: BuildArchitectureStoryInput): GraphInput {
  return {
    files: [...input.files]
      .sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id))
      .map((file) => ({
        id: file.id,
        path: file.path,
        language: file.language,
        byteSize: file.byteSize,
        lineCount: file.lineCount,
      })),
    symbols: [...input.symbols]
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.startLine - right.startLine ||
          left.id.localeCompare(right.id),
      )
      .map((symbol) => ({
        id: symbol.id,
        fileId: symbol.fileId,
        path: symbol.path,
        stableKey: symbol.stableKey,
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      })),
    edges: [...input.edges].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function storyMap(graphInput: GraphInput) {
  const view = buildGraphView(graphInput, "package", 250);
  return {
    nodes: [...view.nodes].sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    ),
    edges: [...view.edges].sort(
      (left, right) =>
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to) ||
        left.type.localeCompare(right.type) ||
        left.id.localeCompare(right.id),
    ),
    truncated: view.truncated,
  };
}

function keyModules(
  graph: ReturnType<typeof storyMap>,
  files: readonly StoryFile[],
): ArchitectureStoryV2["keyModules"] {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const maximumIn = Math.max(0, ...inDegree.values());
  const maximumOut = Math.max(0, ...outDegree.values());

  return graph.nodes
    .map((node) => {
      const incoming = inDegree.get(node.id) ?? 0;
      const outgoing = outDegree.get(node.id) ?? 0;
      const candidates = files
        .filter((file) => packageName(file.path) === node.label)
        .sort(
          (left, right) =>
            filePriority(right.path) - filePriority(left.path) ||
            left.path.localeCompare(right.path),
        );
      const score = clamp(
        0.5 * node.importance +
          0.25 * (maximumIn === 0 ? 0 : incoming / maximumIn) +
          0.15 * (maximumOut === 0 ? 0 : outgoing / maximumOut) +
          0.1 * Math.max(entryHint(node.label), entryHint(candidates[0]?.path ?? "")),
      );
      const connections = incoming + outgoing;
      const reason =
        connections > 0
          ? `Selected from deterministic graph importance with ${incoming} incoming and ${outgoing} outgoing package connections.`
          : "Selected as a repository entry or top-level package even though no cross-package edge was resolved.";
      return {
        id: node.id,
        label: node.label,
        path: node.path,
        importance: node.importance,
        inDegree: incoming,
        outDegree: outgoing,
        score,
        representativePath: candidates[0]?.path ?? null,
        reason,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.importance - left.importance ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 6);
}

function readingPath(
  files: readonly StoryFile[],
  modules: ArchitectureStoryV2["keyModules"],
): ArchitectureStoryV2["readingPath"] {
  const rankedFiles = [...files].sort(
    (left, right) =>
      filePriority(right.path) - filePriority(left.path) || left.path.localeCompare(right.path),
  );
  const candidates = [
    ...rankedFiles.filter((file) => filePriority(file.path) >= 85).map((file) => file.path),
    ...modules.flatMap((module) => (module.representativePath ? [module.representativePath] : [])),
    ...rankedFiles.map((file) => file.path),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((filePath) => {
      if (seen.has(filePath)) return false;
      seen.add(filePath);
      return true;
    })
    .slice(0, 8)
    .map((filePath) => ({ path: filePath, reason: reasonForReadingPath(filePath) }));
}

function evidenceHighlights(
  snapshotId: string,
  files: readonly StoryFile[],
  symbols: readonly StorySymbol[],
  edges: readonly StoryEdge[],
): ArchitectureStoryV2["evidenceHighlights"] {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.fromSymbolId, (degrees.get(edge.fromSymbolId) ?? 0) + 1);
    if (edge.toSymbolId) degrees.set(edge.toSymbolId, (degrees.get(edge.toSymbolId) ?? 0) + 1);
  }
  const selectedSymbols = [...symbols]
    .filter((symbol) => symbol.kind !== "module" || symbols.length <= 6)
    .sort((left, right) =>
      entryHint(`${left.path}/${left.name}`) - entryHint(`${right.path}/${right.name}`) === 0
        ? (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) ||
          left.path.localeCompare(right.path) ||
          left.startLine - right.startLine ||
          left.id.localeCompare(right.id)
        : entryHint(`${right.path}/${right.name}`) - entryHint(`${left.path}/${left.name}`),
    )
    .slice(0, 6);

  const symbolHighlights = selectedSymbols.flatMap((symbol) => {
    const file = filesById.get(symbol.fileId);
    if (!file) return [];
    const quote = quoteRange(file.content, symbol.startLine, symbol.endLine);
    if (!quote) return [];
    return [
      {
        id: `story:${snapshotId}:${symbol.id}`,
        fileId: file.id,
        symbolId: symbol.id,
        path: file.path,
        symbol: symbol.qualifiedName ?? symbol.name,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        quote,
        contentHash: contentHash(quote),
      },
    ];
  });
  if (symbolHighlights.length > 0) return symbolHighlights;

  return [...files]
    .sort(
      (left, right) =>
        filePriority(right.path) - filePriority(left.path) || left.path.localeCompare(right.path),
    )
    .slice(0, 6)
    .flatMap((file) => {
      const quote = quoteRange(file.content, 1, Math.min(20, Math.max(1, file.lineCount)));
      if (!quote) return [];
      return [
        {
          id: `story:${snapshotId}:${file.id}`,
          fileId: file.id,
          symbolId: null,
          path: file.path,
          symbol: null,
          startLine: 1,
          endLine: Math.min(20, Math.max(1, file.lineCount)),
          quote,
          contentHash: contentHash(quote),
        },
      ];
    });
}

export function buildArchitectureStory(input: BuildArchitectureStoryInput): ArchitectureStoryV2 {
  if (input.snapshot.status !== "ready" || !input.snapshot.commitSha) {
    throw new DomainError(
      "SNAPSHOT_NOT_READY",
      "An architecture story can only be built from a ready snapshot.",
    );
  }
  const graphInput = sortedGraphInput(input);
  const map = storyMap(graphInput);
  const modules = keyModules(map, input.files);
  const languages = Object.entries(input.snapshot.stats.languages)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, files]) => ({ name, files }));
  const primaryLanguage = languages[0]?.name;
  const generatedAt = input.snapshot.readyAt ?? input.snapshot.requestedAt;
  const story = {
    version: 2 as const,
    algorithmVersion: STORY_ALGORITHM_VERSION,
    headline: `${input.repository.owner}/${input.repository.name}, mapped at ${input.snapshot.commitSha.slice(0, 7)}.`,
    overview: [
      `${input.repository.owner}/${input.repository.name} contains ${input.snapshot.stats.files} indexed files,`,
      `${input.snapshot.stats.symbols} symbols, and ${input.snapshot.stats.edges} static relationships`,
      primaryLanguage
        ? `with ${primaryLanguage} as its largest indexed language.`
        : "at this commit.",
    ].join(" "),
    metrics: {
      files: input.snapshot.stats.files,
      symbols: input.snapshot.stats.symbols,
      edges: input.snapshot.stats.edges,
      languages,
    },
    map,
    keyModules: modules,
    readingPath: readingPath(input.files, modules),
    evidenceHighlights: evidenceHighlights(
      input.snapshot.id,
      input.files,
      input.symbols,
      input.edges,
    ),
    provenance: {
      snapshotId: input.snapshot.id,
      commitSha: input.snapshot.commitSha,
      parserVersion: input.snapshot.parserVersion,
      generatedAt,
      generatedAtSource: input.snapshot.readyAt
        ? ("snapshot_ready_at" as const)
        : ("snapshot_requested_at" as const),
      retrievalProfile: input.retrievalProfile ?? null,
    },
  };
  return architectureStoryV2Schema.parse(story);
}
