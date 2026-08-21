import { generateKeyPairSync, verify } from "node:crypto";
import { loadConfig } from "@repovista/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppJwt, GitHubAppClient } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

describe("GitHub App client", () => {
  it("creates a short-lived RS256 app JWT", () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const config = loadConfig({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey });
    const token = createGitHubAppJwt(config, new Date("2026-01-01T00:00:00Z"));
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(payload ?? "", "base64url").toString())).toMatchObject({
      iss: "123",
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        pair.publicKey,
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("coalesces concurrent installation-token requests and caches the result", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const config = loadConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_API_ORIGIN: "https://api.github.test",
    });
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "ghs_test_installation_token",
            expires_at: "2099-01-01T00:00:00Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new GitHubAppClient(config);
    const [left, right] = await Promise.all([
      client.installationToken(456),
      client.installationToken(456),
    ]);
    expect(left).toBe(right);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.installationToken(456);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
