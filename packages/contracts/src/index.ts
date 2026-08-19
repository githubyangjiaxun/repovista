import { z } from "zod";

export const idSchema = z.string().uuid();
export const commitShaSchema = z.string().regex(/^[a-f0-9]{7,64}$/i);

export const snapshotStatusSchema = z.enum([
  "requested",
  "cloning",
  "scanning",
  "parsing",
  "building_graph",
  "embedding",
  "ready",
  "failed",
  "cancelled",
]);
export type SnapshotStatus = z.infer<typeof snapshotStatusSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const graphLevelSchema = z.enum(["package", "file", "symbol"]);
export type GraphLevel = z.infer<typeof graphLevelSchema>;

export const symbolKindSchema = z.enum([
  "module",
  "function",
  "class",
  "method",
  "interface",
  "type",
  "variable",
  "enum",
]);
export type SymbolKind = z.infer<typeof symbolKindSchema>;

export const relationTypeSchema = z.enum([
  "contains",
  "imports",
  "calls",
  "extends",
  "implements",
  "exports",
  "reads",
  "writes",
]);
export type RelationType = z.infer<typeof relationTypeSchema>;

export const createRepositoryRequestSchema = z.object({
  url: z.url(),
  ref: z.string().trim().min(1).max(255).optional(),
  ignore: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});
export type CreateRepositoryRequest = z.infer<typeof createRepositoryRequestSchema>;

export const createRepositoryResponseSchema = z.object({
  repositoryId: idSchema,
  snapshotId: idSchema,
  jobId: idSchema,
  status: jobStatusSchema,
});
export type CreateRepositoryResponse = z.infer<typeof createRepositoryResponseSchema>;

export const repositorySummarySchema = z.object({
  id: idSchema,
  owner: z.string(),
  name: z.string(),
  canonicalUrl: z.url(),
  defaultBranch: z.string().nullable(),
  latestSnapshotId: idSchema.nullable(),
  latestSnapshotStatus: snapshotStatusSchema.nullable(),
  latestCommitSha: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;

export const snapshotStatsSchema = z.object({
  files: z.number().int().nonnegative().default(0),
  symbols: z.number().int().nonnegative().default(0),
  edges: z.number().int().nonnegative().default(0),
  languages: z.record(z.string(), z.number().int().nonnegative()).default({}),
  warnings: z.number().int().nonnegative().default(0),
});
export type SnapshotStats = z.infer<typeof snapshotStatsSchema>;

export const snapshotSchema = z.object({
  id: idSchema,
  repositoryId: idSchema,
  commitSha: z.string().nullable(),
  refName: z.string().nullable(),
  status: snapshotStatusSchema,
  parserVersion: z.string(),
  stats: snapshotStatsSchema,
  requestedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
  failure: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const jobSchema = z.object({
  id: idSchema,
  snapshotId: idSchema,
  type: z.string(),
  status: jobStatusSchema,
  phase: z.string().nullable(),
  progress: z.number().min(0).max(1),
  processed: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative().nullable(),
  retryable: z.boolean(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const sourceRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type SourceRange = z.infer<typeof sourceRangeSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  level: graphLevelSchema,
  kind: z.string(),
  label: z.string(),
  path: z.string().nullable(),
  range: sourceRangeSchema.nullable(),
  importance: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: relationTypeSchema,
  confidence: z.number().min(0).max(1),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphResponseSchema = z.object({
  snapshot: z.object({
    id: idSchema,
    commitSha: z.string(),
    parserVersion: z.string(),
  }),
  level: graphLevelSchema,
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  truncated: z.boolean(),
});
export type GraphResponse = z.infer<typeof graphResponseSchema>;

export const sourceFileSchema = z.object({
  id: idSchema,
  path: z.string(),
  language: z.string().nullable(),
  content: z.string(),
  lineCount: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  commitSha: z.string(),
  blobHash: z.string(),
  truncated: z.boolean(),
});
export type SourceFile = z.infer<typeof sourceFileSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  snapshotId: idSchema,
  commitSha: z.string(),
  fileId: idSchema,
  path: z.string(),
  symbolId: idSchema.nullable(),
  symbol: z.string().nullable(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
  contentHash: z.string(),
  score: z.number(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const citationSchema = z.object({
  evidenceId: z.string(),
  path: z.string(),
  symbol: z.string().nullable(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const answerStatusSchema = z.enum(["grounded", "partial", "refused"]);
export type AnswerStatus = z.infer<typeof answerStatusSchema>;

export const groundedAnswerSchema = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  limitations: z.array(z.string()),
  status: answerStatusSchema,
  citations: z.array(citationSchema),
  provider: z.string(),
  model: z.string(),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export const askRequestSchema = z.object({
  question: z.string().trim().min(2).max(4_000),
  provider: z.enum(["fake", "ollama", "openai-compatible"]).optional(),
  model: z.string().max(200).optional(),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

export const createShareRequestSchema = z.object({
  snapshotId: idSchema,
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
  };
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
    requestId: string;
  };
}
