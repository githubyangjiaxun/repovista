import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePythonSourceFile, parseRepository, parseSourceFile } from "./index.js";

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

function pythonFixture(content: string) {
  return {
    path: "app/service.py",
    absolutePath: "/tmp/app/service.py",
    language: "python",
    byteSize: Buffer.byteLength(content),
    lineCount: content.split(/\r?\n/).length,
    content,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    isGenerated: false,
  } as const;
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
    expect(parsed.edges.find((edge) => edge.type === "imports")?.evidence).toMatchObject({
      importSource: "./users",
      importedNames: ["findUser"],
    });
    expect(parsed.edges.find((edge) => edge.type === "calls")?.evidence).toMatchObject({
      referenceTarget: "findUser",
    });
  });

  it("assigns unique stable keys to repeated declarations in anonymous scopes", () => {
    const parsed = parseSourceFile(
      fixture(
        [
          'it("first", () => {',
          "  interface SharedConfig { value: string }",
          "});",
          'it("second", () => {',
          "  interface SharedConfig { value: number }",
          "});",
          'it("third", () => {',
          "  interface SharedConfig { value: number }",
          "});",
        ].join("\n"),
      ),
    );

    const repeated = parsed.symbols.filter((symbol) => symbol.name === "SharedConfig");
    expect(repeated).toHaveLength(3);
    expect(new Set(repeated.map((symbol) => symbol.stableKey))).toHaveLength(3);
    expect(
      parsed.edges.filter(
        (edge) =>
          edge.type === "contains" &&
          repeated.some((item) => item.stableKey === edge.targetStableKey),
      ),
    ).toHaveLength(3);
  });

  it("extracts Python modules, declarations, imports, inheritance, calls, and variables", () => {
    const parsed = parsePythonSourceFile(
      pythonFixture(
        [
          "from .models import User as Account",
          "from app.common import helper",
          "VALUE = 3",
          "",
          "class Service(Base):",
          "    def handle(self, user):",
          "        return helper(user)",
          "",
          "def run(value):",
          "    return Service().handle(value)",
        ].join("\n"),
      ),
    );

    expect(parsed.symbols.map((symbol) => symbol.kind)).toEqual([
      "module",
      "variable",
      "class",
      "method",
      "function",
    ]);
    expect(parsed.imports).toEqual([
      expect.objectContaining({ source: ".models", importedNames: ["User"] }),
      expect.objectContaining({ source: "app.common", importedNames: ["helper"] }),
    ]);
    expect(parsed.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "extends", unresolvedTarget: "Base" }),
        expect.objectContaining({ type: "calls", unresolvedTarget: "helper" }),
        expect.objectContaining({ type: "calls", unresolvedTarget: "Service" }),
      ]),
    );
    expect(parsed.symbols.find((symbol) => symbol.name === "handle")).toMatchObject({
      kind: "method",
      startLine: 6,
      endLine: 7,
    });
  });

  it("dispatches Python and TypeScript through the repository adapter", () => {
    const parsed = parseRepository([
      fixture("export const value = 1;"),
      pythonFixture("def run():\n    return 1"),
    ]);

    expect(parsed.map((file) => file.path)).toEqual(["src/auth.ts", "app/service.py"]);
    expect(parsed.find((file) => file.path.endsWith(".py"))?.symbols[0]?.kind).toBe("module");
  });
});
