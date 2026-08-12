import path from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CheckDefinition, CheckResult, TestTargetObservation, TestTargetQualification } from "./types.js";
import { constrainedCheckEnvironment, runProcess } from "./process.js";
import { pathExists, readUtf8File, sanitizeControlCharacters, unique } from "./util.js";

type PackageJson = { scripts?: Record<string, unknown>; packageManager?: string; workspaces?: unknown };

type PythonTestLayout = { framework: "pytest" | "unittest"; directory: "tests" | "test" | "." };
type PytestConfiguration = { origin: string; patterns: string[] };

type ObserverPayload = {
  version: 1;
  runner: CheckDefinition["targetRunner"];
  unattributedFailures: number;
  files: Array<{ file?: string; runnerPath?: string; observed: boolean; passed: number; failed: number; skipped: number; tests: number }>;
};

function nodeTestReporter(targets: string[]): string {
  const source = String.raw`import{writeSync}from"node:fs";import{resolve}from"node:path";import{Readable}from"node:stream";import{fileURLToPath}from"node:url";import{spec}from"node:test/reporters";const targets=${JSON.stringify(targets)};const records=new Map(targets.map(runnerPath=>[resolve(runnerPath),{runnerPath,observed:false,passed:0,failed:0,skipped:0,tests:0}]));export default async function*proofdiff(source){async function*inspect(){for await(const event of source){if(event.type==="test:summary"&&event.data.file){const raw=event.data.file;const key=resolve(raw.startsWith("file:")?fileURLToPath(raw):raw);const item=records.get(key);if(item)Object.assign(item,{observed:true,passed:event.data.counts.passed,failed:event.data.counts.failed,skipped:event.data.counts.skipped,tests:event.data.counts.tests})}else if(event.type==="test:complete"&&event.data.file){const raw=event.data.file;const key=resolve(raw.startsWith("file:")?fileURLToPath(raw):raw);const item=records.get(key);if(item&&typeof event.data.name==="string"&&resolve(event.data.name)===key){item.observed=true;if(event.data.details?.passed===false&&item.failed===0)item.failed=1}}yield event}}for await(const output of Readable.from(inspect()).compose(spec()))yield output;try{writeSync(3,JSON.stringify({version:1,runner:"node-test",unattributedFailures:0,files:[...records.values()]})+"\n")}catch{}}`;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const PYTEST_OBSERVER = String.raw`
import json, os, sys
targets = sys.argv[1:]
counts = {os.path.normcase(os.path.abspath(item)): {"runnerPath": item, "observed": False, "passed": 0, "failed": 0, "skipped": 0, "tests": 0} for item in targets}
state = {"unattributedFailures": 0}
def target_for(raw):
    return counts.get(os.path.normcase(os.path.abspath(str(raw).split("::", 1)[0])))
class Observer:
    def pytest_runtest_logreport(self, report):
        item = target_for(getattr(report, "nodeid", ""))
        if item is None: return
        item["observed"] = True
        if report.when == "call":
            if report.skipped: item["skipped"] += 1
            elif report.failed: item["failed"] += 1; item["tests"] += 1
            elif report.passed: item["passed"] += 1; item["tests"] += 1
        elif report.skipped:
            item["skipped"] += 1
        elif report.failed:
            item["failed"] += 1
    def pytest_collectreport(self, report):
        item = target_for(getattr(report, "nodeid", ""))
        if item is not None:
            item["observed"] = True
            if report.failed: item["failed"] += 1
        elif report.failed:
            state["unattributedFailures"] += 1
    def pytest_internalerror(self, *args, **kwargs):
        state["unattributedFailures"] += 1
def emit():
    payload = {"version": 1, "runner": "pytest", "unattributedFailures": state["unattributedFailures"], "files": list(counts.values())}
    os.write(3, (json.dumps(payload, separators=(",", ":")) + "\n").encode())
try:
    import pytest
    code = int(pytest.main(["-q", "--", *targets], plugins=[Observer()]))
    if code == 5:
        for item in counts.values(): item["observed"] = True
    elif code in (2, 3, 4):
        state["unattributedFailures"] += 1
except BaseException:
    state["unattributedFailures"] += 1
    raise
finally:
    emit()
raise SystemExit(code)
`;

const UNITTEST_OBSERVER = String.raw`
import json, os, sys, unittest
targets = sys.argv[1:]
counts = {os.path.normcase(os.path.abspath(item)): {"runnerPath": item, "observed": False, "passed": 0, "failed": 0, "skipped": 0, "tests": 0} for item in targets}
state = {"unattributedFailures": 0}
def target_for(test):
    module = sys.modules.get(getattr(test.__class__, "__module__", ""))
    filename = getattr(module, "__file__", None)
    return counts.get(os.path.normcase(os.path.abspath(filename))) if filename else None
def observed(test, failed=False):
    item = target_for(test)
    if item is not None:
        item["observed"] = True
        return item
    if failed: state["unattributedFailures"] += 1
    return None
class Result(unittest.TextTestResult):
    def addSuccess(self, test):
        super().addSuccess(test); item = observed(test)
        if item is not None: item["passed"] += 1; item["tests"] += 1
    def addFailure(self, test, err):
        super().addFailure(test, err); item = observed(test, True)
        if item is not None: item["failed"] += 1; item["tests"] += 1
    def addError(self, test, err):
        super().addError(test, err); item = observed(test, True)
        if item is not None: item["failed"] += 1
    def addSkip(self, test, reason):
        super().addSkip(test, reason); item = observed(test)
        if item is not None: item["skipped"] += 1
    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err); item = observed(test)
        if item is not None: item["skipped"] += 1
    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test); item = observed(test, True)
        if item is not None: item["failed"] += 1; item["tests"] += 1
    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err); item = observed(test, err is not None)
        if item is not None and err is not None: item["failed"] += 1; item["tests"] += 1
class Runner(unittest.TextTestRunner):
    resultclass = Result
program = unittest.main(module=None, argv=["unittest", *targets], exit=False, testRunner=Runner)
if state["unattributedFailures"] == 0:
    for item in counts.values(): item["observed"] = True
payload = {"version": 1, "runner": "unittest", "unattributedFailures": state["unattributedFailures"], "files": list(counts.values())}
os.write(3, (json.dumps(payload, separators=(",", ":")) + "\n").encode())
raise SystemExit(0 if program.result.wasSuccessful() else 1)
`;

function tableBody(content: string, table: string): string | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[[^\]]+\]\s*(?:[#;].*)?$/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function configuredPatterns(body: string | null, toml: boolean): string[] | null {
  if (body === null) return null;
  if (toml) {
    const raw = body.match(/^\s*python_files\s*=\s*(\[[\s\S]*?\]|"[^"]*"|'[^']*')/m)?.[1];
    if (!raw) return [];
    const quoted = [...raw.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!).filter(Boolean);
    return raw.startsWith("[") ? quoted : quoted.flatMap((value) => value.split(/\s+/)).filter(Boolean);
  }
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^\s*python_files\s*=\s*(.*)$/);
    if (!match) continue;
    const values = [match[1] ?? ""];
    while (lines[index + 1] !== undefined && /^\s+\S/.test(lines[index + 1]!)) values.push(lines[++index]!.trim());
    return values.join(" ").split(/\s+/).filter(Boolean);
  }
  return [];
}

async function readPytestConfiguration(root: string): Promise<PytestConfiguration | null> {
  const candidates: Array<{ file: string; table: string; toml: boolean; unconditional?: boolean }> = [
    { file: "pytest.toml", table: "pytest", toml: true, unconditional: true },
    { file: ".pytest.toml", table: "pytest", toml: true, unconditional: true },
    { file: "pytest.ini", table: "pytest", toml: false, unconditional: true },
    { file: ".pytest.ini", table: "pytest", toml: false, unconditional: true },
    { file: "pyproject.toml", table: "tool.pytest", toml: true },
    { file: "pyproject.toml", table: "tool.pytest.ini_options", toml: true },
    { file: "tox.ini", table: "pytest", toml: false },
    { file: "setup.cfg", table: "tool:pytest", toml: false },
  ];
  for (const candidate of candidates) {
    const content = await readUtf8File(path.join(root, candidate.file), 2_000_000);
    if (content === null) continue;
    const body = tableBody(content, candidate.table);
    if (body === null && !candidate.unconditional) continue;
    const patterns = configuredPatterns(body ?? "", candidate.toml) ?? [];
    return { origin: `${candidate.file}${body === null ? "" : ` [${candidate.table}]`}`, patterns: patterns.length > 0 ? patterns : ["test_*.py", "*_test.py"] };
  }
  return null;
}

function simpleGlobMatches(value: string, pattern: string): boolean {
  if (pattern.includes("/") || pattern.includes("\\") || /[\[\]{}]/.test(pattern)) return false;
  const expression = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${expression}$`).test(value);
}

function nodeDefaultTarget(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const name = path.posix.basename(normalized);
  if (!/\.(?:cjs|mjs|js)$/.test(name)) return false;
  const stem = name.replace(/\.(?:cjs|mjs|js)$/, "");
  return stem === "test" || stem.startsWith("test-") || stem.endsWith("-test") || stem.endsWith("_test") || stem.endsWith(".test") || normalized.split("/").slice(0, -1).includes("test");
}

async function detectPythonTests(root: string, limit = 2_000): Promise<PythonTestLayout | null> {
  const queue: Array<{ absolute: string; directory: "tests" | "test" | "." }> = [
    { absolute: root, directory: "." },
    { absolute: path.join(root, "tests"), directory: "tests" },
    { absolute: path.join(root, "test"), directory: "test" },
  ];
  const visited = new Set<string>();
  let inspected = 0;
  let detected: PythonTestLayout | null = null;
  while (queue.length > 0 && inspected < limit) {
    const current = queue.shift()!;
    if (visited.has(current.absolute)) continue;
    visited.add(current.absolute);
    let entries;
    try { entries = await readdir(current.absolute, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      inspected += 1;
      if (inspected >= limit) break;
      const target = path.join(current.absolute, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && !["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"].includes(entry.name)) {
        queue.push({ absolute: target, directory: current.directory === "." && (entry.name === "tests" || entry.name === "test") ? entry.name : current.directory });
      }
      if (entry.isFile() && /(?:^test_.*|.*_(?:test|spec))\.pyi?$/.test(entry.name)) {
        const content = await readUtf8File(target, 200_000);
        const framework = content !== null && /(?:^|\n)\s*(?:from\s+unittest\b|import\s+unittest\b)|unittest\.TestCase/.test(content) ? "unittest" : "pytest";
        if (framework === "pytest") return { framework, directory: current.directory };
        detected = { framework, directory: current.directory };
      }
    }
  }
  return detected;
}

function packageManager(root: string, manifest: PackageJson): { command: string; runArgs: (name: string) => string[]; origin: string } {
  const declared = manifest.packageManager?.split("@")[0];
  if (declared === "pnpm") return { command: "pnpm", runArgs: (name) => ["run", name], origin: "package.json" };
  if (declared === "yarn") return { command: "yarn", runArgs: (name) => ["run", name], origin: "package.json" };
  if (declared === "bun") return { command: "bun", runArgs: (name) => ["run", name], origin: "package.json" };
  return { command: "npm", runArgs: (name) => ["run", name, "--silent"], origin: "package.json" };
}

export function packageManagerInvocation(command: string, args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform !== "win32" || command === "bun") return { command, args };
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `${command}.cmd`, ...args] };
}

function classifyScript(name: string): CheckDefinition["kind"] | null {
  const normalized = name.toLowerCase();
  if (/^(?:test|test:unit|test:ci|test:all|check:test)$/.test(normalized)) return "test";
  if (/^(?:typecheck|type-check|check:types|types)$/.test(normalized)) return "typecheck";
  if (/^(?:lint|lint:ci|check:lint)$/.test(normalized)) return "lint";
  return null;
}

function targetingForScript(kind: CheckDefinition["kind"], command: string): Pick<CheckDefinition, "targetRunner" | "targetRunnerArgs" | "targetPattern" | "targetPatterns"> | null {
  if (kind !== "test") return null;
  const normalized = command.trim().replaceAll(/\s+/g, " ");
  const invocation = normalized.match(/(?:^|&& )(?:node|node\.exe) --test(?: (.+))?$/);
  if (!invocation) return null;
  const runnerArgs: string[] = [];
  const targetArguments: string[] = [];
  for (const argument of invocation[1]?.split(" ") ?? []) {
    if (/^--test-concurrency=[1-9]\d*$/.test(argument) || /^--test-(?:name|skip)-pattern=[A-Za-z0-9_.:*^$-]+$/.test(argument)) runnerArgs.push(argument);
    else if (argument.startsWith("-")) return null;
    else targetArguments.push(argument);
  }
  const runnerMetadata = { targetRunner: "node-test" as const, ...(runnerArgs.length === 0 ? {} : { targetRunnerArgs: runnerArgs }) };
  if (targetArguments.length === 0) return runnerMetadata;
  if (targetArguments.length === 1 && targetArguments[0] && (targetArguments[0].match(/\*/g)?.length ?? 0) === 1 && /^[A-Za-z0-9_./*-]+\.[cm]?js$/.test(targetArguments[0])) {
    return { ...runnerMetadata, targetPattern: targetArguments[0] };
  }
  if (targetArguments.every((argument) => /^[A-Za-z0-9_./-]+\.[cm]?js$/.test(argument))) return { ...runnerMetadata, targetPatterns: targetArguments };
  return null;
}

export async function discoverChecks(root: string): Promise<{ checks: CheckDefinition[]; notes: string[] }> {
  const checks: CheckDefinition[] = [];
  const notes: string[] = [];
  const packagePath = path.join(root, "package.json");
  const packageContent = await readUtf8File(packagePath, 2_000_000);
  if (packageContent !== null) {
    try {
      const manifest = JSON.parse(packageContent) as PackageJson;
      const manager = packageManager(root, manifest);
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        const kind = classifyScript(name);
        if (!kind || typeof command !== "string") continue;
        const targeting = targetingForScript(kind, command);
        const invocation = packageManagerInvocation(manager.command, manager.runArgs(name));
        checks.push({
          id: `js:${kind}:${name}`,
          label: `${kind}: ${name}`,
          kind,
          command: invocation.command,
          args: invocation.args,
          origin: `${manager.origin} script ${JSON.stringify(name)}`,
          executesRepositoryCode: true,
          ...(targeting === null ? {} : targeting),
        });
      }
      if (manifest.workspaces !== undefined) notes.push("Workspace package detected; root scripts are discovered, but package-level scripts are not inferred automatically.");
    } catch (error) {
      notes.push(`Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const localTsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!checks.some((check) => check.kind === "typecheck") && await pathExists(path.join(root, "tsconfig.json")) && await pathExists(localTsc)) {
    checks.push({ id: "js:typecheck:tsc", label: "typecheck: tsc --noEmit", kind: "typecheck", command: "node", args: [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--pretty", "false"], origin: "tsconfig.json + local TypeScript binary", executesRepositoryCode: true });
  }

  const hasPythonProject = await pathExists(path.join(root, "pyproject.toml"));
  const pyproject = hasPythonProject ? await readUtf8File(path.join(root, "pyproject.toml")) : null;
  const pytestConfiguration = await readPytestConfiguration(root);
  const explicitPytest = pytestConfiguration !== null;
  const pythonTests = await detectPythonTests(root);
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  if (explicitPytest || pythonTests?.framework === "pytest") {
    const patterns = pytestConfiguration?.patterns ?? ["test_*.py", "*_test.py"];
    checks.push({ id: "python:test:pytest", label: "test: pytest", kind: "test", command: pythonCommand, args: ["-m", "pytest", "-q"], origin: explicitPytest ? `pytest configuration: ${pytestConfiguration.origin}` : "Python test layout", executesRepositoryCode: true, targetRunner: "pytest", targetPatterns: patterns });
  } else if (pythonTests?.framework === "unittest") {
    checks.push({ id: "python:test:unittest", label: "test: unittest", kind: "test", command: pythonCommand, args: ["-m", "unittest", "discover", "-s", pythonTests.directory], origin: `Python unittest layout at ${pythonTests.directory}`, executesRepositoryCode: true, targetRunner: "unittest", targetPattern: "test*.py" });
  }
  if (pyproject?.includes("[tool.mypy")) {
    checks.push({ id: "python:typecheck:mypy", label: "typecheck: mypy", kind: "typecheck", command: pythonCommand, args: ["-m", "mypy", "."], origin: "pyproject.toml [tool.mypy]", executesRepositoryCode: true });
  }
  if (pyproject?.includes("[tool.ruff")) {
    checks.push({ id: "python:lint:ruff", label: "lint: ruff", kind: "lint", command: pythonCommand, args: ["-m", "ruff", "check", "."], origin: "pyproject.toml [tool.ruff]", executesRepositoryCode: true });
  }

  const deduplicated = unique(checks.map((check) => check.id)).map((id) => checks.find((check) => check.id === id)!);
  return { checks: deduplicated, notes };
}

function normalizedRepositoryPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathGlobMatches(value: string, pattern: string): boolean {
  const expression = normalizedRepositoryPath(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${expression}$`).test(normalizedRepositoryPath(value));
}

function nodeQualification(definition: CheckDefinition, inputFile: string): TestTargetQualification | null {
  const file = normalizedRepositoryPath(inputFile);
  const explicitPaths = definition.targetPatterns?.map(normalizedRepositoryPath);
  if (explicitPaths?.length) {
    if (/\.[cm]?js$/.test(file) && explicitPaths.includes(file)) {
      return { path: inputFile, runnerPath: file, basis: "runner-explicit-path", confidence: "high", detail: `${file} is an exact file listed by the discovered node --test command.`, limitation: "Qualification establishes runner identity, not test execution or behavioral coverage." };
    }
    if (!/\.(?:ts|tsx|mts|cts)$/.test(file)) return null;
    const compiledSource = file.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
    const matches = explicitPaths.filter((candidate) => candidate === compiledSource || candidate.endsWith(`/${compiledSource}`));
    if (matches.length !== 1) return null;
    return { path: inputFile, runnerPath: matches[0]!, basis: "compiled-source-map", confidence: "medium", detail: `${file} maps unambiguously to the explicitly listed compiled test ${matches[0]}.`, limitation: "The source-to-compiled mapping is filename-based and does not establish source-map or changed-line execution." };
  }
  if (definition.targetPattern !== undefined) {
    const pattern = normalizedRepositoryPath(definition.targetPattern);
    if (/\.[cm]?js$/.test(file) && pathGlobMatches(file, pattern)) {
      return { path: inputFile, runnerPath: file, basis: "runner-config-pattern", confidence: "high", detail: `${file} matches the discovered node --test pattern ${pattern}.`, limitation: "Pattern qualification establishes runner identity, not test execution or behavioral coverage." };
    }
    if (!/\.(?:ts|tsx|mts|cts)$/.test(file)) return null;
    const compiledName = path.posix.basename(file).replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
    const runnerPath = path.posix.join(path.posix.dirname(pattern), compiledName);
    if (!pathGlobMatches(runnerPath, pattern)) return null;
    return { path: inputFile, runnerPath, basis: "compiled-source-map", confidence: "medium", detail: `${file} maps by filename to ${runnerPath}, which matches the discovered node --test pattern ${pattern}.`, limitation: "The source-to-compiled mapping is filename-based and does not establish source-map or changed-line execution." };
  }
  if (/\.[cm]?js$/.test(file) && nodeDefaultTarget(file)) {
    return { path: inputFile, runnerPath: file, basis: "runner-default-pattern", confidence: "high", detail: `${file} matches a documented default node --test discovery pattern.`, limitation: "Default-pattern qualification establishes runner identity, not test execution or behavioral coverage." };
  }
  return null;
}

function pythonQualification(definition: CheckDefinition, inputFile: string): TestTargetQualification | null {
  const file = normalizedRepositoryPath(inputFile);
  if (!file.endsWith(".py")) return null;
  const name = path.posix.basename(file);
  if (definition.targetRunner === "pytest") {
    const patterns = definition.targetPatterns ?? ["test_*.py", "*_test.py"];
    const matching = patterns.find((pattern) => simpleGlobMatches(name, pattern));
    if (!matching) return null;
    const configured = definition.origin.startsWith("pytest configuration:");
    return { path: inputFile, runnerPath: file, basis: configured ? "runner-config-pattern" : "runner-default-pattern", confidence: "high", detail: `${file} matches pytest python_files pattern ${matching}${configured ? ` from ${definition.origin.slice("pytest configuration: ".length)}` : ""}.`, limitation: "Static collection-pattern matching cannot detect deselection, skips, dynamic collection hooks, or plugin behavior." };
  }
  if (definition.targetRunner === "unittest" && simpleGlobMatches(name, definition.targetPattern ?? "test*.py")) {
    return { path: inputFile, runnerPath: file, basis: "runner-default-pattern", confidence: "high", detail: `${file} matches unittest's default test*.py discovery convention.`, limitation: "Unsupported custom discovery loaders and runtime import behavior remain conservative." };
  }
  return null;
}

export async function targetedTestChecks(root: string, definitions: CheckDefinition[], impactedPaths: string[], limit = 100): Promise<{ checks: CheckDefinition[]; truncated: boolean }> {
  const sorted = unique(impactedPaths.map(normalizedRepositoryPath)).sort();
  const checks: CheckDefinition[] = [];
  let truncated = false;
  for (const definition of definitions) {
    if (!definition.targetRunner) continue;
    const qualifiedCandidates: TestTargetQualification[] = [];
    for (const file of sorted) {
      const qualification = definition.targetRunner === "node-test" ? nodeQualification(definition, file) : pythonQualification(definition, file);
      if (qualification && await pathExists(path.join(root, qualification.runnerPath))) qualifiedCandidates.push(qualification);
    }
    const runnerPathCounts = new Map<string, number>();
    for (const qualification of qualifiedCandidates) runnerPathCounts.set(qualification.runnerPath, (runnerPathCounts.get(qualification.runnerPath) ?? 0) + 1);
    const candidates = qualifiedCandidates.filter((qualification) => runnerPathCounts.get(qualification.runnerPath) === 1);
    if (candidates.length === 0) continue;
    const selected = candidates.slice(0, limit);
    const targetFiles = selected.map((candidate) => candidate.path);
    const targetArguments = selected.map((candidate) => candidate.runnerPath);
    if (candidates.length > limit) truncated = true;
    let command: string;
    let args: string[];
    if (definition.targetRunner === "node-test") {
      command = "node";
      args = ["--test", ...(definition.targetRunnerArgs ?? []), `--test-reporter=${nodeTestReporter(targetArguments)}`, ...targetArguments];
    } else if (definition.targetRunner === "pytest") {
      command = definition.command;
      args = ["-c", PYTEST_OBSERVER, ...targetArguments];
    } else {
      command = definition.command;
      args = ["-c", UNITTEST_OBSERVER, ...targetArguments];
    }
    checks.push({
      id: `${definition.id}:targeted`,
      label: `targeted ${definition.targetRunner}: ${targetFiles.length} qualified test target${targetFiles.length === 1 ? "" : "s"}`,
      kind: "test",
      command,
      args,
      origin: `ProofDiff targeted execution derived from ${definition.origin}`,
      executesRepositoryCode: true,
      targetRunner: definition.targetRunner,
      ...(definition.targetRunnerArgs === undefined ? {} : { targetRunnerArgs: definition.targetRunnerArgs }),
      ...(definition.targetPattern === undefined ? {} : { targetPattern: definition.targetPattern }),
      ...(definition.targetPatterns === undefined ? {} : { targetPatterns: definition.targetPatterns }),
      targetFiles,
      targetQualifications: selected,
    });
  }
  return { checks, truncated };
}

function notObserved(qualifications: TestTargetQualification[], detail: string): TestTargetObservation[] {
  return qualifications.map((qualification) => ({ path: qualification.path, runnerPath: qualification.runnerPath, outcome: "not-observed", testsObserved: 0, detail }));
}

function observedAbsolutePath(root: string, record: ObserverPayload["files"][number]): string | null {
  const raw = record.runnerPath ?? record.file;
  if (!raw) return null;
  try {
    return path.resolve(raw.startsWith("file:") ? fileURLToPath(raw) : path.resolve(root, raw));
  } catch {
    return null;
  }
}

export function parseTargetObservations(root: string, check: CheckDefinition, raw: string | undefined, truncated = false): TestTargetObservation[] {
  const qualifications = check.targetQualifications ?? [];
  if (qualifications.length === 0) return [];
  if (truncated) return notObserved(qualifications, "The bounded runner observation was truncated and was rejected.");
  const lines = (raw ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length !== 1) return notObserved(qualifications, lines.length === 0 ? "The runner did not produce a target observation." : "The runner produced multiple observation records; all were rejected.");
  let payload: ObserverPayload;
  try {
    payload = JSON.parse(lines[0]!) as ObserverPayload;
  } catch {
    return notObserved(qualifications, "The runner observation was malformed and was rejected.");
  }
  if (payload.version !== 1
    || payload.runner !== check.targetRunner
    || !Number.isSafeInteger(payload.unattributedFailures)
    || payload.unattributedFailures < 0
    || !Array.isArray(payload.files)) {
    return notObserved(qualifications, "The runner observation schema or runner identity did not match the targeted check.");
  }
  const expected = new Map(qualifications.map((qualification) => [path.resolve(root, qualification.runnerPath), qualification]));
  const records = new Map<string, ObserverPayload["files"][number]>();
  for (const record of payload.files) {
    const numeric = [record.passed, record.failed, record.skipped, record.tests];
    const absolute = observedAbsolutePath(root, record);
    if (absolute === null || !expected.has(absolute) || typeof record.observed !== "boolean" || numeric.some((value) => !Number.isSafeInteger(value) || value < 0) || records.has(absolute)) {
      return notObserved(qualifications, "The runner observation contained an invalid, duplicate, or unmatched target and was rejected.");
    }
    records.set(absolute, record);
  }
  if (records.size !== expected.size) return notObserved(qualifications, "The runner observation omitted one or more qualified targets and was rejected.");
  const unavailableRecords = [...records.values()].filter((record) => !record.observed);
  const processFailureHasNoUnavailableTarget = payload.unattributedFailures > 0 && unavailableRecords.length === 0;
  return qualifications.map((qualification) => {
    const record = records.get(path.resolve(root, qualification.runnerPath))!;
    if (!record.observed || (processFailureHasNoUnavailableTarget && record.failed === 0)) {
      const detail = !record.observed
        ? "The runner did not produce a trustworthy lifecycle observation for this exact target."
        : "The runner reported an unattributed process-level failure that could not be excluded from this target.";
      return { path: qualification.path, runnerPath: qualification.runnerPath, outcome: "not-observed" as const, testsObserved: 0, detail };
    }
    const outcome: TestTargetObservation["outcome"] = record.failed > 0 ? "failed" : record.passed > 0 ? "passed" : record.skipped > 0 ? "skipped" : "zero-tests";
    const detail = outcome === "zero-tests"
      ? "The runner observed zero tests for this exact target."
      : `The runner observed ${record.passed} passed, ${record.failed} failed, and ${record.skipped} skipped test${record.tests === 1 ? "" : "s"} for this exact target.`;
    return { path: qualification.path, runnerPath: qualification.runnerPath, outcome, testsObserved: record.passed + record.failed, detail };
  });
}

function redactSensitiveOutput(value: string, root: string): string {
  const redactions: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED PRIVATE KEY]" },
    { pattern: /\b(?:ghp|github_pat|glpat|sk_live|sk_test|npm)_[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED]" },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, replacement: "[REDACTED]" },
    { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED]" },
    { pattern: /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, replacement: "$1[REDACTED]" },
    { pattern: /\b(https?:\/\/[^\s\/:@]+:)[^\s\/@]+@/gi, replacement: "$1[REDACTED]@" },
    { pattern: /\b([A-Za-z][A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi, replacement: "$1[REDACTED]" },
    { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED]" },
  ];
  let output = sanitizeControlCharacters(value);
  for (const redaction of redactions) output = output.replace(redaction.pattern, redaction.replacement);
  const resolvedRoot = path.resolve(root).replace(/[\\/]$/, "");
  const roots = new Set([resolvedRoot]);
  if (resolvedRoot.startsWith("/var/")) roots.add(`/private${resolvedRoot}`);
  if (resolvedRoot.startsWith("/private/var/")) roots.add(resolvedRoot.slice("/private".length));
  const pathVariants = [...roots].flatMap((candidate) => [
    pathToFileURL(candidate).href.replace(/\/$/, ""),
    candidate,
    candidate.replaceAll("\\", "/"),
    candidate.replaceAll("/", "\\"),
  ]).filter((candidate) => candidate.length > 1).sort((a, b) => b.length - a.length);
  for (const localPath of pathVariants) output = output.replaceAll(localPath, "[REPOSITORY]");
  return output.split(/\r?\n/).map((line) => line.trimEnd()).join("\n").trim();
}

export async function runChecks(root: string, definitions: CheckDefinition[], options: { selected?: string[]; timeoutMs: number; maxOutputBytes: number }): Promise<CheckResult[]> {
  const unknown = (options.selected ?? []).filter((selection) => !definitions.some((check) => check.id === selection || check.kind === selection));
  if (unknown.length > 0) throw new Error(`Unknown check selection: ${unknown.join(", ")}. Use a check id or one of test, typecheck, lint.`);
  const selected = options.selected?.length
    ? definitions.filter((check) => options.selected!.includes(check.id) || options.selected!.includes(check.kind))
    : definitions;
  const results: CheckResult[] = [];
  for (const check of selected) {
    const result = await runProcess(check.command, check.args, {
      cwd: root,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      env: constrainedCheckEnvironment(),
      observe: (check.targetQualifications?.length ?? 0) > 0,
      maxObservationBytes: 64_000,
    });
    const combined = redactSensitiveOutput([result.stdout, result.stderr].filter(Boolean).join("\n"), root);
    let status: CheckResult["status"];
    let explanation: string;
    if (result.timedOut) {
      status = "timed-out";
      explanation = `Stopped after the ${Math.round(options.timeoutMs / 1_000)} second safety limit.`;
    } else if (result.error) {
      status = "error";
      explanation = `Could not start the check: ${result.error}`;
    } else if (result.exitCode === 0) {
      status = "passed";
      explanation = "The command exited successfully.";
    } else {
      status = "failed";
      explanation = `The command exited with code ${String(result.exitCode)}.`;
    }
    const targetObservations = parseTargetObservations(root, check, result.observation, result.observationTruncated);
    if (targetObservations.length > 0) {
      const counts = targetObservations.reduce<Record<TestTargetObservation["outcome"], number>>((totals, observation) => {
        totals[observation.outcome] += 1;
        return totals;
      }, { passed: 0, failed: 0, "zero-tests": 0, skipped: 0, "not-observed": 0 });
      explanation += ` Target observations: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts["zero-tests"]} zero-test, ${counts["not-observed"]} unavailable.`;
    }
    results.push({ ...check, status, exitCode: result.exitCode, durationMs: result.durationMs, output: combined, outputTruncated: result.truncated, explanation, ...(targetObservations.length === 0 ? {} : { targetObservations }) });
  }
  return results;
}

export function notRunResults(definitions: CheckDefinition[]): CheckResult[] {
  return definitions.map((check) => ({ ...check, status: "not-run", exitCode: null, durationMs: 0, output: "", outputTruncated: false, explanation: "Discovered only. Pass --run-checks to execute repository code explicitly." }));
}
