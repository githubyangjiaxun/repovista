import type { Evidence, RetrievalChannel, SearchHit } from "@repovista/contracts";
import { fuseRetrievalChannels, tokenizeQuestion } from "@repovista/retrieval";

type EvaluatedMode = RetrievalChannel | "hybrid";

interface FixtureDocument extends Evidence {
  symbol: string;
}

interface QualityQuery {
  id: string;
  query: string;
  expectedEvidenceIds: readonly string[];
}

interface QueryEvaluation {
  id: string;
  query: string;
  expectedEvidenceIds: readonly string[];
  candidateCounts: Record<RetrievalChannel, number>;
  ranks: Record<EvaluatedMode, number | null>;
}

interface QualityMetrics {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrrAt10: number;
  averageCandidates: number;
}

export interface RetrievalQualityReport {
  benchmark: "retrieval-quality-fixture";
  fixture: "synthetic-code-corpus-v1";
  semanticProvider: "deterministic-test-only-concept-v1";
  testOnly: true;
  note: string;
  corpusDocuments: number;
  queries: number;
  metrics: Record<EvaluatedMode, QualityMetrics>;
  hybridVsText: {
    recallAt1Delta: number;
    recallAt3Delta: number;
    recallAt5Delta: number;
    mrrAt10Delta: number;
  };
  evaluations: QueryEvaluation[];
}

const snapshotId = "01900000-0000-7000-8000-000000000001";
const fileId = "01900000-0000-7000-8000-000000000002";
const commitSha = "0123456789abcdef0123456789abcdef01234567";

function fixtureDocument(
  sequence: number,
  path: string,
  symbol: string,
  content: string,
): FixtureDocument {
  const suffix = sequence.toString(16).padStart(12, "0");
  const hash = sequence.toString(16).padStart(64, "0");
  return {
    id: `01900000-0000-7000-8000-${suffix}`,
    snapshotId,
    commitSha,
    fileId,
    path,
    symbolId: `01900000-0000-7000-9000-${suffix}`,
    symbol,
    startLine: sequence * 10,
    endLine: sequence * 10 + 8,
    content,
    contentHash: `sha256:${hash}`,
    score: 0,
  };
}

const corpus: readonly FixtureDocument[] = [
  fixtureDocument(
    1,
    "src/http/router.ts",
    "registerRoutes",
    "The router maps HTTP methods and paths to handlers. registerRoutes installs GET and POST endpoints.",
  ),
  fixtureDocument(
    2,
    "src/http/compression.ts",
    "createResponseEncoder",
    "Gzip middleware compresses HTTP response bodies with a negotiated content encoder.",
  ),
  fixtureDocument(
    3,
    "src/database/unit-of-work.ts",
    "withTransaction",
    "withTransaction begins a PostgreSQL transaction, commits successful writes, and rolls back failures.",
  ),
  fixtureDocument(
    4,
    "src/jobs/lease.ts",
    "renewJobLease",
    "A leased background job is claimed by one worker. Heartbeats extend expiry until processing completes.",
  ),
  fixtureDocument(
    5,
    "src/ai/citation-verifier.ts",
    "verifyCitations",
    "The verifier keeps only retrieved evidence IDs and removes fabricated citations before returning an answer.",
  ),
  fixtureDocument(
    6,
    "src/http/request-logger.ts",
    "logRequest",
    "Structured request logging records method, path, status, latency, and correlation metadata.",
  ),
  fixtureDocument(
    7,
    "src/database/cache.ts",
    "readCachedRecord",
    "The database cache reuses recent read results and invalidates entries after writes.",
  ),
  fixtureDocument(
    8,
    "src/jobs/retry.ts",
    "scheduleRetry",
    "Failed work is retried with bounded exponential backoff and an attempt limit.",
  ),
  fixtureDocument(
    9,
    "src/security/authorization.ts",
    "authorizeRequest",
    "Authorization checks whether the current principal may access a protected resource.",
  ),
  fixtureDocument(
    10,
    "src/observability/metrics.ts",
    "recordLatency",
    "Metrics aggregate request duration, error counts, queue depth, and worker throughput.",
  ),
];

const qualityQueries: readonly QualityQuery[] = [
  {
    id: "http-route-registration",
    query: "Where are HTTP endpoints registered?",
    expectedEvidenceIds: [corpus[0]?.id ?? ""],
  },
  {
    id: "response-compression",
    query: "How are outgoing payloads shrunk before delivery?",
    expectedEvidenceIds: [corpus[1]?.id ?? ""],
  },
  {
    id: "database-transaction",
    query: "What guarantees several database writes happen atomically?",
    expectedEvidenceIds: [corpus[2]?.id ?? ""],
  },
  {
    id: "background-job-lease",
    query: "How does a background worker keep ownership while processing?",
    expectedEvidenceIds: [corpus[3]?.id ?? ""],
  },
  {
    id: "citation-verification",
    query: "What prevents invented source references from reaching an answer?",
    expectedEvidenceIds: [corpus[4]?.id ?? ""],
  },
];

const ignoredTextTokens = new Set([
  "a",
  "an",
  "and",
  "are",
  "before",
  "does",
  "from",
  "how",
  "is",
  "several",
  "the",
  "to",
  "what",
  "where",
  "while",
]);

const semanticConcepts: readonly (readonly string[])[] = [
  ["dispatch", "endpoint", "endpoints", "register", "registered", "route", "router"],
  ["handler", "http", "method", "methods", "path", "paths"],
  ["compress", "compression", "encode", "encoder", "gzip", "shrink", "shrunk"],
  ["body", "delivery", "outgoing", "payload", "payloads", "response"],
  ["atomic", "atomically", "transaction"],
  ["commit", "commits", "rollback"],
  ["database", "postgresql", "write", "writes"],
  ["claim", "expiry", "heartbeat", "lease", "ownership"],
  ["background", "job", "processing", "worker"],
  ["citation", "fabricated", "invented", "verify", "verifier"],
  ["evidence", "grounded", "reference", "references", "source"],
  ["answer", "returning", "reaching"],
  ["correlation", "latency", "log", "logging", "metadata", "request", "status"],
  ["authorization", "permission", "principal", "protected", "security"],
  ["attempt", "backoff", "failure", "retry", "retried"],
  ["metric", "metrics", "observability", "queue", "throughput"],
];

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function asEvidence(document: FixtureDocument, score: number): Evidence {
  return { ...document, score };
}

function scoreText(document: FixtureDocument, query: string): number {
  const queryTokens = tokenizeQuestion(query).filter((token) => !ignoredTextTokens.has(token));
  const contentTokens = new Set(normalizedTokens(`${document.path} ${document.content}`));
  const symbolTokens = new Set(normalizedTokens(document.symbol));
  return queryTokens.reduce((score, token) => {
    if (symbolTokens.has(token)) return score + 2;
    if (contentTokens.has(token)) return score + 1;
    return score;
  }, 0);
}

function scoreSymbol(document: FixtureDocument, query: string): number {
  const queryTokens = tokenizeQuestion(query).filter((token) => !ignoredTextTokens.has(token));
  const targetTokens = normalizedTokens(`${document.symbol} ${document.path}`);
  return queryTokens.reduce((score, token) => {
    if (targetTokens.includes(token)) return score + 2;
    if (targetTokens.some((target) => target.startsWith(token) || token.startsWith(target))) {
      return score + 1;
    }
    return score;
  }, 0);
}

function conceptVector(value: string): number[] {
  const tokens = normalizedTokens(value);
  return semanticConcepts.map((concept) =>
    tokens.reduce((count, token) => count + (concept.includes(token) ? 1 : 0), 0),
  );
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const [index, leftValue] of left.entries()) {
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function rankChannel(channel: RetrievalChannel, query: string): Evidence[] {
  const queryVector = conceptVector(query);
  return corpus
    .map((document) => {
      if (channel === "text") return asEvidence(document, scoreText(document, query));
      if (channel === "symbol") return asEvidence(document, scoreSymbol(document, query));
      return asEvidence(
        document,
        cosineSimilarity(
          queryVector,
          conceptVector(`${document.path} ${document.symbol} ${document.content}`),
        ),
      );
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.path.localeCompare(right.path) ||
        left.startLine - right.startLine ||
        left.id.localeCompare(right.id),
    );
}

function rankForExpected(
  results: readonly SearchHit[],
  expectedIds: readonly string[],
): number | null {
  const rank = results.findIndex((result) => expectedIds.includes(result.id));
  return rank === -1 ? null : rank + 1;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function summarizeMode(
  evaluations: readonly QueryEvaluation[],
  mode: EvaluatedMode,
): QualityMetrics {
  const ranks = evaluations.map((evaluation) => evaluation.ranks[mode]);
  const recallAt = (limit: number) =>
    ranks.filter((rank) => rank !== null && rank <= limit).length / ranks.length;
  const averageCandidates =
    evaluations.reduce((sum, evaluation) => {
      if (mode === "hybrid") {
        return (
          sum +
          evaluation.candidateCounts.text +
          evaluation.candidateCounts.symbol +
          evaluation.candidateCounts.semantic
        );
      }
      return sum + evaluation.candidateCounts[mode];
    }, 0) / evaluations.length;
  return {
    recallAt1: roundMetric(recallAt(1)),
    recallAt3: roundMetric(recallAt(3)),
    recallAt5: roundMetric(recallAt(5)),
    mrrAt10: roundMetric(
      ranks.reduce<number>((sum, rank) => sum + (rank !== null && rank <= 10 ? 1 / rank : 0), 0) /
        ranks.length,
    ),
    averageCandidates: roundMetric(averageCandidates),
  };
}

export function buildRetrievalQualityReport(): RetrievalQualityReport {
  const evaluations = qualityQueries.map((qualityQuery): QueryEvaluation => {
    const text = rankChannel("text", qualityQuery.query);
    const symbol = rankChannel("symbol", qualityQuery.query);
    const semantic = rankChannel("semantic", qualityQuery.query);
    const channelResults = { text, symbol, semantic };
    const ranks = Object.fromEntries(
      (["text", "symbol", "semantic"] as const).map((mode) => [
        mode,
        rankForExpected(
          fuseRetrievalChannels([{ channel: mode, candidates: channelResults[mode] }], 10),
          qualityQuery.expectedEvidenceIds,
        ),
      ]),
    ) as Record<RetrievalChannel, number | null>;
    const hybrid = fuseRetrievalChannels(
      [
        { channel: "text", candidates: text },
        { channel: "symbol", candidates: symbol },
        { channel: "semantic", candidates: semantic },
      ],
      10,
    );
    return {
      id: qualityQuery.id,
      query: qualityQuery.query,
      expectedEvidenceIds: qualityQuery.expectedEvidenceIds,
      candidateCounts: {
        text: text.length,
        symbol: symbol.length,
        semantic: semantic.length,
      },
      ranks: {
        ...ranks,
        hybrid: rankForExpected(hybrid, qualityQuery.expectedEvidenceIds),
      },
    };
  });
  const metrics = {
    text: summarizeMode(evaluations, "text"),
    symbol: summarizeMode(evaluations, "symbol"),
    semantic: summarizeMode(evaluations, "semantic"),
    hybrid: summarizeMode(evaluations, "hybrid"),
  };
  return {
    benchmark: "retrieval-quality-fixture",
    fixture: "synthetic-code-corpus-v1",
    semanticProvider: "deterministic-test-only-concept-v1",
    testOnly: true,
    note: "This deterministic fixture verifies ranking and metric plumbing; it is not a model-quality claim.",
    corpusDocuments: corpus.length,
    queries: qualityQueries.length,
    metrics,
    hybridVsText: {
      recallAt1Delta: roundMetric(metrics.hybrid.recallAt1 - metrics.text.recallAt1),
      recallAt3Delta: roundMetric(metrics.hybrid.recallAt3 - metrics.text.recallAt3),
      recallAt5Delta: roundMetric(metrics.hybrid.recallAt5 - metrics.text.recallAt5),
      mrrAt10Delta: roundMetric(metrics.hybrid.mrrAt10 - metrics.text.mrrAt10),
    },
    evaluations,
  };
}
