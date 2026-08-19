import { describe, expect, it } from "vitest";
import { FakeModelProvider, verifyModelAnswer } from "./index.js";

const evidence = {
  id: "ev-1",
  snapshotId: "00000000-0000-7000-8000-000000000010",
  commitSha: "abcdef1",
  fileId: "00000000-0000-7000-8000-000000000011",
  path: "src/auth.ts",
  symbolId: null,
  symbol: "login",
  startLine: 1,
  endLine: 3,
  content: "function login() {}",
  contentHash: "sha256:test",
  score: 1,
};

describe("verified answers", () => {
  it("keeps only real evidence IDs", async () => {
    const provider = new FakeModelProvider();
    const draft = await provider.generate({ question: "Where is login?", evidence: [evidence] });
    const answer = verifyModelAnswer(draft, [evidence], provider.id, provider.defaultModel);
    expect(answer.status).toBe("grounded");
    expect(answer.citations).toHaveLength(1);
  });
});
