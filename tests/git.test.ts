import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { changedFiles, findRepository, gitNullDevice, listRepositoryFiles, repositoryInfo, selectDiff } from "../src/git.js";
import { runGit } from "../src/git-command.js";
import { pathExists, readUtf8File } from "../src/util.js";
import { addSubmodule, git, initializeRepository, runCli, temporaryDirectory, writeFiles } from "./helpers.js";

test("gitlink additions, updates, renames, deletions, and type changes remain visible without source hunks", async (context) => {
  const root = await initializeRepository({ "README.md": "fixture\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = git(root, "rev-parse", "HEAD").trim();
  git(root, "commit", "--allow-empty", "-qm", "another commit");
  const second = git(root, "rev-parse", "HEAD").trim();
  const link = "sub[module].js";
  const inspect = async (expected: string, options = { staged: true }) => {
    const files = await changedFiles(root, (await selectDiff(root, options)).args, false);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.submodule, true);
    assert.equal(files[0]?.change, expected);
    assert.equal(files[0]?.language, "unknown");
    assert.equal(files[0]?.additions, 0);
    assert.equal(files[0]?.deletions, 0);
    assert.deepEqual(files[0]?.hunks, []);
    return files[0]!;
  };
  git(root, "update-index", "--add", "--cacheinfo", `160000,${first},${link}`);
  await inspect("added");
  git(root, "commit", "-qm", "add pointer");
  git(root, "update-index", "--cacheinfo", `160000,${second},${link}`);
  await inspect("modified");
  assert.equal((await listRepositoryFiles(root)).files.includes(link), false);
  git(root, "commit", "-qm", "update pointer");
  git(root, "update-index", "--force-remove", link);
  git(root, "update-index", "--add", "--cacheinfo", `160000,${second},renamed.js`);
  assert.equal((await inspect("renamed")).previousPath, link);
  git(root, "commit", "-qm", "rename pointer");
  git(root, "update-index", "--force-remove", "renamed.js");
  await inspect("deleted");
  await writeFiles(root, { "renamed.js": "export const value = 1;\n" });
  git(root, "add", "renamed.js");
  await inspect("unknown"); // T: a gitlink-to-file transition is conservatively outside source semantics.
});

test("working-tree submodule HEAD changes are visible while nested dirty contents stay out of scope", async (context) => {
  const root = await initializeRepository({ "README.md": "fixture\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const nested = await addSubmodule(root, "vendor", { "value.js": "export const value = 1;\n" });
  // Local ignore and diff-format preferences must not hide pointer changes or expand nested source.
  git(root, "config", "submodule.nested.ignore", "all");
  git(root, "config", "diff.submodule", "diff");
  await writeFiles(nested, { "value.js": "export const value = 2;\n", "untracked.py": "raise Exception('nested')\n" });
  assert.deepEqual(await changedFiles(root, (await selectDiff(root, {})).args, true), []);
  assert.equal((await repositoryInfo(root)).dirty, false);
  git(nested, "add", "value.js");
  git(nested, "commit", "-qm", "nested change");
  const files = await changedFiles(root, (await selectDiff(root, {})).args, true);
  assert.deepEqual(files.map((file) => [file.path, file.submodule, file.hunks]), [["vendor", true, []]]);
  assert.equal((await repositoryInfo(root)).dirty, true);
  await writeFiles(nested, { "probe.cjs": "require('node:fs').writeFileSync('helper-ran', 'yes');\n" });
  git(nested, "config", "core.fsmonitor", "node probe.cjs");
  await changedFiles(root, (await selectDiff(root, {})).args, true);
  await repositoryInfo(root);
  assert.equal(await pathExists(path.join(nested, "helper-ran")), false);
  assert.equal(await pathExists(path.join(root, "helper-ran")), false);
});

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

test("per-file hunks treat bracket filenames literally", async (context) => {
  const root = await initializeRepository({
    "src/[a].js": "export const bracket = 1;\n",
    "src/a.js": "\n\nexport const other = 1;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "src/[a].js": "export const bracket = 2;\n",
    "src/a.js": "\n\nexport const other = 2;\n",
  });
  const files = await changedFiles(root, (await selectDiff(root, {})).args, true);
  assert.deepEqual(files.map((file) => [file.path, file.hunks]), [
    ["src/[a].js", [{ oldRange: { start: 1, end: 1 }, newRange: { start: 1, end: 1 } }]],
    ["src/a.js", [{ oldRange: { start: 3, end: 3 }, newRange: { start: 3, end: 3 } }]],
  ]);
});

test("renamed wildcard paths preserve exact old and new hunk identity", async (context) => {
  const content = "export function target() {\n  const a = 1;\n  const b = 2;\n  return a + b;\n}\n";
  const root = await initializeRepository({ "old[a].js": content, "olda.js": "export const decoy = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "mv", "old[a].js", "new[a].js");
  await writeFiles(root, { "new[a].js": content.replace("b = 2", "b = 3"), "olda.js": "export const decoy = 2;\n" });
  const files = await changedFiles(root, (await selectDiff(root, {})).args, true);
  const renamed = files.find((file) => file.path === "new[a].js");
  assert.equal(renamed?.previousPath, "old[a].js");
  assert.deepEqual(renamed?.hunks, [{ oldRange: { start: 3, end: 3 }, newRange: { start: 3, end: 3 } }]);
});

test("pathspec magic in a filename cannot select other files", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({ ":(exclude)victim.js": "export const literal = 1;\n", "victim.js": "\n\nexport const victim = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { ":(exclude)victim.js": "export const literal = 2;\n", "victim.js": "\n\nexport const victim = 2;\n" });
  const files = await changedFiles(root, (await selectDiff(root, {})).args, true);
  assert.deepEqual(files[0]?.hunks, [{ oldRange: { start: 1, end: 1 }, newRange: { start: 1, end: 1 } }]);
});

test("oversized per-file Git patches fail closed instead of returning partial evidence", async (context) => {
  const root = await initializeRepository({ "large.txt": "baseline\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "large.txt": `${"x".repeat(8_000_100)}\n` });
  await assert.rejects(changedFiles(root, (await selectDiff(root, {})).args, false), /Git output exceeded.*incomplete/i);
  const output = path.join(root, "report.json");
  const result = runCli(["--repo", root, "--json", "--output", output, "--fail-on", "never"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Git output exceeded.*incomplete/i);
  assert.equal(await pathExists(output), false);
});

test("helper suppression refreshes after configuration changes in the same process", async (context) => {
  const root = await initializeRepository({
    ".gitattributes": "*.txt filter=late\n",
    "data.txt": "baseline\n",
    "helper.cjs": "require('node:fs').writeFileSync('helper-ran','yes');process.stdin.pipe(process.stdout);\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await findRepository(root);
  git(root, "config", "filter.late.clean", "node helper.cjs");
  await writeFiles(root, { "data.txt": "changed\n" });
  await changedFiles(root, (await selectDiff(root, {})).args, false);
  assert.equal(await pathExists(path.join(root, "helper-ran")), false);
});

test("unborn SHA-256 repositories support working-tree and staged selections", async (context) => {
  const root = await temporaryDirectory();
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q", "--object-format=sha256");
  await writeFiles(root, { "first.ts": "export const first = 1;\n" });
  git(root, "add", ".");
  for (const options of [{}, { staged: true }]) {
    const [file] = await changedFiles(root, (await selectDiff(root, options)).args, !options.staged);
    assert.equal(file?.path, "first.ts");
    assert.equal(file?.additions, 1);
  }
});

test("bounded Git inventories reject an incomplete path record", async (context) => {
  const root = await initializeRepository({ "a-long-filename.js": "export const value = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(runGit(root, ["ls-files", "-z"], { maxOutputBytes: 8 }), /Git output exceeded.*incomplete/i);
});

test("oversized driver configuration stops inspection before any helper can run", async (context) => {
  const root = await initializeRepository({
    ".gitattributes": "*.txt filter=probe\n",
    "value.txt": "baseline\n",
    "probe.cjs": "require('node:fs').writeFileSync('probe-ran','yes');process.stdin.pipe(process.stdout);\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const drivers = Array.from({ length: 1_000 }, (_, i) => `[filter "${"x".repeat(70)}${i}"]\nclean = false\n`).join("");
  await writeFile(path.join(root, ".git", "config"), `${drivers}[filter "probe"]\nclean = node probe.cjs\n`);
  await assert.rejects(findRepository(root), /Git output exceeded the 64000 byte limit/);
  assert.equal(await pathExists(path.join(root, "probe-ran")), false);
});
