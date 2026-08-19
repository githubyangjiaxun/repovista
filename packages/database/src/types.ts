import type {
  GroundedAnswer,
  Job,
  RepositorySummary,
  Snapshot,
  SnapshotStats,
} from "@repovista/contracts";
import type { GitHubRepositoryIdentity, IndexedRepository } from "@repovista/domain";

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

export interface SaveAnswerInput {
  workspaceId: string;
  repositoryId: string;
  snapshotId: string;
  question: string;
  answer: GroundedAnswer;
  evidence: SearchEvidenceRecord[];
  latencyMs: number;
}

export interface ShareReportContent {
  overview: string;
  readingPath: { path: string; reason: string }[];
  map: unknown;
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
