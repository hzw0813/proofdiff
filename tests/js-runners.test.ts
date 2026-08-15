import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { discoverChecks, runChecks } from "../src/checks.js";
import { targetedJsFrameworkChecks } from "../src/js-runners.js";
import { initializeRepository } from "./helpers.js";

const JEST_BIN = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const start = args.indexOf("--runTestsByPath") + 1;
const end = args.indexOf("--json");
const targets = args.slice(start, end);
const output = args.find((item) => item.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (!output) process.exit(2);
fs.writeFileSync(output, JSON.stringify({
  success: true,
  testResults: targets.map((target) => ({
    name: path.resolve(target),
    status: "passed",
    assertionResults: [{ status: "passed" }],
  })),
}));
`;

const VITEST_BIN = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const start = args[0] === "run" ? 1 : 0;
const end = args.indexOf("--reporter=json");
const targets = args.slice(start, end);
const output = args.find((item) => item.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (!output) process.exit(2);
fs.writeFileSync(output, JSON.stringify({
  success: true,
  testResults: targets.map((target) => ({
    name: path.resolve(target),
    status: "passed",
    assertionResults: [{ status: "passed" }, { status: "pending" }],
  })),
}));
`;

test("recognized Jest root scripts produce exact per-target pass observations", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "jest" } }),
    "test/discount.test.js": "export const discount = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": JEST_BIN,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/discount.test.js"]);
  assert.equal(targeted.checks.length, 1);
  assert.equal(targeted.checks[0]?.targetRunner, "jest");
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["test/discount.test.js"]);
  assert.equal(targeted.checks[0]?.targetQualifications?.[0]?.basis, "runner-explicit-path");

  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "passed");
  assert.equal(result?.targetObservations?.[0]?.testsObserved, 1);
});

test("recognized Vitest root scripts produce exact per-target pass observations", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "src/value.test.ts": "export const value = true;\n",
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": VITEST_BIN,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["src/value.test.ts"]);
  assert.equal(targeted.checks.length, 1);
  assert.equal(targeted.checks[0]?.targetRunner, "vitest");

  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "passed");
  assert.equal(result?.targetObservations?.[0]?.testsObserved, 1);
  assert.match(result?.targetObservations?.[0]?.detail ?? "", /1 passed, 0 failed, and 1 skipped/);
});

test("literal environment prefixes are preserved for targeted Jest execution", async (context) => {
  const envAwareJest = String.raw`
if (process.env.NODE_ENV !== "test" || process.env.CI !== "1") process.exit(7);
` + JEST_BIN;
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "NODE_ENV=test CI=1 jest --ci" } }),
    "test/env.test.js": "export const env = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": envAwareJest,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/env.test.js"]);
  assert.equal(targeted.checks.length, 1);
  assert.equal(targeted.checks[0]?.targetRunner, "jest");
  assert.deepEqual(targeted.checks[0]?.targetRunnerArgs, ["--ci"]);
  assert.match(targeted.checks[0]?.origin ?? "", /CI, NODE_ENV/);

  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "passed");
});

test("sensitive environment prefixes remain supported but are explicitly qualified without exposing values", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "Path=/tmp/proofdiff-bin NODE_OPTIONS=--no-warnings LD_PRELOAD=/tmp/libproofdiff.so DYLD_LIBRARY_PATH=/tmp/dyld jest" } }),
    "test/env.test.js": "export const env = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": JEST_BIN,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/env.test.js"]);
  assert.equal(targeted.checks.length, 1);
  const origin = targeted.checks[0]?.origin ?? "";
  assert.match(origin, /warning: sensitive environment prefixes propagated: DYLD_LIBRARY_PATH, LD_PRELOAD, NODE_OPTIONS, Path/);
  assert.doesNotMatch(origin, /proofdiff-bin|no-warnings|libproofdiff|\/tmp\/dyld/);
});

test("bounded cross-env prefixes are normalized only when cross-env is locally installed", async (context) => {
  const envAwareVitest = String.raw`
if (process.env.NODE_ENV !== "test") process.exit(7);
` + VITEST_BIN;
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "cross-env NODE_ENV=test vitest run" } }),
    "src/env.test.ts": "export const env = true;\n",
    "node_modules/cross-env/package.json": JSON.stringify({ name: "cross-env", version: "1.0.0" }),
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": envAwareVitest,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["src/env.test.ts"]);
  assert.equal(targeted.checks.length, 1);
  assert.equal(targeted.checks[0]?.targetRunner, "vitest");
  assert.match(targeted.checks[0]?.origin ?? "", /bounded cross-env wrapper recognized/);

  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "passed");
});

test("cross-env command shapes stay opaque when the wrapper is not locally installed", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "cross-env NODE_ENV=test jest" } }),
    "test/value.test.js": "export const value = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": JEST_BIN,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/value.test.js"]);
  assert.deepEqual(targeted.checks, []);
});

test("multiline Jest and Vitest scripts stay opaque instead of being re-tokenized", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: {
      test: "vitest\nrun",
      "test:unit": "cross-env NODE_ENV=test\njest",
    } }),
    "test/value.test.js": "export const value = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": JEST_BIN,
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": VITEST_BIN,
    "node_modules/cross-env/package.json": JSON.stringify({ name: "cross-env", version: "1.0.0" }),
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/value.test.js"]);
  assert.deepEqual(targeted.checks, []);
});

test("custom Jest or Vitest command shapes stay opaque instead of inventing target evidence", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "jest --config custom.js", "test:unit": "vitest --config custom.ts" } }),
    "test/value.test.js": "export const value = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": JEST_BIN,
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": VITEST_BIN,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/value.test.js"]);
  assert.deepEqual(targeted.checks, []);
});

test("unsafe Jest and Vitest script shapes are individually exercised and stay opaque", async (context) => {
  const cases = [
    { label: "unsupported Jest flag", script: "jest --coverage" },
    { label: "command substitution", script: "FOO=$(command) jest" },
    { label: "command chain", script: "NODE_ENV=test jest && eslint ." },
    { label: "dotenv wrapper", script: "dotenv -e .env -- vitest run" },
    { label: "concurrently wrapper", script: "concurrently jest vitest" },
    { label: "cross-env-shell wrapper", script: "cross-env-shell NODE_ENV=test jest" },
    { label: "too many environment assignments", script: "A=1 B=2 C=3 D=4 E=5 jest" },
    { label: "duplicate environment assignment", script: "CI=1 CI=true jest" },
    { label: "non-ASCII whitespace", script: "jest\u00a0--ci" },
  ];

  for (const { label, script } of cases) {
    const root = await initializeRepository({
      "package.json": JSON.stringify({ scripts: { test: script } }),
      "test/value.test.js": "export const value = true;\n",
      "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
      "node_modules/jest/bin/jest.cjs": JEST_BIN,
      "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
      "node_modules/vitest/vitest.cjs": VITEST_BIN,
      "node_modules/cross-env/package.json": JSON.stringify({ name: "cross-env", version: "1.0.0" }),
    });
    context.after(() => rm(root, { recursive: true, force: true }));

    const discovery = await discoverChecks(root);
    const discoveredJsTests = discovery.checks.filter((check) => check.id.startsWith("js:test:"));
    assert.equal(discoveredJsTests.length, 1, `${label}: adversarial script must be discovered as a test check`);
    assert.equal(discoveredJsTests[0]?.id, "js:test:test", `${label}: parser must receive the recognized test script`);

    const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["test/value.test.js"]);
    assert.deepEqual(targeted.checks, [], `${label}: unsafe command shape must remain opaque`);
  }
});

test("a runner JSON report with no exact suite result cannot strengthen evidence", async (context) => {
  const emptyJest = String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args.find((item) => item.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (!output) process.exit(2);
fs.writeFileSync(output, JSON.stringify({ success: true, testResults: [] }));
`;
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "jest --ci" } }),
    "tests/fixtures/helper.js": "export const helper = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": emptyJest,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["tests/fixtures/helper.js"]);
  assert.equal(targeted.checks.length, 1);
  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "not-observed");
});

function duplicateRunner(results: string, exitCode = 0): string {
  return String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const start = args[0] === "run" ? 1 : args.indexOf("--runTestsByPath") + 1;
const reporterIndex = args.indexOf("--reporter=json");
const jsonIndex = args.indexOf("--json");
const end = reporterIndex >= 0 ? reporterIndex : jsonIndex;
const target = args.slice(start, end)[0];
const output = args.find((item) => item.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (!target || !output) process.exit(2);
const name = path.resolve(target);
fs.writeFileSync(output, JSON.stringify({ success: ${exitCode === 0 ? "true" : "false"}, testResults: ${results} }));
process.exitCode = ${exitCode};
`;
}

async function runDuplicateTarget(root: string) {
  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["src/value.test.ts"]);
  assert.equal(targeted.checks.length, 1);
  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.ok(result);
  return result;
}

test("Vitest duplicate exact-path suites are aggregated for multi-project output", async (context) => {
  const runner = duplicateRunner(`[
    { name, status: "passed", assertionResults: [{ status: "passed" }] },
    { name, status: "passed", assertionResults: [{ status: "passed" }, { status: "pending" }] }
  ]`);
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "src/value.test.ts": "export const value = true;\n",
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": runner,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await runDuplicateTarget(root);
  assert.equal(result.status, "passed");
  assert.equal(result.targetObservations?.[0]?.outcome, "passed");
  assert.equal(result.targetObservations?.[0]?.testsObserved, 2);
  assert.match(result.targetObservations?.[0]?.detail ?? "", /2 passed, 0 failed, and 1 skipped/);
});

test("a failing Vitest duplicate suite makes the exact target fail", async (context) => {
  const runner = duplicateRunner(`[
    { name, status: "passed", assertionResults: [{ status: "passed" }] },
    { name, status: "failed", assertionResults: [{ status: "failed" }] }
  ]`, 1);
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "src/value.test.ts": "export const value = true;\n",
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": runner,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await runDuplicateTarget(root);
  assert.equal(result.status, "failed");
  assert.equal(result.targetObservations?.[0]?.outcome, "failed");
  assert.equal(result.targetObservations?.[0]?.testsObserved, 2);
});

test("a malformed Vitest duplicate suite still fails closed", async (context) => {
  const runner = duplicateRunner(`[
    { name, status: "passed", assertionResults: [{ status: "passed" }] },
    { name, status: "passed", assertionResults: [{ status: "unknown-status" }] }
  ]`);
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    "src/value.test.ts": "export const value = true;\n",
    "node_modules/vitest/package.json": JSON.stringify({ bin: { vitest: "./vitest.cjs" } }),
    "node_modules/vitest/vitest.cjs": runner,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await runDuplicateTarget(root);
  assert.equal(result.status, "passed");
  assert.equal(result.targetObservations?.[0]?.outcome, "not-observed");
  assert.equal(result.targetObservations?.[0]?.testsObserved, 0);
});

test("Jest duplicate exact-path suites remain fail-closed", async (context) => {
  const runner = duplicateRunner(`[
    { name, status: "passed", assertionResults: [{ status: "passed" }] },
    { name, status: "passed", assertionResults: [{ status: "passed" }] }
  ]`);
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "jest" } }),
    "src/value.test.ts": "export const value = true;\n",
    "node_modules/jest/package.json": JSON.stringify({ bin: { jest: "./bin/jest.cjs" } }),
    "node_modules/jest/bin/jest.cjs": runner,
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await runDuplicateTarget(root);
  assert.equal(result.status, "passed");
  assert.equal(result.targetObservations?.[0]?.outcome, "not-observed");
});
