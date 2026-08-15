import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { changedFiles, findRepository, gitNullDevice, repositoryInfo, selectDiff } from "../src/git.js";
import { pathExists, readUtf8File } from "../src/util.js";
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

test("working-tree untracked symbolic links are not dereferenced", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({ "tracked.txt": "baseline\n" });
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.js`);
  context.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { force: true })]));
  await writeFile(outside, "export const outside = 1;\nexport const leaked = 2;\n");
  await symlink(outside, path.join(root, "leak.js"));
  const { args } = await selectDiff(root, {});
  const files = await changedFiles(root, args, true);
  const leak = files.find((file) => file.path === "leak.js");
  assert.equal(leak?.additions, 0);
  assert.equal(await readUtf8File(path.join(root, "leak.js")), null);
});

test("findRepository accepts a nested directory", async (context) => {
  const root = await initializeRepository({ "src/a.js": "export const a = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await findRepository(`${root}/src`), root);
});

test("findRepository preserves trailing whitespace in the repository root", { skip: process.platform === "win32" }, async (context) => {
  const parent = await temporaryDirectory("proofdiff-root-space-");
  const root = path.join(parent, "repository ");
  const trimmedSibling = path.join(parent, "repository");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(trimmedSibling, { recursive: true });
  git(root, "init", "-q");
  assert.equal(await findRepository(path.join(root, "src")), root);
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
assert.deepEqual(file?.hunks, []);
});

test("rename with content modification preserves the minimal changed hunk", async (context) => {
  const root = await initializeRepository({
    "src/foo.js": [
      "export function helperA() { return 1; }",
      "",
      "export function target() {",
      "  helperA();",
      "  const x = 1;",
      "  const y = 2;",
      "  return x + y;",
      "}",
      "",
    ].join("\n"),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "mv", "src/foo.js", "src/bar.js");
  await writeFiles(root, {
    "src/bar.js": [
      "export function helperA() { return 1; }",
      "",
      "export function target() {",
      "  helperA();",
      "  const x = 1;",
      "  const y = 3;",
      "  return x + y;",
      "}",
      "",
    ].join("\n"),
  });
  const { args } = await selectDiff(root, {});
  const [file] = await changedFiles(root, args, true);
  assert.equal(file?.change, "renamed");
  assert.equal(file?.previousPath, "src/foo.js");
  assert.equal(file?.path, "src/bar.js");
  assert.equal(file?.additions, 1);
  assert.equal(file?.deletions, 1);
  assert.deepEqual(file?.hunks, [{
    oldRange: { start: 6, end: 6 },
    newRange: { start: 6, end: 6 },
  }]);
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

test("static Git inspection ignores local replace refs", async (context) => {
  const root = await initializeRepository({ "value.txt": "baseline\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await writeFiles(root, { "value.txt": "committed\n" });
  git(root, "add", "value.txt");
  git(root, "commit", "-qm", "real committed value");
  const head = git(root, "rev-parse", "HEAD").trim();

  await writeFiles(root, { "replacement.txt": "spoof-one\nspoof-two\nspoof-three\n" });
  const originalBlob = git(root, "rev-parse", "HEAD:value.txt").trim();
  const replacementBlob = git(root, "hash-object", "-w", "replacement.txt").trim();
  git(root, "replace", originalBlob, replacementBlob);

  assert.match(git(root, "cat-file", "blob", "HEAD:value.txt"), /spoof-three/);
  assert.match(git(root, "diff", "--numstat", `${base}..${head}`, "--", "value.txt"), /^3\s+1\s+/);

  const [file] = await changedFiles(root, [`${base}..${head}`], false);
  assert.equal(file?.path, "value.txt");
  assert.equal(file?.additions, 1);
  assert.equal(file?.deletions, 1);
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
