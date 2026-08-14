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
