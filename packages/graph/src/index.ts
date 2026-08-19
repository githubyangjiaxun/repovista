import path from "node:path";
import type { GraphEdge, GraphLevel, GraphNode, RelationType } from "@repovista/contracts";
import type { ParsedFile, ScannedFile } from "@repovista/domain";

export interface GraphFile {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
}

export interface GraphSymbol {
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

export interface GraphRelationship {
  id: string;
  fromSymbolId: string;
  toSymbolId: string | null;
  unresolvedTarget: string | null;
  relationType: string;
  confidence: number;
}

export interface GraphInput {
  files: GraphFile[];
  symbols: GraphSymbol[];
  edges: GraphRelationship[];
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

function importanceFromDegree(degree: number, maximum: number): number {
  if (maximum <= 0) return 0.2;
  return Math.min(1, 0.2 + (degree / maximum) * 0.8);
}

function packageName(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  if (directory === ".") return "root";
  return directory.split("/").slice(0, 2).join("/");
}

function asRelationType(value: string): RelationType {
  const allowed: RelationType[] = [
    "contains",
    "imports",
    "calls",
    "extends",
    "implements",
    "exports",
    "reads",
    "writes",
  ];
  return allowed.includes(value as RelationType) ? (value as RelationType) : "contains";
}

export function buildGraphView(
  input: GraphInput,
  level: GraphLevel,
  maximumNodes = 2_000,
): GraphView {
  if (level === "package") return buildPackageView(input, maximumNodes);
  if (level === "file") return buildFileView(input, maximumNodes);
  return buildSymbolView(input, maximumNodes);
}

function buildPackageView(input: GraphInput, maximumNodes: number): GraphView {
  const packages = new Map<string, GraphNode>();
  const fileToPackage = new Map<string, string>();
  for (const file of input.files) {
    const name = packageName(file.path);
    const id = `package:${name}`;
    fileToPackage.set(file.id, id);
    const existing = packages.get(id);
    packages.set(id, {
      id,
      level: "package",
      kind: "package",
      label: name,
      path: name === "root" ? null : name,
      range: null,
      importance: 0.2,
      metadata: {
        files: Number(existing?.metadata.files ?? 0) + 1,
        bytes: Number(existing?.metadata.bytes ?? 0) + file.byteSize,
      },
    });
  }

  const symbolToFile = new Map(input.symbols.map((symbol) => [symbol.id, symbol.fileId]));
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const degrees = new Map<string, number>();
  for (const relationship of input.edges) {
    if (!relationship.toSymbolId) continue;
    const fromFile = symbolToFile.get(relationship.fromSymbolId);
    const toFile = symbolToFile.get(relationship.toSymbolId);
    const from = fromFile ? fileToPackage.get(fromFile) : undefined;
    const to = toFile ? fileToPackage.get(toFile) : undefined;
    if (!from || !to || from === to) continue;
    const type = asRelationType(relationship.relationType);
    const key = `${from}:${to}:${type}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: `package-edge:${key}`,
      from,
      to,
      type,
      confidence: relationship.confidence,
    });
    degrees.set(from, (degrees.get(from) ?? 0) + 1);
    degrees.set(to, (degrees.get(to) ?? 0) + 1);
  }
  const maximumDegree = Math.max(0, ...degrees.values());
  const nodes = [...packages.values()]
    .map((node) => ({
      ...node,
      importance: importanceFromDegree(degrees.get(node.id) ?? 0, maximumDegree),
    }))
    .slice(0, maximumNodes);
  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
    truncated: packages.size > maximumNodes,
  };
}

function buildFileView(input: GraphInput, maximumNodes: number): GraphView {
  const symbolsById = new Map(input.symbols.map((symbol) => [symbol.id, symbol]));
  const degrees = new Map<string, number>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const relationship of input.edges) {
    if (!relationship.toSymbolId) continue;
    const from = symbolsById.get(relationship.fromSymbolId)?.fileId;
    const to = symbolsById.get(relationship.toSymbolId)?.fileId;
    if (!from || !to || from === to) continue;
    const type = asRelationType(relationship.relationType);
    const key = `${from}:${to}:${type}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({
      id: `file-edge:${key}`,
      from,
      to,
      type,
      confidence: relationship.confidence,
    });
    degrees.set(from, (degrees.get(from) ?? 0) + 1);
    degrees.set(to, (degrees.get(to) ?? 0) + 1);
  }
  const maximumDegree = Math.max(0, ...degrees.values());
  const allNodes: GraphNode[] = input.files.map((file) => ({
    id: file.id,
    level: "file",
    kind: file.language ?? "text",
    label: path.posix.basename(file.path),
    path: file.path,
    range: null,
    importance: importanceFromDegree(degrees.get(file.id) ?? 0, maximumDegree),
    metadata: {
      language: file.language,
      lines: file.lineCount,
      bytes: file.byteSize,
    },
  }));
  const nodes = allNodes.slice(0, maximumNodes);
  const visible = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to)),
    truncated: allNodes.length > maximumNodes,
  };
}

function buildSymbolView(input: GraphInput, maximumNodes: number): GraphView {
  const degrees = new Map<string, number>();
  for (const edge of input.edges) {
    degrees.set(edge.fromSymbolId, (degrees.get(edge.fromSymbolId) ?? 0) + 1);
    if (edge.toSymbolId) {
      degrees.set(edge.toSymbolId, (degrees.get(edge.toSymbolId) ?? 0) + 1);
    }
  }
  const maximumDegree = Math.max(0, ...degrees.values());
  const allNodes: GraphNode[] = input.symbols.map((symbol) => ({
    id: symbol.id,
    level: "symbol",
    kind: symbol.kind,
    label: symbol.qualifiedName ?? symbol.name,
    path: symbol.path,
    range: {
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    },
    importance: importanceFromDegree(degrees.get(symbol.id) ?? 0, maximumDegree),
    metadata: {
      stableKey: symbol.stableKey,
    },
  }));
  const nodes = allNodes.slice(0, maximumNodes);
  const visible = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = input.edges
    .filter(
      (edge) =>
        edge.toSymbolId !== null && visible.has(edge.fromSymbolId) && visible.has(edge.toSymbolId),
    )
    .map((edge) => ({
      id: edge.id,
      from: edge.fromSymbolId,
      to: edge.toSymbolId as string,
      type: asRelationType(edge.relationType),
      confidence: edge.confidence,
    }));
  return { nodes, edges, truncated: allNodes.length > maximumNodes };
}

export function resolveLocalImport(
  fromPath: string,
  importSource: string,
  knownPaths: ReadonlySet<string>,
): string | null {
  if (!importSource.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), importSource));
  const runtimeExtension = path.posix.extname(base);
  const sourceBase = [".js", ".jsx", ".mjs", ".cjs"].includes(runtimeExtension)
    ? base.slice(0, -runtimeExtension.length)
    : base;
  const candidates = [
    base,
    `${sourceBase}.ts`,
    `${sourceBase}.tsx`,
    `${sourceBase}.js`,
    `${sourceBase}.jsx`,
    `${sourceBase}.mjs`,
    `${sourceBase}.cjs`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mjs`,
    `${base}/index.cjs`,
  ];
  return [...new Set(candidates)].find((candidate) => knownPaths.has(candidate)) ?? null;
}

export function linkParsedImports(
  files: readonly ScannedFile[],
  parsedFiles: readonly ParsedFile[],
): ParsedFile[] {
  const knownPaths = new Set(files.map((file) => file.path));
  const moduleByPath = new Map(parsedFiles.map((file) => [file.path, file.moduleStableKey]));
  return parsedFiles.map((parsed) => {
    const resolvedSources = new Set<string>();
    const localEdges = parsed.imports.flatMap((item) => {
      const resolved = resolveLocalImport(parsed.path, item.source, knownPaths);
      const target = resolved ? moduleByPath.get(resolved) : undefined;
      if (!target) return [];
      resolvedSources.add(item.source);
      return [
        {
          fromStableKey: parsed.moduleStableKey,
          targetStableKey: target,
          type: "imports" as const,
          confidence: 1,
          evidence: {
            path: parsed.path,
            startLine: item.startLine,
            endLine: item.endLine,
            syntaxType: "import_statement",
            importSource: item.source,
            importedNames: item.importedNames,
          },
        },
      ];
    });
    return {
      ...parsed,
      edges: [
        ...parsed.edges.filter(
          (edge) =>
            edge.type !== "imports" ||
            !resolvedSources.has(edge.evidence.importSource ?? edge.unresolvedTarget ?? ""),
        ),
        ...localEdges,
      ],
    };
  });
}
