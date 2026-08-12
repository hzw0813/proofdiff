import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { initializeRepository, writeFiles } from "./helpers.js";

const baseline = {
  "package.json": JSON.stringify({ name: "fixture", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
  "src/math.js": "export function add(a, b) { return a + b; }\n",
  "test/math.test.js": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.js";\ntest("add", () => assert.equal(add(1, 2), 3));\n`,
};

test("static-only analysis is useful and does not claim verification", async (context) => {
  const root = await initializeRepository(baseline);
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/math.js": "export function add(a, b) { return Number(a) + Number(b); }\n" });
  const report = await analyzeRepository({ repo: root, now: () => new Date("2026-01-01T00:00:00Z") });
  assert.equal(report.summary.filesChanged, 1);
  assert.equal(report.assessments[0]?.status, "unknown");
  assert.equal(report.assessments[0]?.changedSymbols[0]?.name, "add");
  assert.deepEqual(report.assessments[0]?.changedCalls, [{ name: "Number", line: 1, confidence: "high" }]);
  assert.match(report.assessments[0]?.evidence.find((item) => item.label.includes("call reference"))?.detail ?? "", /Targets are not resolved and runtime execution is not implied/);
  assert.deepEqual(report.assessments[0]?.relatedTests, ["test/math.test.js"]);
  assert.equal(report.trust.repositoryCodeExecuted, false);
  assert.equal(report.checks[0]?.status, "not-run");
});

test("passing related test evidence produces a qualified verified status", async (context) => {
  const root = await initializeRepository(baseline);
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/math.js": "export function add(a, b) { return a + b + 0; }\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.checks[0]?.status, "passed", report.checks[0]?.output);
  assert.ok(report.checks.some((check) => check.id.endsWith(":targeted") && check.status === "passed"));
  assert.equal(report.assessments[0]?.status, "verified");
  assert.equal(report.summary.overallStatus, "verified");
  assert.deepEqual(report.assessments[0]?.executedTests, ["test/math.test.js"]);
  assert.deepEqual(report.assessments[0]?.testExecutions.map((execution) => [execution.path, execution.status]), [["test/math.test.js", "passed"]]);
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "executed-test")?.detail ?? "", /not runtime line or branch coverage/);
});

test("failing verification cannot be mistaken for success", async (context) => {
  const root = await initializeRepository(baseline);
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/math.js": "export function add(a, b) { return a - b; }\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.checks[0]?.status, "failed");
  assert.equal(report.assessments[0]?.status, "verification-failed");
  assert.equal(report.summary.overallStatus, "verification-failed");
  assert.ok(report.assessments[0]?.riskScore! >= 80);
  assert.deepEqual(report.assessments[0]?.testExecutions.map((execution) => [execution.path, execution.status]), [["test/math.test.js", "failed"]]);
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "failing-check" && item.checkId?.endsWith(":targeted"))?.detail ?? "", /explicitly supplied/);
});

test("Python unittest repositories receive AST-backed related evidence", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "import unittest\nfrom value import value\n\nclass ValueTest(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(value(), 2)\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.checks[0]?.id, "python:test:unittest");
  assert.equal(report.checks[0]?.status, "passed", report.checks[0]?.output);
  assert.equal(report.assessments[0]?.changedSymbols[0]?.name, "value");
  assert.deepEqual(report.assessments[0]?.relatedTests, ["tests/test_value.py"]);
  assert.deepEqual(report.assessments[0]?.executedTests, ["tests/test_value.py"]);
  assert.deepEqual(report.assessments[0]?.testExecutions.map((execution) => execution.status), ["passed"]);
  assert.equal(report.assessments[0]?.status, "verified");
});

test("a passing filtered test script cannot imply that an unexecuted related test passed", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "filtered", private: true, type: "module", scripts: { test: "node --test test/unrelated.test.js" } }, null, 2),
    "src/math.js": "export function add(a, b) { return a + b; }\n",
    "test/math.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { add } from '../src/math.js'; test('add', () => assert.equal(add(1, 2), 3));\n",
    "test/unrelated.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; test('unrelated', () => assert.equal(1, 1));\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/math.js": "export function add(a, b) { return a - b; }\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.status, "passed");
  assert.equal(report.assessments[0]?.status, "partially-verified");
  assert.deepEqual(report.assessments[0]?.relatedTests, ["test/math.test.js"]);
  assert.deepEqual(report.assessments[0]?.executedTests, []);
  assert.deepEqual(report.assessments[0]?.testExecutions, []);
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "passing-check")?.detail ?? "", /did not observe/);
});
