import type {
  Evidence,
  RetrievalChannel,
  RetrievalMode,
  RetrievalSignal,
  SearchHit,
} from "@repovista/contracts";
import type { RetrievalResult } from "@repovista/domain";

export interface RankedCandidate extends Evidence {
  source: RetrievalResult["source"];
  rank: number;
}

export interface ChannelResult {
  channel: RetrievalChannel;
  candidates: readonly Evidence[];
}

const channelOrder: readonly RetrievalChannel[] = ["text", "symbol", "semantic"];

export function channelsForMode(mode: RetrievalMode): RetrievalChannel[] {
  if (mode === "hybrid") return [...channelOrder];
  return [mode];
}

export function fuseRetrievalChannels(
  results: readonly ChannelResult[],
  limit = 20,
  rankConstant = 60,
): SearchHit[] {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];
  if (!Number.isFinite(rankConstant) || rankConstant < 0) {
    throw new TypeError("rankConstant must be a non-negative finite number.");
  }

  const byChannel = new Map(results.map((result) => [result.channel, result.candidates]));
  const fused = new Map<
    string,
    { candidate: Evidence; fusionScore: number; signals: RetrievalSignal[] }
  >();

  for (const channel of channelOrder) {
    const candidates = byChannel.get(channel) ?? [];
    const seen = new Set<string>();
    for (const [index, candidate] of candidates.entries()) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const rank = index + 1;
      const current = fused.get(candidate.id);
      const signal = { channel, rank, rawScore: candidate.score };
      fused.set(candidate.id, {
        candidate: current?.candidate ?? candidate,
        fusionScore: (current?.fusionScore ?? 0) + 1 / (rankConstant + rank),
        signals: [...(current?.signals ?? []), signal],
      });
    }
  }

  return [...fused.values()]
    .sort((left, right) => {
      const scoreDifference = right.fusionScore - left.fusionScore;
      if (scoreDifference !== 0) return scoreDifference;
      const leftBestRank = Math.min(...left.signals.map((signal) => signal.rank));
      const rightBestRank = Math.min(...right.signals.map((signal) => signal.rank));
      if (leftBestRank !== rightBestRank) return leftBestRank - rightBestRank;
      const pathDifference = left.candidate.path.localeCompare(right.candidate.path);
      if (pathDifference !== 0) return pathDifference;
      if (left.candidate.startLine !== right.candidate.startLine) {
        return left.candidate.startLine - right.candidate.startLine;
      }
      return left.candidate.id.localeCompare(right.candidate.id);
    })
    .slice(0, boundedLimit)
    .map(({ candidate, fusionScore, signals }) => ({
      ...candidate,
      score: fusionScore,
      signals,
    }));
}

export function reciprocalRankFusion(
  resultSets: readonly (readonly RankedCandidate[])[],
  limit = 20,
  rankConstant = 60,
): RetrievalResult[] {
  const scores = new Map<string, { candidate: RankedCandidate; score: number }>();
  for (const resultSet of resultSets) {
    for (const [index, candidate] of resultSet.entries()) {
      const current = scores.get(candidate.id);
      const contribution = 1 / (rankConstant + index + 1);
      scores.set(candidate.id, {
        candidate,
        score: (current?.score ?? 0) + contribution,
      });
    }
  }
  return [...scores.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ candidate, score }) => ({
      ...candidate,
      score,
      source: candidate.source,
    }));
}

export function tokenizeQuestion(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}_.$/-]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 30),
    ),
  ];
}
