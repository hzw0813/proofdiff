import assert from "node:assert/strict";
import test from "node:test";
import { JavaScriptAdapter } from "../src/adapters/javascript.js";
import { analyzePythonSource, PythonAdapter, pythonInterpreterCandidates } from "../src/adapters/python.js";

test("TypeScript adapter extracts symbols, imports, and calls with high confidence", async () => {
  const source = `import { parse } from "./parser.js";
export async function analyze(value: string) { return parse(value); }
export class Runner { run() { return analyze("x"); } }
export const arrow = () => analyze("arrow");
`;
  const result = await new JavaScriptAdapter("typescript").analyze("src/analyze.ts", source, process.cwd());
  assert.equal(result.parser, "@babel/parser");
  assert.equal(result.confidence, "high");
  assert.deepEqual(result.imports.map((item) => item.source), ["./parser.js"]);
  assert.ok(result.symbols.some((symbol) => symbol.name === "analyze" && symbol.exported));
  assert.ok(result.symbols.some((symbol) => symbol.name === "Runner" && symbol.kind === "class"));
  assert.ok(result.symbols.some((symbol) => symbol.name === "arrow" && symbol.exported));
  assert.ok(result.calls.includes("parse"));
  assert.deepEqual(result.callSites?.filter((site) => site.name === "parse"), [{ name: "parse", line: 2, confidence: "high" }]);
});

test("JavaScript syntax errors degrade visibly instead of claiming high confidence", async () => {
  const result = await new JavaScriptAdapter("javascript").analyze("broken.js", "export function {", process.cwd());
  assert.notEqual(result.confidence, "high");
  assert.ok(result.diagnostics.length > 0);
});

test("Python adapter uses isolated stdlib AST", async () => {
  const source = `from .maths import add

def public(value: int) -> int:
    def nested(number: int) -> int:
        return number + 1
    return add(nested(value), 1)

class Service:
    def run(self):
        return public(2)
`;
  const result = await new PythonAdapter().analyze("proofdiff/service.py", source, process.cwd());
  assert.match(result.parser, /python.* ast/i);
  assert.equal(result.confidence, "high");
  assert.ok(result.symbols.some((symbol) => symbol.name === "public" && symbol.exported));
  assert.ok(result.symbols.some((symbol) => symbol.name === "nested" && symbol.kind === "function"));
  assert.ok(result.imports.some((item) => item.source === ".maths"));
  assert.ok(result.calls.includes("add"));
  assert.deepEqual(result.callSites?.find((site) => site.name === "add"), { name: "add", line: 6, confidence: "high" });
});

test("Python AST analysis retries the alternate interpreter after a candidate timeout", async () => {
  assert.deepEqual(pythonInterpreterCandidates("win32").map((candidate) => candidate.command), ["python", "python3"]);
  assert.deepEqual(pythonInterpreterCandidates("linux").map((candidate) => candidate.command), ["python3", "python"]);

  const commands: string[] = [];
  const result = await analyzePythonSource("def public():\n    return 1\n", process.cwd(), {
    platform: "win32",
    run: async (command) => {
      commands.push(command);
      if (command === "python") {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          durationMs: 10_000,
          truncated: false,
          error: "Process timed out",
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          symbols: [{ name: "public", kind: "function", start: 1, end: 2, exported: true }],
          imports: [],
          calls: [],
          callSites: [],
        }),
        stderr: "",
        timedOut: false,
        durationMs: 1,
        truncated: false,
      };
    },
  });

  assert.deepEqual(commands, ["python", "python3"]);
  assert.equal(result.parser, "python3 ast");
  assert.equal(result.confidence, "high");
  assert.ok(result.symbols.some((symbol) => symbol.name === "public" && symbol.exported));
});
