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

  it("treats an empty optional GitHub App ID as disabled", () => {
    expect(loadConfig({ GITHUB_APP_ID: "" }).GITHUB_APP_ID).toBeUndefined();
    expect(loadConfig({ GITHUB_APP_ID: "42" }).GITHUB_APP_ID).toBe(42);
  });

  it("keeps semantic retrieval disabled unless an embedding provider is explicit", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      DEMO_SEED_ENABLED: false,
      EMBEDDING_PROVIDER: "none",
      EMBEDDING_BATCH_SIZE: 16,
      EMBEDDING_INPUT_MAX_CHARS: 12_000,
      EMBEDDING_REQUEST_TIMEOUT_MS: 60_000,
    });
    expect(config.EMBEDDING_MODEL).toBeUndefined();
  });

  it("requires an explicit opt-in for bundled demo seeding", () => {
    expect(loadConfig({ DEMO_SEED_ENABLED: "true" }).DEMO_SEED_ENABLED).toBe(true);
    expect(() => loadConfig({ DEMO_SEED_ENABLED: "yes" })).toThrow();
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

  it("rejects insecure production authentication origins", () => {
    expect(() => loadConfig({ APP_ENV: "production" })).toThrow(
      /require HTTPS WEB_ORIGIN\/API_ORIGIN/,
    );
    expect(() =>
      loadConfig({
        APP_ENV: "production",
        WEB_ORIGIN: "https://web.example",
        API_ORIGIN: "https://api.example",
        AUTH_COOKIE_SECURE: "true",
      }),
    ).not.toThrow();
  });
});
