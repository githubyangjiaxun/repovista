import type {
  EmbeddingIndex,
  EmbeddingProvider,
  GitHubWebhookResult,
  GroundedAnswer,
  Job,
  RepositorySummary,
  RetrievalStatus,
  ShareReportContent,
  Snapshot,
  SnapshotStats,
} from "@repovista/contracts";
import type { GitHubRepositoryIdentity, IndexedRepository, ParsedFile } from "@repovista/domain";
import type { ImpactComputation } from "@repovista/impact";

export interface CreateImportInput {
  workspaceId: string;
  identity: GitHubRepositoryIdentity;
  requestedRef?: string;
  ignore: string[];
  parserVersion: string;
}

export interface CreateImportResult {
  repositoryId: string;
  snapshotId: string;
  jobId: string;
  status: "queued";
}

export interface CreatePullRequestAnalysisInput {
  workspaceId: string;
  repositoryId: string;
  prNumber: number;
  title: string;
  canonicalUrl: string;
  baseSha: string;
  headSha: string;
  parserVersion: string;
  algorithmVersion: string;
  providerFiles: import("@repovista/contracts").PullRequestFileChange[];
  requestedBaseSha?: string;
  requestedHeadSha?: string;
  forceRevision?: number;
}

export interface CreatePullRequestAnalysisResult {
  analysisId: string;
  jobId: string;
  revision: number;
  status: Job["status"];
}

export interface PullRequestAnalysisJob {
  id: string;
  analysisId: string;
  repositoryId: string;
  workspaceId: string;
  owner: string;
  name: string;
  cloneUrl: string;
  prNumber: number;
  title: string;
  canonicalUrl: string;
  baseSha: string;
  headSha: string;
  parserVersion: string;
  algorithmVersion: string;
  providerFiles: import("@repovista/contracts").PullRequestFileChange[];
  attemptCount: number;
  maxAttempts: number;
}

export interface EnsureSnapshotForCommitInput {
  repositoryId: string;
  workspaceId: string;
  commitSha: string;
  parserVersion: string;
  cloneRef?: string;
}

export interface EnsureSnapshotForCommitResult {
  snapshotId: string;
  jobId: string | null;
  status: "ready" | "queued" | "running";
}

export interface PullRequestAnalysisMetadata {
  id: string;
  repositoryId: string;
  workspaceId: string;
  prNumber: number;
  title: string;
  canonicalUrl: string;
  baseSha: string;
  headSha: string;
  parserVersion: string;
  algorithmVersion: string;
  revision: number;
}

export interface PullRequestAnalysisPage {
  analysis: import("@repovista/contracts").PullRequestAnalysis;
  files: import("@repovista/contracts").PullRequestFileChange[];
  symbols: import("@repovista/contracts").PullRequestSymbolChange[];
  impacts: import("@repovista/contracts").PullRequestImpact[];
  nextCursor: string | null;
}

export interface CompletePullRequestAnalysisInput {
  jobId: string;
  analysisId: string;
  workerId: string;
  computation: ImpactComputation;
  baseSnapshotId: string;
  headSnapshotId: string;
}

export interface PullRequestAnalysisProgress {
  phase: string;
  progress: number;
  message: string;
}

export interface PullRequestAnalysisCursor {
  riskScore: number;
  path: string;
  startLine: number;
  id: string;
}

export interface ClaimedIndexJob {
  id: string;
  repositoryId: string;
  snapshotId: string;
  workspaceId: string;
  canonicalUrl: string;
  cloneUrl: string;
  owner: string;
  name: string;
  requestedRef: string | null;
  ignore: string[];
  attemptCount: number;
  maxAttempts: number;
}

export interface IncrementalIndexBase {
  snapshotId: string;
  commitSha: string;
  parserVersion: string;
  files: {
    path: string;
    contentHash: string;
    language: string | null;
    parseStatus: string;
  }[];
  parsedFiles: ParsedFile[];
}

export interface GitHubWebhookInput {
  deliveryId: string;
  eventName: string;
  payloadSha256: string;
  push: {
    owner: string;
    name: string;
    canonicalUrl: string;
    cloneUrl: string;
    providerRepoId: string | null;
    defaultBranch: string;
    after: string;
    ref: string;
    deleted: boolean;
    isPrivate: boolean;
    installationId: number | null;
  } | null;
}

export type GitHubWebhookProcessResult = GitHubWebhookResult;

export interface JobEventRecord {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SnapshotFileRecord {
  id: string;
  path: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  blobHash: string;
  content: string;
  parseStatus: string;
}

export type SnapshotFileSummary = Omit<SnapshotFileRecord, "content">;

export interface ListSnapshotFilesOptions {
  afterPath?: string;
  language?: string;
  limit?: number;
  pathPrefix?: string;
  query?: string;
}

export interface SnapshotFilePage {
  files: SnapshotFileSummary[];
  nextCursor: string | null;
}

export interface SymbolRecord {
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

export interface SymbolEdgeRecord {
  id: string;
  fromSymbolId: string;
  toSymbolId: string | null;
  unresolvedTarget: string | null;
  relationType: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface SnapshotGraphData {
  snapshot: Snapshot;
  files: SnapshotFileRecord[];
  symbols: SymbolRecord[];
  edges: SymbolEdgeRecord[];
}

export interface SearchEvidenceRecord {
  id: string;
  snapshotId: string;
  commitSha: string;
  fileId: string;
  path: string;
  symbolId: string | null;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  score: number;
}

export interface EmbeddingChunkRecord {
  id: string;
  snapshotId: string;
  commitSha: string;
  fileId: string;
  path: string;
  symbolId: string | null;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
}

export interface EmbeddingIndexInput {
  snapshotId: string;
  workspaceId: string;
  provider: EmbeddingProvider;
  model: string;
  inputVersion: string;
}

export interface EmbeddingIndexResult {
  embeddingIndex: EmbeddingIndex;
  jobId: string | null;
  reused: boolean;
}

export interface ClaimedEmbeddingJob {
  id: string;
  embeddingIndexId: string;
  snapshotId: string;
  workspaceId: string;
  repositoryId: string;
  provider: EmbeddingProvider;
  model: string;
  inputVersion: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface SaveEmbeddingBatchInput {
  jobId: string;
  embeddingIndexId: string;
  snapshotId: string;
  workerId: string;
  dimensions: number;
  rows: {
    codeChunkId: string;
    contentHash: string;
    inputHash: string;
    embedding: readonly number[];
  }[];
  processed: number;
  total: number;
  message: string;
}

export interface EmbeddingSearchOptions {
  snapshotId: string;
  embeddingIndexId: string;
  queryVector: readonly number[];
  limit: number;
}

export interface RetrievalSearchRecord extends SearchEvidenceRecord {
  channel: "text" | "symbol" | "semantic";
}

export interface RetrievalStatusOptions {
  snapshotId: string;
  provider: EmbeddingProvider | null;
  model: string | null;
  inputVersion: string;
}

export type RetrievalStatusResult = RetrievalStatus;

export interface SaveAnswerInput {
  workspaceId: string;
  repositoryId: string;
  snapshotId: string;
  question: string;
  answer: GroundedAnswer;
  evidence: SearchEvidenceRecord[];
  latencyMs: number;
}

export interface ShareReportRecord {
  id: string;
  slug: string;
  title: string;
  repository: RepositorySummary;
  snapshot: Snapshot;
  content: ShareReportContent;
  createdAt: string;
}

export type { IndexedRepository, Job, RepositorySummary, Snapshot, SnapshotStats };
export type { ShareReportContent };
