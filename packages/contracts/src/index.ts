import { z } from "zod";

export const PARSER_VERSION = "tree-sitter-ts-js-py-go-v1";

export const BUNDLED_DEMO_REPOSITORY = {
  owner: "repovista-fixtures",
  name: "polyglot-demo",
  // RFC 6761 reserves `.invalid` for examples that must never resolve to a
  // real network resource. The bundled fixture is generated locally, so its
  // identity must not look like an actual GitHub repository.
  canonicalUrl: "https://repovista-demo.invalid/polyglot-demo",
  cloneUrl: "https://repovista-demo.invalid/polyglot-demo.git",
  defaultBranch: "fixture-main",
} as const;

export function isBundledDemoRepository(canonicalUrl: string): boolean {
  return canonicalUrl === BUNDLED_DEMO_REPOSITORY.canonicalUrl;
}

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

export const supportedParserLanguageSchema = z.enum(["typescript", "javascript", "python", "go"]);
export type SupportedParserLanguage = z.infer<typeof supportedParserLanguageSchema>;

export const createRepositoryRequestSchema = z.object({
  url: z.url(),
  installationId: z.number().int().positive().optional(),
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
  workspaceId: idSchema.optional(),
  owner: z.string(),
  name: z.string(),
  canonicalUrl: z.url(),
  visibility: z.enum(["public", "private"]).optional(),
  githubInstallationId: z.number().int().positive().nullable().optional(),
  defaultBranch: z.string().nullable(),
  latestSnapshotId: idSchema.nullable(),
  latestSnapshotStatus: snapshotStatusSchema.nullable(),
  latestCommitSha: z.string().nullable(),
  autoUpdateEnabled: z.boolean().default(false),
  lastWebhookAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;

export const githubIntegrationStatusSchema = z.object({
  enabled: z.boolean(),
  loginEnabled: z.boolean().optional(),
  privateRepositories: z.boolean().optional(),
  appSlug: z.string().nullable(),
  events: z.array(
    z.enum(["ping", "installation", "installation_repositories", "push", "pull_request"]),
  ),
  scope: z.enum(["public-repositories", "selected-installation-repositories"]),
});
export type GitHubIntegrationStatus = z.infer<typeof githubIntegrationStatusSchema>;

export const githubWebhookResultSchema = z.object({
  status: z.enum(["enqueued", "ignored", "synchronized", "duplicate"]),
  duplicate: z.boolean(),
  deliveryId: z.string(),
  reason: z.string().nullable(),
  repositoryId: idSchema.nullable(),
  snapshotId: idSchema.nullable(),
  jobId: idSchema.nullable(),
});
export type GitHubWebhookResult = z.infer<typeof githubWebhookResultSchema>;

export const snapshotStatsSchema = z.object({
  files: z.number().int().nonnegative().default(0),
  symbols: z.number().int().nonnegative().default(0),
  edges: z.number().int().nonnegative().default(0),
  languages: z.record(z.string(), z.number().int().nonnegative()).default({}),
  warnings: z.number().int().nonnegative().default(0),
  indexing: z
    .object({
      mode: z.enum(["full", "incremental"]),
      baseSnapshotId: idSchema.nullable(),
      baseCommitSha: commitShaSchema.nullable(),
      scannedFiles: z.number().int().nonnegative(),
      changedFiles: z.number().int().nonnegative(),
      reusedFiles: z.number().int().nonnegative(),
      parsedFiles: z.number().int().nonnegative(),
      deletedFiles: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
});
export type SnapshotStats = z.infer<typeof snapshotStatsSchema>;

export const snapshotSchema = z.object({
  id: idSchema,
  repositoryId: idSchema,
  guardrailProfileId: idSchema.nullable().optional(),
  commitSha: z.string().nullable(),
  refName: z.string().nullable(),
  status: snapshotStatusSchema,
  parserVersion: z.string(),
  baseSnapshotId: idSchema.nullable(),
  indexMode: z.enum(["full", "incremental"]),
  treeHash: z.string().nullable(),
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
  snapshotId: idSchema.nullable(),
  analysisId: idSchema.nullable().default(null),
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

export const snapshotSymbolEvidenceSchema = z.object({
  id: idSchema,
  snapshotId: idSchema,
  commitSha: commitShaSchema,
  parserVersion: z.string(),
  fileId: idSchema,
  path: z.string(),
  language: z.string().nullable(),
  blobHash: z.string(),
  stableKey: z.string(),
  kind: symbolKindSchema,
  name: z.string(),
  qualifiedName: z.string().nullable(),
  signature: z.string().nullable(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
  contentHash: z.string(),
});
export type SnapshotSymbolEvidence = z.infer<typeof snapshotSymbolEvidenceSchema>;

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

export const retrievalModeSchema = z.enum(["text", "symbol", "semantic", "hybrid"]);
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;

export const retrievalChannelSchema = z.enum(["text", "symbol", "semantic"]);
export type RetrievalChannel = z.infer<typeof retrievalChannelSchema>;

export const embeddingProviderSchema = z.enum(["ollama", "openai-compatible"]);
export type EmbeddingProvider = z.infer<typeof embeddingProviderSchema>;

export const embeddingIndexStatusSchema = z.enum([
  "queued",
  "running",
  "ready",
  "failed",
  "cancelled",
]);
export type EmbeddingIndexStatus = z.infer<typeof embeddingIndexStatusSchema>;

export const embeddingIndexSchema = z.object({
  id: idSchema,
  snapshotId: idSchema,
  provider: embeddingProviderSchema,
  model: z.string().min(1).max(200),
  inputVersion: z.string().min(1).max(100),
  status: embeddingIndexStatusSchema,
  dimensions: z.number().int().min(1).max(16_000).nullable(),
  totalChunks: z.number().int().nonnegative(),
  embeddedChunks: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  jobId: idSchema.nullable(),
  failure: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
});
export type EmbeddingIndex = z.infer<typeof embeddingIndexSchema>;

export const retrievalUnavailableReasonSchema = z.enum([
  "provider_disabled",
  "index_missing",
  "index_building",
  "index_failed",
  "model_mismatch",
  "provider_unavailable",
  "dimension_mismatch",
]);
export type RetrievalUnavailableReason = z.infer<typeof retrievalUnavailableReasonSchema>;

export const retrievalChannelTraceSchema = z.object({
  channel: retrievalChannelSchema,
  status: z.enum(["used", "skipped", "unavailable", "failed"]),
  candidateCount: z.number().int().nonnegative(),
  reason: retrievalUnavailableReasonSchema.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
});
export type RetrievalChannelTrace = z.infer<typeof retrievalChannelTraceSchema>;

export const retrievalTraceSchema = z.object({
  requestedMode: retrievalModeSchema,
  usedChannels: z.array(retrievalChannelSchema),
  degraded: z.boolean(),
  degradationReason: retrievalUnavailableReasonSchema.nullable(),
  channels: z.array(retrievalChannelTraceSchema),
  embeddingIndex: embeddingIndexSchema.nullable(),
});
export type RetrievalTrace = z.infer<typeof retrievalTraceSchema>;

export const retrievalSignalSchema = z.object({
  channel: retrievalChannelSchema,
  rank: z.number().int().positive(),
  rawScore: z.number().finite(),
});
export type RetrievalSignal = z.infer<typeof retrievalSignalSchema>;

export const searchHitSchema = evidenceSchema.extend({
  signals: z.array(retrievalSignalSchema).min(1),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchResultSchema = z.object({
  query: z.string(),
  trace: retrievalTraceSchema,
  results: z.array(searchHitSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const retrievalCapabilitySchema = z.object({
  ready: z.boolean(),
  reason: retrievalUnavailableReasonSchema.nullable(),
});
export type RetrievalCapability = z.infer<typeof retrievalCapabilitySchema>;

export const retrievalStatusSchema = z.object({
  snapshotId: idSchema,
  text: retrievalCapabilitySchema,
  symbol: retrievalCapabilitySchema,
  semantic: z.object({
    configured: z.boolean(),
    queryable: z.boolean(),
    reason: retrievalUnavailableReasonSchema.nullable(),
    currentIndex: embeddingIndexSchema.nullable(),
    latestIndex: embeddingIndexSchema.nullable(),
  }),
});
export type RetrievalStatus = z.infer<typeof retrievalStatusSchema>;

export const createEmbeddingIndexResponseSchema = z.object({
  embeddingIndex: embeddingIndexSchema,
  jobId: idSchema.nullable(),
  reused: z.boolean(),
});
export type CreateEmbeddingIndexResponse = z.infer<typeof createEmbeddingIndexResponseSchema>;

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

export const modelProviderSchema = z.enum(["fake", "ollama", "openai-compatible"]);
export type ModelProviderName = z.infer<typeof modelProviderSchema>;

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

export const askResultSchema = z.object({
  messageId: idSchema,
  answer: groundedAnswerSchema,
  evidence: z.array(searchHitSchema),
  trace: retrievalTraceSchema,
});
export type AskResult = z.infer<typeof askResultSchema>;

export const askRequestSchema = z.object({
  question: z.string().trim().min(2).max(4_000),
  provider: modelProviderSchema.optional(),
  model: z.string().max(200).optional(),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

export const pullRequestAnalysisStatusSchema = z.enum([
  "queued",
  "running",
  "ready",
  "failed",
  "cancelled",
]);
export type PullRequestAnalysisStatus = z.infer<typeof pullRequestAnalysisStatusSchema>;

export const pullRequestChangeTypeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "unchanged",
]);
export type PullRequestChangeType = z.infer<typeof pullRequestChangeTypeSchema>;

export const pullRequestSymbolChangeTypeSchema = z.enum(["added", "modified", "deleted", "moved"]);
export type PullRequestSymbolChangeType = z.infer<typeof pullRequestSymbolChangeTypeSchema>;

export const pullRequestRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type PullRequestRiskLevel = z.infer<typeof pullRequestRiskLevelSchema>;

export const pullRequestSnapshotSideSchema = z.enum(["base", "head"]);
export type PullRequestSnapshotSide = z.infer<typeof pullRequestSnapshotSideSchema>;

export const pullRequestImpactTypeSchema = z.enum(["changed", "direct", "transitive", "unknown"]);
export type PullRequestImpactType = z.infer<typeof pullRequestImpactTypeSchema>;

export const pullRequestRiskBreakdownSchema = z.object({
  changedSymbolWeight: z.number().min(0).max(1),
  reverseFanInWeight: z.number().min(0).max(1),
  publicApiWeight: z.number().min(0).max(1),
  languageWeight: z.number().min(0).max(1),
});
export type PullRequestRiskBreakdown = z.infer<typeof pullRequestRiskBreakdownSchema>;

export const pullRequestStatsSchema = z.object({
  changedFiles: z.number().int().nonnegative().default(0),
  changedSymbols: z.number().int().nonnegative().default(0),
  directImpacts: z.number().int().nonnegative().default(0),
  transitiveImpacts: z.number().int().nonnegative().default(0),
  unknownImpacts: z.number().int().nonnegative().default(0),
  truncated: z.boolean().default(false),
});
export type PullRequestStats = z.infer<typeof pullRequestStatsSchema>;

export const pullRequestAnalysisSchema = z.object({
  id: idSchema,
  repositoryId: idSchema,
  prNumber: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  baseSha: commitShaSchema.nullable(),
  headSha: commitShaSchema.nullable(),
  baseSnapshotId: idSchema.nullable(),
  headSnapshotId: idSchema.nullable(),
  parserVersion: z.string(),
  algorithmVersion: z.string(),
  revision: z.number().int().positive(),
  status: pullRequestAnalysisStatusSchema,
  progress: z.number().min(0).max(1),
  stats: pullRequestStatsSchema,
  failure: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type PullRequestAnalysis = z.infer<typeof pullRequestAnalysisSchema>;

export const createPullRequestAnalysisRequestSchema = z.object({
  number: z.coerce.number().int().positive().max(1_000_000),
});
export type CreatePullRequestAnalysisRequest = z.infer<
  typeof createPullRequestAnalysisRequestSchema
>;

export const createPullRequestAnalysisResponseSchema = z.object({
  analysisId: idSchema,
  jobId: idSchema,
  revision: z.number().int().positive(),
  status: jobStatusSchema,
});
export type CreatePullRequestAnalysisResponse = z.infer<
  typeof createPullRequestAnalysisResponseSchema
>;

export const pullRequestFileChangeSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  changeType: pullRequestChangeTypeSchema,
  baseBlobHash: z.string().nullable(),
  headBlobHash: z.string().nullable(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
});
export type PullRequestFileChange = z.infer<typeof pullRequestFileChangeSchema>;

export const pullRequestSymbolChangeSchema = z.object({
  id: z.string(),
  side: pullRequestSnapshotSideSchema,
  symbolId: idSchema.nullable(),
  stableKey: z.string(),
  path: z.string(),
  name: z.string(),
  kind: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  changeType: pullRequestSymbolChangeTypeSchema,
});
export type PullRequestSymbolChange = z.infer<typeof pullRequestSymbolChangeSchema>;

export const pullRequestImpactEvidenceSchema = z.object({
  id: z.string(),
  snapshotId: idSchema,
  commitSha: commitShaSchema,
  fileId: idSchema,
  symbolId: idSchema.nullable(),
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  quote: z.string(),
  contentHash: z.string(),
  relationType: relationTypeSchema.nullable(),
  algorithmVersion: z.string(),
});
export type PullRequestImpactEvidence = z.infer<typeof pullRequestImpactEvidenceSchema>;

export const pullRequestImpactPathSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  fromSymbolId: idSchema.nullable(),
  toSymbolId: idSchema.nullable(),
  fromPath: z.string().nullable(),
  toPath: z.string().nullable(),
  relationType: relationTypeSchema,
  confidence: z.number().min(0).max(1),
  evidenceId: z.string().nullable(),
});
export type PullRequestImpactPath = z.infer<typeof pullRequestImpactPathSchema>;

export const pullRequestImpactSchema = z.object({
  id: idSchema,
  analysisId: idSchema,
  side: pullRequestSnapshotSideSchema,
  symbolId: idSchema.nullable(),
  stableKey: z.string(),
  path: z.string(),
  name: z.string(),
  kind: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  impactType: pullRequestImpactTypeSchema,
  distance: z.number().int().nonnegative(),
  riskScore: z.number().min(0).max(1),
  riskLevel: pullRequestRiskLevelSchema,
  riskBreakdown: pullRequestRiskBreakdownSchema,
  truncated: z.boolean(),
  paths: z.array(pullRequestImpactPathSchema),
  evidence: z.array(pullRequestImpactEvidenceSchema),
});
export type PullRequestImpact = z.infer<typeof pullRequestImpactSchema>;

export const pullRequestImpactResponseSchema = z.object({
  analysis: pullRequestAnalysisSchema,
  files: z.array(pullRequestFileChangeSchema),
  symbols: z.array(pullRequestSymbolChangeSchema),
  impacts: z.array(pullRequestImpactSchema),
  nextCursor: z.string().nullable(),
});
export type PullRequestImpactResponse = z.infer<typeof pullRequestImpactResponseSchema>;

export const createShareRequestSchema = z.object({
  snapshotId: idSchema,
  title: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;

export const architectureTourV1Schema = z.object({
  version: z.literal(1).optional(),
  overview: z.string(),
  readingPath: z.array(z.object({ path: z.string(), reason: z.string() })),
  map: z.unknown(),
});
export type ArchitectureTourV1 = z.infer<typeof architectureTourV1Schema>;

export const storyGraphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  truncated: z.boolean(),
});
export type StoryGraph = z.infer<typeof storyGraphSchema>;

export const storyRetrievalProfileSchema = z.object({
  id: idSchema,
  provider: embeddingProviderSchema,
  model: z.string(),
  dimensions: z.number().int().positive(),
});
export type StoryRetrievalProfile = z.infer<typeof storyRetrievalProfileSchema>;

export const architectureStoryV2Schema = z.object({
  version: z.literal(2),
  algorithmVersion: z.string(),
  headline: z.string(),
  overview: z.string(),
  metrics: z.object({
    files: z.number().int().nonnegative(),
    symbols: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    languages: z.array(
      z.object({
        name: z.string(),
        files: z.number().int().nonnegative(),
      }),
    ),
  }),
  map: storyGraphSchema,
  keyModules: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      path: z.string().nullable(),
      importance: z.number().min(0).max(1),
      inDegree: z.number().int().nonnegative(),
      outDegree: z.number().int().nonnegative(),
      score: z.number().min(0).max(1),
      representativePath: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  readingPath: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
    }),
  ),
  evidenceHighlights: z.array(
    z.object({
      id: z.string(),
      fileId: idSchema,
      symbolId: idSchema.nullable(),
      path: z.string(),
      symbol: z.string().nullable(),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      quote: z.string(),
      contentHash: z.string(),
    }),
  ),
  provenance: z.object({
    snapshotId: idSchema,
    commitSha: commitShaSchema,
    parserVersion: z.string(),
    generatedAt: z.iso.datetime(),
    generatedAtSource: z.enum(["snapshot_ready_at", "snapshot_requested_at"]),
    retrievalProfile: storyRetrievalProfileSchema.nullable(),
  }),
});
export type ArchitectureStoryV2 = z.infer<typeof architectureStoryV2Schema>;

export const shareReportContentSchema = z.union([
  architectureStoryV2Schema,
  architectureTourV1Schema,
]);
export type ShareReportContent = z.infer<typeof shareReportContentSchema>;

// v0.5 authentication and workspace contracts. Raw session/API tokens are
// intentionally absent from response schemas; the token-create response is
// modeled separately and is never persisted by the server.
export const workspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const authScopeSchema = z.enum(["repo:read", "repo:write", "workspace:admin"]);
export type AuthScope = z.infer<typeof authScopeSchema>;

export const workspaceSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  kind: z.enum(["public", "personal", "team"]),
  visibility: z.enum(["public", "private"]),
  role: workspaceRoleSchema,
  createdAt: z.iso.datetime(),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const authUserSchema = z.object({
  id: idSchema,
  login: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authCapabilitiesSchema = z.object({
  githubLogin: z.boolean(),
  githubApp: z.boolean(),
  privateRepositories: z.boolean(),
});

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  user: authUserSchema.nullable(),
  workspace: workspaceSummarySchema.nullable(),
  workspaces: z.array(workspaceSummarySchema),
  csrfToken: z.string().nullable(),
  capabilities: authCapabilitiesSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const switchWorkspaceRequestSchema = z.object({ workspaceId: idSchema });

export const workspaceMemberSchema = z.object({
  userId: idSchema,
  login: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.url().nullable(),
  role: workspaceRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const addWorkspaceMemberRequestSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1)
    .max(39)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
  role: workspaceRoleSchema.default("viewer"),
});
export type AddWorkspaceMemberRequest = z.infer<typeof addWorkspaceMemberRequestSchema>;

export const updateWorkspaceMemberRequestSchema = z.object({
  role: workspaceRoleSchema,
});
export type UpdateWorkspaceMemberRequest = z.infer<typeof updateWorkspaceMemberRequestSchema>;

export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(authScopeSchema).min(1).max(3).default(["repo:read"]),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>;

export const apiTokenMetadataSchema = z.object({
  id: idSchema,
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(authScopeSchema),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiTokenMetadata = z.infer<typeof apiTokenMetadataSchema>;

export const createApiTokenResponseSchema = z.object({
  token: z.string().regex(/^rv_[A-Za-z0-9_-]{32,}$/),
  metadata: apiTokenMetadataSchema,
});
export type CreateApiTokenResponse = z.infer<typeof createApiTokenResponseSchema>;

export const githubInstallationSchema = z.object({
  installationId: z.number().int().positive(),
  accountId: z.number().int().positive(),
  accountLogin: z.string(),
  accountType: z.enum(["User", "Organization"]),
  repositorySelection: z.enum(["all", "selected"]),
  suspendedAt: z.iso.datetime().nullable(),
  lastSyncedAt: z.iso.datetime().nullable(),
  repositoryCount: z.number().int().nonnegative().nullable().default(null),
});
export type GitHubInstallation = z.infer<typeof githubInstallationSchema>;

export const githubInstallationRepositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  html_url: z.url(),
  clone_url: z.url(),
  default_branch: z.string(),
  owner: z.object({ login: z.string() }),
});
export type GitHubInstallationRepository = z.infer<typeof githubInstallationRepositorySchema>;

export const githubInstallationRepositoryPageSchema = z.object({
  repositories: z.array(githubInstallationRepositorySchema),
  totalCount: z.number().int().nonnegative(),
});
export type GitHubInstallationRepositoryPage = z.infer<
  typeof githubInstallationRepositoryPageSchema
>;

export const auditEventSchema = z.object({
  id: z.number().int().positive(),
  actorKind: z.enum(["anonymous", "session", "token", "github", "system"]),
  actorLogin: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

// v0.6 deterministic Architecture Guardrails. Findings are derived from one
// immutable Snapshot and intentionally carry only bounded source locations and
// metrics, never source blobs or credentials.
export const guardrailSeveritySchema = z.enum(["error", "warning", "info"]);
export type GuardrailSeverity = z.infer<typeof guardrailSeveritySchema>;

export const guardrailStatusSchema = z.enum(["pass", "warn", "fail"]);
export type GuardrailStatus = z.infer<typeof guardrailStatusSchema>;

export const guardrailRuleIdSchema = z.enum([
  "dependency_cycle",
  "large_file",
  "large_symbol",
  "high_fan_in",
  "unresolved_import",
  "parse_failure",
]);
export type GuardrailRuleId = z.infer<typeof guardrailRuleIdSchema>;

export const guardrailThresholdsSchema = z
  .object({
    cycleMaxLength: z.number().int().min(2).max(100),
    largeFileLines: z.number().int().positive(),
    largeFileBytes: z.number().int().positive(),
    largeSymbolLines: z.number().int().positive(),
    highFanIn: z.number().int().positive(),
  })
  .strict();
export type GuardrailThresholds = z.infer<typeof guardrailThresholdsSchema>;

export const guardrailProfileIdSchema = idSchema;
export const guardrailProfileKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,63}$/);

export const guardrailProfileSchema = z.object({
  id: guardrailProfileIdSchema,
  workspaceId: idSchema.nullable(),
  profileKey: guardrailProfileKeySchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  version: z.number().int().positive(),
  algorithmVersion: z.string().min(1),
  thresholds: guardrailThresholdsSchema,
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  builtIn: z.boolean(),
  createdBy: idSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type GuardrailProfile = z.infer<typeof guardrailProfileSchema>;

export const createGuardrailProfileRequestSchema = z
  .object({
    profileKey: guardrailProfileKeySchema.refine((value) => value !== "default", {
      message: "The default profile key is reserved for the built-in policy.",
    }),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).default(""),
    thresholds: guardrailThresholdsSchema,
  })
  .strict();
export type CreateGuardrailProfileRequest = z.infer<typeof createGuardrailProfileRequestSchema>;

export const assignGuardrailProfileRequestSchema = z
  .object({
    profileId: idSchema.nullable(),
  })
  .strict();
export type AssignGuardrailProfileRequest = z.infer<typeof assignGuardrailProfileRequestSchema>;

export const guardrailEvidenceSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  description: z.string().min(1),
});
export type GuardrailEvidence = z.infer<typeof guardrailEvidenceSchema>;

export const guardrailFindingSchema = z.object({
  id: z.string().min(1),
  fingerprint: z.string().min(1),
  ruleId: guardrailRuleIdSchema,
  severity: guardrailSeveritySchema,
  title: z.string().min(1),
  message: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  metric: z.record(z.string(), z.union([z.number().finite(), z.string()])),
  evidence: z.array(guardrailEvidenceSchema).min(1).max(20),
});
export type GuardrailFinding = z.infer<typeof guardrailFindingSchema>;

export const guardrailReportSchema = z.object({
  algorithmVersion: z.string().min(1),
  profile: guardrailProfileSchema.nullable().default(null),
  snapshot: z.object({
    id: idSchema,
    commitSha: commitShaSchema,
    parserVersion: z.string().min(1),
  }),
  generatedAt: z.iso.datetime(),
  status: guardrailStatusSchema,
  summary: z.object({
    total: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
  }),
  thresholds: guardrailThresholdsSchema,
  findings: z.array(guardrailFindingSchema),
});
export type GuardrailReport = z.infer<typeof guardrailReportSchema>;

// Human review is intentionally separate from deterministic Guardrail
// findings. It is workspace metadata only and can never alter report status,
// severity, thresholds, or CI decisions.
export const guardrailReviewStatusSchema = z.enum([
  "unreviewed",
  "acknowledged",
  "accepted_risk",
  "false_positive",
]);
export type GuardrailReviewStatus = z.infer<typeof guardrailReviewStatusSchema>;

export const guardrailReviewReviewerSchema = z.object({
  userId: idSchema,
  login: z.string().nullable(),
  displayName: z.string(),
});
export type GuardrailReviewReviewer = z.infer<typeof guardrailReviewReviewerSchema>;

const guardrailReviewNoteSchema = z
  .string()
  // PostgreSQL length(text) counts Unicode code points while JavaScript's
  // String#length counts UTF-16 code units. Keep a small code-unit guard and
  // enforce the documented 2,000-character limit by code point.
  .max(4_000)
  .refine((value) => Array.from(value).length <= 2_000, {
    message: "Review note must contain at most 2,000 Unicode characters.",
  });

export const guardrailReviewSchema = z.object({
  findingId: z.string().trim().min(1).max(300),
  subjectKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: guardrailReviewStatusSchema,
  note: guardrailReviewNoteSchema,
  reviewer: guardrailReviewReviewerSchema.nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type GuardrailReview = z.infer<typeof guardrailReviewSchema>;

export const guardrailReviewsResponseSchema = z.object({
  snapshot: z.object({
    id: idSchema,
    commitSha: commitShaSchema,
  }),
  reviews: z.array(guardrailReviewSchema),
});
export type GuardrailReviewsResponse = z.infer<typeof guardrailReviewsResponseSchema>;

export const updateGuardrailReviewRequestSchema = z
  .object({
    status: guardrailReviewStatusSchema,
    note: guardrailReviewNoteSchema.trim().default(""),
  })
  .strict();
export type UpdateGuardrailReviewRequest = z.infer<typeof updateGuardrailReviewRequestSchema>;

export const createGuardrailExplanationRequestSchema = z
  .object({
    findingId: z.string().trim().min(1).max(300),
    provider: modelProviderSchema.optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CreateGuardrailExplanationRequest = z.infer<
  typeof createGuardrailExplanationRequestSchema
>;

export const guardrailExplanationSubjectKeySchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const guardrailExplanationSchema = z.object({
  id: idSchema,
  subjectKey: guardrailExplanationSubjectKeySchema,
  snapshot: z.object({
    id: idSchema,
    commitSha: commitShaSchema,
    parserVersion: z.string().min(1),
    algorithmVersion: z.string().min(1),
  }),
  profile: guardrailProfileSchema.nullable().default(null),
  profileFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  finding: guardrailFindingSchema,
  answer: groundedAnswerSchema,
  promptVersion: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
});
export type GuardrailExplanation = z.infer<typeof guardrailExplanationSchema>;

export const createGuardrailExplanationResponseSchema = z.object({
  explanation: guardrailExplanationSchema,
  reused: z.boolean(),
});
export type CreateGuardrailExplanationResponse = z.infer<
  typeof createGuardrailExplanationResponseSchema
>;

export const guardrailExplanationSummarySchema = z.object({
  id: idSchema,
  subjectKey: guardrailExplanationSubjectKeySchema,
  snapshot: z.object({
    id: idSchema,
    commitSha: commitShaSchema,
    parserVersion: z.string().min(1),
    algorithmVersion: z.string().min(1),
  }),
  profileFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  finding: z.object({
    id: z.string().min(1),
    fingerprint: z.string().min(1),
    ruleId: guardrailRuleIdSchema,
    severity: guardrailSeveritySchema,
    title: z.string().min(1),
    message: z.string().min(1),
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }),
  answer: z.object({
    status: answerStatusSchema,
    summary: z.string(),
    provider: z.string(),
    model: z.string(),
    stepCount: z.number().int().nonnegative(),
    citationCount: z.number().int().nonnegative(),
    limitationCount: z.number().int().nonnegative(),
  }),
  promptVersion: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
});
export type GuardrailExplanationSummary = z.infer<typeof guardrailExplanationSummarySchema>;

export const guardrailExplanationHistorySchema = z.object({
  subjectKey: guardrailExplanationSubjectKeySchema,
  finding: guardrailFindingSchema,
  explanations: z.array(guardrailExplanationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type GuardrailExplanationHistory = z.infer<typeof guardrailExplanationHistorySchema>;

export const guardrailExplanationDifferenceSchema = z.enum(["same", "changed"]);
export type GuardrailExplanationDifference = z.infer<typeof guardrailExplanationDifferenceSchema>;

export const guardrailExplanationComparisonSchema = z.object({
  subjectKey: guardrailExplanationSubjectKeySchema,
  changed: z.boolean(),
  base: guardrailExplanationSchema,
  head: guardrailExplanationSchema,
  differences: z.object({
    provenance: z.object({
      snapshotId: guardrailExplanationDifferenceSchema,
      commitSha: guardrailExplanationDifferenceSchema,
      parserVersion: guardrailExplanationDifferenceSchema,
      algorithmVersion: guardrailExplanationDifferenceSchema,
      profileFingerprint: guardrailExplanationDifferenceSchema,
      provider: guardrailExplanationDifferenceSchema,
      model: guardrailExplanationDifferenceSchema,
      promptVersion: guardrailExplanationDifferenceSchema,
    }),
    finding: z.object({
      id: guardrailExplanationDifferenceSchema,
      fingerprint: guardrailExplanationDifferenceSchema,
      severity: guardrailExplanationDifferenceSchema,
      title: guardrailExplanationDifferenceSchema,
      message: guardrailExplanationDifferenceSchema,
      path: guardrailExplanationDifferenceSchema,
      range: guardrailExplanationDifferenceSchema,
      metric: guardrailExplanationDifferenceSchema,
      evidence: guardrailExplanationDifferenceSchema,
    }),
    answer: z.object({
      status: guardrailExplanationDifferenceSchema,
      summary: guardrailExplanationDifferenceSchema,
      steps: guardrailExplanationDifferenceSchema,
      limitations: guardrailExplanationDifferenceSchema,
      citations: guardrailExplanationDifferenceSchema,
    }),
  }),
});
export type GuardrailExplanationComparison = z.infer<typeof guardrailExplanationComparisonSchema>;

export const guardrailComparisonStatusSchema = z.enum([
  "added",
  "resolved",
  "unchanged",
  "changed",
]);
export type GuardrailComparisonStatus = z.infer<typeof guardrailComparisonStatusSchema>;

export const guardrailComparisonOverallSchema = z.enum(["regressed", "improved", "unchanged"]);
export type GuardrailComparisonOverall = z.infer<typeof guardrailComparisonOverallSchema>;

export const guardrailFindingComparisonSchema = z.object({
  key: z.string().min(1),
  status: guardrailComparisonStatusSchema,
  base: guardrailFindingSchema.nullable(),
  head: guardrailFindingSchema.nullable(),
});
export type GuardrailFindingComparison = z.infer<typeof guardrailFindingComparisonSchema>;

export const guardrailComparisonSchema = z.object({
  algorithmVersion: z.string().min(1),
  profile: guardrailProfileSchema.nullable().default(null),
  base: guardrailReportSchema,
  head: guardrailReportSchema,
  overall: guardrailComparisonOverallSchema,
  summary: z.object({
    total: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
    improvements: z.number().int().nonnegative(),
  }),
  findings: z.array(guardrailFindingComparisonSchema),
});
export type GuardrailComparison = z.infer<typeof guardrailComparisonSchema>;

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
