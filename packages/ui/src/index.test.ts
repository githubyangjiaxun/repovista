import { describe, expect, it } from "vitest";
import { uiPackageName } from "./index.js";

describe("ui package", () => {
  it("exports its package identity", () => {
    expect(uiPackageName).toBe("@repovista/ui");
  });
});
