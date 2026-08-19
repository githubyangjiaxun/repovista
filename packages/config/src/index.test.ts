import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("treats an empty GitHub webhook secret as disabled", () => {
    expect(loadConfig({ GITHUB_WEBHOOK_SECRET: "" }).GITHUB_WEBHOOK_SECRET).toBeUndefined();
  });

  it("preserves a configured GitHub webhook secret", () => {
    expect(
      loadConfig({ GITHUB_WEBHOOK_SECRET: "signed-update-secret" }).GITHUB_WEBHOOK_SECRET,
    ).toBe("signed-update-secret");
  });
});
