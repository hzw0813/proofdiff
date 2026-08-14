import path from "node:path";
import type { CheckDefinition, TestTargetQualification } from "./types.js";
import { isTestLikePath, pathExists, readUtf8File, unique } from "./util.js";

type SupportedJsRunner = "jest" | "vitest";
type PackageJson = { scripts?: Record<string, unknown> };
type RunnerPackageJson = { bin?: string | Record<string, unknown> };
type RecognizedRunnerScript = {
  runner: SupportedJsRunner;
  runnerArgs: string[];
  runnerEnv: Record<string, string>;
  usesCrossEnv: boolean;
};

const JS_TEST_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const JEST_SAFE_ARGS = new Set(["--ci", "--runInBand"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_LITERAL_VALUE = /^[A-Za-z0-9_./:@%+,-]*$/;
const MAX_RUNNER_ENV_ASSIGNMENTS = 4;
const BLOCKED_ENV_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const SENSITIVE_ENV_NAMES = new Set(["PATH", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH"]);

function normalizedRepositoryPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function safeEnvironmentAssignment(token: string): [name: string, value: string] | null {
  const separator = token.indexOf("=");
  if (separator <= 0) return null;
  const name = token.slice(0, separator);
  const value = token.slice(separator + 1);
  if (!ENV_NAME.test(name) || BLOCKED_ENV_NAMES.has(name) || !ENV_LITERAL_VALUE.test(value)) return null;
  return [name, value];
}

function recognizedRunnerScript(command: string): RecognizedRunnerScript | null {
  const tokens = command.trim().replaceAll(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  let index = 0;
  let usesCrossEnv = false;
  if (tokens[index] === "cross-env") {
    usesCrossEnv = true;
    index += 1;
  }

  const runnerEnv = Object.create(null) as Record<string, string>;
  let environmentAssignments = 0;
  while (index < tokens.length) {
    const assignment = safeEnvironmentAssignment(tokens[index]!);
    if (assignment === null) break;
    environmentAssignments += 1;
    if (environmentAssignments > MAX_RUNNER_ENV_ASSIGNMENTS) return null;
    const [name, value] = assignment;
    if (Object.hasOwn(runnerEnv, name)) return null;
    runnerEnv[name] = value;
    index += 1;
  }
  if (usesCrossEnv && environmentAssignments === 0) return null;

  const runnerToken = tokens[index];
  const runnerTokens = tokens.slice(index + 1);
  if (runnerToken === "jest" && runnerTokens.every((token) => JEST_SAFE_ARGS.has(token))) {
    return { runner: "jest", runnerArgs: runnerTokens, runnerEnv, usesCrossEnv };
  }
  if (runnerToken === "vitest" && (runnerTokens.length === 0 || (runnerTokens.length === 1 && (runnerTokens[0] === "run" || runnerTokens[0] === "--run")))) {
    return { runner: "vitest", runnerArgs: [], runnerEnv, usesCrossEnv };
  }
  return null;
}

function sensitiveRunnerEnvironmentNames(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter((name) => {
    const normalized = name.toUpperCase();
    return SENSITIVE_ENV_NAMES.has(normalized) || normalized.startsWith("DYLD_");
  }).sort();
}

async function localRunnerBin(root: string, runner: SupportedJsRunner): Promise<string | null> {
  const packageRoot = path.join(root, "node_modules", runner);
  const content = await readUtf8File(path.join(packageRoot, "package.json"), 1_000_000);
  if (content === null) return null;
  try {
    const manifest = JSON.parse(content) as RunnerPackageJson;
    const raw = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[runner];
    if (typeof raw !== "string" || raw.length === 0 || path.isAbsolute(raw)) return null;
    const candidate = path.resolve(packageRoot, raw);
    const relative = path.relative(packageRoot, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    if (!(await pathExists(candidate))) return null;
    return normalizedRepositoryPath(path.relative(root, candidate));
  } catch {
    return null;
  }
}

async function localCrossEnvAvailable(root: string): Promise<boolean> {
  return pathExists(path.join(root, "node_modules", "cross-env", "package.json"));
}

function qualifyTarget(runner: SupportedJsRunner, inputFile: string): TestTargetQualification | null {
  const file = normalizedRepositoryPath(inputFile);
  if (!JS_TEST_EXTENSION.test(file) || !isTestLikePath(file)) return null;
  return {
    path: inputFile,
    runnerPath: file,
    basis: "runner-explicit-path",
    confidence: "high",
    detail: `${file} is a test-like JavaScript/TypeScript path that ProofDiff can explicitly supply to the recognized ${runner} runner.`,
    limitation: "Qualification establishes exact target supply only. Runtime observation is still required and does not prove changed-symbol, changed-line, assertion, or behavioral coverage.",
  };
}

function observerSource(runner: SupportedJsRunner, runnerBin: string, runnerArgs: string[], runnerEnv: Record<string, string>, targets: string[]): string {
  return String.raw`
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
const runner=${JSON.stringify(runner)};
const runnerBin=${JSON.stringify(runnerBin)};
const runnerArgs=${JSON.stringify(runnerArgs)};
const runnerEnv=${JSON.stringify(runnerEnv)};
const targets=${JSON.stringify(targets)};
const report=join(tmpdir(),"proofdiff-"+runner+"-"+randomUUID()+".json");
const records=new Map(targets.map(runnerPath=>[resolve(runnerPath),{runnerPath,observed:false,passed:0,failed:0,skipped:0,tests:0}]));
let unattributedFailures=0;
let invalid=false;
let finished=false;
const statuses={passed:"passed",failed:"failed",pending:"skipped",skipped:"skipped",todo:"skipped",disabled:"skipped"};
function safeInt(value){return Number.isSafeInteger(value)&&value>=0?value:null}
function suiteCounts(suite){
  const assertions=Array.isArray(suite?.assertionResults)?suite.assertionResults:Array.isArray(suite?.testResults)?suite.testResults:null;
  if(assertions){
    let passed=0,failed=0,skipped=0;
    for(const assertion of assertions){const mapped=statuses[assertion?.status];if(!mapped)return null;if(mapped==="passed")passed++;else if(mapped==="failed")failed++;else skipped++}
    return {passed,failed,skipped,tests:passed+failed};
  }
  const passed=safeInt(suite?.numPassingTests),failed=safeInt(suite?.numFailingTests),skipped=safeInt(suite?.numPendingTests);
  if(passed===null||failed===null||skipped===null)return null;
  return {passed,failed,skipped,tests:passed+failed};
}
function suiteFailed(suite,counts){return suite?.status==="failed"||(counts?.failed??0)>0}
function consume(){
  try{
    const info=statSync(report);if(!info.isFile()||info.size>4_000_000)return;
    const payload=JSON.parse(readFileSync(report,"utf8"));if(!Array.isArray(payload?.testResults))return;
    const seen=new Set();
    for(const suite of payload.testResults){
      const raw=typeof suite?.name==="string"?suite.name:typeof suite?.testFilePath==="string"?suite.testFilePath:null;
      const counts=suiteCounts(suite);
      if(!raw||!counts){invalid=true;break}
      const absolute=resolve(isAbsolute(raw)?raw:resolve(raw));
      const record=records.get(absolute);
      if(!record){if(suiteFailed(suite,counts))unattributedFailures++;continue}
      if(seen.has(absolute)){invalid=true;break}
      seen.add(absolute);Object.assign(record,{observed:true,...counts});
      if(suite?.status==="failed"&&record.failed===0)record.failed=1;
    }
  }catch{}
}
function emit(code){
  consume();
  if(invalid){for(const record of records.values())Object.assign(record,{observed:false,passed:0,failed:0,skipped:0,tests:0})}
  const attributedFailure=[...records.values()].some(record=>record.observed&&record.failed>0);
  if(code!==0&&!attributedFailure)unattributedFailures++;
  try{writeSync(3,JSON.stringify({version:1,runner,unattributedFailures,files:[...records.values()]})+"\n")}catch{}
  try{rmSync(report,{force:true})}catch{}
}
function finish(code){if(finished)return;finished=true;emit(code);process.exitCode=code}
const args=runner==="jest"
  ? [...runnerArgs,"--runTestsByPath",...targets,"--json","--outputFile="+report]
  : ["run",...runnerArgs,...targets,"--reporter=json","--outputFile="+report];
const child=spawn(process.execPath,[resolve(runnerBin),...args],{cwd:process.cwd(),env:{...process.env,...runnerEnv},stdio:["ignore","inherit","inherit"]});
child.once("error",()=>{unattributedFailures++;finish(1)});
child.once("close",code=>{finish(typeof code==="number"?code:1)});
`;
}

export async function targetedJsFrameworkChecks(
  root: string,
  definitions: CheckDefinition[],
  impactedPaths: string[],
  limit = 100,
): Promise<{ checks: CheckDefinition[]; truncated: boolean }> {
  const packageContent = await readUtf8File(path.join(root, "package.json"), 2_000_000);
  if (packageContent === null) return { checks: [], truncated: false };
  let manifest: PackageJson;
  try {
    manifest = JSON.parse(packageContent) as PackageJson;
  } catch {
    return { checks: [], truncated: false };
  }

  const sorted = unique(impactedPaths.map(normalizedRepositoryPath)).sort();
  const checks: CheckDefinition[] = [];
  let truncated = false;
  for (const definition of definitions) {
    if (definition.kind !== "test" || !definition.id.startsWith("js:test:")) continue;
    const scriptName = definition.id.slice("js:test:".length);
    const script = manifest.scripts?.[scriptName];
    if (typeof script !== "string") continue;
    const recognized = recognizedRunnerScript(script);
    if (recognized === null) continue;
    if (recognized.usesCrossEnv && !(await localCrossEnvAvailable(root))) continue;
    const runnerBin = await localRunnerBin(root, recognized.runner);
    if (runnerBin === null) continue;

    const qualified: TestTargetQualification[] = [];
    for (const file of sorted) {
      const qualification = qualifyTarget(recognized.runner, file);
      if (qualification && await pathExists(path.join(root, qualification.runnerPath))) qualified.push(qualification);
    }
    if (qualified.length === 0) continue;
    const selected = qualified.slice(0, limit);
    if (qualified.length > limit) truncated = true;
    const targets = selected.map((item) => item.runnerPath);
    const environmentNames = Object.keys(recognized.runnerEnv).sort();
    const sensitiveEnvironmentNames = sensitiveRunnerEnvironmentNames(recognized.runnerEnv);
    const environmentOrigin = environmentNames.length === 0 ? "" : `; preserving literal environment prefixes: ${environmentNames.join(", ")}`;
    const sensitiveEnvironmentOrigin = sensitiveEnvironmentNames.length === 0 ? "" : `; warning: sensitive environment prefixes propagated: ${sensitiveEnvironmentNames.join(", ")}`;
    const wrapperOrigin = recognized.usesCrossEnv ? "; bounded cross-env wrapper recognized" : "";
    checks.push({
      id: `${definition.id}:targeted:${recognized.runner}`,
      label: `targeted ${recognized.runner}: ${selected.length} qualified test target${selected.length === 1 ? "" : "s"}`,
      kind: "test",
      command: "node",
      args: ["--input-type=module", "--eval", observerSource(recognized.runner, runnerBin, recognized.runnerArgs, recognized.runnerEnv, targets)],
      origin: `ProofDiff targeted ${recognized.runner} execution derived from ${definition.origin}${environmentOrigin}${sensitiveEnvironmentOrigin}${wrapperOrigin}`,
      executesRepositoryCode: true,
      targetRunner: recognized.runner,
      ...(recognized.runnerArgs.length === 0 ? {} : { targetRunnerArgs: recognized.runnerArgs }),
      targetFiles: selected.map((item) => item.path),
      targetQualifications: selected,
    });
  }
  return { checks, truncated };
}
