import { chmod, writeFile } from "node:fs/promises";
import type {
  AskResult,
  GuardrailComparison,
  GuardrailExplanationComparison,
  GuardrailExplanationHistory,
  GuardrailProfile,
  GuardrailReview,
  GuardrailReviewHistoryPage,
  GuardrailReviewsResponse,
  NotificationDelivery,
  NotificationDeliveryPage,
  NotificationEndpoint,
} from "@repovista/contracts";
import {
  createGuardrailProfileRequestSchema,
  createRepositoryRequestSchema,
  type GuardrailReport,
  idSchema,
  type Job,
  type RepositorySummary,
  retrievalModeSchema,
  type SearchResult,
  type Snapshot,
} from "@repovista/contracts";
import { ApiError, RepoVistaClient } from "./api-client.js";
import {
  activeCliProfile,
  CliConfigError,
  cliConfigPath,
  loadCliConfig,
  removeActiveCliProfile,
  saveCliConfig,
  upsertCliProfile,
} from "./config.js";
import { CLI_VERSION } from "./version.js";

const DEFAULT_API_URL = "http://localhost:4000";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS = {
  cycleMaxLength: 12,
  largeFileLines: 800,
  largeFileBytes: 100 * 1024,
  largeSymbolLines: 150,
  highFanIn: 20,
};

const mainHelp = [
  "RepoVista CLI",
  "",
  "Analyze public or installed private GitHub repositories through a RepoVista API.",
  "RepoVista clones source only; it never installs or executes repository code.",
  "",
  "Usage:",
  "  repovista <command> [options]",
  "",
  "Commands:",
  "  analyze <url>           Queue a repository analysis",
  "  status <job-id>         Inspect or watch an indexing job",
  "  repositories            List imported repositories",
  "  show <repository-id>    Show a repository and its snapshots",
  "  ask <repository-id>     Ask an evidence-backed question",
  "  search <snapshot-id>    Search fixed snapshot evidence",
  "  embed <snapshot-id>     Build a semantic embedding index",
  "  guardrails <target>      Evaluate reports or manage policy profiles",
  "  notifications <target>  Manage signed Workspace notification Webhooks",
  "  auth <action>           Login, inspect, or remove local CLI authentication",
  "  workspace <action>      List or select locally authenticated workspaces",
  "  github <action>         List GitHub App installations or repositories",
  "  doctor                  Check API readiness",
  "",
  "Global options:",
  "  --api-url <url>         API origin (default: REPOVISTA_API_URL or http://localhost:4000)",
  "  --request-timeout <n>   Per-request timeout, such as 30s or 2m",
  "  --json                  Emit machine-readable JSON",
  "  -h, --help              Show help",
  "  -V, --version           Show the CLI version",
  "",
  "Run `repovista <command> --help` for command-specific options.",
].join("\n");

const commandHelp: Record<string, string> = {
  analyze: [
    "Usage: repovista analyze <https://github.com/owner/repository> [options]",
    "",
    "Options:",
    "  --ref <name>            Branch, tag, or commit to analyze",
    "  --ignore <path>         Ignore a repository-relative path; repeatable",
    "  --installation <id>     Use a connected GitHub App installation",
    "  --wait                  Wait for indexing to finish",
    "  --poll-interval <n>     Poll interval while waiting (default: 2s)",
    "  --timeout <n>           Maximum wait time (default: 15m)",
  ].join("\n"),
  status: [
    "Usage: repovista status <job-id> [options]",
    "",
    "Options:",
    "  --watch                 Poll until the job finishes",
    "  --poll-interval <n>     Poll interval while watching (default: 2s)",
    "  --timeout <n>           Maximum watch time (default: 15m)",
  ].join("\n"),
  repositories: "Usage: repovista repositories [--json]",
  show: "Usage: repovista show <repository-id> [--json]",
  ask: [
    "Usage: repovista ask <repository-id> <question...> [options]",
    "",
    "Options:",
    "  --snapshot <id>         Ask against a specific immutable snapshot",
    "  --provider <name>       fake, ollama, or openai-compatible",
    "  --model <name>          Override the configured chat model",
  ].join("\n"),
  search: [
    "Usage: repovista search <snapshot-id> <query...> [options]",
    "",
    "Options:",
    "  --mode <name>           text, symbol, semantic, or hybrid (default: hybrid)",
    "  --limit <n>             Maximum results from 1 to 100 (default: 20)",
  ].join("\n"),
  embed: [
    "Usage: repovista embed <snapshot-id> [options]",
    "",
    "Options:",
    "  --wait                  Wait for the embedding job to finish",
    "  --poll-interval <n>     Poll interval while waiting (default: 2s)",
    "  --timeout <n>           Maximum wait time (default: 15m)",
  ].join("\n"),
  guardrails: [
    "Usage: repovista guardrails <snapshot-id> [options]",
    "       repovista guardrails compare <base-snapshot-id> <head-snapshot-id> [options]",
    "       repovista guardrails explain <snapshot-id> <finding-id> [options]",
    "       repovista guardrails explanations history <snapshot-id> <finding-id> [options]",
    "       repovista guardrails explanations compare <repository-id> <base-id> <head-id> [options]",
    "       repovista guardrails reviews list <snapshot-id> [options]",
    "       repovista guardrails reviews set <snapshot-id> <finding-id> <status> [options]",
    "       repovista guardrails reviews clear <snapshot-id> <finding-id> [options]",
    "       repovista guardrails reviews history <snapshot-id> [options]",
    "       repovista guardrails profiles [--json]",
    "       repovista guardrails profile create <key> --name <name> [options]",
    "       repovista guardrails profile assign <repository-id> <profile-id|default>",
    "",
    "Report options:",
    "  --sarif <file>          Save a SARIF 2.1.0 report to a local file",
    "  --json-export <file>    Save deterministic + review metadata JSON to a local file",
    "  --json                  Emit the complete Guardrails JSON report",
    "  --provider <name>       fake, ollama, or openai-compatible (for explain)",
    "  --model <name>          Override the configured explanation model",
    "  --limit <n>             Explanation history page size from 1 to 50 (default: 20)",
    "  --cursor <value>        Continue explanation history from a server cursor",
    "  --note <text>           Human review note (maximum 2,000 characters)",
    "",
    "Profile create options (unspecified thresholds use the built-in default):",
    "  --name <name>                 Human-readable profile name (required)",
    "  --description <text>          Reviewable policy description",
    "  --cycle-max-length <n>        Maximum dependency cycle length (2-100)",
    "  --large-file-lines <n>        Large file line threshold",
    "  --large-file-bytes <n>        Large file byte threshold",
    "  --large-symbol-lines <n>      Large symbol line threshold",
    "  --high-fan-in <n>             High fan-in threshold",
    "",
    "Exit codes: 0 means no error-level findings; 2 means at least one error-level finding.",
  ].join("\n"),
  notifications: [
    "Usage: repovista notifications endpoints <list|create|update|delete|test> ...",
    "       repovista notifications deliveries list <workspace-id> [options]",
    "",
    "Endpoint create options: --name <name> --url <https-url> [--event <event>] [--disabled]",
    "Endpoint update options: --name <name> --url <https-url> [--event <event>] [--enabled|--disabled]",
    "Events: guardrail_review.updated, guardrail_review.cleared",
    "The create command prints the signing secret once; it is never returned again.",
  ].join("\n"),
  doctor: "Usage: repovista doctor [--json]",
  auth: [
    "Usage: repovista auth <login|status|logout> [options]",
    "",
    "`auth login` reads a RepoVista API token from hidden stdin and stores it locally with mode 0600.",
    "Create the token in RepoVista Settings; tokens are never accepted as command-line arguments.",
  ].join("\n"),
  workspace: "Usage: repovista workspace <list|use> [workspace-id] [--json]",
  github: [
    "Usage: repovista github <installations|repos> [installation-id] [options]",
    "",
    "Options for `repos`:",
    "  --page <n>              Page number (default: 1)",
    "  --page-size <n>         Results per page from 1 to 100 (default: 50)",
  ].join("\n"),
};

type OptionKind = "boolean" | "repeat" | "string";

interface ParsedOptions {
  options: Record<string, boolean | string | string[]>;
  positionals: string[];
}

interface Invocation {
  command: string;
  commandArguments: string[];
}

interface CliOutput {
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export interface CliDependencies {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  output?: Partial<CliOutput>;
  readToken?: () => Promise<string>;
  sleep?: (milliseconds: number) => Promise<void>;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function optionName(value: string): string {
  return value.slice(2).replaceAll("-", "_");
}

function parseOptions(args: string[], specification: Record<string, OptionKind>): ParsedOptions {
  const options: ParsedOptions["options"] = {};
  const positionals: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (positionalOnly || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (["-h", "--help"].includes(argument)) {
      options.help = true;
      continue;
    }
    if (["-V", "--version"].includes(argument)) {
      options.version = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new UsageError(`Unknown option: ${argument}`);
    }

    const separator = argument.indexOf("=");
    const rawName = separator === -1 ? argument : argument.slice(0, separator);
    const name = optionName(rawName);
    const kind = specification[name];
    if (!kind) throw new UsageError(`Unknown option: ${rawName}`);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);

    if (kind === "boolean") {
      if (inlineValue !== undefined) {
        throw new UsageError(`Option ${rawName} does not accept a value.`);
      }
      options[name] = true;
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith("-"))) {
      throw new UsageError(`Option ${rawName} requires a value.`);
    }
    if (inlineValue === undefined) index += 1;
    if (kind === "repeat") {
      const existing = options[name];
      options[name] = [...(Array.isArray(existing) ? existing : []), value];
    } else {
      options[name] = value;
    }
  }

  return { options, positionals };
}

const globalSpecification: Record<string, OptionKind> = {
  api_url: "string",
  json: "boolean",
  request_timeout: "string",
};

function specification(extra: Record<string, OptionKind> = {}): Record<string, OptionKind> {
  return { ...globalSpecification, ...extra };
}

function parseInvocation(args: string[]): Invocation {
  const leadingOptions: string[] = [];
  let index = 0;
  while (index < args.length) {
    const argument = args[index];
    if (argument === undefined || !argument.startsWith("-")) break;
    if (["-h", "--help", "-V", "--version"].includes(argument)) {
      return { command: argument, commandArguments: [] };
    }
    if (argument === "--json") {
      leadingOptions.push(argument);
      index += 1;
      continue;
    }
    const globalWithValue = ["--api-url", "--request-timeout"].find(
      (name) => argument === name || argument.startsWith(`${name}=`),
    );
    if (!globalWithValue) throw new UsageError(`Unknown global option: ${argument}`);
    leadingOptions.push(argument);
    if (argument === globalWithValue) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`Option ${globalWithValue} requires a value.`);
      }
      leadingOptions.push(value);
      index += 1;
    }
    index += 1;
  }
  return {
    command: args[index] ?? "",
    commandArguments: [...leadingOptions, ...args.slice(index + 1)],
  };
}

function optionalString(value: boolean | string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseDuration(value: string | undefined, fallback: number, label: string): number {
  if (!value) return fallback;
  const match = /^(\d+)(ms|s|m)?$/i.exec(value.trim());
  if (!match) throw new UsageError(`${label} must look like 500ms, 30s, or 2m.`);
  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "ms").toLowerCase();
  const multiplier = unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const milliseconds = amount * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) {
    throw new UsageError(`${label} must be a positive duration.`);
  }
  return milliseconds;
}

function requireId(value: string | undefined, label: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new UsageError(`${label} must be a valid UUID.`);
  return parsed.data;
}

function terminal(job: Job): boolean {
  return ["succeeded", "failed", "cancelled"].includes(job.status);
}

function unsuccessful(job: Job): boolean {
  return ["failed", "cancelled"].includes(job.status);
}

function formatPercent(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}

function formatJob(job: Job): string {
  const progress =
    job.processed !== null && job.total !== null
      ? `${job.processed}/${job.total} (${formatPercent(job.progress)})`
      : formatPercent(job.progress);
  return [
    `Job: ${job.id}`,
    `Status: ${job.status}`,
    `Phase: ${job.phase ?? "pending"}`,
    `Progress: ${progress}`,
    ...(job.error ? [`Error: ${job.error.code} — ${job.error.message}`] : []),
  ].join("\n");
}

function formatRepository(repository: RepositorySummary): string {
  return [
    `${repository.owner}/${repository.name}`,
    `  ID: ${repository.id}`,
    `  URL: ${repository.canonicalUrl}`,
    `  Latest snapshot: ${repository.latestSnapshotId ?? "none"}`,
    `  Status: ${repository.latestSnapshotStatus ?? "not analyzed"}`,
    `  Commit: ${repository.latestCommitSha?.slice(0, 12) ?? "unknown"}`,
  ].join("\n");
}

function formatSnapshot(snapshot: Snapshot): string {
  const languages = Object.entries(snapshot.stats.languages)
    .sort((left, right) => right[1] - left[1])
    .map(([language, count]) => `${language}:${count}`)
    .join(", ");
  return [
    `Snapshot: ${snapshot.id}`,
    `Status: ${snapshot.status}`,
    `Commit: ${snapshot.commitSha ?? "pending"}`,
    `Files: ${snapshot.stats.files}`,
    `Symbols: ${snapshot.stats.symbols}`,
    `Edges: ${snapshot.stats.edges}`,
    `Languages: ${languages || "none"}`,
  ].join("\n");
}

function formatAnswer(result: AskResult): string {
  const lines = [result.answer.summary];
  if (result.answer.steps.length > 0) {
    lines.push("", "Explanation:");
    for (const [index, step] of result.answer.steps.entries()) {
      lines.push(`${index + 1}. ${step.text}`);
    }
  }
  if (result.answer.citations.length > 0) {
    lines.push("", "Evidence:");
    for (const citation of result.answer.citations) {
      const symbol = citation.symbol ? ` (${citation.symbol})` : "";
      lines.push(`- ${citation.path}:${citation.startLine}-${citation.endLine}${symbol}`);
      lines.push(`  ${citation.quote.replace(/\s+/g, " ").trim()}`);
    }
  }
  if (result.answer.limitations.length > 0) {
    lines.push("", "Limitations:");
    for (const limitation of result.answer.limitations) lines.push(`- ${limitation}`);
  }
  lines.push("", `Provider: ${result.answer.provider}/${result.answer.model}`);
  lines.push(`Grounding: ${result.answer.status}`);
  return lines.join("\n");
}

function formatSearch(result: SearchResult): string {
  const lines = [
    `Query: ${result.query}`,
    `Mode: ${result.trace.requestedMode}`,
    `Channels: ${result.trace.usedChannels.join(", ") || "none"}`,
    ...(result.trace.degraded ? [`Degraded: ${result.trace.degradationReason ?? "unknown"}`] : []),
  ];
  for (const [index, hit] of result.results.entries()) {
    const signals = hit.signals
      .map((signal) => `${signal.channel}#${signal.rank}:${signal.rawScore.toFixed(4)}`)
      .join(", ");
    lines.push(
      "",
      `${index + 1}. ${hit.path}:${hit.startLine}-${hit.endLine}`,
      `   Fusion: ${hit.score.toFixed(6)} · ${signals}`,
      `   ${hit.content.replace(/\s+/g, " ").trim().slice(0, 240)}`,
    );
  }
  if (result.results.length === 0) lines.push("", "No evidence matched the query.");
  return lines.join("\n");
}

function formatGuardrails(
  report: GuardrailReport,
  sarifPath?: string,
  jsonExportPath?: string,
): string {
  const lines = [
    `Guardrails: ${report.status}`,
    `Snapshot: ${report.snapshot.id}`,
    `Commit: ${report.snapshot.commitSha.slice(0, 12)}`,
    `Findings: ${report.summary.total} (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos)`,
    `Algorithm: ${report.algorithmVersion}`,
    `Profile: ${report.profile ? `${report.profile.profileKey} v${report.profile.version} (${report.profile.fingerprint.slice(0, 19)}…)` : "legacy default"}`,
  ];
  if (report.findings.length > 0) {
    lines.push("", "Findings:");
    for (const item of report.findings) {
      lines.push(
        `- [${item.severity}] ${item.ruleId} ${item.path}:${item.startLine}-${item.endLine}`,
        `  ${item.message}`,
      );
    }
  } else {
    lines.push("", "No guardrail findings.");
  }
  if (sarifPath) lines.push("", `SARIF: ${sarifPath}`);
  if (jsonExportPath) lines.push(`JSON export: ${jsonExportPath}`);
  return lines.join("\n");
}

function formatGuardrailComparison(comparison: GuardrailComparison): string {
  const lines = [
    `Guardrails comparison: ${comparison.overall}`,
    `Base: ${comparison.base.snapshot.id} (${comparison.base.snapshot.commitSha.slice(0, 12)})`,
    `Head: ${comparison.head.snapshot.id} (${comparison.head.snapshot.commitSha.slice(0, 12)})`,
    `Changes: ${comparison.summary.total} (${comparison.summary.added} added, ${comparison.summary.resolved} resolved, ${comparison.summary.changed} changed, ${comparison.summary.unchanged} unchanged)`,
    `Regressions: ${comparison.summary.regressions} · Improvements: ${comparison.summary.improvements}`,
    `Profile: ${comparison.profile ? `${comparison.profile.profileKey} v${comparison.profile.version}` : "legacy default"}`,
  ];
  if (comparison.findings.length > 0) {
    lines.push("", "Findings:");
    for (const item of comparison.findings) {
      const finding = item.head ?? item.base;
      if (!finding) continue;
      lines.push(
        `- [${item.status}] ${finding.ruleId} ${finding.path}:${finding.startLine}-${finding.endLine}`,
        `  ${finding.message}`,
      );
    }
  } else {
    lines.push("", "No guardrail changes.");
  }
  return lines.join("\n");
}

function formatGuardrailProfile(profile: GuardrailProfile): string {
  return [
    `${profile.builtIn ? "built-in" : "custom  "}  ${profile.profileKey} v${profile.version}  ${profile.name}`,
    `  ID: ${profile.id}`,
    `  Algorithm: ${profile.algorithmVersion}`,
    `  Fingerprint: ${profile.fingerprint}`,
    `  Thresholds: cycle=${profile.thresholds.cycleMaxLength}, file-lines=${profile.thresholds.largeFileLines}, file-bytes=${profile.thresholds.largeFileBytes}, symbol-lines=${profile.thresholds.largeSymbolLines}, fan-in=${profile.thresholds.highFanIn}`,
    ...(profile.description ? [`  Description: ${profile.description}`] : []),
  ].join("\n");
}

function formatGuardrailExplanation(result: {
  explanation: import("@repovista/contracts").GuardrailExplanation;
  reused: boolean;
}): string {
  const explanation = result.explanation;
  const lines = [
    `Verified explanation: ${explanation.answer.status}${result.reused ? " (reused)" : ""}`,
    `Finding: ${explanation.finding.id} [${explanation.finding.severity}] ${explanation.finding.ruleId}`,
    `Location: ${explanation.finding.path}:${explanation.finding.startLine}-${explanation.finding.endLine}`,
    `Commit: ${explanation.snapshot.commitSha.slice(0, 12)}`,
    `Profile: ${explanation.profile?.profileKey ?? "legacy"} · ${explanation.profileFingerprint}`,
    `Provider: ${explanation.answer.provider}/${explanation.answer.model}`,
    `Prompt: ${explanation.promptVersion}`,
    "",
    explanation.answer.summary,
  ];
  if (explanation.answer.steps.length > 0) {
    lines.push("", "Explanation:");
    for (const [index, step] of explanation.answer.steps.entries()) {
      lines.push(`${index + 1}. ${step.text}`);
    }
  }
  if (explanation.answer.citations.length > 0) {
    lines.push("", "Evidence:");
    for (const citation of explanation.answer.citations) {
      lines.push(`- ${citation.path}:${citation.startLine}-${citation.endLine}`);
    }
  }
  if (explanation.answer.limitations.length > 0) {
    lines.push("", "Limitations:");
    for (const limitation of explanation.answer.limitations) lines.push(`- ${limitation}`);
  }
  return lines.join("\n");
}

function formatGuardrailExplanationHistory(history: GuardrailExplanationHistory): string {
  const lines = [
    "Verified explanation history",
    `Subject: ${history.subjectKey}`,
    `Finding: ${history.finding.id} [${history.finding.severity}] ${history.finding.ruleId}`,
    `Location: ${history.finding.path}:${history.finding.startLine}-${history.finding.endLine}`,
  ];
  if (history.explanations.length === 0) {
    lines.push("", "No saved explanations for this logical Finding.");
  } else {
    lines.push("", "Saved explanations:");
    for (const explanation of history.explanations) {
      lines.push(
        `- ${explanation.id}`,
        `  Snapshot: ${explanation.snapshot.id} · Commit: ${explanation.snapshot.commitSha.slice(0, 12)}`,
        `  Status: ${explanation.answer.status} · Provider: ${explanation.answer.provider}/${explanation.answer.model}`,
        `  Prompt: ${explanation.promptVersion} · Profile: ${explanation.profileFingerprint}`,
        `  Evidence: ${explanation.answer.citationCount} citation(s) · Created: ${explanation.createdAt}`,
        `  ${explanation.answer.summary}`,
      );
    }
  }
  lines.push("", `Next cursor: ${history.nextCursor ?? "none"}`);
  return lines.join("\n");
}

function formatGuardrailReviews(result: GuardrailReviewsResponse): string {
  const reviewed = result.reviews.filter((review) => review.status !== "unreviewed");
  const lines = [
    "Guardrail review metadata",
    `Snapshot: ${result.snapshot.id} · Commit: ${result.snapshot.commitSha.slice(0, 12)}`,
    `Reviewed: ${reviewed.length}/${result.reviews.length}`,
    "Deterministic Guardrail status and CI decisions are unchanged by reviews.",
  ];
  if (result.reviews.length === 0) {
    lines.push("", "No findings were produced for this Snapshot.");
    return lines.join("\n");
  }
  lines.push("", "Findings:");
  for (const review of result.reviews) {
    lines.push(
      `- [${review.status}] ${review.findingId}`,
      ...(review.note ? [`  Note: ${review.note}`] : []),
      ...(review.reviewer
        ? [`  Reviewer: ${review.reviewer.login ?? review.reviewer.displayName}`]
        : []),
      ...(review.updatedAt ? [`  Updated: ${review.updatedAt}`] : []),
    );
  }
  return lines.join("\n");
}

function formatGuardrailReviewHistory(history: GuardrailReviewHistoryPage): string {
  const lines = [
    "Guardrail review history",
    "Notes are represented only by their length; note text is not retained in this timeline.",
  ];
  if (history.entries.length === 0) {
    lines.push("", "No review history entries.");
  } else {
    for (const entry of history.entries) {
      lines.push(
        "",
        `${entry.createdAt} · ${entry.findingId}`,
        `  ${entry.fromStatus} → ${entry.toStatus} · note ${entry.fromNoteLength} → ${entry.toNoteLength}${entry.noteChanged ? " (changed)" : ""}`,
        `  Actor: ${entry.actorLogin ? `@${entry.actorLogin}` : entry.actorKind}`,
        `  Event: ${entry.action} · audit ${entry.id}`,
      );
    }
  }
  lines.push("", `Next cursor: ${history.nextCursor ?? "none"}`);
  return lines.join("\n");
}

function formatNotificationEndpoint(endpoint: NotificationEndpoint): string {
  return [
    `${endpoint.enabled ? "enabled " : "disabled"}  ${endpoint.name}`,
    `  ID: ${endpoint.id}`,
    `  URL: ${endpoint.url}`,
    `  Events: ${endpoint.eventTypes.join(", ")}`,
    `  Last delivery: ${endpoint.lastDeliveryStatus ?? "none"}${endpoint.lastDeliveryAt ? ` (${endpoint.lastDeliveryAt})` : ""}`,
  ].join("\n");
}

function formatNotificationDelivery(delivery: NotificationDelivery): string {
  return [
    `${delivery.status}  ${delivery.eventType}`,
    `  ID: ${delivery.id}`,
    `  Endpoint: ${delivery.endpointId}`,
    `  Attempts: ${delivery.attemptCount}/${delivery.maxAttempts}`,
    `  HTTP: ${delivery.lastStatusCode ?? "—"}`,
    `  Next attempt: ${delivery.nextAttemptAt ?? "—"}`,
    ...(delivery.lastError ? [`  Error: ${delivery.lastError}`] : []),
  ].join("\n");
}

function formatNotificationDeliveries(page: NotificationDeliveryPage): string {
  const lines = ["Notification deliveries"];
  if (page.deliveries.length === 0) lines.push("", "No notification deliveries.");
  else lines.push("", page.deliveries.map(formatNotificationDelivery).join("\n\n"));
  lines.push("", `Next cursor: ${page.nextCursor ?? "none"}`);
  return lines.join("\n");
}

function formatGuardrailExplanationComparison(comparison: GuardrailExplanationComparison): string {
  const lines = [
    `Verified explanation comparison: ${comparison.changed ? "changed" : "same"}`,
    `Subject: ${comparison.subjectKey}`,
    `Base: ${comparison.base.id} · Snapshot: ${comparison.base.snapshot.id} · Commit: ${comparison.base.snapshot.commitSha.slice(0, 12)}`,
    `Head: ${comparison.head.id} · Snapshot: ${comparison.head.snapshot.id} · Commit: ${comparison.head.snapshot.commitSha.slice(0, 12)}`,
    "",
    "Structural differences:",
  ];
  for (const [groupName, fields] of Object.entries(comparison.differences)) {
    lines.push(`${groupName}:`);
    for (const [fieldName, status] of Object.entries(fields)) {
      lines.push(`- ${fieldName}: ${status}`);
    }
  }
  lines.push(
    "",
    `Base answer: ${comparison.base.answer.status} · ${comparison.base.answer.provider}/${comparison.base.answer.model}`,
    comparison.base.answer.summary,
    "",
    `Head answer: ${comparison.head.answer.status} · ${comparison.head.answer.provider}/${comparison.head.answer.model}`,
    comparison.head.answer.summary,
    "",
    "This is a deterministic structural comparison; it does not rank explanation quality.",
  );
  return lines.join("\n");
}

function writeJson(output: CliOutput, value: unknown): void {
  output.stdout(JSON.stringify(value, null, 2));
}

function printApiError(output: CliOutput, error: ApiError, json: boolean): void {
  if (json) {
    output.stderr(
      JSON.stringify(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.status ? { status: error.status } : {}),
            ...(error.requestId ? { requestId: error.requestId } : {}),
            retryable: error.retryable,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  output.stderr(`Error [${error.code}]: ${error.message}`);
  if (error.requestId) output.stderr(`Request ID: ${error.requestId}`);
  if (error.retryable) output.stderr("This operation may succeed if retried.");
}

async function waitForJob(
  client: RepoVistaClient,
  jobId: string,
  options: {
    json: boolean;
    now: () => number;
    output: CliOutput;
    pollIntervalMs: number;
    sleep: (milliseconds: number) => Promise<void>;
    timeoutMs: number;
  },
): Promise<Job> {
  const startedAt = options.now();
  let previous = "";
  while (true) {
    const job = await client.getJob(jobId);
    const signature = `${job.status}:${job.phase}:${job.progress}:${job.processed}:${job.total}`;
    if (!options.json && signature !== previous) {
      options.output.stdout(
        `[${formatPercent(job.progress)}] ${job.status} — ${job.phase ?? "waiting"}`,
      );
      previous = signature;
    }
    if (terminal(job)) return job;
    if (options.now() - startedAt >= options.timeoutMs) {
      throw new ApiError(`Job ${jobId} did not finish within ${options.timeoutMs}ms.`, {
        code: "WAIT_TIMEOUT",
        retryable: true,
      });
    }
    await options.sleep(options.pollIntervalMs);
  }
}

function apiUrl(
  options: ParsedOptions["options"],
  env: NodeJS.ProcessEnv,
  profileApiUrl?: string,
): string {
  return (
    optionalString(options.api_url) ?? env.REPOVISTA_API_URL ?? profileApiUrl ?? DEFAULT_API_URL
  );
}

function jsonEnabled(options: ParsedOptions["options"]): boolean {
  return options.json === true;
}

function comparableApiUrl(value: string): string | null {
  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function positiveInteger(value: string | undefined, label: string, maximum?: number): number {
  if (!value || !/^\d+$/.test(value)) throw new UsageError(`${label} must be a positive integer.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new UsageError(
      maximum === undefined
        ? `${label} must be a positive integer.`
        : `${label} must be an integer from 1 to ${maximum}.`,
    );
  }
  return parsed;
}

const NOTIFICATION_EVENTS = ["guardrail_review.updated", "guardrail_review.cleared"] as const;

function notificationEventOptions(
  options: ParsedOptions["options"],
): (typeof NOTIFICATION_EVENTS)[number][] | undefined {
  const raw = options.event;
  if (raw === undefined) return undefined;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  if (values.length < 1 || values.length > 2) {
    throw new UsageError("Use one or two --event values.");
  }
  const events = values.map((value) => {
    if (!(NOTIFICATION_EVENTS as readonly string[]).includes(value)) {
      throw new UsageError(
        `Unknown notification event: ${value}. Use guardrail_review.updated or guardrail_review.cleared.`,
      );
    }
    return value as (typeof NOTIFICATION_EVENTS)[number];
  });
  if (new Set(events).size !== events.length)
    throw new UsageError("Each --event may appear only once.");
  return events;
}

function profileThreshold(
  options: ParsedOptions["options"],
  option: string,
  label: string,
  fallback: number,
  minimum = 1,
  maximum?: number,
): number {
  const value = optionalString(options[option]);
  if (!value) return fallback;
  const parsed = positiveInteger(value, label, maximum);
  if (parsed < minimum) {
    throw new UsageError(
      maximum === undefined
        ? `${label} must be an integer of at least ${minimum}.`
        : `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return parsed;
}

async function readTokenFromStdin(output: CliOutput): Promise<string> {
  if (!process.stdin.isTTY) {
    let content = "";
    for await (const chunk of process.stdin) {
      content += String(chunk);
      if (content.length > 2_000) break;
    }
    return content.split(/\r?\n/, 1)[0]?.trim() ?? "";
  }
  if (!process.stdin.setRawMode) {
    throw new UsageError(
      "This terminal cannot securely read a token. Pipe the token through stdin.",
    );
  }
  output.stderr("Paste the API token (input hidden), then press Enter:");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const restore = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    const onData = (chunk: Buffer | string) => {
      const characters = String(chunk);
      for (const character of characters) {
        if (character === "\u0003") {
          restore();
          reject(new UsageError("Authentication was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          restore();
          resolve(value.trim());
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " " && value.length < 500) value += character;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

export async function runCli(args: string[], dependencies: CliDependencies = {}): Promise<number> {
  const output: CliOutput = {
    stdout: dependencies.output?.stdout ?? ((line) => console.log(line)),
    stderr: dependencies.output?.stderr ?? ((line) => console.error(line)),
  };
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const wantsJson = args.includes("--json");

  try {
    if (args.length === 0 || ["help", "-h", "--help"].includes(args[0] ?? "")) {
      output.stdout(mainHelp);
      return 0;
    }
    if (["-V", "--version", "version"].includes(args[0] ?? "")) {
      output.stdout(CLI_VERSION);
      return 0;
    }

    const invocation = parseInvocation(args);
    const { command, commandArguments } = invocation;
    if (["-h", "--help"].includes(command)) {
      output.stdout(mainHelp);
      return 0;
    }
    if (["-V", "--version"].includes(command)) {
      output.stdout(CLI_VERSION);
      return 0;
    }
    if (commandArguments.includes("-h") || commandArguments.includes("--help")) {
      const help = commandHelp[command];
      if (!help) throw new UsageError(`Unknown command: ${command}`);
      output.stdout(help);
      return 0;
    }

    const extraSpecification: Record<string, Record<string, OptionKind>> = {
      analyze: {
        ignore: "repeat",
        installation: "string",
        poll_interval: "string",
        ref: "string",
        timeout: "string",
        wait: "boolean",
      },
      status: { poll_interval: "string", timeout: "string", watch: "boolean" },
      repositories: {},
      show: {},
      ask: { model: "string", provider: "string", snapshot: "string" },
      search: { limit: "string", mode: "string" },
      embed: { poll_interval: "string", timeout: "string", wait: "boolean" },
      guardrails: {
        cursor: "string",
        cycle_max_length: "string",
        description: "string",
        high_fan_in: "string",
        large_file_bytes: "string",
        large_file_lines: "string",
        large_symbol_lines: "string",
        limit: "string",
        name: "string",
        model: "string",
        note: "string",
        provider: "string",
        status: "string",
        sarif: "string",
        json_export: "string",
        finding_id: "string",
      },
      notifications: {
        name: "string",
        url: "string",
        event: "repeat",
        enabled: "boolean",
        disabled: "boolean",
        endpoint_id: "string",
        status: "string",
      },
      doctor: {},
      auth: {},
      workspace: {},
      github: { page: "string", page_size: "string" },
    };
    const commandSpecification = extraSpecification[command];
    if (!commandSpecification) throw new UsageError(`Unknown command: ${command}`);
    const parsed = parseOptions(commandArguments, specification(commandSpecification));
    if (parsed.options.version === true) {
      output.stdout(CLI_VERSION);
      return 0;
    }
    const json = jsonEnabled(parsed.options);
    const requestTimeoutMs = parseDuration(
      optionalString(parsed.options.request_timeout),
      30_000,
      "--request-timeout",
    );
    const configFile = dependencies.configPath ?? cliConfigPath(env);
    let cliConfig = await loadCliConfig(configFile);
    const activeProfile = activeCliProfile(cliConfig);
    const selectedApiUrl = apiUrl(parsed.options, env, activeProfile?.apiUrl);
    const selectedToken =
      activeProfile && comparableApiUrl(activeProfile.apiUrl) === comparableApiUrl(selectedApiUrl)
        ? activeProfile.token
        : undefined;

    if (command === "auth") {
      const action = parsed.positionals[0];
      if (!action || parsed.positionals.length !== 1) {
        throw new UsageError("auth requires exactly one action: login, status, or logout.");
      }
      if (action === "login") {
        const token = await (dependencies.readToken?.() ?? readTokenFromStdin(output));
        if (!/^rv_[A-Za-z0-9_-]{32,}$/.test(token)) {
          throw new UsageError("stdin did not contain a valid RepoVista API token.");
        }
        const loginClient = new RepoVistaClient({
          apiUrl: selectedApiUrl,
          apiToken: token,
          fetch: dependencies.fetch,
          requestTimeoutMs,
        });
        const session = await loginClient.authSession();
        if (!session.authenticated || !session.workspace || !session.user) {
          throw new ApiError("The API token did not resolve to an authenticated workspace.", {
            code: "AUTH_INVALID",
            status: 401,
          });
        }
        cliConfig = upsertCliProfile(cliConfig, {
          workspaceId: session.workspace.id,
          workspaceName: session.workspace.name,
          apiUrl: loginClient.apiUrl,
          token,
          login: session.user.login,
        });
        await saveCliConfig(configFile, cliConfig);
        if (json) {
          writeJson(output, {
            authenticated: true,
            apiUrl: loginClient.apiUrl,
            user: session.user,
            workspace: session.workspace,
          });
        } else {
          output.stdout(
            `Authenticated as @${session.user.login ?? session.user.displayName} in ${session.workspace.name}.`,
          );
          output.stdout(`Credentials saved to ${configFile} with user-only permissions.`);
        }
        return 0;
      }
      if (action === "logout") {
        const removed = activeProfile;
        cliConfig = removeActiveCliProfile(cliConfig);
        await saveCliConfig(configFile, cliConfig);
        if (json)
          writeJson(output, {
            authenticated: false,
            removedWorkspaceId: removed?.workspaceId ?? null,
          });
        else if (removed) output.stdout(`Removed local credentials for ${removed.workspaceName}.`);
        else output.stdout("No local RepoVista credentials were configured.");
        return 0;
      }
      if (action !== "status") throw new UsageError(`Unknown auth action: ${action}`);
      if (!activeProfile) {
        if (json) writeJson(output, { authenticated: false, apiUrl: selectedApiUrl });
        else
          output.stdout(
            "Not authenticated. Create a token in Settings, then run `repovista auth login`.",
          );
        return 0;
      }
    }

    if (command === "workspace") {
      const action = parsed.positionals[0];
      if (!action) throw new UsageError("workspace requires list or use.");
      if (action === "list") {
        if (parsed.positionals.length !== 1) throw new UsageError("workspace list accepts no ID.");
        const workspaces = Object.values(cliConfig.profiles)
          .sort((left, right) => left.workspaceName.localeCompare(right.workspaceName))
          .map(({ token: _token, ...profile }) => ({
            ...profile,
            active: profile.workspaceId === cliConfig.activeWorkspaceId,
          }));
        if (json) writeJson(output, workspaces);
        else if (workspaces.length === 0) output.stdout("No authenticated workspaces.");
        else {
          output.stdout(
            workspaces
              .map(
                (workspace) =>
                  `${workspace.active ? "*" : " "} ${workspace.workspaceName}  ${workspace.workspaceId}  ${workspace.apiUrl}`,
              )
              .join("\n"),
          );
        }
        return 0;
      }
      if (action === "use") {
        if (parsed.positionals.length !== 2) {
          throw new UsageError("workspace use requires exactly one workspace ID.");
        }
        const workspaceId = requireId(parsed.positionals[1], "Workspace ID");
        const profile = cliConfig.profiles[workspaceId];
        if (!profile) {
          throw new UsageError(
            "That workspace has no local token. Select it in the web app, create a token, and run auth login.",
          );
        }
        cliConfig = { ...cliConfig, activeWorkspaceId: workspaceId };
        await saveCliConfig(configFile, cliConfig);
        if (json) writeJson(output, { ...profile, token: undefined, active: true });
        else output.stdout(`Using workspace ${profile.workspaceName}.`);
        return 0;
      }
      throw new UsageError(`Unknown workspace action: ${action}`);
    }

    const client = new RepoVistaClient({
      apiUrl: selectedApiUrl,
      apiToken: selectedToken,
      fetch: dependencies.fetch,
      requestTimeoutMs,
    });

    if (command === "auth") {
      const session = await client.authSession();
      if (!session.authenticated || !session.workspace || !session.user) {
        throw new ApiError("The saved API token is no longer valid.", {
          code: "AUTH_INVALID",
          status: 401,
        });
      }
      if (json) writeJson(output, { ...session, apiUrl: client.apiUrl });
      else {
        output.stdout(`Authenticated: @${session.user.login ?? session.user.displayName}`);
        output.stdout(`Workspace: ${session.workspace.name} (${session.workspace.id})`);
        output.stdout(`API: ${client.apiUrl}`);
      }
      return 0;
    }

    if (command === "github") {
      const action = parsed.positionals[0];
      if (action === "installations") {
        if (parsed.positionals.length !== 1) {
          throw new UsageError("github installations accepts no additional arguments.");
        }
        const installations = await client.listGitHubInstallations();
        if (json) writeJson(output, installations);
        else if (installations.length === 0)
          output.stdout("No GitHub App installations are connected.");
        else {
          output.stdout(
            installations
              .map(
                (installation) =>
                  `${installation.accountLogin}  ${installation.installationId}  ${installation.suspendedAt ? "suspended" : installation.repositorySelection}`,
              )
              .join("\n"),
          );
        }
        return 0;
      }
      if (action === "repos") {
        if (parsed.positionals.length !== 2) {
          throw new UsageError("github repos requires exactly one installation ID.");
        }
        const installationId = positiveInteger(parsed.positionals[1], "Installation ID");
        const page = positiveInteger(optionalString(parsed.options.page) ?? "1", "--page");
        const pageSize = positiveInteger(
          optionalString(parsed.options.page_size) ?? "50",
          "--page-size",
          100,
        );
        const repositories = await client.listInstallationRepositories(
          installationId,
          page,
          pageSize,
        );
        if (json) writeJson(output, repositories);
        else if (repositories.repositories.length === 0)
          output.stdout("No repositories on this page.");
        else {
          output.stdout(
            repositories.repositories
              .map(
                (repository) =>
                  `${repository.private ? "private" : "public "}  ${repository.full_name}  ${repository.html_url}`,
              )
              .join("\n"),
          );
          output.stdout(`Total granted repositories: ${repositories.totalCount}`);
        }
        return 0;
      }
      throw new UsageError("github requires installations or repos.");
    }

    if (command === "doctor") {
      if (parsed.positionals.length > 0) throw new UsageError("doctor does not accept arguments.");
      const health = await client.health();
      if (json) writeJson(output, { apiUrl: client.apiUrl, ...health });
      else output.stdout(`RepoVista API is ready at ${client.apiUrl}.`);
      return 0;
    }

    if (command === "repositories") {
      if (parsed.positionals.length > 0) {
        throw new UsageError("repositories does not accept arguments.");
      }
      const repositories = await client.listRepositories();
      if (json) writeJson(output, repositories);
      else if (repositories.length === 0) output.stdout("No repositories have been imported.");
      else output.stdout(repositories.map(formatRepository).join("\n\n"));
      return 0;
    }

    if (command === "show") {
      if (parsed.positionals.length !== 1) {
        throw new UsageError("show requires exactly one repository ID.");
      }
      const repositoryId = requireId(parsed.positionals[0], "Repository ID");
      const [repository, snapshots] = await Promise.all([
        client.getRepository(repositoryId),
        client.listSnapshots(repositoryId),
      ]);
      if (json) writeJson(output, { repository, snapshots });
      else {
        const snapshotLines =
          snapshots.length === 0
            ? "No snapshots."
            : snapshots
                .map(
                  (snapshot) =>
                    `- ${snapshot.id}  ${snapshot.status}  ${snapshot.commitSha?.slice(0, 12) ?? "pending"}`,
                )
                .join("\n");
        output.stdout(`${formatRepository(repository)}\n\nSnapshots:\n${snapshotLines}`);
      }
      return 0;
    }

    if (command === "ask") {
      if (parsed.positionals.length < 2) {
        throw new UsageError("ask requires a repository ID and a question.");
      }
      const repositoryId = requireId(parsed.positionals[0], "Repository ID");
      const snapshotId = optionalString(parsed.options.snapshot);
      if (snapshotId) requireId(snapshotId, "Snapshot ID");
      const provider = optionalString(parsed.options.provider);
      if (provider && !["fake", "ollama", "openai-compatible"].includes(provider)) {
        throw new UsageError("--provider must be fake, ollama, or openai-compatible.");
      }
      const question = parsed.positionals.slice(1).join(" ").trim();
      if (question.length < 2 || question.length > 4_000) {
        throw new UsageError("The question must contain between 2 and 4,000 characters.");
      }
      const result = await client.ask(repositoryId, {
        question,
        ...(snapshotId ? { snapshotId } : {}),
        ...(provider ? { provider: provider as "fake" | "ollama" | "openai-compatible" } : {}),
        ...(optionalString(parsed.options.model)
          ? { model: optionalString(parsed.options.model) }
          : {}),
      });
      if (json) writeJson(output, result);
      else output.stdout(formatAnswer(result));
      return 0;
    }

    if (command === "search") {
      if (parsed.positionals.length < 2) {
        throw new UsageError("search requires a snapshot ID and a query.");
      }
      const snapshotId = requireId(parsed.positionals[0], "Snapshot ID");
      const query = parsed.positionals.slice(1).join(" ").trim();
      if (query.length < 2 || query.length > 4_000) {
        throw new UsageError("The query must contain between 2 and 4,000 characters.");
      }
      const modeResult = retrievalModeSchema.safeParse(
        optionalString(parsed.options.mode) ?? "hybrid",
      );
      if (!modeResult.success) {
        throw new UsageError("--mode must be text, symbol, semantic, or hybrid.");
      }
      const limitText = optionalString(parsed.options.limit) ?? "20";
      if (!/^\d+$/.test(limitText))
        throw new UsageError("--limit must be an integer from 1 to 100.");
      const limit = Number.parseInt(limitText, 10);
      if (limit < 1 || limit > 100)
        throw new UsageError("--limit must be an integer from 1 to 100.");
      const result = await client.searchSnapshot(snapshotId, query, modeResult.data, limit);
      if (json) writeJson(output, result);
      else output.stdout(formatSearch(result));
      return 0;
    }

    if (command === "embed") {
      if (parsed.positionals.length !== 1) {
        throw new UsageError("embed requires exactly one snapshot ID.");
      }
      const snapshotId = requireId(parsed.positionals[0], "Snapshot ID");
      const queued = await client.createEmbeddingIndex(snapshotId);
      if (parsed.options.wait !== true || queued.jobId === null) {
        if (json) writeJson(output, queued);
        else {
          output.stdout(
            queued.embeddingIndex.status === "ready"
              ? `Embedding index ${queued.embeddingIndex.id} is ready.`
              : `Embedding index queued as job ${queued.jobId ?? "none"}.`,
          );
        }
        return 0;
      }
      const job = await waitForJob(client, queued.jobId, {
        json,
        now,
        output,
        pollIntervalMs: parseDuration(
          optionalString(parsed.options.poll_interval),
          DEFAULT_POLL_INTERVAL_MS,
          "--poll-interval",
        ),
        sleep,
        timeoutMs: parseDuration(
          optionalString(parsed.options.timeout),
          DEFAULT_WAIT_TIMEOUT_MS,
          "--timeout",
        ),
      });
      if (json) writeJson(output, { ...queued, job });
      else output.stdout(formatJob(job));
      return unsuccessful(job) ? 3 : 0;
    }

    if (command === "guardrails") {
      if (parsed.positionals[0] === "reviews") {
        const action = parsed.positionals[1];
        if (action === "list") {
          if (parsed.positionals.length !== 3) {
            throw new UsageError("guardrails reviews list requires exactly a snapshot ID.");
          }
          const snapshotId = requireId(parsed.positionals[2], "Snapshot ID");
          const result = await client.listGuardrailReviews(snapshotId);
          if (json) writeJson(output, result);
          else output.stdout(formatGuardrailReviews(result));
          return 0;
        }
        if (action === "history") {
          if (parsed.positionals.length !== 3) {
            throw new UsageError("guardrails reviews history requires exactly a snapshot ID.");
          }
          const snapshotId = requireId(parsed.positionals[2], "Snapshot ID");
          const findingId = optionalString(parsed.options.finding_id);
          if (findingId && findingId.length > 300) {
            throw new UsageError("--finding-id must be at most 300 characters.");
          }
          const status = optionalString(parsed.options.status);
          if (
            status &&
            !["unreviewed", "acknowledged", "accepted_risk", "false_positive"].includes(status)
          ) {
            throw new UsageError(
              "--status must be unreviewed, acknowledged, accepted_risk, or false_positive.",
            );
          }
          const history = await client.listGuardrailReviewHistory(snapshotId, {
            ...(findingId ? { findingId } : {}),
            ...(status ? { status: status as GuardrailReview["status"] } : {}),
            ...(optionalString(parsed.options.cursor)
              ? { cursor: optionalString(parsed.options.cursor) }
              : {}),
            limit: positiveInteger(optionalString(parsed.options.limit) ?? "20", "--limit", 50),
          });
          if (json) writeJson(output, history);
          else output.stdout(formatGuardrailReviewHistory(history));
          return 0;
        }
        if (action === "set") {
          if (parsed.positionals.length !== 5) {
            throw new UsageError(
              "guardrails reviews set requires a snapshot ID, finding ID, and status.",
            );
          }
          const snapshotId = requireId(parsed.positionals[2], "Snapshot ID");
          const findingId = parsed.positionals[3];
          const status = parsed.positionals[4] as GuardrailReview["status"];
          if (!findingId) throw new UsageError("Finding ID is required.");
          if (
            !(["unreviewed", "acknowledged", "accepted_risk", "false_positive"] as const).includes(
              status,
            )
          ) {
            throw new UsageError(
              "Review status must be unreviewed, acknowledged, accepted_risk, or false_positive.",
            );
          }
          const review = await client.updateGuardrailReview(snapshotId, findingId, {
            status,
            ...(optionalString(parsed.options.note) !== undefined
              ? { note: optionalString(parsed.options.note) }
              : {}),
          });
          if (json) writeJson(output, review);
          else {
            output.stdout(
              `Review for ${review.findingId}: ${review.status}${review.note ? `\nNote: ${review.note}` : ""}`,
            );
            output.stdout("Deterministic Guardrail status and CI decisions are unchanged.");
          }
          return 0;
        }
        if (action === "clear") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError("guardrails reviews clear requires a snapshot ID and finding ID.");
          }
          const snapshotId = requireId(parsed.positionals[2], "Snapshot ID");
          const findingId = parsed.positionals[3];
          if (!findingId) throw new UsageError("Finding ID is required.");
          const review = await client.clearGuardrailReview(snapshotId, findingId);
          if (json) writeJson(output, review);
          else {
            output.stdout(`Review for ${review.findingId} cleared (unreviewed).`);
            output.stdout("Deterministic Guardrail status and CI decisions are unchanged.");
          }
          return 0;
        }
        throw new UsageError("guardrails reviews requires list, set, or clear.");
      }
      if (parsed.positionals[0] === "explanations") {
        const action = parsed.positionals[1];
        if (action === "history") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError(
              "guardrails explanations history requires a snapshot ID and finding ID.",
            );
          }
          const snapshotId = requireId(parsed.positionals[2], "Snapshot ID");
          const findingId = parsed.positionals[3];
          if (!findingId) throw new UsageError("Finding ID is required.");
          const history = await client.listGuardrailExplanationHistory(snapshotId, findingId, {
            limit: positiveInteger(optionalString(parsed.options.limit) ?? "20", "--limit", 50),
            ...(optionalString(parsed.options.cursor)
              ? { cursor: optionalString(parsed.options.cursor) }
              : {}),
          });
          if (json) writeJson(output, history);
          else output.stdout(formatGuardrailExplanationHistory(history));
          return 0;
        }
        if (action === "compare") {
          if (parsed.positionals.length !== 5) {
            throw new UsageError(
              "guardrails explanations compare requires a repository ID and two explanation IDs.",
            );
          }
          const repositoryId = requireId(parsed.positionals[2], "Repository ID");
          const baseExplanationId = requireId(parsed.positionals[3], "Base explanation ID");
          const headExplanationId = requireId(parsed.positionals[4], "Head explanation ID");
          if (baseExplanationId === headExplanationId) {
            throw new UsageError("Base and head explanation IDs must be different.");
          }
          const comparison = await client.compareGuardrailExplanations(
            repositoryId,
            baseExplanationId,
            headExplanationId,
          );
          if (json) writeJson(output, comparison);
          else output.stdout(formatGuardrailExplanationComparison(comparison));
          return 0;
        }
        throw new UsageError("guardrails explanations requires history or compare.");
      }
      if (parsed.positionals[0] === "profiles") {
        if (parsed.positionals.length !== 1) {
          throw new UsageError("guardrails profiles accepts no additional arguments.");
        }
        const profiles = await client.listGuardrailProfiles();
        if (json) writeJson(output, profiles);
        else output.stdout(profiles.map(formatGuardrailProfile).join("\n\n"));
        return 0;
      }
      if (parsed.positionals[0] === "profile") {
        const action = parsed.positionals[1];
        if (action === "create") {
          if (parsed.positionals.length !== 3) {
            throw new UsageError("guardrails profile create requires exactly one profile key.");
          }
          const name = optionalString(parsed.options.name);
          if (!name) throw new UsageError("guardrails profile create requires --name.");
          const request = createGuardrailProfileRequestSchema.safeParse({
            profileKey: parsed.positionals[2],
            name,
            description: optionalString(parsed.options.description) ?? "",
            thresholds: {
              cycleMaxLength: profileThreshold(
                parsed.options,
                "cycle_max_length",
                "--cycle-max-length",
                DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS.cycleMaxLength,
                2,
                100,
              ),
              largeFileLines: profileThreshold(
                parsed.options,
                "large_file_lines",
                "--large-file-lines",
                DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS.largeFileLines,
              ),
              largeFileBytes: profileThreshold(
                parsed.options,
                "large_file_bytes",
                "--large-file-bytes",
                DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS.largeFileBytes,
              ),
              largeSymbolLines: profileThreshold(
                parsed.options,
                "large_symbol_lines",
                "--large-symbol-lines",
                DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS.largeSymbolLines,
              ),
              highFanIn: profileThreshold(
                parsed.options,
                "high_fan_in",
                "--high-fan-in",
                DEFAULT_GUARDRAIL_PROFILE_THRESHOLDS.highFanIn,
              ),
            },
          });
          if (!request.success) {
            throw new UsageError(
              `Invalid Guardrail profile: ${request.error.issues.map((issue) => issue.message).join("; ")}`,
            );
          }
          const profile = await client.createGuardrailProfile(request.data);
          if (json) writeJson(output, profile);
          else {
            output.stdout(`Guardrail profile ready.\n\n${formatGuardrailProfile(profile)}`);
            output.stdout("Profiles are immutable; changed inputs create the next version.");
          }
          return 0;
        }
        if (action === "assign") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError(
              "guardrails profile assign requires a repository ID and profile ID or default.",
            );
          }
          const repositoryId = requireId(parsed.positionals[2], "Repository ID");
          const target = parsed.positionals[3];
          const profileId = target === "default" ? null : requireId(target, "Guardrail profile ID");
          const profile = await client.assignRepositoryGuardrailProfile(repositoryId, profileId);
          if (json) writeJson(output, profile);
          else {
            output.stdout(
              `Repository ${repositoryId} will use ${profile.profileKey} v${profile.version} for new snapshots.`,
            );
            output.stdout("Existing snapshots keep their original policy profile.");
          }
          return 0;
        }
        throw new UsageError("guardrails profile requires create or assign.");
      }
      if (parsed.positionals[0] === "compare") {
        if (parsed.positionals.length !== 3) {
          throw new UsageError("guardrails compare requires exactly a base and head snapshot ID.");
        }
        const baseSnapshotId = requireId(parsed.positionals[1], "Base snapshot ID");
        const headSnapshotId = requireId(parsed.positionals[2], "Head snapshot ID");
        const comparison = await client.compareGuardrails(baseSnapshotId, headSnapshotId);
        if (json) writeJson(output, comparison);
        else output.stdout(formatGuardrailComparison(comparison));
        return comparison.summary.regressions > 0 ? 2 : 0;
      }
      if (parsed.positionals[0] === "explain") {
        if (parsed.positionals.length !== 3) {
          throw new UsageError("guardrails explain requires a snapshot ID and finding ID.");
        }
        const snapshotId = requireId(parsed.positionals[1], "Snapshot ID");
        const findingId = parsed.positionals[2];
        if (!findingId) throw new UsageError("Finding ID is required.");
        const provider = optionalString(parsed.options.provider);
        if (provider && !["fake", "ollama", "openai-compatible"].includes(provider)) {
          throw new UsageError("--provider must be fake, ollama, or openai-compatible.");
        }
        const result = await client.createGuardrailExplanation(snapshotId, {
          findingId,
          ...(provider ? { provider: provider as "fake" | "ollama" | "openai-compatible" } : {}),
          ...(optionalString(parsed.options.model)
            ? { model: optionalString(parsed.options.model) }
            : {}),
        });
        if (json) writeJson(output, result);
        else output.stdout(formatGuardrailExplanation(result));
        return result.explanation.answer.status === "refused" ? 2 : 0;
      }
      if (parsed.positionals.length !== 1) {
        throw new UsageError("guardrails requires exactly one snapshot ID.");
      }
      const snapshotId = requireId(parsed.positionals[0], "Snapshot ID");
      const report = await client.getGuardrails(snapshotId);
      const sarifPath = optionalString(parsed.options.sarif);
      if (sarifPath) {
        const artifact = await client.downloadGuardrailsSarif(snapshotId);
        await writeFile(sarifPath, artifact.body, { encoding: "utf8", mode: 0o600 });
        await chmod(sarifPath, 0o600);
      }
      const jsonExportPath = optionalString(parsed.options.json_export);
      if (jsonExportPath) {
        const artifact = await client.downloadGuardrailsJson(snapshotId);
        await writeFile(jsonExportPath, artifact.body, { encoding: "utf8", mode: 0o600 });
        await chmod(jsonExportPath, 0o600);
      }
      if (json) writeJson(output, report);
      else output.stdout(formatGuardrails(report, sarifPath, jsonExportPath));
      return report.summary.errors > 0 ? 2 : 0;
    }

    if (command === "notifications") {
      const target = parsed.positionals[0];
      if (target === "endpoints") {
        const action = parsed.positionals[1];
        if (action === "list") {
          if (parsed.positionals.length !== 3) {
            throw new UsageError("notifications endpoints list requires a workspace ID.");
          }
          const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
          const endpoints = await client.listNotificationEndpoints(workspaceId);
          if (json) writeJson(output, endpoints);
          else if (endpoints.length === 0) output.stdout("No notification endpoints.");
          else output.stdout(endpoints.map(formatNotificationEndpoint).join("\n\n"));
          return 0;
        }
        if (action === "create") {
          if (parsed.positionals.length !== 3) {
            throw new UsageError("notifications endpoints create requires a workspace ID.");
          }
          const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
          const name = optionalString(parsed.options.name);
          const url = optionalString(parsed.options.url);
          if (!name || !url) {
            throw new UsageError("Endpoint create requires --name and --url.");
          }
          if (parsed.options.enabled === true && parsed.options.disabled === true) {
            throw new UsageError("Use either --enabled or --disabled, not both.");
          }
          const eventTypes = notificationEventOptions(parsed.options);
          const created = await client.createNotificationEndpoint(workspaceId, {
            name,
            url,
            ...(eventTypes ? { eventTypes } : {}),
            ...(parsed.options.disabled === true ? { enabled: false } : {}),
          });
          if (json) writeJson(output, created);
          else {
            output.stdout(formatNotificationEndpoint(created.endpoint));
            output.stdout("");
            output.stdout("Signing secret (displayed once; save it securely):");
            output.stdout(created.signingSecret);
          }
          return 0;
        }
        if (action === "update") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError(
              "notifications endpoints update requires workspace and endpoint IDs.",
            );
          }
          const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
          const endpointId = requireId(parsed.positionals[3], "Endpoint ID");
          const eventTypes = notificationEventOptions(parsed.options);
          if (parsed.options.enabled === true && parsed.options.disabled === true) {
            throw new UsageError("Use either --enabled or --disabled, not both.");
          }
          const input = {
            ...(optionalString(parsed.options.name)
              ? { name: optionalString(parsed.options.name) }
              : {}),
            ...(optionalString(parsed.options.url)
              ? { url: optionalString(parsed.options.url) }
              : {}),
            ...(eventTypes ? { eventTypes } : {}),
            ...(parsed.options.enabled === true ? { enabled: true } : {}),
            ...(parsed.options.disabled === true ? { enabled: false } : {}),
          };
          if (Object.keys(input).length === 0) {
            throw new UsageError("Endpoint update requires at least one field to change.");
          }
          const endpoint = await client.updateNotificationEndpoint(workspaceId, endpointId, input);
          if (json) writeJson(output, endpoint);
          else output.stdout(formatNotificationEndpoint(endpoint));
          return 0;
        }
        if (action === "delete") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError(
              "notifications endpoints delete requires workspace and endpoint IDs.",
            );
          }
          const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
          const endpointId = requireId(parsed.positionals[3], "Endpoint ID");
          await client.deleteNotificationEndpoint(workspaceId, endpointId);
          if (json) writeJson(output, { deleted: true, endpointId });
          else output.stdout(`Notification endpoint ${endpointId} deleted.`);
          return 0;
        }
        if (action === "test") {
          if (parsed.positionals.length !== 4) {
            throw new UsageError(
              "notifications endpoints test requires workspace and endpoint IDs.",
            );
          }
          const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
          const endpointId = requireId(parsed.positionals[3], "Endpoint ID");
          const delivery = await client.testNotificationEndpoint(workspaceId, endpointId);
          if (json) writeJson(output, delivery);
          else {
            output.stdout("Test notification queued.");
            output.stdout(formatNotificationDelivery(delivery));
          }
          return 0;
        }
        throw new UsageError(
          "notifications endpoints requires list, create, update, delete, or test.",
        );
      }
      if (target === "deliveries" && parsed.positionals[1] === "list") {
        if (parsed.positionals.length !== 3) {
          throw new UsageError("notifications deliveries list requires a workspace ID.");
        }
        const workspaceId = requireId(parsed.positionals[2], "Workspace ID");
        const status = optionalString(parsed.options.status);
        if (status && !["queued", "running", "succeeded", "failed"].includes(status)) {
          throw new UsageError("--status must be queued, running, succeeded, or failed.");
        }
        const endpointId = optionalString(parsed.options.endpoint_id);
        if (endpointId) requireId(endpointId, "Endpoint ID");
        const page = await client.listNotificationDeliveries(workspaceId, {
          ...(endpointId ? { endpointId } : {}),
          ...(status ? { status: status as NotificationDelivery["status"] } : {}),
          ...(optionalString(parsed.options.cursor)
            ? { cursor: optionalString(parsed.options.cursor) }
            : {}),
          limit: positiveInteger(optionalString(parsed.options.limit) ?? "20", "--limit", 50),
        });
        if (json) writeJson(output, page);
        else output.stdout(formatNotificationDeliveries(page));
        return 0;
      }
      throw new UsageError("notifications requires endpoints or deliveries list.");
    }

    if (command === "status") {
      if (parsed.positionals.length !== 1) {
        throw new UsageError("status requires exactly one job ID.");
      }
      const jobId = requireId(parsed.positionals[0], "Job ID");
      const watch = parsed.options.watch === true;
      const job = watch
        ? await waitForJob(client, jobId, {
            json,
            now,
            output,
            pollIntervalMs: parseDuration(
              optionalString(parsed.options.poll_interval),
              DEFAULT_POLL_INTERVAL_MS,
              "--poll-interval",
            ),
            sleep,
            timeoutMs: parseDuration(
              optionalString(parsed.options.timeout),
              DEFAULT_WAIT_TIMEOUT_MS,
              "--timeout",
            ),
          })
        : await client.getJob(jobId);
      if (json) writeJson(output, job);
      else output.stdout(formatJob(job));
      return unsuccessful(job) ? 3 : 0;
    }

    if (command === "analyze") {
      if (parsed.positionals.length !== 1) {
        throw new UsageError("analyze requires exactly one GitHub repository URL.");
      }
      const installation = optionalString(parsed.options.installation);
      const request = createRepositoryRequestSchema.safeParse({
        url: parsed.positionals[0],
        ...(installation
          ? { installationId: positiveInteger(installation, "--installation") }
          : {}),
        ...(optionalString(parsed.options.ref) ? { ref: optionalString(parsed.options.ref) } : {}),
        ignore: Array.isArray(parsed.options.ignore) ? parsed.options.ignore : [],
      });
      if (!request.success) {
        throw new UsageError(
          `Invalid repository request: ${request.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      const queued = await client.createRepository(request.data);
      if (parsed.options.wait !== true) {
        if (json) writeJson(output, queued);
        else {
          output.stdout(
            [
              "Repository analysis queued.",
              `Repository: ${queued.repositoryId}`,
              `Snapshot: ${queued.snapshotId}`,
              `Job: ${queued.jobId}`,
              `Track it with: repovista status ${queued.jobId} --watch`,
            ].join("\n"),
          );
        }
        return 0;
      }

      if (!json) {
        output.stdout(`Repository analysis queued as job ${queued.jobId}.`);
      }
      const job = await waitForJob(client, queued.jobId, {
        json,
        now,
        output,
        pollIntervalMs: parseDuration(
          optionalString(parsed.options.poll_interval),
          DEFAULT_POLL_INTERVAL_MS,
          "--poll-interval",
        ),
        sleep,
        timeoutMs: parseDuration(
          optionalString(parsed.options.timeout),
          DEFAULT_WAIT_TIMEOUT_MS,
          "--timeout",
        ),
      });
      const snapshot = await client.getSnapshot(queued.snapshotId);
      if (json) writeJson(output, { ...queued, job, snapshot });
      else output.stdout(`${formatJob(job)}\n\n${formatSnapshot(snapshot)}`);
      return unsuccessful(job) ? 3 : 0;
    }

    throw new UsageError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      if (wantsJson) {
        output.stderr(
          JSON.stringify({ error: { code: "USAGE_ERROR", message: error.message } }, null, 2),
        );
      } else {
        output.stderr(`Usage error: ${error.message}`);
        output.stderr("Run `repovista --help` for usage.");
      }
      return 2;
    }
    if (error instanceof CliConfigError) {
      if (wantsJson) {
        output.stderr(
          JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2),
        );
      } else output.stderr(`Error [${error.code}]: ${error.message}`);
      return 1;
    }
    if (error instanceof ApiError) {
      printApiError(output, error, wantsJson);
      return 1;
    }
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    if (wantsJson) {
      output.stderr(JSON.stringify({ error: { code: "INTERNAL_ERROR", message } }, null, 2));
    } else output.stderr(`Unexpected error: ${message}`);
    return 1;
  }
}
