import { createHash } from "node:crypto";
import path from "node:path";
import type { ParsedEdge, ParsedFile, ParsedSymbol, ScannedFile } from "@repovista/domain";
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

export const PARSER_VERSION = "tree-sitter-ts-v1";

const declarationKinds: Record<string, ParsedSymbol["kind"]> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  class_declaration: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  method_definition: "method",
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function moduleKey(filePath: string): string {
  return `module:${filePath}`;
}

function declarationName(node: Parser.SyntaxNode): string | null {
  const named = node.childForFieldName("name");
  if (named) return normalizeName(named.text);
  if (node.type === "method_definition") {
    const property = node.namedChildren.find((child) =>
      ["property_identifier", "private_property_identifier", "computed_property_name"].includes(
        child.type,
      ),
    );
    return property ? normalizeName(property.text) : null;
  }
  return null;
}

function signatureFor(node: Parser.SyntaxNode, name: string): string | null {
  const parameters = node.childForFieldName("parameters");
  if (parameters) return name + normalizeName(parameters.text);
  const typeParameters = node.childForFieldName("type_parameters");
  return typeParameters ? name + normalizeName(typeParameters.text) : name;
}

function symbolKey(
  filePath: string,
  kind: ParsedSymbol["kind"],
  qualifiedName: string,
  signature: string | null,
): string {
  return [kind, filePath, qualifiedName, digest(signature ?? qualifiedName).slice(0, 12)].join(":");
}

function sourceLines(content: string, startLine: number, endLine: number): string {
  return content
    .split(/\r?\n/)
    .slice(startLine - 1, endLine)
    .join("\n");
}

function importedNames(node: Parser.SyntaxNode): string[] {
  const clause = node.namedChildren.find((child) => child.type === "import_clause");
  if (!clause) return [];
  const names = clause.descendantsOfType(["identifier", "namespace_import", "named_imports"]);
  return [
    ...new Set(
      names.filter((item) => item.type === "identifier").map((item) => normalizeName(item.text)),
    ),
  ];
}

function importSource(node: Parser.SyntaxNode): string | null {
  const source = node.childForFieldName("source");
  if (!source) return null;
  return source.text.replace(/^['"]|['"]$/g, "");
}

function callTarget(node: Parser.SyntaxNode): string | null {
  const callable = node.childForFieldName("function");
  if (!callable) return null;
  const text = normalizeName(callable.text);
  return text.length <= 300 ? text : null;
}

export function parseSourceFile(file: ScannedFile): ParsedFile {
  const parser = new Parser();
  const useTsx = [".tsx", ".jsx"].includes(path.extname(file.path).toLowerCase());
  parser.setLanguage(useTsx ? TypeScript.tsx : TypeScript.typescript);
  const tree = parser.parse(file.content);
  const root = tree.rootNode;
  const rootStableKey = moduleKey(file.path);
  const moduleSymbol: ParsedSymbol = {
    stableKey: rootStableKey,
    kind: "module",
    name: path.posix.basename(file.path),
    qualifiedName: file.path,
    signature: null,
    startLine: 1,
    startColumn: 0,
    endLine: Math.max(1, file.lineCount),
    endColumn: 0,
    docText: null,
    contentHash: file.contentHash,
  };
  const symbols: ParsedSymbol[] = [moduleSymbol];
  const edges: ParsedEdge[] = [];
  const imports: ParsedFile["imports"] = [];

  function visit(
    node: Parser.SyntaxNode,
    parentQualifiedName: string | null,
    currentSymbolKey: string,
  ): void {
    let nextQualifiedName = parentQualifiedName;
    let nextSymbolKey = currentSymbolKey;
    const kind = declarationKinds[node.type];
    if (kind) {
      const name = declarationName(node);
      if (name) {
        const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
        const signature = signatureFor(node, name);
        const stableKey = symbolKey(file.path, kind, qualifiedName, signature);
        const startLine = node.startPosition.row + 1;
        const endLine = Math.max(startLine, node.endPosition.row + 1);
        symbols.push({
          stableKey,
          kind,
          name,
          qualifiedName,
          signature,
          startLine,
          startColumn: node.startPosition.column,
          endLine,
          endColumn: node.endPosition.column,
          docText: null,
          contentHash: `sha256:${digest(sourceLines(file.content, startLine, endLine))}`,
        });
        edges.push({
          fromStableKey: currentSymbolKey,
          targetStableKey: stableKey,
          type: "contains",
          confidence: 1,
          evidence: {
            path: file.path,
            startLine,
            endLine,
            syntaxType: node.type,
          },
        });
        nextQualifiedName = qualifiedName;
        nextSymbolKey = stableKey;
      }
    }

    if (node.type === "import_statement") {
      const source = importSource(node);
      if (source) {
        imports.push({
          source,
          importedNames: importedNames(node),
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
        edges.push({
          fromStableKey: rootStableKey,
          unresolvedTarget: source,
          type: "imports",
          confidence: 1,
          evidence: {
            path: file.path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            syntaxType: node.type,
          },
        });
      }
    }

    if (node.type === "call_expression") {
      const target = callTarget(node);
      if (target) {
        edges.push({
          fromStableKey: nextSymbolKey,
          unresolvedTarget: target,
          type: "calls",
          confidence: 0.7,
          evidence: {
            path: file.path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            syntaxType: node.type,
          },
        });
      }
    }

    for (const child of node.namedChildren) {
      visit(child, nextQualifiedName, nextSymbolKey);
    }
  }

  for (const child of root.namedChildren) {
    visit(child, null, rootStableKey);
  }

  return {
    path: file.path,
    moduleStableKey: rootStableKey,
    symbols,
    edges,
    imports,
  };
}

export function parseRepository(files: readonly ScannedFile[]): ParsedFile[] {
  return files
    .filter((file) => file.language === "typescript" || file.language === "javascript")
    .map(parseSourceFile);
}
