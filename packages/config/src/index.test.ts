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

  it("keeps semantic retrieval disabled unless an embedding provider is explicit", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      EMBEDDING_PROVIDER: "none",
      EMBEDDING_BATCH_SIZE: 16,
      EMBEDDING_INPUT_MAX_CHARS: 12_000,
      EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
    });
    expect(config.EMBEDDING_MODEL).toBeUndefined();
  });

  it("normalizes empty optional model and endpoint values", () => {
    expect(
      loadConfig({
        CHAT_MODEL: "",
        EMBEDDING_MODEL: "  ",
        OPENAI_COMPATIBLE_BASE_URL: "",
      }),
    ).toMatchObject({
      CHAT_MODEL: undefined,
      EMBEDDING_MODEL: undefined,
      OPENAI_COMPATIBLE_BASE_URL: undefined,
    });
  });

  it("validates bounded embedding batch configuration", () => {
    expect(() => loadConfig({ EMBEDDING_BATCH_SIZE: "65" })).toThrow();
    expect(() => loadConfig({ EMBEDDING_INPUT_MAX_CHARS: "255" })).toThrow();
    expect(() => loadConfig({ EMBEDDING_REQUEST_TIMEOUT_MS: "999" })).toThrow();
  });
});
