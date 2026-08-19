import type { ParsedFile, ScannedFile } from "@repovista/domain";
import { describe, expect, it } from "vitest";
import { linkParsedImports, resolveLocalImport } from "./index.js";

describe("resolveLocalImport", () => {
  it("resolves extensionless TypeScript imports", () => {
    expect(
      resolveLocalImport(
        "src/routes/login.ts",
        "../services/auth",
        new Set(["src/services/auth.ts"]),
      ),
    ).toBe("src/services/auth.ts");
  });

  it("maps JavaScript runtime specifiers back to TypeScript source", () => {
    expect(
      resolveLocalImport(
        "src/routes/login.ts",
        "../services/auth.js",
        new Set(["src/services/auth.ts"]),
      ),
    ).toBe("src/services/auth.ts");
  });
});

describe("linkParsedImports", () => {
  it("resolves local imports while preserving external imports as unresolved evidence", () => {
    const files = ["src/index.ts", "src/auth.ts"].map(
      (filePath) =>
        ({
          path: filePath,
          absolutePath: `/tmp/${filePath}`,
          language: "typescript",
          byteSize: 1,
          lineCount: 1,
          content: "x",
          contentHash: `sha256:${filePath}`,
          isGenerated: false,
        }) satisfies ScannedFile,
    );
    const parsed: ParsedFile[] = [
      {
        path: "src/index.ts",
        moduleStableKey: "module:src/index.ts",
        symbols: [],
        imports: [
          { source: "./auth.js", importedNames: ["login"], startLine: 1, endLine: 1 },
          { source: "fastify", importedNames: ["Fastify"], startLine: 2, endLine: 2 },
        ],
        edges: [
          {
            fromStableKey: "module:src/index.ts",
            unresolvedTarget: "./auth.js",
            type: "imports",
            confidence: 1,
            evidence: {
              path: "src/index.ts",
              startLine: 1,
              endLine: 1,
              syntaxType: "import_statement",
            },
          },
          {
            fromStableKey: "module:src/index.ts",
            unresolvedTarget: "fastify",
            type: "imports",
            confidence: 1,
            evidence: {
              path: "src/index.ts",
              startLine: 2,
              endLine: 2,
              syntaxType: "import_statement",
            },
          },
        ],
      },
      {
        path: "src/auth.ts",
        moduleStableKey: "module:src/auth.ts",
        symbols: [],
        imports: [],
        edges: [],
      },
    ];

    const linked = linkParsedImports(files, parsed)[0];

    expect(linked?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "imports",
          targetStableKey: "module:src/auth.ts",
        }),
        expect.objectContaining({ type: "imports", unresolvedTarget: "fastify" }),
      ]),
    );
    expect(linked?.edges).toHaveLength(2);
  });

  it("relinks a reused resolved import instead of preserving its stale target", () => {
    const files = ["src/index.ts", "src/auth/index.ts"].map(
      (filePath) =>
        ({
          path: filePath,
          absolutePath: `/tmp/${filePath}`,
          language: "typescript",
          byteSize: 1,
          lineCount: 1,
          content: "x",
          contentHash: `sha256:${filePath}`,
          isGenerated: false,
        }) satisfies ScannedFile,
    );
    const parsed: ParsedFile[] = [
      {
        path: "src/index.ts",
        moduleStableKey: "module:src/index.ts",
        symbols: [],
        imports: [{ source: "./auth", importedNames: ["login"], startLine: 1, endLine: 1 }],
        edges: [
          {
            fromStableKey: "module:src/index.ts",
            targetStableKey: "module:src/auth.ts",
            type: "imports",
            confidence: 1,
            evidence: {
              path: "src/index.ts",
              startLine: 1,
              endLine: 1,
              syntaxType: "import_statement",
              importSource: "./auth",
              importedNames: ["login"],
            },
          },
        ],
      },
      {
        path: "src/auth/index.ts",
        moduleStableKey: "module:src/auth/index.ts",
        symbols: [],
        imports: [],
        edges: [],
      },
    ];

    const linked = linkParsedImports(files, parsed)[0];

    expect(linked?.edges).toEqual([
      expect.objectContaining({
        targetStableKey: "module:src/auth/index.ts",
        evidence: expect.objectContaining({ importSource: "./auth" }),
      }),
    ]);
  });
});
