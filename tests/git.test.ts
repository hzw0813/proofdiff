import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { changedFiles, findRepository, gitNullDevice, repositoryInfo, selectDiff } from "../src/git.js";
import { pathExists } from "../src/util.js";
import { git, initializeRepository, temporaryDirectory, writeFiles } from "./helpers.js";

test("Git uses the native null device accepted by each platform", () => {
  assert.equal(gitNullDevice("win32"), "NUL");
  assert.equal(gitNullDevice("linux"), "/dev/null");
});

test("working-tree diff includes tracked and untracked files with line counts", async (context) => {
  const root = await initializeRepository({ "src/a.ts": "export const a = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/a.ts": "export const a = 2;\nexport const b = 3;\n", "src/new.py": "def hello():\n    return 'hi'\n" });
  const { args } = await selectDiff(root, {});
  const files = await changedFiles(root, args, true);
  assert.deepEqual(files.map((file) => file.path), ["src/a.ts", "src/new.py"]);
  assert.equal(files[0]?.change, "modified");
  assert.equal(files[1]?.change, "added");
  assert.equal(files[1]?.language, "python");
  assert.ok((files[1]?.additions ?? 0) >= 2);
});

test("findRepository accepts a nested directory", async (context) => {
  const root = await initializeRepository({ "src/a.js": "export const a = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await findRepository(`${root}/src`), root);
});

test("revision-like options are rejected before reaching git", async (context) => {
  const root = await initializeRepository({ "a.js": "export const a = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(selectDiff(root, { base: "--output=/tmp/pwned" }), /Invalid revision/);
  await assert.rejects(selectDiff(root, { range: "HEAD..HEAD;touch pwned" }), /Invalid range/);
});

test("rename metadata preserves both paths", async (context) => {
  const root = await initializeRepository({ "src/old name.ts": "export function value() { return 1; }\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "mv", "src/old name.ts", "src/new name.ts");
  const { args } = await selectDiff(root, {});
  const [file] = await changedFiles(root, args, true);
  assert.equal(file?.change, "renamed");
  assert.equal(file?.previousPath, "src/old name.ts");
  assert.equal(file?.path, "src/new name.ts");
});

test("staged selection excludes later unstaged edits", async (context) => {
  const root = await initializeRepository({ "value.js": "export const value = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.js": "export const value = 2;\n" });
  git(root, "add", "value.js");
  await writeFiles(root, { "value.js": "export const value = 3;\n" });
  const { selection, args } = await selectDiff(root, { staged: true });
  const [file] = await changedFiles(root, args, false);
  assert.equal(selection.mode, "staged");
  assert.equal(file?.additions, 1);
  assert.equal(file?.deletions, 1);
});

test("base and range selections validate real commits", async (context) => {
  const root = await initializeRepository({ "a.py": "def value():\n    return 1\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await writeFiles(root, { "a.py": "def value():\n    return 2\n" });
  git(root, "add", ".");
  git(root, "commit", "-qm", "change");
  const head = git(root, "rev-parse", "HEAD").trim();
  const selectedBase = await selectDiff(root, { base });
  const selectedRange = await selectDiff(root, { range: `${base}..${head}` });
  assert.equal((await changedFiles(root, selectedBase.args, false))[0]?.path, "a.py");
  assert.equal((await changedFiles(root, selectedRange.args, false))[0]?.path, "a.py");
});

test("staged files work before the first commit", async (context) => {
  const root = await temporaryDirectory();
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  await writeFiles(root, { "first.ts": "export const first = true;\n" });
  git(root, "add", "first.ts");
  const { args } = await selectDiff(root, { staged: true });
  const [file] = await changedFiles(root, args, false);
  assert.equal(file?.change, "added");
  assert.equal(file?.path, "first.ts");
});

test("default selection before the first commit includes unstaged content", async (context) => {
  const root = await temporaryDirectory();
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  await writeFiles(root, { "first.ts": "export const first = 1;\n" });
  git(root, "add", "first.ts");
  await writeFiles(root, { "first.ts": "export const first = 2;\nexport const second = true;\n" });
  const { args } = await selectDiff(root, {});
  const [file] = await changedFiles(root, args, true);
  assert.equal(file?.additions, 2);
});

test("static Git inspection suppresses repository-configured helper execution", async (context) => {
  const root = await initializeRepository({
    ".gitattributes": "*.txt diff=evil filter=evil\n",
    "data.txt": "baseline\n",
    "malicious-helper.cjs": "const fs=require('node:fs'); fs.writeFileSync('helper-ran','yes'); process.stdin.pipe(process.stdout);\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "config", "diff.evil.command", "node malicious-helper.cjs");
  git(root, "config", "diff.evil.textconv", "node malicious-helper.cjs");
  git(root, "config", "filter.evil.clean", "node malicious-helper.cjs");
  git(root, "config", "core.fsmonitor", "node malicious-helper.cjs");
  await rm(path.join(root, "helper-ran"), { force: true });
  await writeFiles(root, { "data.txt": "changed\n" });
  const { args } = await selectDiff(root, {});
  await changedFiles(root, args, false);
  await repositoryInfo(root);
  assert.equal(await pathExists(path.join(root, "helper-ran")), false);
});
