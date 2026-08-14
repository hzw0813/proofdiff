import { runProcess, safeExecutablePath, type ProcessOptions, type ProcessResult } from "../process.js";
import type { SourceAnalysis, SymbolInfo } from "../types.js";
import type { LanguageAdapter } from "./types.js";

const PYTHON_AST_SCRIPT = String.raw`
import ast, json, sys
source = sys.stdin.read()
try:
    tree = ast.parse(source, filename="<proofdiff-input>", type_comments=True)
except SyntaxError as exc:
    print(json.dumps({"error": f"{exc.msg} at line {exc.lineno or '?'}"}))
    raise SystemExit(0)

symbols, imports, calls, call_sites = [], [], set(), {}

class Visitor(ast.NodeVisitor):
    def __init__(self):
        self.scopes = []

    def _symbol(self, node, kind):
        symbols.append({
            "name": node.name,
            "kind": kind,
            "start": node.lineno,
            "end": getattr(node, "end_lineno", node.lineno),
            "exported": len(self.scopes) == 0 and not node.name.startswith("_"),
        })

    def visit_FunctionDef(self, node):
        self._symbol(node, "method" if self.scopes and self.scopes[-1] == "class" else "function")
        self.scopes.append("function")
        self.generic_visit(node)
        self.scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self._symbol(node, "class")
        self.scopes.append("class")
        self.generic_visit(node)
        self.scopes.pop()

    def visit_Import(self, node):
        for alias in node.names:
            imports.append({"source": alias.name, "names": [alias.asname or alias.name], "line": node.lineno, "level": 0})

    def visit_ImportFrom(self, node):
        imports.append({"source": ("." * node.level) + (node.module or ""), "names": [a.name for a in node.names], "line": node.lineno, "level": node.level})

    def visit_Call(self, node):
        def name(value):
            if isinstance(value, ast.Name): return value.id
            if isinstance(value, ast.Attribute):
                base = name(value.value)
                return f"{base}.{value.attr}" if base else value.attr
            return None
        value = name(node.func)
        if value:
            calls.add(value)
            call_sites[(value, node.lineno)] = {"name": value, "line": node.lineno}
        self.generic_visit(node)

Visitor().visit(tree)
print(json.dumps({"symbols": symbols, "imports": imports, "calls": sorted(calls), "callSites": sorted(call_sites.values(), key=lambda item: (item["line"], item["name"]))}))
`;

type PythonOutput = {
  error?: string;
  symbols?: Array<{ name: string; kind: "function" | "method" | "class"; start: number; end: number; exported: boolean }>;
  imports?: Array<{ source: string; names: string[]; line: number }>;
  calls?: string[];
  callSites?: Array<{ name: string; line: number }>;
};

type PythonProcessRunner = (command: string, args: string[], options: ProcessOptions) => Promise<ProcessResult>;

type PythonCandidate = {
  command: string;
  parser: string;
};

export function pythonInterpreterCandidates(platform: NodeJS.Platform = process.platform): PythonCandidate[] {
  return platform === "win32"
    ? [{ command: "python", parser: "python ast" }, { command: "python3", parser: "python3 ast" }]
    : [{ command: "python3", parser: "python3 ast" }, { command: "python", parser: "python ast" }];
}

function failureReason(result: ProcessResult): string {
  if (result.timedOut) return "timed out";
  return result.stderr.trim() || result.error || `exited with ${String(result.exitCode)}`;
}

export async function analyzePythonSource(
  source: string,
  root: string,
  options: { platform?: NodeJS.Platform; run?: PythonProcessRunner } = {},
): Promise<SourceAnalysis> {
  const failures: string[] = [];
  const runner = options.run ?? runProcess;
  for (const candidate of pythonInterpreterCandidates(options.platform)) {
    const result = await runner(candidate.command, ["-I", "-S", "-c", PYTHON_AST_SCRIPT], {
      cwd: root,
      stdin: source,
      timeoutMs: 10_000,
      maxOutputBytes: 1_000_000,
      env: { PATH: safeExecutablePath(), PYTHONIOENCODING: "utf-8" },
    });
    if (result.exitCode === 0) {
      try {
        const parsed = JSON.parse(result.stdout) as PythonOutput;
        if (parsed.error) return lexicalFallback(source, parsed.error);
        return {
          language: "python",
          parser: candidate.parser,
          symbols: (parsed.symbols ?? []).map((symbol) => ({
            name: symbol.name,
            kind: symbol.kind,
            range: { start: symbol.start, end: symbol.end },
            exported: symbol.exported,
            confidence: "high",
          })),
          imports: (parsed.imports ?? []).map((item) => ({ source: item.source, names: item.names, kind: "static", line: item.line, confidence: "high" })),
          calls: parsed.calls ?? [],
          callSites: (parsed.callSites ?? []).map((site) => ({ ...site, confidence: "high" })),
          diagnostics: [],
          confidence: "high",
        };
      } catch {
        failures.push(`${candidate.command}: invalid AST helper output`);
        continue;
      }
    }
    failures.push(`${candidate.command}: ${failureReason(result)}`);
  }
  return lexicalFallback(
    source,
    failures.length > 0
      ? `Python AST helpers unavailable (${failures.join("; ")}); using lexical analysis`
      : "Python interpreter unavailable; using lexical analysis",
  );
}

export class PythonAdapter implements LanguageAdapter {
  readonly id = "python" as const;
  readonly extensions = [".py", ".pyi"] as const;

  async analyze(_file: string, source: string, root: string): Promise<SourceAnalysis> {
    return await analyzePythonSource(source, root);
  }
}

function lexicalFallback(source: string, diagnostic: string): SourceAnalysis {
  const symbols: SymbolInfo[] = [];
  const imports: SourceAnalysis["imports"] = [];
  for (const [index, line] of source.split("\n").entries()) {
    const definition = line.match(/^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/);
    if (definition?.[2] && definition[3]) {
      symbols.push({
        name: definition[3],
        kind: definition[2] === "class" ? "class" : definition[1] ? "method" : "function",
        range: { start: index + 1, end: index + 1 },
        exported: !definition[1] && !definition[3].startsWith("_"),
        confidence: "low",
      });
    }
    const imported = line.match(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/);
    const sourceName = imported?.[1] ?? imported?.[2];
    if (sourceName) imports.push({ source: sourceName, names: [], kind: "static", line: index + 1, confidence: "low" });
  }
  return { language: "python", parser: "lexical fallback", symbols, imports, calls: [], callSites: [], diagnostics: [diagnostic], confidence: "low" };
}
