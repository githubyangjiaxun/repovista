import { createHash } from "node:crypto";
import path from "node:path";
import { PARSER_VERSION } from "@repovista/contracts";
import type { ParsedEdge, ParsedFile, ParsedSymbol, ScannedFile } from "@repovista/domain";
import Parser from "tree-sitter";
import Go from "tree-sitter-go";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";

export { PARSER_VERSION };

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

function reserveSymbolKey(baseKey: string, sourceHash: string, reservedKeys: Set<string>): string {
  if (!reservedKeys.has(baseKey)) {
    reservedKeys.add(baseKey);
    return baseKey;
  }

  const collisionKey = `${baseKey}:${sourceHash.slice(0, 12)}`;
  let candidate = collisionKey;
  let occurrence = 2;
  while (reservedKeys.has(candidate)) {
    candidate = `${collisionKey}:${occurrence}`;
    occurrence += 1;
  }
  reservedKeys.add(candidate);
  return candidate;
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

function pythonImportItems(node: Parser.SyntaxNode): {
  source: string;
  importedNames: string[];
}[] {
  const text = node.text.trim();
  if (text.startsWith("import ")) {
    return text
      .slice("import ".length)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({
        source: item.split(/\s+as\s+/i)[0]?.trim() ?? item,
        importedNames: [item.split(/\s+as\s+/i)[0]?.trim() ?? item],
      }));
  }
  const match = text.match(/^from\s+(.+?)\s+import\s+(.+)$/s);
  if (!match) return [];
  const source = match[1]?.trim();
  if (!source) return [];
  const importedNames = (match[2] ?? "")
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(/\s+as\s+/i)[0]?.trim() ?? item);
  return [{ source, importedNames }];
}

function pythonDeclarationName(node: Parser.SyntaxNode): string | null {
  return node.childForFieldName("name")?.text.trim() || null;
}

function pythonSignature(node: Parser.SyntaxNode, name: string): string {
  const parameters = node.childForFieldName("parameters")?.text.trim() ?? "()";
  const returnType = node.childForFieldName("return_type")?.text.trim();
  return `${name}${parameters}${returnType ? ` -> ${returnType}` : ""}`;
}

function pythonAssignmentName(node: Parser.SyntaxNode): string | null {
  const assignment =
    node.type === "assignment" ? node : node.childForFieldName("right") ? node : null;
  const left = assignment?.childForFieldName("left");
  return left?.type === "identifier" ? left.text.trim() : null;
}

export function parsePythonSourceFile(file: ScannedFile): ParsedFile {
  const parser = new Parser();
  parser.setLanguage(Python);
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
  const reservedSymbolKeys = new Set([rootStableKey]);
  const edges: ParsedEdge[] = [];
  const imports: ParsedFile["imports"] = [];

  function addImport(node: Parser.SyntaxNode): void {
    for (const item of pythonImportItems(node)) {
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      imports.push({ source: item.source, importedNames: item.importedNames, startLine, endLine });
      edges.push({
        fromStableKey: rootStableKey,
        unresolvedTarget: item.source,
        type: "imports",
        confidence: 1,
        evidence: {
          path: file.path,
          startLine,
          endLine,
          syntaxType: node.type,
          importSource: item.source,
          importedNames: item.importedNames,
        },
      });
    }
  }

  function visit(
    node: Parser.SyntaxNode,
    parentQualifiedName: string | null,
    currentSymbolKey: string,
    currentKind: ParsedSymbol["kind"],
    rangeNode: Parser.SyntaxNode = node,
  ): void {
    if (node.type === "decorated_definition") {
      const definition = node.childForFieldName("definition");
      if (definition) visit(definition, parentQualifiedName, currentSymbolKey, currentKind, node);
      return;
    }

    if (node.type === "import_statement" || node.type === "import_from_statement") {
      addImport(node);
    }

    let nextQualifiedName = parentQualifiedName;
    let nextSymbolKey = currentSymbolKey;
    let nextKind = currentKind;
    if (node.type === "class_definition" || node.type === "function_definition") {
      const name = pythonDeclarationName(node);
      if (name) {
        const kind: ParsedSymbol["kind"] =
          node.type === "class_definition"
            ? "class"
            : currentKind === "class"
              ? "method"
              : "function";
        const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
        const signature = node.type === "function_definition" ? pythonSignature(node, name) : name;
        const startLine = rangeNode.startPosition.row + 1;
        const endLine = Math.max(startLine, node.endPosition.row + 1);
        const declarationHash = digest(sourceLines(file.content, startLine, endLine));
        const stableKey = reserveSymbolKey(
          symbolKey(file.path, kind, qualifiedName, signature),
          declarationHash,
          reservedSymbolKeys,
        );
        symbols.push({
          stableKey,
          kind,
          name,
          qualifiedName,
          signature,
          startLine,
          startColumn: rangeNode.startPosition.column,
          endLine,
          endColumn: node.endPosition.column,
          docText: null,
          contentHash: `sha256:${declarationHash}`,
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
        if (node.type === "class_definition") {
          const superclassText = node.childForFieldName("superclasses")?.text ?? "";
          for (const target of superclassText
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)) {
            edges.push({
              fromStableKey: stableKey,
              unresolvedTarget: target,
              type: "extends",
              confidence: 0.9,
              evidence: {
                path: file.path,
                startLine,
                endLine,
                syntaxType: "class_definition",
                referenceTarget: target,
              },
            });
          }
        }
        nextQualifiedName = qualifiedName;
        nextSymbolKey = stableKey;
        nextKind = kind;
      }
    } else if (
      currentSymbolKey === rootStableKey &&
      node.type === "expression_statement" &&
      node.namedChildren.length === 1
    ) {
      const assignment = node.namedChildren[0];
      const name = assignment ? pythonAssignmentName(assignment) : null;
      if (name) {
        const startLine = node.startPosition.row + 1;
        const endLine = Math.max(startLine, node.endPosition.row + 1);
        const declarationHash = digest(sourceLines(file.content, startLine, endLine));
        const qualifiedName = name;
        const stableKey = reserveSymbolKey(
          symbolKey(file.path, "variable", qualifiedName, name),
          declarationHash,
          reservedSymbolKeys,
        );
        symbols.push({
          stableKey,
          kind: "variable",
          name,
          qualifiedName,
          signature: name,
          startLine,
          startColumn: node.startPosition.column,
          endLine,
          endColumn: node.endPosition.column,
          docText: null,
          contentHash: `sha256:${declarationHash}`,
        });
        edges.push({
          fromStableKey: rootStableKey,
          targetStableKey: stableKey,
          type: "contains",
          confidence: 1,
          evidence: {
            path: file.path,
            startLine,
            endLine,
            syntaxType: assignment?.type ?? "assignment",
          },
        });
      }
    }

    if (node.type === "call") {
      const target = node.childForFieldName("function")?.text.trim();
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
            referenceTarget: target,
          },
        });
      }
    }

    for (const child of node.namedChildren) {
      visit(child, nextQualifiedName, nextSymbolKey, nextKind);
    }
  }

  for (const child of root.namedChildren) {
    visit(child, null, rootStableKey, "module");
  }

  return { path: file.path, moduleStableKey: rootStableKey, symbols, edges, imports };
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
  const reservedSymbolKeys = new Set([rootStableKey]);
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
        const startLine = node.startPosition.row + 1;
        const endLine = Math.max(startLine, node.endPosition.row + 1);
        const declarationHash = digest(sourceLines(file.content, startLine, endLine));
        const stableKey = reserveSymbolKey(
          symbolKey(file.path, kind, qualifiedName, signature),
          declarationHash,
          reservedSymbolKeys,
        );
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
          contentHash: `sha256:${declarationHash}`,
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
            importSource: source,
            importedNames: importedNames(node),
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
            referenceTarget: target,
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

function goReceiverType(node: Parser.SyntaxNode): string | null {
  const receiver = node.namedChildren.find((child) => child.type === "parameter_list");
  const text = receiver?.text ?? "";
  const match = text.match(/(?:^|\s)[*]?([A-Za-z_][A-Za-z0-9_]*)\s*\)?$/);
  return match?.[1] ?? null;
}

function goCallTarget(node: Parser.SyntaxNode): string | null {
  const callable = node.childForFieldName("function") ?? node.namedChildren[0];
  if (!callable || callable.type === "argument_list") return null;
  const text = normalizeName(callable.text);
  return text.length > 0 && text.length <= 300 ? text : null;
}

function goImportItems(node: Parser.SyntaxNode): {
  source: string;
  importedNames: string[];
}[] {
  const specs = node.descendantsOfType("import_spec");
  if (specs.length === 0 && node.type === "import_declaration") {
    const match = node.text.match(/(?:[A-Za-z_][A-Za-z0-9_]*\s+)?["`]([^"`]+)["`]/);
    return match?.[1] ? [{ source: match[1], importedNames: [] }] : [];
  }
  return specs.flatMap((spec) => {
    const match = spec.text.match(
      /^(?:(?<alias>[A-Za-z_][A-Za-z0-9_]*|\.)\s+)?["`]?(?<source>[^"`\s]+)["`]?$/,
    );
    if (!match?.groups?.source) return [];
    const alias = match.groups.alias;
    return [
      {
        source: match.groups.source,
        importedNames: alias ? [alias] : [],
      },
    ];
  });
}

function goVariableNames(node: Parser.SyntaxNode): string[] {
  const spec = node.type === "var_spec" || node.type === "const_spec" ? node : null;
  if (!spec) return [];
  return spec.namedChildren
    .filter((child) => child.type === "identifier")
    .map((child) => normalizeName(child.text));
}

function goTypeSpec(node: Parser.SyntaxNode): {
  name: string;
  kind: ParsedSymbol["kind"];
  signature: string;
  embedded: string[];
  interfaceMethods: string[];
} | null {
  const nameNode = node.namedChildren.find(
    (child) => child.type === "type_identifier" || child.type === "identifier",
  );
  if (!nameNode) return null;
  const typeNode = node.namedChildren.find((child) => child !== nameNode);
  if (!typeNode) return null;
  if (typeNode.type === "struct_type") {
    const embedded = (typeNode.descendantsOfType("field_declaration") ?? [])
      .filter((field) => !field.namedChildren.some((child) => child.type === "field_identifier"))
      .map((field) => normalizeName(field.text).replace(/^\*/, ""))
      .filter(Boolean);
    return {
      name: normalizeName(nameNode.text),
      kind: "class",
      signature: normalizeName(node.text),
      embedded,
      interfaceMethods: [],
    };
  }
  if (typeNode.type === "interface_type") {
    const interfaceMethods = typeNode.descendantsOfType("method_elem").flatMap((method) => {
      const field = method.namedChildren.find((child) => child.type === "field_identifier");
      return field ? [normalizeName(field.text)] : [];
    });
    return {
      name: normalizeName(nameNode.text),
      kind: "interface",
      signature: normalizeName(node.text),
      embedded: [],
      interfaceMethods,
    };
  }
  return {
    name: normalizeName(nameNode.text),
    kind: "type",
    signature: normalizeName(node.text),
    embedded: [],
    interfaceMethods: [],
  };
}

/** Parse a Go source file into the same evidence graph contract as TS/JS/Python. */
export function parseGoSourceFile(file: ScannedFile): ParsedFile {
  const parser = new Parser();
  parser.setLanguage(Go);
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
  const reserved = new Set([rootStableKey]);
  const symbolByName = new Map<string, ParsedSymbol>();
  const interfaceMethods = new Map<string, string[]>();
  const structMethods = new Map<string, string[]>();

  const addSymbol = (
    node: Parser.SyntaxNode,
    kind: ParsedSymbol["kind"],
    name: string,
    qualifiedName: string,
    signature: string | null,
    parentStableKey = rootStableKey,
  ): ParsedSymbol => {
    const startLine = node.startPosition.row + 1;
    const endLine = Math.max(startLine, node.endPosition.row + 1);
    const declarationHash = digest(sourceLines(file.content, startLine, endLine));
    const stableKey = reserveSymbolKey(
      symbolKey(file.path, kind, qualifiedName, signature),
      declarationHash,
      reserved,
    );
    const symbol: ParsedSymbol = {
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
      contentHash: `sha256:${declarationHash}`,
    };
    symbols.push(symbol);
    symbolByName.set(name, symbol);
    edges.push({
      fromStableKey: parentStableKey,
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
    return symbol;
  };

  for (const declaration of root.namedChildren) {
    if (declaration.type === "import_declaration") {
      for (const item of goImportItems(declaration)) {
        const startLine = declaration.startPosition.row + 1;
        const endLine = declaration.endPosition.row + 1;
        imports.push({
          source: item.source,
          importedNames: item.importedNames,
          startLine,
          endLine,
        });
        edges.push({
          fromStableKey: rootStableKey,
          unresolvedTarget: item.source,
          type: "imports",
          confidence: 1,
          evidence: {
            path: file.path,
            startLine,
            endLine,
            syntaxType: declaration.type,
            importSource: item.source,
            importedNames: item.importedNames,
          },
        });
      }
      continue;
    }
    if (declaration.type === "type_declaration") {
      for (const spec of declaration.namedChildren.filter(
        (child) => child.type === "type_spec" || child.type === "type_alias",
      )) {
        const type = goTypeSpec(spec);
        if (!type) continue;
        const symbol = addSymbol(spec, type.kind, type.name, type.name, type.signature);
        if (type.kind === "interface") interfaceMethods.set(type.name, type.interfaceMethods);
        for (const embedded of type.embedded) {
          edges.push({
            fromStableKey: symbol.stableKey,
            unresolvedTarget: embedded,
            type: "extends",
            confidence: 0.85,
            evidence: {
              path: file.path,
              startLine: spec.startPosition.row + 1,
              endLine: spec.endPosition.row + 1,
              syntaxType: "struct_type",
              referenceTarget: embedded,
            },
          });
        }
        if (type.kind === "interface") {
          for (const methodNode of spec.descendantsOfType("method_elem")) {
            const methodName = methodNode.namedChildren.find(
              (child) => child.type === "field_identifier",
            )?.text;
            if (!methodName) continue;
            addSymbol(
              methodNode,
              "method",
              methodName,
              `${type.name}.${methodName}`,
              normalizeName(methodNode.text),
              symbol.stableKey,
            );
          }
        }
      }
      continue;
    }
    if (declaration.type === "function_declaration") {
      const name = declaration.namedChildren.find((child) => child.type === "identifier")?.text;
      if (name) addSymbol(declaration, "function", name, name, normalizeName(declaration.text));
      continue;
    }
    if (declaration.type === "method_declaration") {
      const receiver = goReceiverType(declaration);
      const name = declaration.namedChildren.find(
        (child) => child.type === "field_identifier",
      )?.text;
      if (!name) continue;
      const qualifiedName = receiver ? `${receiver}.${name}` : name;
      const method = addSymbol(
        declaration,
        "method",
        name,
        qualifiedName,
        normalizeName(declaration.text),
        receiver ? (symbolByName.get(receiver)?.stableKey ?? rootStableKey) : rootStableKey,
      );
      if (receiver) structMethods.set(receiver, [...(structMethods.get(receiver) ?? []), name]);
      void method;
      continue;
    }
    if (declaration.type === "var_declaration" || declaration.type === "const_declaration") {
      for (const spec of declaration.descendantsOfType(["var_spec", "const_spec"])) {
        for (const name of goVariableNames(spec)) addSymbol(spec, "variable", name, name, name);
      }
    }
  }

  // A method declaration may appear before its receiver type in source order.
  for (const edge of edges) {
    if (edge.type !== "contains" || !edge.targetStableKey) continue;
    const method = symbols.find((symbol) => symbol.stableKey === edge.targetStableKey);
    const receiver = method?.qualifiedName?.split(".")[0];
    const receiverSymbol = receiver ? symbolByName.get(receiver) : undefined;
    if (method?.kind === "method" && receiverSymbol && edge.fromStableKey === rootStableKey) {
      edge.fromStableKey = receiverSymbol.stableKey;
    }
  }

  const visitCalls = (node: Parser.SyntaxNode, currentStableKey: string): void => {
    if (node.type === "call_expression") {
      const target = goCallTarget(node);
      if (target) {
        edges.push({
          fromStableKey: currentStableKey,
          unresolvedTarget: target,
          type: "calls",
          confidence: 0.7,
          evidence: {
            path: file.path,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            syntaxType: node.type,
            referenceTarget: target,
          },
        });
      }
    }
    for (const child of node.namedChildren) visitCalls(child, currentStableKey);
  };
  for (const declaration of root.namedChildren) {
    const name =
      declaration.type === "function_declaration"
        ? declaration.namedChildren.find((child) => child.type === "identifier")?.text
        : declaration.type === "method_declaration"
          ? declaration.namedChildren.find((child) => child.type === "field_identifier")?.text
          : undefined;
    if (!name) continue;
    const symbol = symbols.find(
      (candidate) =>
        candidate.name === name && candidate.startLine === declaration.startPosition.row + 1,
    );
    if (symbol) visitCalls(declaration, symbol.stableKey);
  }

  for (const [structName, methods] of structMethods) {
    const struct = symbolByName.get(structName);
    if (!struct) continue;
    for (const [interfaceName, required] of interfaceMethods) {
      if (required.length > 0 && required.every((method) => methods.includes(method))) {
        const target = symbolByName.get(interfaceName);
        if (!target) continue;
        edges.push({
          fromStableKey: struct.stableKey,
          targetStableKey: target.stableKey,
          type: "implements",
          confidence: 0.8,
          evidence: {
            path: file.path,
            startLine: struct.startLine,
            endLine: struct.endLine,
            syntaxType: "interface_implementation",
            referenceTarget: interfaceName,
          },
        });
      }
    }
  }

  return { path: file.path, moduleStableKey: rootStableKey, symbols, edges, imports };
}

export function parseRepository(files: readonly ScannedFile[]): ParsedFile[] {
  return files
    .filter(
      (file) =>
        file.language === "typescript" ||
        file.language === "javascript" ||
        file.language === "python" ||
        file.language === "go",
    )
    .map((file) =>
      file.language === "python"
        ? parsePythonSourceFile(file)
        : file.language === "go"
          ? parseGoSourceFile(file)
          : parseSourceFile(file),
    );
}
