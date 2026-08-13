import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { renderGithubSummary } from "../src/report/github.js";
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
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "executed-test")?.detail ?? "", /not changed-symbol, changed-line, branch, assertion, or behavioral coverage/);
  assert.match(report.assessments[0]?.limitations.find((item) => item.includes("did not observe whether changed symbols")) ?? "", /did not observe whether changed symbols, lines, branches, or relevant assertions executed/);
});

test("a passing related test file does not claim that the changed symbol executed", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "symbol-boundary", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
    "src/math.js": "export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\n",
    "test/math.test.js": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.js";\ntest("add", () => assert.equal(add(2, 3), 5));\n`,
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/math.js": "export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a + b; }\n" });

  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const assessment = report.assessments[0];
  assert.equal(assessment?.status, "verified");
  assert.equal(report.summary.overallStatus, "verified");
  assert.deepEqual(assessment?.changedSymbols.map((symbol) => symbol.name), ["subtract"]);
  assert.deepEqual(assessment?.relatedTests, ["test/math.test.js"]);
  assert.deepEqual(assessment?.executedTests, ["test/math.test.js"]);
  assert.match(report.checks.find((check) => check.id.endsWith(":targeted"))?.output ?? "", /add/);
  assert.match(assessment?.evidence.find((item) => item.kind === "executed-test")?.detail ?? "", /not changed-symbol/);
  assert.match(assessment?.limitations.find((item) => item.includes("did not observe whether changed symbols")) ?? "", /did not observe whether changed symbols/);
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

test("a directory-only helper remains related but cannot become runner-qualified evidence", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "helper-boundary", private: true, type: "module", scripts: { test: "node --test" } }),
    "src/value.js": "export const value = 1;\n",
    "tests/fixtures/helper.js": "import { value } from '../../src/value.js';\nexport const fixture = value;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const assessment = report.assessments[0];
  assert.deepEqual(assessment?.relatedTests, ["tests/fixtures/helper.js"]);
  assert.deepEqual(assessment?.executedTests, []);
  assert.equal(assessment?.status, "partially-verified");
  assert.ok(!report.checks.some((check) => check.id.endsWith(":targeted")));
  assert.match(assessment?.limitations.join("\n") ?? "", /not qualified/);
});

test("test-like relationship discovery remains bounded separately from the 250-file impact display", async (context) => {
  const generated = Object.fromEntries(Array.from({ length: 260 }, (_, index) => [`src/generated/dependent-${String(index).padStart(3, "0")}.js`, "import { value } from '../value.js'; export const observed = value;\n"]));
  const root = await initializeRepository({
    "src/value.js": "export const value = 1;\n",
    ...generated,
    "src/z-names.js": "export { value } from './value.js';\n",
    "src/testRunner/unittests/custom.js": "import { value } from '../../z-names.js'; export const observed = value;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });
  const report = await analyzeRepository({ repo: root });
  const assessment = report.assessments[0];
  assert.equal(assessment?.impactedFiles.length, 250);
  assert.match(assessment?.limitations.join("\n") ?? "", /Impact traversal stopped at 250/);
  assert.deepEqual(assessment?.relatedTests, ["src/testRunner/unittests/custom.js"]);
});

test("root test.js and an explicit custom Node path can independently establish identity", async (context) => {
  const rootDefault = await initializeRepository({
    "package.json": JSON.stringify({ name: "root-test", private: true, type: "module", scripts: { test: "node --test" } }),
    "src/value.js": "export const value = 1;\n",
    "test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from './src/value.js'; test('value', () => assert.equal(value, 2));\n",
  });
  const rootCustom = await initializeRepository({
    "package.json": JSON.stringify({ name: "custom-test", private: true, type: "module", scripts: { test: "node --test quality/check.js" } }),
    "src/value.js": "export const value = 1;\n",
    "quality/check.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value, 2));\n",
  });
  context.after(() => Promise.all([rm(rootDefault, { recursive: true, force: true }), rm(rootCustom, { recursive: true, force: true })]));
  await writeFiles(rootDefault, { "src/value.js": "export const value = 2;\n" });
  await writeFiles(rootCustom, { "src/value.js": "export const value = 2;\n" });
  const defaultReport = await analyzeRepository({ repo: rootDefault, runChecks: true, timeoutMs: 20_000 });
  const customReport = await analyzeRepository({ repo: rootCustom, runChecks: true, timeoutMs: 20_000 });
  assert.equal(defaultReport.assessments[0]?.status, "verified");
  assert.deepEqual(defaultReport.assessments[0]?.relatedTests, ["test.js"]);
  assert.equal(customReport.assessments[0]?.status, "verified");
  assert.deepEqual(customReport.assessments[0]?.relatedTests, ["quality/check.js"]);
  assert.equal(customReport.checks.find((check) => check.id.endsWith(":targeted"))?.targetQualifications?.[0]?.basis, "runner-explicit-path");
});

test("Node zero-test, name-filtered, and all-skipped targets never produce executedTests", async (context) => {
  const fixtures = [
    {
      script: "node --test",
      file: "test/empty.test.js",
      content: "import { value } from '../src/value.js'; export const observed = value;\n",
      outcome: "zero-tests",
    },
    {
      script: "node --test --test-name-pattern=missing",
      file: "test/value.test.js",
      content: "import test from 'node:test'; import { value } from '../src/value.js'; test('value', () => void value);\n",
      outcome: "zero-tests",
    },
    {
      script: "node --test",
      file: "test/value.test.js",
      content: "import test from 'node:test'; import { value } from '../src/value.js'; test.skip('value', () => void value);\n",
      outcome: "skipped",
    },
  ] as const;
  for (const fixture of fixtures) {
    const root = await initializeRepository({
      "package.json": JSON.stringify({ name: "node-zero", private: true, type: "module", scripts: { test: fixture.script } }),
      "src/value.js": "export const value = 1;\n",
      [fixture.file]: fixture.content,
    });
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFiles(root, { "src/value.js": "export const value = 2;\n" });
    const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
    const assessment = report.assessments[0];
    const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
    assert.deepEqual(assessment?.executedTests, [], fixture.outcome);
    assert.equal(assessment?.status, "partially-verified", fixture.outcome);
    assert.equal(targeted?.status, "passed", fixture.outcome);
    assert.equal(targeted?.targetObservations?.[0]?.outcome, fixture.outcome);
    assert.ok(!assessment?.evidence.some((item) => item.kind === "failing-check"), fixture.outcome);
  }
});

test("a zero-test unittest target is unverified instead of verification-failed", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "import unittest\nfrom value import value\nobserved = value()\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.deepEqual(report.assessments[0]?.executedTests, []);
  assert.equal(report.assessments[0]?.status, report.checks[0]?.status === "passed" ? "partially-verified" : "unverified");
  assert.equal(report.checks.find((check) => check.id.endsWith(":targeted"))?.targetObservations?.[0]?.outcome, "zero-tests");
  assert.ok(!report.assessments[0]?.evidence.some((item) => item.kind === "failing-check"));
});

test("the fixed pytest observer attributes a configured custom target", async (context) => {
  const root = await initializeRepository({
    "pyproject.toml": "[tool.pytest]\npython_files = [\"check_*.py\"]\n",
    "value.py": "def value():\n    return 1\n",
    "quality/check_value.py": "from value import value\ndef check_value():\n    assert value() == 2\n",
    "pytest.py": [
      "from types import SimpleNamespace",
      "def main(args=None, plugins=None):",
      "    target = args[-1]",
      "    report = SimpleNamespace(nodeid=target + '::check_value', when='call', passed=True, failed=False, skipped=False)",
      "    plugins[0].pytest_runtest_logreport(report)",
      "    return 0",
      "",
    ].join("\n"),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.assessments.find((item) => item.file.path === "value.py")?.status, "verified");
  const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
  assert.equal(targeted?.targetQualifications?.[0]?.basis, "runner-config-pattern");
  assert.deepEqual(targeted?.targetObservations?.map((item) => [item.path, item.outcome, item.testsObserved]), [["quality/check_value.py", "passed", 1]]);
});

test("a pytest collection failure without an attributable test failure fails closed", async (context) => {
  const root = await initializeRepository({
    "pyproject.toml": "[tool.pytest]\n",
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "from value import value\n",
    "pytest.py": "def main(args=None, plugins=None):\n    return 2\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
  assert.equal(targeted?.status, "failed");
  assert.equal(targeted?.exitCode, 2);
  assert.equal(targeted?.targetObservations?.[0]?.outcome, "not-observed");
  assert.equal(report.assessments[0]?.status, "verification-failed");
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "failing-check" && item.checkId === targeted.id)?.detail ?? "", /did not reliably attribute.*failed closed/);
});

test("pytest exit 5 remains a non-failing no-collection outcome", async (context) => {
  const root = await initializeRepository({
    "pyproject.toml": "[tool.pytest]\n",
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "from value import value\n",
    "pytest.py": "def main(args=None, plugins=None):\n    return 5\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
  assert.equal(targeted?.status, "failed");
  assert.equal(targeted?.exitCode, 5);
  assert.equal(targeted?.targetObservations?.[0]?.outcome, "zero-tests");
  assert.equal(report.assessments[0]?.status, "partially-verified");
  assert.ok(!report.assessments[0]?.evidence.some((item) => item.kind === "failing-check"));
});

test("a unittest loader failure without an attributable test failure fails closed", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "import unittest\nimport missing_dependency\nfrom value import value\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
  assert.equal(targeted?.status, "failed");
  assert.equal(targeted?.exitCode, 1);
  assert.equal(targeted?.targetObservations?.[0]?.outcome, "not-observed");
  assert.equal(report.assessments[0]?.status, "verification-failed");
  assert.match(report.assessments[0]?.evidence.find((item) => item.kind === "failing-check" && item.checkId === targeted.id)?.detail ?? "", /did not reliably attribute.*failed closed/);
});

test("unittest subtest failures remain exact target failures", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\n    return 1\n",
    "tests/test_value.py": "import unittest\nfrom value import value\nclass ValueTest(unittest.TestCase):\n    def test_values(self):\n        with self.subTest(case='value'):\n            self.assertEqual(value(), 1)\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\n    return 2\n" });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.equal(report.assessments[0]?.status, "verification-failed");
  assert.equal(report.checks.find((check) => check.id.endsWith(":targeted"))?.targetObservations?.[0]?.outcome, "failed");
});

test("a partially localized targeted batch fails closed for an ambiguous related target", async (context) => {
  const root = await initializeRepository({
    "pyproject.toml": "[tool.pytest]\n",
    "value.py": "def value():\n    return 1\n",
    "other.py": "def other():\n    return 1\n",
    "tests/test_pass.py": "from value import value\ndef test_pass():\n    assert value() == 2\n",
    "tests/test_import.py": "import missing_dependency\nfrom value import value\n",
    "tests/test_fail.py": "from other import other\ndef test_fail():\n    assert other() == 1\n",
    "pytest.py": [
      "import runpy",
      "from types import SimpleNamespace",
      "def main(args=None, plugins=None):",
      "    observer = plugins[0]",
      "    for target in args:",
      "        if target.endswith('test_pass.py'):",
      "            observer.pytest_runtest_logreport(SimpleNamespace(nodeid=target + '::test_pass', when='call', passed=True, failed=False, skipped=False))",
      "        elif target.endswith('test_fail.py'):",
      "            observer.pytest_runtest_logreport(SimpleNamespace(nodeid=target + '::test_fail', when='call', passed=False, failed=True, skipped=False))",
      "    runpy.run_path(next(target for target in args if target.endswith('test_import.py')))",
      "",
    ].join("\n"),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "value.py": "def value():\n    return 2\n",
    "other.py": "def other():\n    return 2\n",
  });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const targeted = report.checks.find((check) => check.id.endsWith(":targeted"));
  const assessment = report.assessments.find((item) => item.file.path === "value.py");
  assert.equal(targeted?.status, "failed");
  assert.match(targeted?.output ?? "", /missing_dependency|ModuleNotFoundError/);
  assert.deepEqual(targeted?.targetObservations?.map((item) => [item.path, item.outcome]), [
    ["tests/test_fail.py", "failed"],
    ["tests/test_import.py", "not-observed"],
    ["tests/test_pass.py", "passed"],
  ]);
  assert.equal(assessment?.status, "verification-failed");
  assert.ok(assessment?.evidence.some((item) => item.kind === "failing-check" && item.checkId === targeted.id));
  assert.ok(assessment);
  const valueReport = structuredClone(report);
  valueReport.assessments = [assessment];
  valueReport.summary.filesChanged = 1;
  valueReport.summary.counts = { verified: 0, "partially-verified": 0, unverified: 0, unknown: 0, "verification-failed": 1 };
  const valueSummary = renderGithubSummary(valueReport);
  assert.match(valueSummary, /failed without complete attribution/);
  assert.match(valueSummary, /tests\/test_import\.py: not-observed/);
  assert.match(valueSummary, /Independently passing target: <code>tests\/test_pass\.py<\/code>/);
  assert.doesNotMatch(valueSummary, /Attributed failed target: <code>tests\/test_pass\.py/);
});

test("mixed targeted batches attribute pass, zero, and failure to exact paths", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "mixed-batch", private: true, type: "module", scripts: { test: "node --test" } }),
    "src/pass.js": "export const value = 1;\n",
    "src/empty.js": "export const value = 1;\n",
    "src/fail.js": "export const value = 1;\n",
    "test/pass.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/pass.js'; test('pass', () => assert.equal(value, 2));\n",
    "test/empty.test.js": "import { value } from '../src/empty.js'; export const observed = value;\n",
    "test/fail.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/fail.js'; test('fail', () => assert.equal(value, 1));\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "src/pass.js": "export const value = 2;\n",
    "src/empty.js": "export const value = 2;\n",
    "src/fail.js": "export const value = 2;\n",
  });
  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const byPath = new Map(report.assessments.map((item) => [item.file.path, item]));
  assert.equal(byPath.get("src/pass.js")?.status, "verified");
  assert.deepEqual(byPath.get("src/pass.js")?.executedTests, ["test/pass.test.js"]);
  assert.ok(!byPath.get("src/pass.js")?.evidence.some((item) => item.kind === "failing-check"));
  assert.equal(byPath.get("src/empty.js")?.status, "unverified");
  assert.deepEqual(byPath.get("src/empty.js")?.executedTests, []);
  assert.ok(!byPath.get("src/empty.js")?.evidence.some((item) => item.kind === "failing-check"));
  assert.equal(byPath.get("src/fail.js")?.status, "verification-failed");
  assert.deepEqual(report.checks.find((check) => check.id.endsWith(":targeted"))?.targetObservations?.map((item) => [item.path, item.outcome]), [
    ["test/empty.test.js", "zero-tests"],
    ["test/fail.test.js", "failed"],
    ["test/pass.test.js", "passed"],
  ]);
});

test("GitHub summary categorizes malformed compiler configuration before suggesting runtime evidence", async (context) => {
  const root = await initializeRepository({
    "tsconfig.json": '{"compilerOptions":{"paths":{"@value":["./src/value.ts"]}},"secret":SUPER_SECRET_12345}',
    "src/value.ts": "export const value = 1;\n",
    "test/value.test.ts": "import { value } from '@value'; export const observed = value;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.ts": "export const value = 2;\n" });
  const report = await analyzeRepository({ repo: root });
  assert.ok(report.notes.some((note) => /malformed compiler configuration was rejected/.test(note)));
  const summary = renderGithubSummary(report);
  assert.match(summary, /Compiler configuration could not be parsed; static alias resolution was unavailable/);
  assert.match(summary, /Inspect and, where appropriate, fix the static-analysis limitation/);
  assert.doesNotMatch(summary, /SUPER_SECRET|malformed compiler configuration was rejected|`run-checks: true`/);
});

test("working-tree analysis warns without hiding Git-visible generated files", async (context) => {
  const root = await initializeRepository({ "README.md": "# fixture\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "node_modules/example/index.js": "export const generated = true;\n" });
  const report = await analyzeRepository({ repo: root });
  assert.deepEqual(report.assessments.map((item) => item.file.path), ["node_modules/example/index.js"]);
  assert.match(report.notes.join("\n"), /Git-visible untracked file.*node_modules\/.*did not hide/);
});
