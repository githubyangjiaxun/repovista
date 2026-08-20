import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createModelProvider, verifyModelAnswer } from "@repovista/ai";
import type { AppConfig } from "@repovista/config";
import type { GraphLevel, RelationType } from "@repovista/contracts";
import {
  askRequestSchema,
  createPullRequestAnalysisRequestSchema,
  createRepositoryRequestSchema,
  createShareRequestSchema,
  graphLevelSchema,
  idSchema,
  PARSER_VERSION,
  relationTypeSchema,
} from "@repovista/contracts";
import type { RepoVistaStore, SearchEvidenceRecord } from "@repovista/database";
import { DomainError, PUBLIC_WORKSPACE_ID } from "@repovista/domain";
import {
  createMarkdownExport,
  createSvgExport,
  type ExportArtifact,
  type SnapshotExportInput,
} from "@repovista/exporter";
import { parseGitHubUrl } from "@repovista/git";
import { buildGraphView, type GraphView } from "@repovista/graph";
import { IMPACT_ALGORITHM_VERSION } from "@repovista/impact";
import { reciprocalRankFusion, tokenizeQuestion } from "@repovista/retrieval";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fetchPublicPullRequest } from "./github.js";

const repositoryParamsSchema = z.object({ repositoryId: idSchema });
const snapshotParamsSchema = z.object({ snapshotId: idSchema });
const snapshotSymbolParamsSchema = z.object({ snapshotId: idSchema, symbolId: idSchema });
const jobParamsSchema = z.object({ jobId: idSchema });
const shareParamsSchema = z.object({ slug: z.string().min(3).max(300) });
const pullRequestAnalysisParamsSchema = z.object({ analysisId: idSchema });

const githubWebhookHeadersSchema = z.object({
  delivery: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  event: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  signature: z.string().regex(/^sha256=[a-f0-9]{64}$/i),
});

const githubPushPayloadSchema = z.object({
  after: z.string(),
  deleted: z.boolean().default(false),
  ref: z.string(),
  repository: z.object({
    id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
    name: z.string().min(1).max(100),
    full_name: z.string().min(3).max(300),
    html_url: z.url(),
    default_branch: z.string().min(1).max(255),
    private: z.boolean(),
    owner: z.object({ login: z.string().min(1).max(100) }),
  }),
  installation: z.object({ id: z.number().int().positive() }).optional(),
});

const filesQuerySchema = z.object({
  cursor: z.string().max(1_000).optional(),
  language: z.string().trim().min(1).max(100).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  path: z.string().trim().max(1_000).optional(),
  query: z.string().trim().max(500).optional(),
});

const sourceQuerySchema = z.object({
  endLine: z.coerce.number().int().positive().optional(),
  path: z.string().trim().min(1).max(1_000),
  startLine: z.coerce.number().int().positive().optional(),
});

const searchQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  mode: z.enum(["text", "symbol", "hybrid"]).default("hybrid"),
  q: z.string().trim().min(2).max(4_000),
});

const mapQuerySchema = z.object({
  depth: z.coerce.number().int().min(0).max(4).default(1),
  level: graphLevelSchema.default("package"),
  query: z.string().trim().max(500).optional(),
  relationTypes: z.union([z.string(), z.array(z.string())]).optional(),
  rootId: z.string().max(1_000).optional(),
});

const svgExportQuerySchema = z.object({
  level: graphLevelSchema.default("package"),
});

const askBodySchema = askRequestSchema.extend({
  snapshotId: idSchema.optional(),
});

const eventQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
});

const impactQuerySchema = z.object({
  cursor: z.string().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", "The request contains invalid input.", {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

function response<T>(request: FastifyRequest, data: T) {
  return { data, meta: { requestId: request.id } };
}

function rawWebhookBody(request: FastifyRequest): Buffer {
  const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    throw new DomainError(
      "GITHUB_WEBHOOK_PAYLOAD_INVALID",
      "The webhook body was not available for signature verification.",
    );
  }
  return rawBody;
}

function verifyGitHubSignature(rawBody: Buffer, signature: string, secret: string): void {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const receivedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    throw new DomainError(
      "GITHUB_WEBHOOK_SIGNATURE_INVALID",
      "The GitHub webhook signature is invalid.",
    );
  }
}

function parseWebhookJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new DomainError(
      "GITHUB_WEBHOOK_PAYLOAD_INVALID",
      "The GitHub webhook body must be valid JSON.",
    );
  }
}

function githubWebhookHeaders(request: FastifyRequest) {
  const parsed = githubWebhookHeadersSchema.safeParse({
    delivery: request.headers["x-github-delivery"],
    event: request.headers["x-github-event"],
    signature: request.headers["x-hub-signature-256"],
  });
  if (!parsed.success) {
    throw new DomainError(
      "GITHUB_WEBHOOK_HEADERS_INVALID",
      "The GitHub webhook headers are invalid.",
      {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    );
  }
  return parsed.data;
}

function requireSafePath(value: string, label = "path"): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    segments.some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    throw new DomainError(
      "SOURCE_PATH_INVALID",
      `The ${label} must be a relative repository path.`,
    );
  }
  return normalized;
}

function requireSafeRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const valid =
    /^(?!-)(?!.*(?:\.\.|@\{|\/\/))[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value) &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock");
  if (!valid) {
    throw new DomainError("REPOSITORY_REF_INVALID", "The Git ref is not valid.");
  }
  return value;
}

function requireReadySnapshot<T extends { status: string; commitSha: string | null }>(
  snapshot: T | null,
): asserts snapshot is T & { commitSha: string } {
  if (!snapshot) {
    throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
  }
  if (snapshot.status !== "ready" || !snapshot.commitSha) {
    throw new DomainError("SNAPSHOT_NOT_READY", "The requested snapshot is not ready yet.", {
      retryable: true,
    });
  }
}

function parseRelationTypes(value: string | string[] | undefined): RelationType[] {
  if (!value) return [];
  const values = (Array.isArray(value) ? value : value.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return values.map((item) => parseInput(relationTypeSchema, item));
}

function filterGraph(
  view: GraphView,
  options: {
    depth: number;
    query?: string;
    relationTypes: readonly RelationType[];
    rootId?: string;
  },
): GraphView {
  let edges = view.edges;
  if (options.relationTypes.length > 0) {
    const allowed = new Set(options.relationTypes);
    edges = edges.filter((edge) => allowed.has(edge.type));
  }

  let visible = new Set(view.nodes.map((node) => node.id));
  if (options.rootId) {
    if (!visible.has(options.rootId)) {
      throw new DomainError("GRAPH_NODE_NOT_FOUND", "The requested graph root does not exist.");
    }
    visible = new Set([options.rootId]);
    let frontier = new Set([options.rootId]);
    for (let currentDepth = 0; currentDepth < options.depth; currentDepth += 1) {
      const next = new Set<string>();
      for (const edge of edges) {
        if (frontier.has(edge.from)) next.add(edge.to);
        if (frontier.has(edge.to)) next.add(edge.from);
      }
      for (const id of next) visible.add(id);
      frontier = next;
    }
  }
  if (options.query) {
    const query = options.query.toLowerCase();
    const matched = new Set(
      view.nodes
        .filter(
          (node) =>
            node.label.toLowerCase().includes(query) || node.path?.toLowerCase().includes(query),
        )
        .map((node) => node.id),
    );
    visible = new Set([...visible].filter((id) => matched.has(id)));
  }

  const nodes = view.nodes.filter((node) => visible.has(node.id));
  edges = edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  return { nodes, edges, truncated: view.truncated };
}

function compactEvidence(record: SearchEvidenceRecord): SearchEvidenceRecord {
  const maximumCharacters = 8_000;
  if (record.content.length <= maximumCharacters) return record;
  const lines = record.content.split(/\r?\n/);
  const selected: string[] = [];
  let characters = 0;
  for (const line of lines) {
    if (selected.length > 0 && characters + line.length + 1 > maximumCharacters) break;
    selected.push(line.slice(0, maximumCharacters));
    characters += line.length + 1;
    if (characters >= maximumCharacters) break;
  }
  const content = selected.join("\n");
  return {
    ...record,
    content,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    endLine: record.startLine + Math.max(0, selected.length - 1),
  };
}

async function retrieveEvidence(
  store: RepoVistaStore,
  snapshotId: string,
  question: string,
): Promise<SearchEvidenceRecord[]> {
  const queries = [question, ...tokenizeQuestion(question).slice(0, 6)];
  const uniqueQueries = [
    ...new Set(queries.map((item) => item.trim()).filter((item) => item.length >= 2)),
  ];
  const resultSets = await Promise.all(
    uniqueQueries.map((query) => store.searchEvidence(snapshotId, query, 12)),
  );
  const ranked = resultSets.map((resultSet) =>
    resultSet.map((item, index) => ({
      ...item,
      rank: index + 1,
      source: item.symbolId ? ("symbol" as const) : ("text" as const),
    })),
  );
  return reciprocalRankFusion(ranked, 12).map((item) => compactEvidence(item));
}

function readingPath(files: readonly { path: string }[]): { path: string; reason: string }[] {
  const score = (filePath: string): number => {
    const lower = filePath.toLowerCase();
    if (lower === "readme.md") return 100;
    if (lower === "package.json") return 90;
    if (/(^|\/)(index|main|server|app)\.[cm]?[jt]sx?$/.test(lower)) return 80;
    if (lower.startsWith("src/")) return 50;
    return 10;
  };
  return [...files]
    .sort(
      (left, right) => score(right.path) - score(left.path) || left.path.localeCompare(right.path),
    )
    .slice(0, 8)
    .map((file) => ({
      path: file.path,
      reason:
        file.path.toLowerCase() === "readme.md"
          ? "Start with the project-maintained overview."
          : "This file is a likely entry point or central implementation file.",
    }));
}

function sseEvent(id: number, event: string, payload: Record<string, unknown>): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadSnapshotExport(
  store: RepoVistaStore,
  snapshotId: string,
  level: GraphLevel,
): Promise<SnapshotExportInput> {
  const graphData = await store.getSnapshotGraphData(snapshotId);
  if (!graphData) {
    throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
  }
  requireReadySnapshot(graphData.snapshot);
  const repository = await store.getRepository(graphData.snapshot.repositoryId);
  if (!repository) {
    throw new DomainError("EXPORT_NOT_AVAILABLE", "The snapshot repository is not available.");
  }
  const graph = buildGraphView(graphData, level, Number.MAX_SAFE_INTEGER);
  return {
    repository,
    snapshot: graphData.snapshot,
    files: graphData.files.map((file) => ({
      path: file.path,
      language: file.language,
      byteSize: file.byteSize,
      lineCount: file.lineCount,
      parseStatus: file.parseStatus,
    })),
    graph: { level, ...graph },
  };
}

function sendExport(reply: FastifyReply, artifact: ExportArtifact) {
  const etag = `"sha256-${createHash("sha256").update(artifact.body).digest("base64url")}"`;
  reply
    .header("Cache-Control", "public, max-age=0, must-revalidate")
    .header("Content-Disposition", `attachment; filename="${artifact.filename}"`)
    .header("Content-Type", artifact.contentType)
    .header("ETag", etag)
    .header("X-Content-Type-Options", "nosniff");
  if (artifact.contentType.startsWith("image/svg+xml")) {
    reply.header(
      "Content-Security-Policy",
      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    );
  }
  return reply.send(artifact.body);
}

export function registerRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; store: RepoVistaStore },
): void {
  const { config, store } = dependencies;

  app.get("/v1/integrations/github", async (request) =>
    response(request, {
      enabled: Boolean(config.GITHUB_WEBHOOK_SECRET),
      appSlug: config.GITHUB_APP_SLUG || null,
      events: ["ping", "push"],
      scope: "public-repositories",
    }),
  );

  app.post("/v1/integrations/github/webhooks", async (request, reply) => {
    if (!config.GITHUB_WEBHOOK_SECRET) {
      throw new DomainError(
        "GITHUB_APP_DISABLED",
        "GitHub webhook updates are disabled on this server.",
        { retryable: true },
      );
    }
    const headers = githubWebhookHeaders(request);
    const rawBody = rawWebhookBody(request);
    verifyGitHubSignature(rawBody, headers.signature, config.GITHUB_WEBHOOK_SECRET);
    const payloadSha256 = `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
    const body = parseWebhookJson(rawBody);

    if (headers.event !== "push") {
      const result = await store.processGitHubWebhook(
        {
          deliveryId: headers.delivery,
          eventName: headers.event,
          payloadSha256,
          push: null,
        },
        PARSER_VERSION,
      );
      return response(request, result);
    }

    const payload = parseInput(githubPushPayloadSchema, body);
    const identity = parseGitHubUrl(payload.repository.html_url);
    if (
      identity.owner.toLowerCase() !== payload.repository.owner.login.toLowerCase() ||
      identity.name.toLowerCase() !== payload.repository.name.toLowerCase() ||
      payload.repository.full_name.toLowerCase() !==
        `${identity.owner}/${identity.name}`.toLowerCase()
    ) {
      throw new DomainError(
        "GITHUB_WEBHOOK_PAYLOAD_INVALID",
        "The repository identity in the webhook payload is inconsistent.",
      );
    }
    const result = await store.processGitHubWebhook(
      {
        deliveryId: headers.delivery,
        eventName: "push",
        payloadSha256,
        push: {
          owner: identity.owner,
          name: identity.name,
          canonicalUrl: identity.canonicalUrl,
          cloneUrl: identity.cloneUrl,
          providerRepoId: payload.repository.id ? String(payload.repository.id) : null,
          defaultBranch: payload.repository.default_branch,
          after: payload.after,
          ref: payload.ref,
          deleted: payload.deleted,
          isPrivate: payload.repository.private,
          installationId: payload.installation?.id ?? null,
        },
      },
      PARSER_VERSION,
    );
    if (result.status === "enqueued") reply.code(202);
    return response(request, result);
  });

  app.post(
    "/v1/repositories",
    {
      config: {
        rateLimit: { max: config.ANONYMOUS_IMPORTS_PER_HOUR, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const body = parseInput(createRepositoryRequestSchema, request.body);
      const identity = parseGitHubUrl(body.url);
      if (!config.repositoryAllowedHosts.includes(new URL(identity.canonicalUrl).hostname)) {
        throw new DomainError(
          "REPOSITORY_HOST_NOT_ALLOWED",
          "This Git host is not enabled by the server.",
        );
      }
      const result = await store.createRepositoryImport({
        workspaceId: PUBLIC_WORKSPACE_ID,
        identity,
        requestedRef: requireSafeRef(body.ref),
        ignore: body.ignore.map((item) => requireSafePath(item, "ignore pattern")),
        parserVersion: PARSER_VERSION,
      });
      reply.code(202);
      return response(request, result);
    },
  );

  app.get("/v1/repositories", async (request) =>
    response(request, await store.listRepositories(PUBLIC_WORKSPACE_ID)),
  );

  app.get("/v1/repositories/:repositoryId", async (request) => {
    const { repositoryId } = parseInput(repositoryParamsSchema, request.params);
    const repository = await store.getRepository(repositoryId);
    if (!repository) {
      throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
    }
    return response(request, repository);
  });

  app.get("/v1/repositories/:repositoryId/snapshots", async (request) => {
    const { repositoryId } = parseInput(repositoryParamsSchema, request.params);
    const repository = await store.getRepository(repositoryId);
    if (!repository) {
      throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
    }
    return response(request, await store.listSnapshots(repositoryId));
  });

  app.post(
    "/v1/repositories/:repositoryId/pull-requests",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const { repositoryId } = parseInput(repositoryParamsSchema, request.params);
      const body = parseInput(createPullRequestAnalysisRequestSchema, request.body);
      const repository = await store.getRepository(repositoryId);
      if (!repository) {
        throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
      }
      const metadata = await fetchPublicPullRequest(config, repository, body.number);
      const result = await store.createPullRequestAnalysis({
        workspaceId: PUBLIC_WORKSPACE_ID,
        repositoryId,
        prNumber: metadata.number,
        title: metadata.title,
        canonicalUrl: metadata.url,
        baseSha: metadata.baseSha,
        headSha: metadata.headSha,
        parserVersion: PARSER_VERSION,
        algorithmVersion: IMPACT_ALGORITHM_VERSION,
        providerFiles: metadata.files,
      });
      if (result.status === "queued" || result.status === "running") reply.code(202);
      return response(request, result);
    },
  );

  app.get("/v1/pull-request-analyses/:analysisId", async (request) => {
    const { analysisId } = parseInput(pullRequestAnalysisParamsSchema, request.params);
    const analysis = await store.getPullRequestAnalysis(analysisId);
    if (!analysis) {
      throw new DomainError("PR_ANALYSIS_NOT_FOUND", "The pull request analysis does not exist.");
    }
    return response(request, analysis);
  });

  app.get("/v1/pull-request-analyses/:analysisId/impact", async (request) => {
    const { analysisId } = parseInput(pullRequestAnalysisParamsSchema, request.params);
    const { cursor, limit } = parseInput(impactQuerySchema, request.query);
    const page = await store.getPullRequestImpactPage(analysisId, limit, cursor);
    if (!page) {
      throw new DomainError("PR_ANALYSIS_NOT_FOUND", "The pull request analysis does not exist.");
    }
    return response(request, page);
  });

  app.get("/v1/pull-request-analyses/:analysisId/events", async (request, reply) => {
    const { analysisId } = parseInput(pullRequestAnalysisParamsSchema, request.params);
    const query = parseInput(eventQuerySchema, request.query);
    const header = request.headers["last-event-id"];
    const headerId = typeof header === "string" ? Number.parseInt(header, 10) : Number.NaN;
    let afterId = Number.isFinite(headerId) ? headerId : query.after;
    const analysis = await store.getPullRequestAnalysis(analysisId);
    const jobId = await store.getPullRequestAnalysisJobId(analysisId);
    if (!analysis || !jobId) {
      throw new DomainError("PR_ANALYSIS_NOT_FOUND", "The pull request analysis does not exist.");
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Request-ID": request.id,
    });
    reply.raw.write("retry: 1000\n\n");
    for (let cycle = 0; cycle < 25 && !request.raw.destroyed; cycle += 1) {
      const events = await store.listJobEvents(jobId, afterId);
      for (const event of events) {
        reply.raw.write(sseEvent(event.id, event.type, event.payload));
        afterId = event.id;
      }
      const current = await store.getPullRequestAnalysis(analysisId);
      if (current && ["ready", "failed", "cancelled"].includes(current.status)) break;
      if (events.length === 0) reply.raw.write(": keep-alive\n\n");
      await wait(1_000);
    }
    if (!request.raw.destroyed) reply.raw.end();
  });

  app.post("/v1/pull-request-analyses/:analysisId/rerun", async (request, reply) => {
    const { analysisId } = parseInput(pullRequestAnalysisParamsSchema, request.params);
    const analysis = await store.getPullRequestAnalysis(analysisId);
    if (!analysis) {
      throw new DomainError("PR_ANALYSIS_NOT_FOUND", "The pull request analysis does not exist.");
    }
    const repository = await store.getRepository(analysis.repositoryId);
    if (!repository) {
      throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
    }
    const metadata = await fetchPublicPullRequest(config, repository, analysis.prNumber);
    const result = await store.createPullRequestAnalysis({
      workspaceId: PUBLIC_WORKSPACE_ID,
      repositoryId: repository.id,
      prNumber: metadata.number,
      title: metadata.title,
      canonicalUrl: metadata.url,
      baseSha: metadata.baseSha,
      headSha: metadata.headSha,
      parserVersion: PARSER_VERSION,
      algorithmVersion: IMPACT_ALGORITHM_VERSION,
      providerFiles: metadata.files,
      forceRevision: analysis.revision + 1,
    });
    reply.code(202);
    return response(request, result);
  });

  app.get("/v1/snapshots/:snapshotId", async (request) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const snapshot = await store.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
    }
    return response(request, snapshot);
  });

  app.get("/v1/snapshots/:snapshotId/exports/markdown", async (request, reply) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const input = await loadSnapshotExport(store, snapshotId, "package");
    return sendExport(reply, createMarkdownExport(input));
  });

  app.get("/v1/snapshots/:snapshotId/exports/svg", async (request, reply) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const { level } = parseInput(svgExportQuerySchema, request.query);
    const input = await loadSnapshotExport(store, snapshotId, level);
    return sendExport(reply, createSvgExport(input));
  });

  app.post("/v1/snapshots/:snapshotId/cancel", async (request, reply) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const snapshot = await store.getSnapshot(snapshotId);
    if (!snapshot) {
      throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
    }
    if (!["ready", "failed", "cancelled"].includes(snapshot.status)) {
      await store.requestCancellation(snapshotId);
    }
    reply.code(202);
    return response(request, {
      snapshotId,
      status: snapshot.status === "cancelled" ? "cancelled" : "cancellation_requested",
    });
  });

  app.get("/v1/jobs/:jobId", async (request) => {
    const { jobId } = parseInput(jobParamsSchema, request.params);
    const job = await store.getJob(jobId);
    if (!job) throw new DomainError("JOB_NOT_FOUND", "The requested job does not exist.");
    return response(request, job);
  });

  app.get("/v1/jobs/:jobId/events", async (request, reply) => {
    const { jobId } = parseInput(jobParamsSchema, request.params);
    const query = parseInput(eventQuerySchema, request.query);
    const header = request.headers["last-event-id"];
    const headerId = typeof header === "string" ? Number.parseInt(header, 10) : Number.NaN;
    let afterId = Number.isFinite(headerId) ? headerId : query.after;
    const job = await store.getJob(jobId);
    if (!job) throw new DomainError("JOB_NOT_FOUND", "The requested job does not exist.");

    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Request-ID": request.id,
    });
    reply.raw.write("retry: 1000\n\n");

    for (let cycle = 0; cycle < 25 && !request.raw.destroyed; cycle += 1) {
      const events = await store.listJobEvents(jobId, afterId);
      for (const event of events) {
        reply.raw.write(sseEvent(event.id, event.type, event.payload));
        afterId = event.id;
      }
      const currentJob = await store.getJob(jobId);
      if (currentJob && ["succeeded", "failed", "cancelled"].includes(currentJob.status)) break;
      if (events.length === 0) reply.raw.write(": keep-alive\n\n");
      await wait(1_000);
    }
    if (!request.raw.destroyed) reply.raw.end();
  });

  app.get("/v1/snapshots/:snapshotId/map", async (request) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const query = parseInput(mapQuerySchema, request.query);
    const graphData = await store.getSnapshotGraphData(snapshotId);
    if (!graphData) {
      throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
    }
    requireReadySnapshot(graphData.snapshot);
    const level: GraphLevel = query.level;
    const view = filterGraph(buildGraphView(graphData, level), {
      depth: query.depth,
      query: query.query,
      relationTypes: parseRelationTypes(query.relationTypes),
      rootId: query.rootId,
    });
    return response(request, {
      snapshot: {
        id: graphData.snapshot.id,
        commitSha: graphData.snapshot.commitSha,
        parserVersion: graphData.snapshot.parserVersion,
      },
      level,
      ...view,
    });
  });

  app.get("/v1/snapshots/:snapshotId/files", async (request) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const query = parseInput(filesQuerySchema, request.query);
    const snapshot = await store.getSnapshot(snapshotId);
    requireReadySnapshot(snapshot);
    const page = await store.listSnapshotFiles(snapshotId, {
      afterPath: query.cursor,
      language: query.language,
      limit: query.pageSize,
      pathPrefix: query.path ? requireSafePath(query.path) : undefined,
      query: query.query,
    });
    return response(request, page);
  });

  app.get("/v1/snapshots/:snapshotId/source", async (request) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const query = parseInput(sourceQuerySchema, request.query);
    if (query.startLine && query.endLine && query.endLine < query.startLine) {
      throw new DomainError("SOURCE_RANGE_INVALID", "endLine must be greater than startLine.");
    }
    if (query.startLine && query.endLine && query.endLine - query.startLine > 5_000) {
      throw new DomainError("SOURCE_RANGE_TOO_LARGE", "A source range cannot exceed 5,000 lines.");
    }
    const source = await store.getSourceFile(
      snapshotId,
      requireSafePath(query.path),
      query.startLine,
      query.endLine,
    );
    if (!source) {
      throw new DomainError("SOURCE_NOT_FOUND", "The requested source file does not exist.");
    }
    return response(request, source);
  });

  app.get("/v1/snapshots/:snapshotId/symbols/:symbolId", async (request) => {
    const { snapshotId, symbolId } = parseInput(snapshotSymbolParamsSchema, request.params);
    const snapshot = await store.getSnapshot(snapshotId);
    requireReadySnapshot(snapshot);
    const symbol = await store.getSnapshotSymbolEvidence(snapshotId, symbolId);
    if (!symbol) {
      throw new DomainError(
        "SYMBOL_NOT_FOUND",
        "The requested symbol does not belong to this snapshot.",
      );
    }
    return response(request, symbol);
  });

  app.get("/v1/snapshots/:snapshotId/search", async (request) => {
    const { snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const query = parseInput(searchQuerySchema, request.query);
    const snapshot = await store.getSnapshot(snapshotId);
    requireReadySnapshot(snapshot);
    const evidence = await store.searchEvidence(snapshotId, query.q, query.limit);
    return response(request, { mode: query.mode, results: evidence });
  });

  app.post(
    "/v1/repositories/:repositoryId/ask",
    {
      config: {
        rateLimit: { max: config.ANONYMOUS_QUESTIONS_PER_HOUR, timeWindow: "1 hour" },
      },
    },
    async (request) => {
      const { repositoryId } = parseInput(repositoryParamsSchema, request.params);
      const body = parseInput(askBodySchema, request.body);
      const repository = await store.getRepository(repositoryId);
      if (!repository) {
        throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
      }
      const snapshotId = body.snapshotId ?? repository.latestSnapshotId;
      if (!snapshotId) {
        throw new DomainError("SNAPSHOT_NOT_READY", "This repository has no ready snapshot.", {
          retryable: true,
        });
      }
      const snapshot = await store.getSnapshot(snapshotId);
      requireReadySnapshot(snapshot);
      if (snapshot.repositoryId !== repositoryId) {
        throw new DomainError(
          "SNAPSHOT_NOT_FOUND",
          "The snapshot does not belong to this repository.",
        );
      }

      const startedAt = Date.now();
      const evidence = await retrieveEvidence(store, snapshotId, body.question);
      const providerName =
        body.provider ?? (config.MODEL_PROVIDER === "none" ? "fake" : config.MODEL_PROVIDER);
      const provider = createModelProvider({
        provider: providerName,
        ollamaBaseUrl: config.OLLAMA_BASE_URL,
        openAIBaseUrl: config.OPENAI_COMPATIBLE_BASE_URL,
        openAIApiKey: config.OPENAI_COMPATIBLE_API_KEY,
        model: body.model ?? config.CHAT_MODEL,
      });
      const model = body.model ?? provider.defaultModel;
      const draft = await provider.generate({ question: body.question, evidence, model });
      const answer = verifyModelAnswer(draft, evidence, provider.id, model);
      const messageId = await store.saveAnswer({
        workspaceId: PUBLIC_WORKSPACE_ID,
        repositoryId,
        snapshotId,
        question: body.question,
        answer,
        evidence,
        latencyMs: Date.now() - startedAt,
      });
      return response(request, { messageId, answer, evidence });
    },
  );

  app.post(
    "/v1/share-reports",
    {
      config: {
        rateLimit: { max: config.SHARE_REPORTS_PER_HOUR, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const body = parseInput(createShareRequestSchema, request.body);
      const graphData = await store.getSnapshotGraphData(body.snapshotId);
      if (!graphData) {
        throw new DomainError("SNAPSHOT_NOT_FOUND", "The requested snapshot does not exist.");
      }
      requireReadySnapshot(graphData.snapshot);
      const repository = await store.getRepository(graphData.snapshot.repositoryId);
      if (!repository) {
        throw new DomainError("REPOSITORY_NOT_FOUND", "The requested repository does not exist.");
      }
      const map = buildGraphView(graphData, "package", 250);
      const title = body.title ?? `${repository.owner}/${repository.name} architecture tour`;
      const report = await store.createShareReport(repository.id, graphData.snapshot.id, title, {
        overview: `${repository.owner}/${repository.name} contains ${graphData.snapshot.stats.files} indexed files and ${graphData.snapshot.stats.symbols} symbols at commit ${graphData.snapshot.commitSha.slice(0, 7)}.`,
        readingPath: readingPath(graphData.files),
        map,
      });
      reply.code(201);
      return response(request, report);
    },
  );

  app.get("/v1/share-reports/:slug", async (request) => {
    const { slug } = parseInput(shareParamsSchema, request.params);
    const report = await store.getShareReport(slug);
    if (!report) {
      throw new DomainError("SHARE_REPORT_NOT_FOUND", "The share report does not exist.");
    }
    return response(request, report);
  });
}
