import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { initializeRepository, runCli, writeFiles } from "./helpers.js";

test("CLI produces terminal, JSON, HTML, and GitHub summary reports for a realistic change", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
    "src/greet.js": "export const greet = (name) => `Hello ${name}`;\n",
    "test/greet.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { greet } from '../src/greet.js'; test('greet',()=>assert.equal(greet('Ada'),'Hello Ada'));\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/greet.js": "export const greet = (name) => `Hello ${String(name)}`;\n" });
  const htmlPath = path.join(root, "proofdiff.html");
  const summaryPath = path.join(root, "proofdiff-summary.md");
  const terminal = runCli(["--repo", root, "--run-checks", "--html", htmlPath, "--github-summary", summaryPath, "--no-color"]);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.match(terminal.stdout, /RELATED TEST FILE PASSED/);
  assert.match(await readFile(htmlPath, "utf8"), /Partially verified|Related test file passed/);
  const summary = await readFile(summaryPath, "utf8");
  assert.match(summary, /^## ProofDiff · Change Evidence/);
  assert.match(summary, /Observed passing target: <code>test\/greet\.test\.js<\/code>/);
  assert.match(summary, /configured HTML report <code>proofdiff\.html<\/code>/);
  if (process.platform !== "win32") assert.equal((await stat(htmlPath)).mode & 0o777, 0o600);
  if (process.platform !== "win32") assert.equal((await stat(summaryPath)).mode & 0o777, 0o600);
  const json = runCli(["--repo", root, "--json", "--fail-on", "never"]);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).schemaVersion, "1.0");
});

test("CLI returns actionable usage errors and CI failure codes", async (context) => {
  const root = await initializeRepository({ "package.json": JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"" } }), "a.js": "export const a = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "a.js": "export const a = 2;\n" });
  const failed = runCli(["--repo", root, "--run-checks", "--no-color"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /FAILED/);
  const invalid = runCli(["--repo", root, "--check", "test"]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /requires --run-checks/);
});
