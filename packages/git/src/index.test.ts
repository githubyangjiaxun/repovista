import { describe, expect, it } from "vitest";
import { languageForPath, parseGitHubUrl } from "./index.js";

describe("parseGitHubUrl", () => {
  it("canonicalizes a GitHub repository URL", () => {
    expect(parseGitHubUrl("https://github.com/acme/demo.git")).toEqual({
      owner: "acme",
      name: "demo",
      canonicalUrl: "https://github.com/acme/demo",
      cloneUrl: "https://github.com/acme/demo.git",
    });
  });

  it("rejects credentials and non-GitHub hosts", () => {
    expect(() => parseGitHubUrl("https://user:pass@github.com/acme/demo")).toThrow();
    expect(() => parseGitHubUrl("https://example.com/acme/demo")).toThrow();
  });
});

describe("languageForPath", () => {
  it("recognizes TypeScript variants", () => {
    expect(languageForPath("src/index.ts")).toBe("typescript");
    expect(languageForPath("src/view.tsx")).toBe("typescript");
  });
});
