import { describe, expect, it } from "vitest";
import { tokenizeQuestion } from "./index.js";

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
