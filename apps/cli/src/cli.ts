import type { AskResult } from "@repovista/contracts";
import {
  createRepositoryRequestSchema,
  idSchema,
  type Job,
  type RepositorySummary,
  retrievalModeSchema,
  type SearchResult,
  type Snapshot,
} from "@repovista/contracts";
import { ApiError, RepoVistaClient } from "./api-client.js";
import { CLI_VERSION } from "./version.js";

const DEFAULT_API_URL = "http://localhost:4000";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;

const mainHelp = [
  "RepoVista CLI",
  "",
  "Analyze public GitHub repositories through a running RepoVista API.",
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
  doctor: "Usage: repovista doctor [--json]",
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
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  output?: Partial<CliOutput>;
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

function apiUrl(options: ParsedOptions["options"], env: NodeJS.ProcessEnv): string {
  return optionalString(options.api_url) ?? env.REPOVISTA_API_URL ?? DEFAULT_API_URL;
}

function jsonEnabled(options: ParsedOptions["options"]): boolean {
  return options.json === true;
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
      doctor: {},
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
    const client = new RepoVistaClient({
      apiUrl: apiUrl(parsed.options, env),
      fetch: dependencies.fetch,
      requestTimeoutMs,
    });

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
        throw new UsageError("analyze requires exactly one public GitHub repository URL.");
      }
      const request = createRepositoryRequestSchema.safeParse({
        url: parsed.positionals[0],
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
