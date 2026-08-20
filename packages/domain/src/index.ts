import type {
  AnswerStatus,
  Citation,
  Evidence,
  GraphEdge,
  GraphNode,
  GroundedAnswer,
  JobStatus,
  RelationType,
  SnapshotStats,
  SnapshotStatus,
  SymbolKind,
} from "@repovista/contracts";
import { v7 as uuidv7 } from "uuid";

export const PUBLIC_USER_ID = "00000000-0000-7000-8000-000000000001";
export const PUBLIC_WORKSPACE_ID = "00000000-0000-7000-8000-000000000002";

export function createId(): string {
  return uuidv7();
}

export interface GitHubRepositoryIdentity {
  owner: string;
  name: string;
  canonicalUrl: string;
  cloneUrl: string;
}

export interface ScannedFile {
  path: string;
  absolutePath: string;
  language: string | null;
  byteSize: number;
  lineCount: number;
  content: string;
  contentHash: string;
  isGenerated: boolean;
}

export interface ParsedSymbol {
  stableKey: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string | null;
  signature: string | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  docText: string | null;
  contentHash: string;
}

export interface ParsedEdge {
  fromStableKey: string;
  targetStableKey?: string;
  unresolvedTarget?: string;
  type: RelationType;
  confidence: number;
  evidence: {
    path: string;
    startLine: number;
    endLine: number;
    syntaxType: string;
    importSource?: string;
    importedNames?: string[];
    referenceTarget?: string;
  };
}

export interface ParsedFile {
  path: string;
  moduleStableKey: string;
  /** Optional Go module path used for repository-local import linking. */
  modulePath?: string;
  symbols: ParsedSymbol[];
  edges: ParsedEdge[];
  imports: {
    source: string;
    importedNames: string[];
    startLine: number;
    endLine: number;
  }[];
}

export type SupportedParserLanguage = "typescript" | "javascript" | "python" | "go";

export interface IndexedRepository {
  commitSha: string;
  branch: string | null;
  baseSnapshotId: string | null;
  indexMode: "full" | "incremental";
  treeHash: string;
  files: ScannedFile[];
  parsedFiles: ParsedFile[];
  stats: SnapshotStats;
}

export interface JobProgress {
  status: JobStatus;
  snapshotStatus?: SnapshotStatus;
  phase: string;
  progress: number;
  processed?: number;
  total?: number;
  message: string;
}

export interface RetrievalResult extends Evidence {
  source: "symbol" | "text" | "semantic" | "graph";
}

export interface ModelAnswerDraft {
  summary: string;
  steps: {
    text: string;
    evidenceIds: string[];
  }[];
  limitations: string[];
  status: AnswerStatus;
}

export interface VerifiedAnswer extends GroundedAnswer {
  citations: Citation[];
}

export interface RepositoryMap {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type { SnapshotStatus, JobStatus, RelationType, SymbolKind };

export class DomainError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function assertNever(value: never): never {
  throw new DomainError("UNEXPECTED_STATE", `Unexpected value: ${String(value)}`);
}
