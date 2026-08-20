import type { Evidence } from "@repovista/contracts";
import { describe, expect, it } from "vitest";
import { channelsForMode, fuseRetrievalChannels, tokenizeQuestion } from "./index.js";

function evidence(id: string, path: string, score: number): Evidence {
  return {
    id,
    snapshotId: "01900000-0000-7000-8000-000000000001",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    fileId: "01900000-0000-7000-8000-000000000002",
    path,
    symbolId: null,
    symbol: null,
    startLine: 1,
    endLine: 2,
    content: path,
    contentHash: `sha256:${id}`,
    score,
  };
}

describe("tokenizeQuestion", () => {
  it("deduplicates meaningful tokens", () => {
    expect(tokenizeQuestion("Where does login login begin?")).toEqual([
      "where",
      "does",
      "login",
      "begin",
    ]);
  });
});

describe("transparent retrieval fusion", () => {
  it("maps each requested mode to explicit channels", () => {
    expect(channelsForMode("text")).toEqual(["text"]);
    expect(channelsForMode("semantic")).toEqual(["semantic"]);
    expect(channelsForMode("hybrid")).toEqual(["text", "symbol", "semantic"]);
  });

  it("fuses ranks without mixing incomparable raw score scales", () => {
    const shared = evidence("shared", "src/shared.ts", 0.01);
    const results = fuseRetrievalChannels(
      [
        {
          channel: "text",
          candidates: [evidence("text", "src/text.ts", 100), shared],
        },
        {
          channel: "semantic",
          candidates: [{ ...shared, score: 0.9 }, evidence("semantic", "src/semantic.ts", 0.8)],
        },
      ],
      10,
    );
    expect(results[0]).toMatchObject({
      id: "shared",
      signals: [
        { channel: "text", rank: 2, rawScore: 0.01 },
        { channel: "semantic", rank: 1, rawScore: 0.9 },
      ],
    });
    expect(results[0]?.score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it("is independent of channel input order and has stable tie breakers", () => {
    const text = {
      channel: "text" as const,
      candidates: [evidence("b", "src/b.ts", 1), evidence("a", "src/a.ts", 1)],
    };
    const symbol = {
      channel: "symbol" as const,
      candidates: [evidence("c", "src/c.ts", 1)],
    };
    expect(fuseRetrievalChannels([text, symbol], 10)).toEqual(
      fuseRetrievalChannels([symbol, text], 10),
    );
    expect(fuseRetrievalChannels([text], 10).map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("deduplicates repeated candidates within one channel", () => {
    const duplicate = evidence("same", "src/same.ts", 1);
    const [result] = fuseRetrievalChannels(
      [{ channel: "text", candidates: [duplicate, { ...duplicate, score: 0.5 }] }],
      10,
    );
    expect(result?.signals).toEqual([{ channel: "text", rank: 1, rawScore: 1 }]);
  });
});
