import { describe, expect, it } from "vitest";
import {
  anonymousPrincipal,
  createApiToken,
  hashSecret,
  parseCookieHeader,
  safeReturnTo,
  serializeCookie,
} from "./index.js";

describe("auth primitives", () => {
  it("creates non-repeatable API tokens and hashes only their digest", () => {
    const token = createApiToken();
    expect(token).toMatch(/^rv_[A-Za-z0-9_-]{43}$/);
    expect(hashSecret(token)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashSecret(token)).not.toContain(token);
  });

  it("parses and serializes safe cookies", () => {
    const cookie = serializeCookie("repovista_session", "a".repeat(32), {
      httpOnly: true,
      secure: true,
    });
    expect(parseCookieHeader(cookie).get("repovista_session")).toBe("a".repeat(32));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("rejects open redirects", () => {
    expect(safeReturnTo("/repositories?tab=search")).toBe("/repositories?tab=search");
    expect(safeReturnTo("//evil.example/path")).toBe("/repositories");
    expect(safeReturnTo("https://evil.example/path")).toBe("/repositories");
  });

  it("uses the public workspace for anonymous mode", () => {
    expect(anonymousPrincipal()).toMatchObject({ kind: "anonymous", role: "viewer" });
  });
});
