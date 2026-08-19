import type { Evidence } from "@repovista/contracts";
import type { RetrievalResult } from "@repovista/domain";

export interface RankedCandidate extends Evidence {
  source: RetrievalResult["source"];
  rank: number;
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
