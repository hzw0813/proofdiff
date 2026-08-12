import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { discoverChecks, packageManagerInvocation, runChecks, targetedTestChecks } from "../src/checks.js";
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
    "package.json": JSON.stringify({ scripts: { test: "node --test dist-test/tests/value.test.js dist-test/tests/other.test.js" } }),
    "tests/value.test.ts": "export const value = true;\n",
    "dist-test/tests/value.test.js": "export const value = true;\n",
    "dist-test/tests/other.test.js": "export const other = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks[0]?.targetPatterns, ["dist-test/tests/value.test.js", "dist-test/tests/other.test.js"]);
  const targeted = await targetedTestChecks(root, checks, ["tests/value.test.ts"]);
  assert.deepEqual(targeted.checks[0]?.args, ["--test", "dist-test/tests/value.test.js"]);
  assert.deepEqual(targeted.checks[0]?.targetFiles, ["tests/value.test.ts"]);
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
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  const [result] = await runChecks(root, checks, { timeoutMs: 200, maxOutputBytes: 1_000 });
  assert.equal(result?.status, "timed-out");
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
