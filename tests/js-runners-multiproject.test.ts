import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { discoverChecks, runChecks } from "../src/checks.js";
import { targetedJsFrameworkChecks } from "../src/js-runners.js";
import { initializeRepository } from "./helpers.js";

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

async function runTargeted(root: string): Promise<Awaited<ReturnType<typeof runChecks>>[number]> {
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

  const result = await runTargeted(root);
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

  const result = await runTargeted(root);
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

  const result = await runTargeted(root);
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

  const discovery = await discoverChecks(root);
  const targeted = await targetedJsFrameworkChecks(root, discovery.checks, ["src/value.test.ts"]);
  assert.equal(targeted.checks.length, 1);
  const [result] = await runChecks(root, targeted.checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.targetObservations?.[0]?.outcome, "not-observed");
});
