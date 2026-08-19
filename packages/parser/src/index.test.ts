import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSourceFile } from "./index.js";

function fixture(content: string) {
  return {
    path: "src/auth.ts",
    absolutePath: "/tmp/src/auth.ts",
    language: "typescript",
    byteSize: Buffer.byteLength(content),
    lineCount: content.split(/\r?\n/).length,
    content,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    isGenerated: false,
  };
}

describe("parseSourceFile", () => {
  it("extracts declarations, imports, and calls", () => {
    const parsed = parseSourceFile(
      fixture(
        [
          "import { findUser } from './users';",
          "export class AuthService {",
          "  login(email: string) {",
          "    return findUser(email);",
          "  }",
          "}",
        ].join("\n"),
      ),
    );

    expect(parsed.symbols.some((symbol) => symbol.kind === "class")).toBe(true);
    expect(parsed.symbols.some((symbol) => symbol.kind === "method")).toBe(true);
    expect(parsed.edges.some((edge) => edge.type === "imports")).toBe(true);
    expect(parsed.edges.some((edge) => edge.type === "calls")).toBe(true);
  });
});
