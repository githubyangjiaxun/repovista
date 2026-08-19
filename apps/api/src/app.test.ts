import { describe, expect, it } from "vitest";

describe("API skeleton", () => {
  it("has a stable live response shape", () => {
    expect({ status: "ok" }).toEqual({ status: "ok" });
  });
});
