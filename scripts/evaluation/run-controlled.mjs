#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--proofdiff-root" || argument === "--output") {
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument === "--output" ? "output" : "proofdiffRoot"] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout;
}

async function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
}

async function initialize(files, changes) {
  const root = await mkdtemp(path.join(os.tmpdir(), "proofdiff-evaluation-control-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "evaluation@example.invalid");
  git(root, "config", "user.name", "ProofDiff Evaluation");
  await writeFiles(root, files);
  git(root, "add", ".");
  git(root, "commit", "-qm", "controlled baseline");
  await writeFiles(root, changes);
  return root;
}

const controls = [
  {
    id: "relative-targeted-pass",
    purpose: "A direct relative test relationship is found, explicitly targeted, and passes.",
    files: {
      "package.json": JSON.stringify({ name: "relative-targeted", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
      "src/value.js": "export function value() { return 1; }\n",
      "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value(), 2));\n"
    },
    changes: { "src/value.js": "export function value() { return 2; }\n" },
    runChecks: true,
    verify(report) {
      const assessment = report.assessments[0];
      const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
      return assessment?.status === "verified"
        && assessment.relatedTests.includes("test/value.test.js")
        && targeted?.status === "passed"
        && targeted.targetFiles?.includes("test/value.test.js");
    }
  },
  {
    id: "typescript-alias-unresolved",
    purpose: "A clear tsconfig paths relationship remains a labeled miss rather than being converted into a success.",
    files: {
      "package.json": JSON.stringify({ name: "alias-control", private: true, type: "module", scripts: { test: "vitest run" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } } }, null, 2),
      "src/math.ts": "export function add(a: number, b: number) { return a + b; }\n",
      "test/math.test.ts": "import { add } from '@app/math'; export const observed = add(1, 2);\n"
    },
    changes: { "src/math.ts": "export function add(a: number, b: number) { return a + b; }\n// controlled alias mutation\n" },
    runChecks: false,
    verify(report) {
      const assessment = report.assessments[0];
      return assessment?.file.language === "typescript"
        && assessment.relatedTests.length === 0
        && report.trust.repositoryCodeExecuted === false;
    }
  },
  {
    id: "directory-support-file-targeted-pass",
    purpose: "A support module under tests/ is classified as a test and can produce a zero-test targeted pass; the evaluator preserves this false-strength risk.",
    files: {
      "package.json": JSON.stringify({ name: "directory-support-control", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
      "src/value.js": "export function value() { return 1; }\n",
      "tests/fixtures/helper.js": "import { value } from '../../src/value.js'; export const fixtureValue = value();\n"
    },
    changes: { "src/value.js": "export function value() { return 2; }\n" },
    runChecks: true,
    verify(report) {
      const assessment = report.assessments[0];
      const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
      return assessment?.status === "verified"
        && assessment.relatedTests.includes("tests/fixtures/helper.js")
        && targeted?.status === "passed"
        && targeted.targetFiles?.includes("tests/fixtures/helper.js");
    }
  },
  {
    id: "opaque-passing-command",
    purpose: "A passing repository test command that excludes the related test remains partial and non-targeted.",
    files: {
      "package.json": JSON.stringify({ name: "opaque-control", private: true, type: "module", scripts: { test: "node --test test/smoke.test.js" } }, null, 2),
      "src/access.js": "export function allowed(role) { return role === 'admin'; }\n",
      "test/access.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { allowed } from '../src/access.js'; test('users denied', () => assert.equal(allowed('user'), false));\n",
      "test/smoke.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; test('smoke', () => assert.equal(1, 1));\n"
    },
    changes: { "src/access.js": "export function allowed(role) { return role === 'admin' || role === 'user'; }\n" },
    runChecks: true,
    verify(report) {
      const assessment = report.assessments[0];
      return report.checks.length === 1
        && report.checks[0]?.status === "passed"
        && assessment?.status === "partially-verified"
        && assessment.relatedTests.includes("test/access.test.js")
        && assessment.executedTests.length === 0;
    }
  },
  {
    id: "targeted-verification-failure",
    purpose: "A related test that executes and fails produces verification-failed evidence.",
    files: {
      "package.json": JSON.stringify({ name: "failure-control", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
      "src/tax.js": "export function tax(total) { return total * 0.2; }\n",
      "test/tax.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { tax } from '../src/tax.js'; test('tax', () => assert.equal(tax(100), 20));\n"
    },
    changes: { "src/tax.js": "export function tax(total) { return total * 0.02; }\n" },
    runChecks: true,
    verify(report) {
      const assessment = report.assessments[0];
      const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
      return assessment?.status === "verification-failed" && targeted?.status === "failed";
    }
  },
  {
    id: "unsupported-ambiguous-file",
    purpose: "An unsupported file remains unknown and is not forced into a binary relationship judgment.",
    files: { "policy/access.rego": "package access\ndefault allow := false\n" },
    changes: { "policy/access.rego": "package access\ndefault allow := true\n" },
    runChecks: false,
    verify(report) {
      const assessment = report.assessments[0];
      return assessment?.file.language === "unknown"
        && assessment.status === "unknown"
        && assessment.relatedTests.length === 0
        && report.trust.repositoryCodeExecuted === false;
    }
  }
];

const options = parseArgs(process.argv.slice(2));
const proofdiffRoot = path.resolve(options.proofdiffRoot ?? projectRoot);
const outputPath = path.resolve(options.output ?? path.join(projectRoot, "evaluation", "controlled-results.json"));
const candidateCommit = git(proofdiffRoot, "rev-parse", "HEAD").trim();
const { analyzeRepository, VERSION } = await import(pathToFileURL(path.join(proofdiffRoot, "dist", "analyze.js")).href);
const results = [];

for (const control of controls) {
  const root = await initialize(control.files, control.changes);
  try {
    const report = await analyzeRepository({
      repo: root,
      runChecks: control.runChecks,
      timeoutMs: 20_000,
      now: () => new Date("2000-01-01T00:00:00.000Z")
    });
    const passed = control.verify(report);
    if (!passed) throw new Error(`Controlled evaluation invariant failed: ${control.id}\n${JSON.stringify(report, null, 2)}`);
    const assessment = report.assessments[0];
    results.push({
      id: control.id,
      purpose: control.purpose,
      verdict: "passed",
      observed: {
        status: assessment?.status ?? "missing",
        language: assessment?.file.language ?? "missing",
        relatedTests: assessment?.relatedTests ?? [],
        executedTests: assessment?.executedTests ?? [],
        checkStatuses: Object.fromEntries(report.checks.map((check) => [check.id, check.status])),
        repositoryCodeExecuted: report.trust.repositoryCodeExecuted
      }
    });
    process.stdout.write(`Controlled case passed: ${control.id}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const output = {
  schemaVersion: "1.0",
  generatedAt: "2000-01-01T00:00:00.000Z",
  proofdiff: { commit: candidateCommit, version: VERSION },
  cases: results
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${results.length} controlled observations to ${path.relative(projectRoot, outputPath)}\n`);
