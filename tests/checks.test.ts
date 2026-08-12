import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { discoverChecks, packageManagerInvocation, parseTargetObservations, runChecks, targetedTestChecks } from "../src/checks.js";
import { initializeRepository } from "./helpers.js";

test("repository scripts are discovered but execution is a separate operation", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node -e \"console.log('ok')\"", postinstall: "exit 99", deploy: "exit 98" } }) });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks.map((check) => check.id), ["js:test:test"]);
  assert.ok(checks.every((check) => check.executesRepositoryCode));
  assert.deepEqual(packageManagerInvocation("npm", ["run", "test", "--silent"], "linux"), { command: "npm", args: ["run", "test", "--silent"] });
  assert.deepEqual(packageManagerInvocation("npm", ["run", "test", "--silent"], "win32"), { command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd", "run", "test", "--silent"] });
  assert.deepEqual(packageManagerInvocation("bun", ["run", "test"], "win32"), { command: "bun", args: ["run", "test"] });
});

test("check output redacts common secret formats", async (context) => {
  const command = "node -e \"console.log('API_TOKEN=super-sensitive-value');console.log('api_token=lowercase-secret-value');console.log('Authorization: Basic dXNlcjpjb3JyZWN0LWhvcnNl');console.log('https://alice:correct-horse@example.test/path');console.log('trailing   ')\"";
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: command } }) });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.doesNotMatch(result?.output ?? "", /super-sensitive-value/);
  assert.doesNotMatch(result?.output ?? "", /lowercase-secret-value|dXNlcjpjb3JyZWN0LWhvcnNl|correct-horse/);
  assert.doesNotMatch(result?.output ?? "", /[ \t]+$/m);
  assert.match(result?.output ?? "", /REDACTED/);
});

test("check output redacts provider tokens, JWTs, and private keys", async (context) => {
  const emitted = [
    ["ghp_", "abcdefghijklmnop1234567890"].join(""),
    ["npm_", "abcdefghijklmnop1234567890"].join(""),
    ["xoxb-", "123456789012-abcdefghijkl"].join(""),
    ["AKIA", "1234567890ABCDEF"].join(""),
    ["eyJabcdefghijk", "abcdefghijklmnop", "qrstuvwxyz1234"].join("."),
    ["-----BEGIN PRIVATE", " KEY-----\nprivate-material\n-----END PRIVATE KEY-----"].join(""),
  ];
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node emit.js" } }),
    "emit.js": `console.log(${JSON.stringify(emitted)}.join("\\n"));\n`,
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.doesNotMatch(result?.output ?? "", /ghp_|npm_|xoxb-|AKIA|eyJabcdefghijk|private-material/);
  assert.match(result?.output ?? "", /REDACTED PRIVATE KEY/);
});

test("check output redacts native and file URL forms of the repository root", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node emit.js" } }),
    "emit.js": "const { pathToFileURL } = require('node:url'); console.log(process.cwd()); console.log(new URL('fixture.js', `${pathToFileURL(process.cwd()).href}/`).href);\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.doesNotMatch(result?.output ?? "", new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result?.output ?? "", /\[REPOSITORY\]/);
});

test("unknown check selection fails closed", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }) });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  await assert.rejects(runChecks(root, checks, { selected: ["deploy"], timeoutMs: 1_000, maxOutputBytes: 1_000 }), /Unknown check selection/);
});

test("a JavaScript tests directory does not invent a pytest check", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "tests/value.test.js": "export const value = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks.map((check) => check.id), ["js:test:test"]);
});

test("an explicit compiled Node test list maps related TypeScript tests without shell globs", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test --test-concurrency=1 dist-test/tests/value.test.js dist-test/tests/other.test.js" } }),
    "tests/value.test.ts": "export const value = true;\n",
    "dist-test/tests/value.test.js": "export const value = true;\n",
    "dist-test/tests/other.test.js": "export const other = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks[0]?.targetPatterns, ["dist-test/tests/value.test.js", "dist-test/tests/other.test.js"]);
  const targeted = await targetedTestChecks(root, checks, ["tests/value.test.ts"]);
  assert.equal(targeted.checks[0]?.args[0], "--test");
  assert.ok(targeted.checks[0]?.args.some((argument) => argument.startsWith("--test-reporter=data:")));
  assert.equal(targeted.checks[0]?.args.at(-1), "dist-test/tests/value.test.js");
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["tests/value.test.ts"]);
  assert.equal(targeted.checks[0]?.targetQualifications?.[0]?.basis, "compiled-source-map");
});

test("unsupported Node test options keep targeted execution disabled", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test --test-reporter=spec dist-test/tests/value.test.js" } }),
    "tests/value.test.ts": "export const value = true;\n",
    "dist-test/tests/value.test.js": "export const value = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.equal(checks[0]?.targetRunner, undefined);
  assert.deepEqual((await targetedTestChecks(root, checks, ["tests/value.test.ts"])).checks, []);
});

test("Node qualification separates documented defaults from directory-only helpers", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "test.js": "export const rootTest = true;\n",
    "test/helper.js": "export const singularDirectoryTarget = true;\n",
    "tests/fixtures/helper.js": "export const helper = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const targeted = await targetedTestChecks(root, checks, ["tests\\fixtures\\helper.js", "test\\helper.js", "test.js"]);
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["test.js", "test/helper.js"]);
  assert.ok(targeted.checks[0]?.targetQualifications?.every((item) => item.basis === "runner-default-pattern"));
  assert.ok(!targeted.checks[0]?.targetFiles?.includes("tests/fixtures/helper.js"));
});

test("an exact Node file list can qualify a custom convention", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test quality/check.js" } }),
    "quality/check.js": "export const custom = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const targeted = await targetedTestChecks(root, checks, ["quality/check.js"]);
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["quality/check.js"]);
  assert.equal(targeted.checks[0]?.targetQualifications?.[0]?.basis, "runner-explicit-path");
});

test("pytest configuration precedence and pytest 9 tables qualify custom file patterns", async (context) => {
  const root = await initializeRepository({
    "pyproject.toml": "[tool.pytest]\npython_files = [\"check_*.py\"]\n\n[tool.pytest.ini_options]\npython_files = [\"legacy_*.py\"]\n",
    "quality/check_value.py": "def check_value():\n    assert True\n",
    "quality/legacy_value.py": "def test_value():\n    assert True\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const pytest = checks.find((check) => check.targetRunner === "pytest");
  assert.deepEqual(pytest?.targetPatterns, ["check_*.py"]);
  assert.match(pytest?.origin ?? "", /pyproject\.toml \[tool\.pytest\]/);
  const targeted = await targetedTestChecks(root, checks, ["quality/check_value.py", "quality/legacy_value.py"]);
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["quality/check_value.py"]);
  assert.equal(targeted.checks[0]?.targetQualifications?.[0]?.basis, "runner-config-pattern");
});

test("pytest defaults and unittest defaults remain distinct", async (context) => {
  const pytestRoot = await initializeRepository({ "tests/test_value.py": "def test_value():\n    assert True\n", "tests/value_test.py": "def test_value():\n    assert True\n" });
  const unittestRoot = await initializeRepository({ "tests/test_value.py": "import unittest\nclass T(unittest.TestCase):\n    def test_value(self): self.assertTrue(True)\n", "tests/value_test.py": "import unittest\n" });
  context.after(() => Promise.all([rm(pytestRoot, { recursive: true, force: true }), rm(unittestRoot, { recursive: true, force: true })]));
  const pytestChecks = (await discoverChecks(pytestRoot)).checks;
  assert.deepEqual(pytestChecks.find((check) => check.targetRunner === "pytest")?.targetPatterns, ["test_*.py", "*_test.py"]);
  assert.deepEqual((await targetedTestChecks(pytestRoot, pytestChecks, ["tests/test_value.py", "tests/value_test.py"])).checks[0]?.targetFiles, ["tests/test_value.py", "tests/value_test.py"]);
  const unittestChecks = (await discoverChecks(unittestRoot)).checks;
  assert.deepEqual((await targetedTestChecks(unittestRoot, unittestChecks, ["tests/test_value.py", "tests/value_test.py"])).checks[0]?.targetFiles, ["tests/test_value.py"]);
});

test("type-only files do not become Node targets and Windows paths normalize safely", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "test/value.test.js": "export const value = true;\n",
    "test/types.test.d.ts": "export type Value = string;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const targeted = await targetedTestChecks(root, checks, ["test\\value.test.js", "test\\types.test.d.ts"]);
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["test/value.test.js"]);
});

test("ambiguous source files cannot share one compiled Node target", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test dist-test/tests/*.test.js" } }),
    "tests/value.test.ts": "export const fromTs = true;\n",
    "tests/value.test.tsx": "export const fromTsx = true;\n",
    "dist-test/tests/value.test.js": "export const compiled = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual((await targetedTestChecks(root, checks, ["tests/value.test.ts", "tests/value.test.tsx"])).checks, []);
});

test("observer parsing rejects truncation, malformed data, and unmatched targets", async (context) => {
  const root = await initializeRepository({ "test/value.test.js": "export const value = true;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const check = (await targetedTestChecks(root, [{ id: "node", label: "node", kind: "test", command: "node", args: ["--test"], origin: "fixture", executesRepositoryCode: true, targetRunner: "node-test" }], ["test/value.test.js"])).checks[0]!;
  assert.equal(parseTargetObservations(root, check, "{", false)[0]?.outcome, "not-observed");
  assert.match(parseTargetObservations(root, check, "", true)[0]?.detail ?? "", /truncated/);
  const unmatched = JSON.stringify({ version: 1, runner: "node-test", files: [{ runnerPath: "test/other.test.js", passed: 1, failed: 0, skipped: 0, tests: 1 }] });
  assert.match(parseTargetObservations(root, check, unmatched)[0]?.detail ?? "", /unmatched/);
  const valid = JSON.stringify({ version: 1, runner: "node-test", files: [{ runnerPath: "test/value.test.js", passed: 1, failed: 0, skipped: 0, tests: 1 }] });
  assert.deepEqual(parseTargetObservations(root, check, valid).map((item) => [item.outcome, item.testsObserved]), [["passed", 1]]);
});

test("the control pipe is bounded independently from stdout and stderr", async (context) => {
  const root = await initializeRepository({ "test/value.test.js": "export const value = true;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const qualification = { path: "test/value.test.js", runnerPath: "test/value.test.js", basis: "runner-default-pattern" as const, confidence: "high" as const, detail: "fixture", limitation: "fixture" };
  const [result] = await runChecks(root, [{
    id: "control-bound",
    label: "control bound",
    kind: "test",
    command: "node",
    args: ["-e", "process.stdout.write('x'.repeat(5000));require('node:fs').writeSync(3,'y'.repeat(70000))"],
    origin: "fixture",
    executesRepositoryCode: true,
    targetRunner: "node-test",
    targetFiles: [qualification.path],
    targetQualifications: [qualification],
  }], { timeoutMs: 10_000, maxOutputBytes: 1_000 });
  assert.equal(result?.output.length, 1_000);
  assert.equal(result?.outputTruncated, true);
  assert.equal(result?.targetObservations?.[0]?.outcome, "not-observed");
  assert.match(result?.targetObservations?.[0]?.detail ?? "", /truncated/);
});

test("a conventional Python test file discovers pytest", async (context) => {
  const root = await initializeRepository({ "tests/test_value.py": "def test_value():\n    assert True\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.ok(checks.some((check) => check.id === "python:test:pytest"));
});

test("stdlib unittest projects use unittest without requiring pytest", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\n    return 2\n",
    "tests/test_value.py": "import unittest\nfrom value import value\n\nclass ValueTest(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(value(), 2)\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks.map((check) => check.id), ["python:test:unittest"]);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed", result?.output);
});

test("checks receive no inherited application secrets", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node -e \"console.log(process.env.PROOFDIFF_TEST_SECRET || 'absent')\"" } }) });
  context.after(() => rm(root, { recursive: true, force: true }));
  process.env.PROOFDIFF_TEST_SECRET = "must-not-cross-boundary";
  context.after(() => { delete process.env.PROOFDIFF_TEST_SECRET; });
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.output, "absent");
});

test("check execution enforces timeouts", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node -e \"setInterval(()=>{},1000)\"" } }) });
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 200, maxOutputBytes: 1_000 });
  assert.equal(result?.status, "timed-out");
  assert.ok((result?.durationMs ?? 10_000) < 5_000, `timeout took ${String(result?.durationMs)} ms`);
});

test("check execution caps captured output", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node -e \"process.stdout.write('x'.repeat(5000))\"" } }) });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 10_000, maxOutputBytes: 1_000 });
  assert.equal(result?.status, "passed");
  assert.equal(result?.outputTruncated, true);
  assert.ok(Buffer.byteLength(result?.output ?? "") <= 1_000);
});
