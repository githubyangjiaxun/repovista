import type { ParsedFile, ScannedFile } from "@repovista/domain";
import { describe, expect, it } from "vitest";
import { goModulePath, linkParsedImports, resolveLocalImport } from "./index.js";

describe("resolveLocalImport", () => {
  it("resolves Go module imports to repository-local packages", () => {
    const known = new Set(["internal/service/service.go", "internal/store/store.go"]);
    expect(
      resolveLocalImport(
        "internal/service/service.go",
        "example.com/acme/app/internal/store",
        known,
        "example.com/acme/app",
      ),
    ).toBe("internal/store/store.go");
  });

  it("reads a Go module declaration deterministically", () => {
    expect(
      goModulePath([
        {
          path: "go.mod",
          absolutePath: "/tmp/go.mod",
          language: "go-mod",
          byteSize: 30,
          lineCount: 2,
          content: "module example.com/acme/app\n\ngo 1.22\n",
          contentHash: "sha256:go-mod",
          isGenerated: false,
        },
      ]),
    ).toBe("example.com/acme/app");
  });

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

  it("resolves Python relative and absolute modules", () => {
    expect(resolveLocalImport("app/service.py", ".models", new Set(["app/models.py"]))).toBe(
      "app/models.py",
    );
    expect(
      resolveLocalImport("app/service.py", "app.common", new Set(["app/common/__init__.py"])),
    ).toBe("app/common/__init__.py");
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

  it("links Python imports while leaving third-party modules unresolved", () => {
    const files = ["app/service.py", "app/models.py"].map(
      (filePath) =>
        ({
          path: filePath,
          absolutePath: `/tmp/${filePath}`,
          language: "python",
          byteSize: 1,
          lineCount: 1,
          content: "x",
          contentHash: `sha256:${filePath}`,
          isGenerated: false,
        }) satisfies ScannedFile,
    );
    const parsed: ParsedFile[] = [
      {
        path: "app/service.py",
        moduleStableKey: "module:app/service.py",
        symbols: [],
        imports: [
          { source: ".models", importedNames: ["User"], startLine: 1, endLine: 1 },
          { source: "requests", importedNames: ["requests"], startLine: 2, endLine: 2 },
        ],
        edges: [
          {
            fromStableKey: "module:app/service.py",
            unresolvedTarget: ".models",
            type: "imports",
            confidence: 1,
            evidence: {
              path: "app/service.py",
              startLine: 1,
              endLine: 1,
              syntaxType: "import_from_statement",
              importSource: ".models",
            },
          },
          {
            fromStableKey: "module:app/service.py",
            unresolvedTarget: "requests",
            type: "imports",
            confidence: 1,
            evidence: {
              path: "app/service.py",
              startLine: 2,
              endLine: 2,
              syntaxType: "import_statement",
              importSource: "requests",
            },
          },
        ],
      },
      {
        path: "app/models.py",
        moduleStableKey: "module:app/models.py",
        symbols: [],
        imports: [],
        edges: [],
      },
    ];
    const linked = linkParsedImports(files, parsed)[0];
    expect(linked?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetStableKey: "module:app/models.py", type: "imports" }),
        expect.objectContaining({ unresolvedTarget: "requests", type: "imports" }),
      ]),
    );
  });
});
