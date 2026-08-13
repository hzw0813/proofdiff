import path from "node:path";
import { parse, type ParserOptions } from "@babel/parser";
import type { CallInfo, ImportInfo, SourceAnalysis, SymbolInfo } from "../types.js";
import { compareCodeUnits } from "../util.js";
import type { LanguageAdapter } from "./types.js";

type NodeLike = {
  type?: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number }; end: { line: number } } | null;
  [key: string]: unknown;
};

function nodeName(node: NodeLike | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value;
  if (node.type === "PrivateName") return `#${nodeName(node.id as NodeLike) ?? "private"}`;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const object = nodeName(node.object as NodeLike);
    const property = nodeName(node.property as NodeLike);
    return object && property ? `${object}.${property}` : property;
  }
  if (node.type === "TSQualifiedName") {
    const left = nodeName(node.left as NodeLike);
    const right = nodeName(node.right as NodeLike);
    return left && right ? `${left}.${right}` : right;
  }
  return null;
}

function range(node: NodeLike): { start: number; end: number } {
  return { start: node.loc?.start.line ?? 1, end: node.loc?.end.line ?? node.loc?.start.line ?? 1 };
}

function isExported(parent: NodeLike | undefined): boolean {
  return parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration";
}

function collectImportNames(specifiers: unknown): string[] {
  if (!Array.isArray(specifiers)) return [];
  const names: string[] = [];
  for (const item of specifiers) {
    const specifier = item as NodeLike;
    const imported = nodeName(specifier.imported as NodeLike);
    const local = nodeName(specifier.local as NodeLike);
    if (imported) names.push(imported);
    else if (local) names.push(local);
  }
  return names;
}

function analyzeAst(ast: NodeLike, language: "typescript" | "javascript"): SourceAnalysis {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const calls = new Set<string>();
  const callSites: CallInfo[] = [];
  const seen = new Set<object>();

  function visit(node: unknown, parent?: NodeLike, grandparent?: NodeLike): void {
    if (!node || typeof node !== "object" || Array.isArray(node) || seen.has(node)) return;
    seen.add(node);
    const current = node as NodeLike;
    const line = current.loc?.start.line ?? 1;

    if (current.type === "ImportDeclaration" || current.type === "ExportNamedDeclaration" || current.type === "ExportAllDeclaration") {
      const source = current.source as NodeLike | undefined;
      if (source && typeof source.value === "string") {
        imports.push({
          source: source.value,
          names: collectImportNames(current.specifiers),
          kind: "static",
          line,
          confidence: "high",
        });
      }
    }

    if (current.type === "CallExpression" || current.type === "OptionalCallExpression") {
      const callee = current.callee as NodeLike;
      const name = nodeName(callee);
      if (name) {
        calls.add(name);
        if (!callSites.some((site) => site.name === name && site.line === line)) callSites.push({ name, line, confidence: "high" });
      }
      const args = current.arguments;
      const first = Array.isArray(args) ? args[0] as NodeLike | undefined : undefined;
      if ((name === "require" || callee?.type === "Import") && first && typeof first.value === "string") {
        imports.push({
          source: first.value,
          names: [],
          kind: callee.type === "Import" ? "dynamic" : "static",
          line,
          confidence: "high",
        });
      }
    }

    if (current.type === "FunctionDeclaration") {
      symbols.push({
        name: nodeName(current.id as NodeLike) ?? "default",
        kind: "function",
        range: range(current),
        exported: isExported(parent),
        confidence: "high",
      });
    } else if (current.type === "ClassDeclaration") {
      symbols.push({
        name: nodeName(current.id as NodeLike) ?? "default",
        kind: "class",
        range: range(current),
        exported: isExported(parent),
        confidence: "high",
      });
    } else if (["ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(current.type ?? "")) {
      symbols.push({
        name: nodeName(current.key as NodeLike) ?? "anonymous",
        kind: "method",
        range: range(current),
        exported: false,
        confidence: "high",
      });
    } else if (current.type === "VariableDeclarator") {
      const initializer = current.init as NodeLike | undefined;
      if (initializer && ["ArrowFunctionExpression", "FunctionExpression"].includes(initializer.type ?? "")) {
        symbols.push({
          name: nodeName(current.id as NodeLike) ?? "anonymous",
          kind: "function",
          range: range(current),
          exported: parent?.type === "VariableDeclaration" && isExported(grandparent),
          confidence: "high",
        });
      }
    }

    for (const [key, value] of Object.entries(current)) {
      if (["loc", "start", "end", "errors", "tokens", "comments"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child, current, parent);
      } else if (value && typeof value === "object") {
        visit(value, current, parent);
      }
    }
  }

  visit(ast);
  return {
    language,
    parser: "@babel/parser",
    symbols,
    imports,
    calls: [...calls].sort(),
    callSites: callSites.sort((a, b) => a.line - b.line || compareCodeUnits(a.name, b.name)),
    diagnostics: [],
    confidence: "high",
  };
}

export class JavaScriptAdapter implements LanguageAdapter {
  readonly id;
  readonly extensions: readonly string[];

  constructor(language: "typescript" | "javascript") {
    this.id = language;
    this.extensions = language === "typescript" ? [".ts", ".tsx", ".mts", ".cts"] : [".js", ".jsx", ".mjs", ".cjs"];
  }

  async analyze(file: string, source: string, _root: string): Promise<SourceAnalysis> {
    const extension = path.extname(file).toLowerCase();
    const plugins: NonNullable<ParserOptions["plugins"]> = ["jsx", "decorators-legacy", "importAttributes", "explicitResourceManagement"];
    if (this.id === "typescript") plugins.push("typescript");
    try {
      const ast = parse(source, {
        sourceType: "unambiguous",
        errorRecovery: true,
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: extension === ".cjs",
        plugins,
      }) as unknown as NodeLike;
      const analysis = analyzeAst(ast, this.id);
      const parseErrors = (ast as NodeLike & { errors?: Array<{ message: string }> }).errors ?? [];
      if (parseErrors.length > 0) {
        analysis.diagnostics.push(...parseErrors.slice(0, 5).map((error) => `Parser recovered: ${error.message}`));
        analysis.confidence = "medium";
        for (const site of analysis.callSites ?? []) site.confidence = "medium";
      }
      return analysis;
    } catch (error) {
      return lexicalFallback(source, this.id, error instanceof Error ? error.message : String(error));
    }
  }
}

function lexicalFallback(source: string, language: "typescript" | "javascript", diagnostic: string): SourceAnalysis {
  const symbols: SymbolInfo[] = [];
  const imports: ImportInfo[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const symbol = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+([\w$]+)/);
    if (symbol?.[1]) {
      symbols.push({ name: symbol[1], kind: /\bclass\b/.test(line) ? "class" : "function", range: { start: index + 1, end: index + 1 }, exported: /\bexport\b/.test(line), confidence: "low" });
    }
    const imported = line.match(/(?:\bfrom\s+|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)/);
    if (imported?.[1]) imports.push({ source: imported[1], names: [], kind: "static", line: index + 1, confidence: "low" });
  }
  return { language, parser: "lexical fallback", symbols, imports, calls: [], callSites: [], diagnostics: [`AST parsing failed: ${diagnostic}`], confidence: "low" };
}
