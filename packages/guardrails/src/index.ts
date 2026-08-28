import { createHash } from "node:crypto";
import type {
  GuardrailComparison,
  GuardrailComparisonStatus,
  GuardrailEvidence,
  GuardrailExplanation,
  GuardrailExplanationComparison,
  GuardrailFinding,
  GuardrailProfile,
  GuardrailReport,
  GuardrailReview,
  GuardrailRuleId,
  GuardrailSeverity,
  GuardrailThresholds,
} from "@repovista/contracts";

export const GUARDRAILS_ALGORITHM_VERSION = "architecture-guardrails-v1";
export const BUILT_IN_GUARDRAIL_PROFILE_ID = "00000000-0000-7000-8000-000000000003";

export const DEFAULT_GUARDRAIL_THRESHOLDS: GuardrailThresholds = {
  cycleMaxLength: 12,
  largeFileLines: 800,
  largeFileBytes: 100 * 1024,
  largeSymbolLines: 150,
  highFanIn: 20,
};

const BUILT_IN_PROFILE_CREATED_AT = "2026-01-01T00:00:00.000Z";

function stableProfileInput(
  profileKey: string,
  version: number,
  algorithmVersion: string,
  thresholds: GuardrailThresholds,
): string {
  return JSON.stringify({
    algorithmVersion,
    profileKey,
    thresholds: {
      cycleMaxLength: thresholds.cycleMaxLength,
      largeFileBytes: thresholds.largeFileBytes,
      largeFileLines: thresholds.largeFileLines,
      largeSymbolLines: thresholds.largeSymbolLines,
      highFanIn: thresholds.highFanIn,
    },
    version,
  });
}

export function guardrailProfileFingerprint(input: {
  profileKey: string;
  version: number;
  algorithmVersion?: string;
  thresholds: GuardrailThresholds;
}): string {
  return `sha256:${sha(
    stableProfileInput(
      input.profileKey,
      input.version,
      input.algorithmVersion ?? GUARDRAILS_ALGORITHM_VERSION,
      input.thresholds,
    ),
  )}`;
}

export const BUILT_IN_GUARDRAIL_PROFILE: GuardrailProfile = {
  id: BUILT_IN_GUARDRAIL_PROFILE_ID,
  workspaceId: null,
  profileKey: "default",
  name: "Default architecture guardrails",
  description: "The deterministic RepoVista baseline thresholds.",
  version: 1,
  algorithmVersion: GUARDRAILS_ALGORITHM_VERSION,
  thresholds: DEFAULT_GUARDRAIL_THRESHOLDS,
  fingerprint: guardrailProfileFingerprint({
    profileKey: "default",
    version: 1,
    thresholds: DEFAULT_GUARDRAIL_THRESHOLDS,
  }),
  builtIn: true,
  createdBy: null,
  createdAt: BUILT_IN_PROFILE_CREATED_AT,
};

export interface GuardrailSnapshot {
  id: string;
  commitSha: string;
  parserVersion: string;
  requestedAt: string;
  readyAt: string | null;
}

export interface GuardrailFile {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  parseStatus: string;
}

export interface GuardrailSymbol {
  id: string;
  fileId: string;
  path: string;
  kind: string;
  name: string;
  qualifiedName: string | null;
  startLine: number;
  endLine: number;
}

export interface GuardrailEdge {
  id: string;
  fromSymbolId: string;
  toSymbolId: string | null;
  unresolvedTarget: string | null;
  relationType: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface BuildGuardrailReportInput {
  snapshot: GuardrailSnapshot;
  files: readonly GuardrailFile[];
  symbols: readonly GuardrailSymbol[];
  edges: readonly GuardrailEdge[];
  profile?: GuardrailProfile | null;
  thresholds?: Partial<GuardrailThresholds>;
}

interface PackageInfo {
  name: string;
  files: GuardrailFile[];
}

const severityOrder: Record<GuardrailSeverity, number> = { error: 0, warning: 1, info: 2 };

function packageName(filePath: string): string {
  const segments = filePath.replaceAll("\\", "/").split("/");
  if (segments.length <= 1) return "root";
  return segments.slice(0, Math.min(2, segments.length - 1)).join("/");
}

function evidenceLine(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function evidencePath(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mergeThresholds(input: Partial<GuardrailThresholds> | undefined): GuardrailThresholds {
  const merged = { ...DEFAULT_GUARDRAIL_THRESHOLDS, ...(input ?? {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error(`Guardrail threshold ${key} must be a positive integer.`);
    }
  }
  if (merged.cycleMaxLength < 2) throw new Error("Guardrail cycleMaxLength must be at least 2.");
  return merged;
}

function finding(input: {
  snapshotId: string;
  ruleId: GuardrailRuleId;
  severity: GuardrailSeverity;
  title: string;
  message: string;
  path: string;
  startLine: number;
  endLine?: number;
  metric: Record<string, number | string>;
  evidence: GuardrailEvidence[];
}): GuardrailFinding {
  const endLine = Math.max(input.startLine, input.endLine ?? input.startLine);
  const location = `${input.path}:${input.startLine}-${endLine}`;
  const fingerprint = `sha256:${sha(
    [input.snapshotId, input.ruleId, location, JSON.stringify(input.metric)].join("\n"),
  )}`;
  return {
    id: `${input.ruleId}:${fingerprint.slice(-16)}`,
    fingerprint,
    ruleId: input.ruleId,
    severity: input.severity,
    title: input.title,
    message: input.message,
    path: input.path,
    startLine: input.startLine,
    endLine,
    metric: input.metric,
    evidence: input.evidence.slice(0, 20),
  };
}

function sortedUnique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const map = new Map<string, T>();
  for (const value of values) map.set(key(value), value);
  return [...map.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

function stronglyConnectedComponents(
  nodes: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(target) ?? 0));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (true) {
      const current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
      if (current === node) break;
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  }

  for (const node of [...nodes].sort((left, right) => left.localeCompare(right))) {
    if (!indices.has(node)) visit(node);
  }
  return components.sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
}

function cycleFindings(
  input: BuildGuardrailReportInput,
  thresholds: GuardrailThresholds,
  filesById: ReadonlyMap<string, GuardrailFile>,
  symbolsById: ReadonlyMap<string, GuardrailSymbol>,
): GuardrailFinding[] {
  const packageFiles = new Map<string, PackageInfo>();
  for (const file of input.files) {
    const name = packageName(file.path);
    const current = packageFiles.get(name) ?? { name, files: [] };
    current.files.push(file);
    packageFiles.set(name, current);
  }
  const adjacency = new Map<string, Set<string>>();
  const cycleEdges: GuardrailEdge[] = [];
  for (const edge of input.edges) {
    if (edge.relationType !== "imports" || !edge.toSymbolId) continue;
    const from = symbolsById.get(edge.fromSymbolId);
    const to = symbolsById.get(edge.toSymbolId);
    const fromFile = from ? filesById.get(from.fileId) : undefined;
    const toFile = to ? filesById.get(to.fileId) : undefined;
    if (!fromFile || !toFile) continue;
    const fromPackage = packageName(fromFile.path);
    const toPackage = packageName(toFile.path);
    if (fromPackage === toPackage) continue;
    const targets = adjacency.get(fromPackage) ?? new Set<string>();
    targets.add(toPackage);
    adjacency.set(fromPackage, targets);
    cycleEdges.push(edge);
  }
  const components = stronglyConnectedComponents(
    [...packageFiles.keys()],
    new Map([...adjacency].map(([key, value]) => [key, [...value].sort()])),
  );
  return components
    .filter((component) => component.length >= 2 && component.length <= thresholds.cycleMaxLength)
    .map((component) => {
      const componentSet = new Set(component);
      const relatedEdges = cycleEdges.filter((edge) => {
        const from = symbolsById.get(edge.fromSymbolId);
        const to = edge.toSymbolId ? symbolsById.get(edge.toSymbolId) : undefined;
        const fromFile = from ? filesById.get(from.fileId) : undefined;
        const toFile = to ? filesById.get(to.fileId) : undefined;
        return (
          fromFile !== undefined &&
          toFile !== undefined &&
          componentSet.has(packageName(fromFile.path)) &&
          componentSet.has(packageName(toFile.path))
        );
      });
      const representative = [...component]
        .flatMap((name) => packageFiles.get(name)?.files ?? [])
        .sort((left, right) => left.path.localeCompare(right.path))[0];
      const edge = relatedEdges.slice().sort((left, right) => left.id.localeCompare(right.id))[0];
      const path = representative?.path ?? `${component[0] ?? "root"}/index`;
      const startLine = evidenceLine(edge?.evidence.startLine, 1);
      const evidence = relatedEdges.slice(0, 20).map((item) => {
        const from = symbolsById.get(item.fromSymbolId);
        const fromFile = from ? filesById.get(from.fileId) : undefined;
        const evidencePathValue = evidencePath(item.evidence.path, fromFile?.path ?? path);
        const line = evidenceLine(item.evidence.startLine, startLine);
        return {
          path: evidencePathValue,
          startLine: line,
          endLine: evidenceLine(item.evidence.endLine, line),
          description: `Import edge participates in package cycle ${component.join(" → ")}.`,
        };
      });
      return finding({
        snapshotId: input.snapshot.id,
        ruleId: "dependency_cycle",
        severity: "error",
        title: "Package dependency cycle",
        message: `Packages ${component.join(" → ")} form a dependency cycle.`,
        path,
        startLine,
        metric: { packageCount: component.length, packages: component.join(",") },
        evidence:
          evidence.length > 0
            ? evidence
            : [{ path, startLine, endLine: startLine, description: "Cycle representative." }],
      });
    });
}

export function buildGuardrailReport(input: BuildGuardrailReportInput): GuardrailReport {
  const profile = input.profile ?? (input.thresholds ? null : BUILT_IN_GUARDRAIL_PROFILE);
  if (profile) {
    if (profile.algorithmVersion !== GUARDRAILS_ALGORITHM_VERSION) {
      throw new Error("Guardrail profile uses an incompatible algorithm version.");
    }
    if (profile.fingerprint !== guardrailProfileFingerprint(profile)) {
      throw new Error("Guardrail profile fingerprint is invalid.");
    }
    if (
      input.thresholds &&
      stableSerialize(mergeThresholds(input.thresholds)) !== stableSerialize(profile.thresholds)
    ) {
      throw new Error("Guardrail profile thresholds cannot be overridden.");
    }
  }
  const thresholds = profile ? profile.thresholds : mergeThresholds(input.thresholds);
  const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path));
  const symbols = [...input.symbols].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.startLine - right.startLine ||
      left.id.localeCompare(right.id),
  );
  const filesById = new Map(files.map((file) => [file.id, file]));
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const findings: GuardrailFinding[] = [];

  findings.push(...cycleFindings(input, thresholds, filesById, symbolsById));

  for (const file of files) {
    if (file.lineCount > thresholds.largeFileLines || file.byteSize > thresholds.largeFileBytes) {
      findings.push(
        finding({
          snapshotId: input.snapshot.id,
          ruleId: "large_file",
          severity: "warning",
          title: "Large source file",
          message: `${file.path} has ${file.lineCount} lines and ${file.byteSize} bytes, exceeding the configured file threshold.`,
          path: file.path,
          startLine: 1,
          endLine: Math.max(1, file.lineCount),
          metric: { lines: file.lineCount, bytes: file.byteSize },
          evidence: [
            {
              path: file.path,
              startLine: 1,
              endLine: Math.max(1, file.lineCount),
              description: "File size and line count.",
            },
          ],
        }),
      );
    }
    if (file.parseStatus !== "parsed") {
      findings.push(
        finding({
          snapshotId: input.snapshot.id,
          ruleId: "parse_failure",
          severity: "warning",
          title: "File was not fully parsed",
          message: `${file.path} has parser status ${file.parseStatus}. Graph relationships may be incomplete.`,
          path: file.path,
          startLine: 1,
          metric: { parseStatus: file.parseStatus },
          evidence: [
            {
              path: file.path,
              startLine: 1,
              endLine: Math.max(1, file.lineCount),
              description: `Parser status: ${file.parseStatus}.`,
            },
          ],
        }),
      );
    }
  }

  const incoming = new Map<string, GuardrailEdge[]>();
  for (const edge of input.edges) {
    if (edge.toSymbolId && edge.relationType !== "contains") {
      const list = incoming.get(edge.toSymbolId) ?? [];
      list.push(edge);
      incoming.set(edge.toSymbolId, list);
    }
    if (edge.relationType === "imports" && !edge.toSymbolId) {
      const from = symbolsById.get(edge.fromSymbolId);
      const file = from ? filesById.get(from.fileId) : undefined;
      const path = evidencePath(edge.evidence.path, file?.path ?? "unknown");
      const startLine = evidenceLine(edge.evidence.startLine, 1);
      const target =
        edge.unresolvedTarget ?? String(edge.evidence.importSource ?? "unknown import");
      findings.push(
        finding({
          snapshotId: input.snapshot.id,
          ruleId: "unresolved_import",
          severity: "info",
          title: "Unresolved local import",
          message: `The import ${target} could not be resolved inside this Snapshot.`,
          path,
          startLine,
          endLine: evidenceLine(edge.evidence.endLine, startLine),
          metric: { target },
          evidence: [
            {
              path,
              startLine,
              endLine: evidenceLine(edge.evidence.endLine, startLine),
              description: `Unresolved import: ${target}.`,
            },
          ],
        }),
      );
    }
  }

  for (const symbol of symbols) {
    const span = Math.max(1, symbol.endLine - symbol.startLine + 1);
    if (symbol.kind !== "module" && span > thresholds.largeSymbolLines) {
      findings.push(
        finding({
          snapshotId: input.snapshot.id,
          ruleId: "large_symbol",
          severity: "warning",
          title: "Large symbol",
          message: `${symbol.qualifiedName ?? symbol.name} spans ${span} lines, exceeding the configured symbol threshold.`,
          path: symbol.path,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          metric: { lines: span, symbol: symbol.qualifiedName ?? symbol.name },
          evidence: [
            {
              path: symbol.path,
              startLine: symbol.startLine,
              endLine: symbol.endLine,
              description: "Symbol source range.",
            },
          ],
        }),
      );
    }
    const edges = incoming.get(symbol.id) ?? [];
    if (edges.length >= thresholds.highFanIn) {
      findings.push(
        finding({
          snapshotId: input.snapshot.id,
          ruleId: "high_fan_in",
          severity: "warning",
          title: "High fan-in symbol",
          message: `${symbol.qualifiedName ?? symbol.name} has ${edges.length} incoming relationships.`,
          path: symbol.path,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          metric: { incoming: edges.length, symbol: symbol.qualifiedName ?? symbol.name },
          evidence: [
            {
              path: symbol.path,
              startLine: symbol.startLine,
              endLine: symbol.endLine,
              description: `${edges.length} incoming relationships.`,
            },
          ],
        }),
      );
    }
  }

  const ordered = sortedUnique(
    findings,
    (item) =>
      `${item.ruleId}\u0000${item.path}\u0000${String(item.startLine).padStart(8, "0")}\u0000${item.fingerprint}`,
  ).sort(
    (left, right) =>
      left.ruleId.localeCompare(right.ruleId) ||
      left.path.localeCompare(right.path) ||
      left.startLine - right.startLine ||
      (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99) ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
  const errors = ordered.filter((item) => item.severity === "error").length;
  const warnings = ordered.filter((item) => item.severity === "warning").length;
  const infos = ordered.filter((item) => item.severity === "info").length;
  return {
    algorithmVersion: GUARDRAILS_ALGORITHM_VERSION,
    profile,
    snapshot: {
      id: input.snapshot.id,
      commitSha: input.snapshot.commitSha,
      parserVersion: input.snapshot.parserVersion,
    },
    generatedAt: input.snapshot.readyAt ?? input.snapshot.requestedAt,
    status: errors > 0 ? "fail" : warnings > 0 ? "warn" : "pass",
    summary: { total: ordered.length, errors, warnings, infos },
    thresholds,
    findings: ordered,
  };
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: Array<Record<string, unknown>>;
}

export interface GuardrailJsonExport {
  schemaVersion: "repovista.guardrails.v1";
  deterministic: GuardrailReport;
  reviews: GuardrailReview[];
}

function reviewsForReport(
  report: GuardrailReport,
  reviews: readonly GuardrailReview[],
): GuardrailReview[] {
  const subjectKeys = new Map(
    report.findings.map((finding) => [finding.id, guardrailFindingSubjectKey(finding)]),
  );
  const byFinding = new Map<string, GuardrailReview>();
  for (const review of reviews) {
    if (subjectKeys.get(review.findingId) === review.subjectKey) {
      byFinding.set(review.findingId, review);
    }
  }
  return [...byFinding.values()];
}

/**
 * Build a deterministic JSON artifact that keeps analysis and human review
 * metadata in separate top-level fields. Reviews are sorted independently so
 * callers cannot accidentally make output depend on database row order.
 */
export function buildGuardrailJsonExport(
  report: GuardrailReport,
  reviews: readonly GuardrailReview[] = [],
): GuardrailJsonExport {
  const reportReviews = reviewsForReport(report, reviews);
  return {
    schemaVersion: "repovista.guardrails.v1",
    deterministic: report,
    reviews: reportReviews.sort((left, right) => {
      const findingOrder = left.findingId.localeCompare(right.findingId);
      if (findingOrder !== 0) return findingOrder;
      const statusOrder = left.status.localeCompare(right.status);
      if (statusOrder !== 0) return statusOrder;
      return (left.updatedAt ?? "").localeCompare(right.updatedAt ?? "");
    }),
  };
}

export function buildSarifReport(
  report: GuardrailReport,
  toolVersion = "1.2.0",
  reviews: readonly GuardrailReview[] = [],
): SarifLog {
  const ruleIds = [...new Set(report.findings.map((finding) => finding.ruleId))].sort();
  const rules = ruleIds.map((id) => ({ id, name: id.replaceAll("_", " ") }));
  const reportReviews = reviewsForReport(report, reviews);
  const reviewByFinding = new Map(reportReviews.map((review) => [review.findingId, review]));
  const reviewedCount = reportReviews.filter((review) => review.status !== "unreviewed").length;
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: { name: "RepoVista Architecture Guardrails", version: toolVersion, rules },
        },
        properties: {
          snapshotId: report.snapshot.id,
          commitSha: report.snapshot.commitSha,
          algorithmVersion: report.algorithmVersion,
          guardrailProfileId: report.profile?.id ?? BUILT_IN_GUARDRAIL_PROFILE.id,
          guardrailProfileFingerprint:
            report.profile?.fingerprint ?? BUILT_IN_GUARDRAIL_PROFILE.fingerprint,
          deterministicStatus: report.status,
          reviewMetadataVersion: "guardrail-review-v1",
          reviewCount: reviewedCount,
        },
        results: report.findings.map((finding) => {
          const review = reviewByFinding.get(finding.id);
          return {
            ruleId: finding.ruleId,
            level:
              finding.severity === "error"
                ? "error"
                : finding.severity === "warning"
                  ? "warning"
                  : "note",
            message: { text: finding.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: finding.path },
                  region: { startLine: finding.startLine, endLine: finding.endLine },
                },
              },
            ],
            fingerprints: { primaryLocationLineHash: finding.fingerprint },
            properties: {
              title: finding.title,
              metric: finding.metric,
              evidenceCount: finding.evidence.length,
              reviewStatus: review?.status ?? "unreviewed",
              reviewNote: review?.note ?? "",
              reviewedAt: review?.reviewedAt ?? null,
              reviewedBy: review?.reviewer?.userId ?? null,
            },
          };
        }),
      },
    ],
  };
}

const comparisonSeverityOrder: Record<GuardrailSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

function findingSubjectIdentity(item: GuardrailFinding): string {
  const metric = item.metric;
  switch (item.ruleId) {
    case "dependency_cycle":
      return JSON.stringify([item.ruleId, String(metric.packages ?? item.message)]);
    case "large_file":
    case "parse_failure":
      return JSON.stringify([item.ruleId, item.path]);
    case "large_symbol":
    case "high_fan_in":
      return JSON.stringify([item.ruleId, item.path, String(metric.symbol ?? item.message)]);
    case "unresolved_import":
      return JSON.stringify([
        item.ruleId,
        item.path,
        String(item.startLine),
        String(metric.target ?? item.message),
      ]);
  }
}

export function guardrailFindingSubjectKey(item: GuardrailFinding): string {
  return `sha256:${sha(findingSubjectIdentity(item))}`;
}

function findingSortKey(item: GuardrailFinding): string {
  return [
    item.id,
    item.ruleId,
    item.path,
    String(item.startLine).padStart(8, "0"),
    String(item.endLine).padStart(8, "0"),
    item.severity,
    item.title,
    item.message,
    stableSerialize(item.metric),
    stableSerialize(item.evidence),
  ].join("\u0000");
}

function sameFinding(base: GuardrailFinding, head: GuardrailFinding): boolean {
  return (
    base.ruleId === head.ruleId &&
    base.severity === head.severity &&
    base.title === head.title &&
    base.message === head.message &&
    base.path === head.path &&
    base.startLine === head.startLine &&
    base.endLine === head.endLine &&
    stableSerialize(base.metric) === stableSerialize(head.metric) &&
    stableSerialize(base.evidence) === stableSerialize(head.evidence)
  );
}

function pairFindings(
  base: readonly GuardrailFinding[],
  head: readonly GuardrailFinding[],
): Array<{ base: GuardrailFinding | null; head: GuardrailFinding | null; key: string }> {
  const groupedBase = new Map<string, GuardrailFinding[]>();
  const groupedHead = new Map<string, GuardrailFinding[]>();
  for (const item of base) {
    const key = findingSubjectIdentity(item);
    groupedBase.set(
      key,
      [...(groupedBase.get(key) ?? []), item].sort((a, b) =>
        findingSortKey(a).localeCompare(findingSortKey(b)),
      ),
    );
  }
  for (const item of head) {
    const key = findingSubjectIdentity(item);
    groupedHead.set(
      key,
      [...(groupedHead.get(key) ?? []), item].sort((a, b) =>
        findingSortKey(a).localeCompare(findingSortKey(b)),
      ),
    );
  }
  const keys = [...new Set([...groupedBase.keys(), ...groupedHead.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const pairs: Array<{
    base: GuardrailFinding | null;
    head: GuardrailFinding | null;
    key: string;
  }> = [];
  for (const key of keys) {
    const left = groupedBase.get(key) ?? [];
    const right = groupedHead.get(key) ?? [];
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const baseFinding = left[index] ?? null;
      const headFinding = right[index] ?? null;
      const subject = baseFinding ?? headFinding;
      if (!subject) continue;
      pairs.push({
        base: baseFinding,
        head: headFinding,
        key: guardrailFindingSubjectKey(subject),
      });
    }
  }
  return pairs;
}

function comparisonStatus(
  base: GuardrailFinding | null,
  head: GuardrailFinding | null,
): GuardrailComparisonStatus {
  if (!base) return "added";
  if (!head) return "resolved";
  return sameFinding(base, head) ? "unchanged" : "changed";
}

function isRegression(
  base: GuardrailFinding | null,
  head: GuardrailFinding | null,
  status: GuardrailComparisonStatus,
): boolean {
  if (status === "added") return head?.severity === "warning" || head?.severity === "error";
  if (status !== "changed" || !base || !head) return false;
  return comparisonSeverityOrder[head.severity] > comparisonSeverityOrder[base.severity];
}

function isImprovement(
  base: GuardrailFinding | null,
  head: GuardrailFinding | null,
  status: GuardrailComparisonStatus,
): boolean {
  if (status === "resolved") return base?.severity === "warning" || base?.severity === "error";
  if (status !== "changed" || !base || !head) return false;
  return comparisonSeverityOrder[head.severity] < comparisonSeverityOrder[base.severity];
}

export function compareGuardrailReports(
  base: GuardrailReport,
  head: GuardrailReport,
): GuardrailComparison {
  if (base.algorithmVersion !== head.algorithmVersion) {
    throw new Error("Guardrail reports use incompatible algorithm versions.");
  }
  const baseProfile = base.profile ?? BUILT_IN_GUARDRAIL_PROFILE;
  const headProfile = head.profile ?? BUILT_IN_GUARDRAIL_PROFILE;
  if (baseProfile.fingerprint !== headProfile.fingerprint) {
    throw new Error("Guardrail reports use incompatible policy profiles.");
  }
  if (stableSerialize(base.thresholds) !== stableSerialize(head.thresholds)) {
    throw new Error("Guardrail reports use incompatible thresholds.");
  }
  const findings = pairFindings(base.findings, head.findings).map(
    ({ base: left, head: right, key }) => ({
      key,
      status: comparisonStatus(left, right),
      base: left,
      head: right,
    }),
  );
  const summary = {
    total: findings.length,
    added: findings.filter((item) => item.status === "added").length,
    resolved: findings.filter((item) => item.status === "resolved").length,
    unchanged: findings.filter((item) => item.status === "unchanged").length,
    changed: findings.filter((item) => item.status === "changed").length,
    regressions: findings.filter((item) => isRegression(item.base, item.head, item.status)).length,
    improvements: findings.filter((item) => isImprovement(item.base, item.head, item.status))
      .length,
  };
  const overall =
    summary.regressions > 0 ? "regressed" : summary.improvements > 0 ? "improved" : "unchanged";
  return {
    algorithmVersion: head.algorithmVersion,
    profile: headProfile,
    base,
    head,
    overall,
    summary,
    findings,
  };
}

function difference(left: unknown, right: unknown): "same" | "changed" {
  return stableSerialize(left) === stableSerialize(right) ? "same" : "changed";
}

export function compareGuardrailExplanations(
  base: GuardrailExplanation,
  head: GuardrailExplanation,
): GuardrailExplanationComparison {
  const baseSubjectKey = guardrailFindingSubjectKey(base.finding);
  const headSubjectKey = guardrailFindingSubjectKey(head.finding);
  if (
    base.subjectKey !== baseSubjectKey ||
    head.subjectKey !== headSubjectKey ||
    base.subjectKey !== head.subjectKey
  ) {
    throw new Error("Guardrail explanations describe different logical findings.");
  }
  const differences: GuardrailExplanationComparison["differences"] = {
    provenance: {
      snapshotId: difference(base.snapshot.id, head.snapshot.id),
      commitSha: difference(base.snapshot.commitSha, head.snapshot.commitSha),
      parserVersion: difference(base.snapshot.parserVersion, head.snapshot.parserVersion),
      algorithmVersion: difference(base.snapshot.algorithmVersion, head.snapshot.algorithmVersion),
      profileFingerprint: difference(base.profileFingerprint, head.profileFingerprint),
      provider: difference(base.answer.provider, head.answer.provider),
      model: difference(base.answer.model, head.answer.model),
      promptVersion: difference(base.promptVersion, head.promptVersion),
    },
    finding: {
      id: difference(base.finding.id, head.finding.id),
      fingerprint: difference(base.finding.fingerprint, head.finding.fingerprint),
      severity: difference(base.finding.severity, head.finding.severity),
      title: difference(base.finding.title, head.finding.title),
      message: difference(base.finding.message, head.finding.message),
      path: difference(base.finding.path, head.finding.path),
      range: difference(
        [base.finding.startLine, base.finding.endLine],
        [head.finding.startLine, head.finding.endLine],
      ),
      metric: difference(base.finding.metric, head.finding.metric),
      evidence: difference(base.finding.evidence, head.finding.evidence),
    },
    answer: {
      status: difference(base.answer.status, head.answer.status),
      summary: difference(base.answer.summary, head.answer.summary),
      steps: difference(base.answer.steps, head.answer.steps),
      limitations: difference(base.answer.limitations, head.answer.limitations),
      citations: difference(base.answer.citations, head.answer.citations),
    },
  };
  return {
    subjectKey: base.subjectKey,
    changed: Object.values(differences).some((group) =>
      Object.values(group).some((value) => value === "changed"),
    ),
    base,
    head,
    differences,
  };
}
