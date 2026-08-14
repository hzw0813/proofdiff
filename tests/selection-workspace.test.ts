import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { git, initializeRepository, writeFiles } from "./helpers.js";

const fixture = {
  "package.json": JSON.stringify({ name: "selection-binding", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
  "src/value.js": "export const value = 1;\n",
  "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value, 1));\n",
};

async function commitChange(root: string, content: string, message: string): Promise<string> {
  await writeFiles(root, { "src/value.js": content });
  git(root, "add", "src/value.js");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD").trim();
}

test("clean base selections remain analyzable", async (context) => {
  const root = await initializeRepository(fixture);
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");

  const report = await analyzeRepository({ repo: root, base });
  assert.deepEqual(report.assessments.map((item) => item.file.path), ["src/value.js"]);
});

test("base selections fail closed when tracked worktree content drifts from HEAD", async (context) => {
  const root = await initializeRepository(fixture);
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, { "test/value.test.js": "// dirty test outside the immutable diff\n" });

  await assert.rejects(
    analyzeRepository({ repo: root, base }),
    /tracked checked-out content does not match the selected HEAD target/,
  );
});

test("base selections fail closed on Git-visible untracked inputs", async (context) => {
  const root = await initializeRepository(fixture);
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, { "pytest.ini": "[pytest]\npython_files = always_pass.py\n" });

  await assert.rejects(
    analyzeRepository({ repo: root, base }),
    /Git-visible untracked file.*pytest\.ini/,
  );
});

test("staged selections require the checked-out worktree to match the index", async (context) => {
  const root = await initializeRepository(fixture);
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });
  git(root, "add", "src/value.js");

  const aligned = await analyzeRepository({ repo: root, staged: true });
  assert.deepEqual(aligned.assessments.map((item) => item.file.path), ["src/value.js"]);

  await writeFiles(root, { "test/value.test.js": "// unstaged drift\n" });
  await assert.rejects(
    analyzeRepository({ repo: root, staged: true }),
    /tracked checked-out content does not match the staged index/,
  );
});

test("historical range targets must be checked out before filesystem-backed analysis", async (context) => {
  const root = await initializeRepository(fixture);
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = git(root, "rev-parse", "HEAD").trim();
  const historicalTarget = await commitChange(root, "export const value = 2;\n", "historical target");
  await commitChange(root, "export const value = 3;\n", "newer head");

  await assert.rejects(
    analyzeRepository({ repo: root, range: `${first}..${historicalTarget}` }),
    /targets commit .* but the checked-out HEAD is .*could mix snapshots/,
  );
});
