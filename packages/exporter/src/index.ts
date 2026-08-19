import type {
  GraphEdge,
  GraphLevel,
  GraphNode,
  RepositorySummary,
  Snapshot,
} from "@repovista/contracts";

export const EXPORT_NODE_LIMIT = 250;
export const EXPORT_EDGE_LIMIT = 2_000;

export interface ExportFileSummary {
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  parseStatus: string;
}

export interface ExportGraphView {
  level: GraphLevel;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface SnapshotExportInput {
  repository: RepositorySummary;
  snapshot: Snapshot & { commitSha: string };
  files: ExportFileSummary[];
  graph: ExportGraphView;
}

export interface ExportArtifact {
  body: string;
  contentType: "text/markdown; charset=utf-8" | "image/svg+xml; charset=utf-8";
  filename: string;
}

export interface ReadingPathEntry {
  path: string;
  reason: string;
}

interface NormalizedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  omittedNodes: number;
  omittedEdges: number;
  truncated: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nodeKey(node: GraphNode): string {
  return [node.path ?? "", node.label, node.kind, node.id].join("\u0000");
}

function selectionOrder(left: GraphNode, right: GraphNode): number {
  return right.importance - left.importance || compareText(nodeKey(left), nodeKey(right));
}

function layoutOrder(left: GraphNode, right: GraphNode): number {
  return compareText(nodeKey(left), nodeKey(right));
}

function edgeOrder(left: GraphEdge, right: GraphEdge): number {
  return compareText(
    [left.from, left.to, left.type, left.id].join("\u0000"),
    [right.from, right.to, right.type, right.id].join("\u0000"),
  );
}

function normalizeGraph(
  graph: ExportGraphView,
  nodeLimit = EXPORT_NODE_LIMIT,
  edgeLimit = EXPORT_EDGE_LIMIT,
): NormalizedGraph {
  const selected = [...graph.nodes].sort(selectionOrder).slice(0, nodeLimit);
  const visible = new Set(selected.map((node) => node.id));
  const visibleEdges = graph.edges
    .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
    .sort(edgeOrder);
  const edges = visibleEdges.slice(0, edgeLimit);
  const omittedNodes = Math.max(0, graph.nodes.length - selected.length);
  const omittedEdges = Math.max(0, graph.edges.length - edges.length);
  return {
    nodes: selected.sort(layoutOrder),
    edges,
    omittedNodes,
    omittedEdges,
    truncated: graph.truncated || omittedNodes > 0 || omittedEdges > 0,
  };
}

function cleanText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const valid =
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    return valid ? character : "�";
  }).join("");
}

export function escapeXml(value: string): string {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function markdownCode(value: string): string {
  const text = cleanText(value).replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
  const longestFence = Math.max(0, ...(text.match(/`+/g) ?? []).map((match) => match.length));
  const fence = "`".repeat(longestFence + 1);
  return `${fence} ${text || "—"} ${fence}`;
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized || "repository";
}

function exportFilename(input: SnapshotExportInput, suffix: string): string {
  const repository = safeFilenamePart(`${input.repository.owner}-${input.repository.name}`);
  return `${repository}-${input.snapshot.commitSha.slice(0, 12)}-${suffix}`;
}

function timestamp(input: SnapshotExportInput): { value: string; source: string } {
  if (input.snapshot.readyAt) {
    return { value: input.snapshot.readyAt, source: "repository_snapshots.ready_at" };
  }
  return { value: input.snapshot.requestedAt, source: "repository_snapshots.requested_at" };
}

function readingScore(filePath: string): number {
  const lower = filePath.toLowerCase();
  if (lower === "readme.md") return 100;
  if (["package.json", "pyproject.toml", "requirements.txt"].includes(lower)) return 95;
  if (/(^|\/)(index|main|server|app|__main__)\.(?:[cm]?[jt]sx?|py)$/.test(lower)) return 85;
  if (/^(src|app|lib)\//.test(lower)) return 50;
  return 10;
}

function readingReason(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower === "readme.md") return "Project-maintained overview.";
  if (["package.json", "pyproject.toml", "requirements.txt"].includes(lower)) {
    return "Primary dependency and runtime manifest.";
  }
  if (/(^|\/)(index|main|server|app|__main__)\.(?:[cm]?[jt]sx?|py)$/.test(lower)) {
    return "Likely runtime or module entry point.";
  }
  return "Central indexed implementation file.";
}

export function buildReadingPath(files: readonly ExportFileSummary[]): ReadingPathEntry[] {
  return [...files]
    .sort(
      (left, right) =>
        readingScore(right.path) - readingScore(left.path) || compareText(left.path, right.path),
    )
    .slice(0, 8)
    .map((file) => ({ path: file.path, reason: readingReason(file.path) }));
}

function percentage(count: number, total: number): string {
  return total <= 0 ? "0.0%" : `${((count / total) * 100).toFixed(1)}%`;
}

function markdownNode(node: GraphNode): string {
  const location = node.path ? ` — ${markdownCode(node.path)}` : "";
  return `- ${markdownCode(node.label)} (${markdownCode(node.kind)})${location}`;
}

function markdownEdge(edge: GraphEdge, labels: ReadonlyMap<string, string>): string {
  const from = labels.get(edge.from) ?? edge.from;
  const to = labels.get(edge.to) ?? edge.to;
  return `- ${markdownCode(from)} → ${markdownCode(to)} — ${markdownCode(edge.type)} (${(
    edge.confidence * 100
  ).toFixed(0)}%)`;
}

export function createMarkdownExport(input: SnapshotExportInput): ExportArtifact {
  const graph = normalizeGraph(input.graph);
  const reportTimestamp = timestamp(input);
  const languages = Object.entries(input.snapshot.stats.languages).sort(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || compareText(leftName, rightName),
  );
  const readingPath = buildReadingPath(input.files);
  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const indexing = input.snapshot.stats.indexing;
  const lines = [
    "# RepoVista Architecture Report",
    "",
    "> Deterministic static-analysis export. No AI-generated claims are included.",
    "",
    "## Provenance",
    "",
    `- Repository: ${markdownCode(`${input.repository.owner}/${input.repository.name}`)}`,
    `- Canonical URL: ${markdownCode(input.repository.canonicalUrl)}`,
    `- Full commit: ${markdownCode(input.snapshot.commitSha)}`,
    `- Snapshot ID: ${markdownCode(input.snapshot.id)}`,
    `- Parser version: ${markdownCode(input.snapshot.parserVersion)}`,
    `- Ref: ${markdownCode(input.snapshot.refName ?? "detached")}`,
    `- Deterministic report timestamp: ${markdownCode(reportTimestamp.value)}`,
    `- Timestamp source: ${markdownCode(reportTimestamp.source)}`,
    "",
    "## Snapshot stats",
    "",
    `- Index mode: ${markdownCode(input.snapshot.indexMode)}`,
    `- Files: ${input.snapshot.stats.files}`,
    `- Symbols: ${input.snapshot.stats.symbols}`,
    `- Relationships: ${input.snapshot.stats.edges}`,
    `- Warnings: ${input.snapshot.stats.warnings}`,
    `- Tree hash: ${markdownCode(input.snapshot.treeHash ?? "not recorded")}`,
    "",
    "## Language distribution",
    "",
    "| Language | Files | Share |",
    "| --- | ---: | ---: |",
    ...(languages.length > 0
      ? languages.map(
          ([language, count]) =>
            `| ${markdownCode(language)} | ${count} | ${percentage(count, input.snapshot.stats.files)} |`,
        )
      : ["| ` none ` | 0 | 0.0% |"]),
    "",
    "## Update delta",
    "",
    ...(indexing
      ? [
          `- Mode: ${markdownCode(indexing.mode)}`,
          `- Base snapshot: ${markdownCode(indexing.baseSnapshotId ?? "none")}`,
          `- Base commit: ${markdownCode(indexing.baseCommitSha ?? "none")}`,
          `- Scanned: ${indexing.scannedFiles}`,
          `- Changed: ${indexing.changedFiles}`,
          `- Parsed: ${indexing.parsedFiles}`,
          `- Reused: ${indexing.reusedFiles}`,
          `- Deleted: ${indexing.deletedFiles}`,
        ]
      : ["- Incremental planner evidence was not recorded for this snapshot."]),
    "",
    "## Reading path",
    "",
    ...(readingPath.length > 0
      ? readingPath.map(
          (entry, index) => `${index + 1}. ${markdownCode(entry.path)} — ${entry.reason}`,
        )
      : ["No indexed files were available for a reading path."]),
    "",
    `## Architecture map (${input.graph.level})`,
    "",
    `Visible nodes: ${graph.nodes.length}; visible relationships: ${graph.edges.length}.`,
    "",
    "### Nodes",
    "",
    ...(graph.nodes.length > 0 ? graph.nodes.map(markdownNode) : ["- No graph nodes."]),
    "",
    "### Relationships",
    "",
    ...(graph.edges.length > 0
      ? graph.edges.map((edge) => markdownEdge(edge, labels))
      : ["- No visible graph relationships."]),
    "",
    "## Limitations",
    "",
    "- This report describes indexed syntax and resolved static relationships; runtime behavior may differ.",
    "- Dynamic imports, reflection, generated code, and unsupported syntax can remain unresolved.",
    `- Export safety limit: ${EXPORT_NODE_LIMIT} nodes and ${EXPORT_EDGE_LIMIT} visible relationships.`,
    `- Omitted by export limits: ${graph.omittedNodes} nodes and ${graph.omittedEdges} relationships.`,
    `- Upstream graph reported truncation: ${input.graph.truncated ? "yes" : "no"}.`,
    "- The report is generated only from immutable Snapshot data and does not call a model provider.",
    "",
  ];
  return {
    body: lines.join("\n"),
    contentType: "text/markdown; charset=utf-8",
    filename: exportFilename(input, "architecture.md"),
  };
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(cleanText(value).replace(/\s+/g, " ").trim());
  return characters.length <= maximum
    ? characters.join("")
    : `${characters.slice(0, Math.max(1, maximum - 1)).join("")}…`;
}

function graphColor(level: GraphLevel): string {
  if (level === "package") return "#1f6feb";
  if (level === "file") return "#2ea043";
  return "#a371f7";
}

export function createSvgExport(input: SnapshotExportInput): ExportArtifact {
  const graph = normalizeGraph(input.graph);
  const reportTimestamp = timestamp(input);
  const nodeWidth = 250;
  const nodeHeight = 72;
  const horizontalGap = 48;
  const verticalGap = 42;
  const margin = 56;
  const headerHeight = 230;
  const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, graph.nodes.length)))));
  const rows = Math.max(1, Math.ceil(graph.nodes.length / columns));
  const width = Math.max(
    960,
    margin * 2 + columns * nodeWidth + Math.max(0, columns - 1) * horizontalGap,
  );
  const height = headerHeight + rows * nodeHeight + Math.max(0, rows - 1) * verticalGap + 110;
  const positions = new Map(
    graph.nodes.map((node, index) => [
      node.id,
      {
        x: margin + (index % columns) * (nodeWidth + horizontalGap),
        y: headerHeight + Math.floor(index / columns) * (nodeHeight + verticalGap),
      },
    ]),
  );
  const color = graphColor(input.graph.level);
  const edgeMarkup = graph.edges.flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return [];
    const startX = from.x + nodeWidth / 2;
    const startY = from.y + nodeHeight / 2;
    const endX = to.x + nodeWidth / 2;
    const endY = to.y + nodeHeight / 2;
    const bend = Math.max(36, Math.abs(endY - startY) * 0.35);
    const controlY = startY <= endY ? startY + bend : startY - bend;
    return [
      `<path class="edge" d="M ${startX} ${startY} Q ${(startX + endX) / 2} ${controlY} ${endX} ${endY}" opacity="${(
        0.28 + edge.confidence * 0.42
      ).toFixed(
        2,
      )}"><title>${escapeXml(edge.type)} · ${(edge.confidence * 100).toFixed(0)}%</title></path>`,
    ];
  });
  const nodeMarkup = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return "";
    const secondary = node.path ?? node.kind;
    return [
      `<g class="node" transform="translate(${position.x} ${position.y})">`,
      `<title>${escapeXml(node.label)}${node.path ? ` · ${escapeXml(node.path)}` : ""}</title>`,
      `<rect width="${nodeWidth}" height="${nodeHeight}" rx="12" />`,
      `<circle cx="20" cy="24" r="6" fill="${color}" />`,
      `<text class="node-label" x="34" y="29">${escapeXml(truncate(node.label, 31))}</text>`,
      `<text class="node-detail" x="20" y="53">${escapeXml(truncate(secondary, 38))}</text>`,
      "</g>",
    ].join("");
  });
  const repositoryName = `${input.repository.owner}/${input.repository.name}`;
  const truncation = graph.truncated
    ? `${graph.omittedNodes} nodes and ${graph.omittedEdges} relationships omitted by export limits or upstream truncation.`
    : "No graph elements were omitted.";
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(repositoryName)} architecture map</title>`,
    `<desc id="description">Deterministic ${escapeXml(input.graph.level)} graph for commit ${escapeXml(input.snapshot.commitSha)}. ${escapeXml(truncation)}</desc>`,
    "<metadata>RepoVista deterministic static-analysis export; no model provider was called.</metadata>",
    "<defs>",
    '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6e7681" /></marker>',
    "</defs>",
    "<style>",
    ".background{fill:#0d1117}.title{fill:#f0f6fc;font:700 28px ui-sans-serif,system-ui,sans-serif}.meta{fill:#8b949e;font:14px ui-monospace,SFMono-Regular,Consolas,monospace}.legend{fill:#c9d1d9;font:13px ui-sans-serif,system-ui,sans-serif}.edge{fill:none;stroke:#6e7681;stroke-width:1.5;marker-end:url(#arrow)}.node rect{fill:#161b22;stroke:#30363d;stroke-width:1.5}.node-label{fill:#f0f6fc;font:600 14px ui-sans-serif,system-ui,sans-serif}.node-detail{fill:#8b949e;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.footer{fill:#8b949e;font:12px ui-sans-serif,system-ui,sans-serif}",
    "</style>",
    `<rect class="background" width="${width}" height="${height}" />`,
    `<text class="title" x="${margin}" y="58">${escapeXml(truncate(repositoryName, 72))} architecture map</text>`,
    `<text class="meta" x="${margin}" y="91">Commit: ${escapeXml(input.snapshot.commitSha)}</text>`,
    `<text class="meta" x="${margin}" y="116">Snapshot: ${escapeXml(input.snapshot.id)} · Parser: ${escapeXml(truncate(input.snapshot.parserVersion, 70))}</text>`,
    `<text class="meta" x="${margin}" y="141">Level: ${escapeXml(input.graph.level)} · Report timestamp: ${escapeXml(reportTimestamp.value)}</text>`,
    `<text class="meta" x="${margin}" y="166">Timestamp source: ${escapeXml(reportTimestamp.source)}</text>`,
    `<circle cx="${margin + 6}" cy="198" r="6" fill="${color}" /><text class="legend" x="${margin + 20}" y="203">${escapeXml(input.graph.level)} node</text>`,
    `<path d="M ${margin + 150} 198 L ${margin + 202} 198" class="edge" /><text class="legend" x="${margin + 216}" y="203">static relationship · ${graph.nodes.length} nodes · ${graph.edges.length} edges</text>`,
    `<g aria-label="relationships">${edgeMarkup.join("")}</g>`,
    `<g aria-label="nodes">${nodeMarkup.join("")}</g>`,
    `<text class="footer" x="${margin}" y="${height - 54}">${escapeXml(truncate(truncation, 150))}</text>`,
    `<text class="footer" x="${margin}" y="${height - 31}">Static syntax map; dynamic runtime behavior and unsupported syntax may not be represented.</text>`,
    "</svg>",
    "",
  ].join("\n");
  return {
    body,
    contentType: "image/svg+xml; charset=utf-8",
    filename: exportFilename(input, `${input.graph.level}-map.svg`),
  };
}
