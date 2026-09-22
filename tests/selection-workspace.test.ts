import assert from "node:assert/strict";
import path from "node:path";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { pathExists } from "../src/util.js";
import { addSubmodule, git, initializeRepository, runCli, writeFiles } from "./helpers.js";

const fixture = {
  "package.json": JSON.stringify({ name: "selection-binding", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
  "src/value.js": "export const value = 1;\n",
  "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value, 1));\n",
};

test("immutable execution cannot bind nested submodule inputs to the selected snapshot", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node probe.cjs" } }),
    "probe.cjs": "require('node:fs').writeFileSync('probe-ran', 'yes');\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const nested = await addSubmodule(root, "vendor", { "value.js": "export const value = 1;\n" });
  await writeFiles(nested, { "value.js": "export const value = 999;\n", "hidden-input": "outside the superproject snapshot\n" });
  for (const selection of [{ base: "HEAD" }, { range: "HEAD..HEAD" }, { staged: true }]) {
    const report = await analyzeRepository({ repo: root, ...selection });
    assert.equal(report.trust.repositoryCodeExecuted, false);
    await assert.rejects(analyzeRepository({ repo: root, ...selection, runChecks: true }), /nested filesystem inputs are not bound/);
    assert.match(report.notes.join("\n"), /submodule/);
  }
  assert.equal(await pathExists(path.join(root, "probe-ran")), false);
});

for (const flag of ["assume-unchanged", "skip-worktree"]) {
  test(`${flag} cannot hide filesystem changes from any selection or authorize checks`, async (context) => {
    const root = await initializeRepository({
      ...fixture,
      "probe.cjs": "require('node:fs').writeFileSync('probe-ran', 'yes');\n",
      "package.json": JSON.stringify({ scripts: { test: "node probe.cjs" } }),
    });
    context.after(() => rm(root, { recursive: true, force: true }));
    git(root, "update-index", `--${flag}`, "src/value.js");
    await writeFiles(root, { "src/value.js": "export const value = 999;\n" });
    for (const selection of [{}, { base: "HEAD" }, { range: "HEAD..HEAD" }, { staged: true }]) {
      await assert.rejects(analyzeRepository({ repo: root, ...selection, runChecks: true }), new RegExp(flag));
    }
    assert.equal(await pathExists(path.join(root, "probe-ran")), false);
    const cli = runCli(["--repo", root, "--json", "--output", path.join(root, "report.json"), "--fail-on", "never"]);
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, new RegExp(flag));
    assert.equal(await pathExists(path.join(root, "report.json")), false);
    // Inspection must not clear flags or rewrite the user's index.
    assert.match(git(root, "ls-files", "-v", "src/value.js"), flag === "skip-worktree" ? /^S / : /^h /);
    git(root, "update-index", `--no-${flag}`, "src/value.js");
    const report = await analyzeRepository({ repo: root });
    assert.deepEqual(report.assessments.map((item) => item.file.path), ["src/value.js"]);
  });
}

test("sparse checkouts fail closed with a recovery diagnostic for missing source inputs", async (context) => {
  const root = await initializeRepository({ ...fixture, "other/module.js": "export const other = 1;\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "sparse-checkout", "set", "--cone", "--sparse-index", "src");
  await assert.rejects(analyzeRepository({ repo: root, base: "HEAD" }), /skip-worktree.*full checkout/s);
});

test("unresolved merge stages cannot produce reports or execute checks", async (context) => {
  const root = await initializeRepository({
    ...fixture,
    "probe.cjs": "require('node:fs').writeFileSync('probe-ran', 'yes');\n",
    "package.json": JSON.stringify({ scripts: { test: "node probe.cjs" } }),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const branch = git(root, "symbolic-ref", "--short", "HEAD").trim();
  git(root, "checkout", "-qb", "conflict-side");
  await commitChange(root, "export const value = 2;\n", "side");
  git(root, "checkout", "-q", branch);
  await commitChange(root, "export const value = 3;\n", "main");
  assert.throws(() => git(root, "merge", "conflict-side"));
  for (const selection of [{}, { base: "HEAD" }, { range: "HEAD..HEAD" }, { staged: true }]) {
    await assert.rejects(analyzeRepository({ repo: root, ...selection, runChecks: true }), /unresolved merge.*src\/value\.js/s);
  }
  assert.match(git(root, "ls-files", "--unmerged"), /src\/value\.js/);
  assert.equal(await pathExists(path.join(root, "probe-ran")), false);
});

test("all immutable static modes suppress configured Git clean filters", async (context) => {
  const root = await initializeRepository({
    ".gitattributes": "*.txt filter=probe\n",
    "value.txt": "baseline\n",
    "probe.cjs": "require('node:fs').writeFileSync('probe-ran','yes');process.stdin.pipe(process.stdout);\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "config", "filter.probe.clean", "node probe.cjs");
  for (const selection of [{ base: "HEAD" }, { range: "HEAD..HEAD" }, { staged: true }]) {
    const report = await analyzeRepository({ repo: root, ...selection });
    assert.equal(await pathExists(path.join(root, "probe-ran")), false, JSON.stringify(selection));
    assert.equal(report.trust.repositoryCodeExecuted, false);
  }
});

test("linked worktree configuration cannot enable static Git helper execution", async (context) => {
  const root = await initializeRepository({
    // The checkout must remain byte-aligned even when the host has global autocrlf=true;
    // static Git reads deliberately exclude global configuration.
    ".gitattributes": "* text eol=lf\n*.txt filter=probe\n",
    "value.txt": "baseline\n",
    "probe.cjs": "require('node:fs').writeFileSync('probe-ran','yes');process.stdin.pipe(process.stdout);\n",
  });
  const linked = `${root}-linked`;
  context.after(() => rm(linked, { recursive: true, force: true }));
  context.after(() => rm(root, { recursive: true, force: true }));
  git(root, "config", "extensions.worktreeConfig", "true");
  git(root, "worktree", "add", "--detach", linked, "HEAD");
  git(linked, "config", "--worktree", "filter.probe.clean", "node probe.cjs");
  const report = await analyzeRepository({ repo: linked, base: "HEAD" });
  assert.equal(await pathExists(path.join(linked, "probe-ran")), false);
  assert.equal(report.trust.repositoryCodeExecuted, false);
});

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

test("ignored metadata and Python tests that discovery would inspect fail closed for immutable selections", async (context) => {
  const root = await initializeRepository({
    ".gitignore": "package.json\npytest.ini\nignored_tests/\n",
    "src/value.js": "export const value = 1;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, {
    "package.json": JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }),
    "pytest.ini": "[pytest]\npython_files = test_*.py\n",
    "ignored_tests/test_fake.py": "def test_fake():\n    assert True\n",
  });

  await assert.rejects(
    analyzeRepository({ repo: root, base }),
    /ignored filesystem inputs?.*(?:package\.json|pytest\.ini|test_fake\.py)/,
  );
});

test("ignored runtime-only inputs are allowed statically but rejected before repository execution", async (context) => {
  const root = await initializeRepository({
    ".gitignore": ".env\n",
    "package.json": JSON.stringify({ name: "ignored-runtime-input", private: true, scripts: { test: "node --test" } }, null, 2),
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "import test from 'node:test'; test('ok', () => {});\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, { ".env": "TOKEN=local-only\n" });

  const staticReport = await analyzeRepository({ repo: root, base });
  assert.deepEqual(staticReport.assessments.map((item) => item.file.path), ["src/value.js"]);

  await assert.rejects(
    analyzeRepository({ repo: root, base, runChecks: true }),
    /ignored filesystem input.*visible to repository execution.*\.env/,
  );
});

test("explicit POSIX data artifacts preserve literal backslashes in their own identity", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({
    ".gitignore": "coverage*\n",
    "src/value.js": "export const value = 1;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  const target = await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, {
    "coverage\\proof.lcov": "TN:\nSF:src/value.js\nDA:1,1\nend_of_record\n",
  });

  const report = await analyzeRepository({
    repo: root,
    base,
    runChecks: true,
    coverageLcov: "coverage\\proof.lcov",
    coverageCommit: target,
  });
  assert.equal(report.coverage?.accepted, true);
  assert.equal(report.coverage?.artifact, "coverage\\proof.lcov");
});

test("ignored POSIX paths preserve literal backslashes instead of aliasing allowed artifacts", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({
    ".gitignore": "coverage*\n",
    "package.json": JSON.stringify({ name: "ignored-path-identity", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import { value } from '../src/value.js'; test('value', () => { assert.equal(value, 2); assert.equal(readFileSync('coverage\\\\proof.lcov', 'utf8').trim(), 'allow'); });\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  const target = await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, {
    "coverage/proof.lcov": "TN:\nSF:src/value.js\nDA:1,1\nend_of_record\n",
    "coverage\\proof.lcov": "allow\n",
  });

  await assert.rejects(
    analyzeRepository({
      repo: root,
      base,
      runChecks: true,
      coverageLcov: "coverage/proof.lcov",
      coverageCommit: target,
      timeoutMs: 20_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /ignored filesystem input.*visible to repository execution/);
      assert.ok(error.message.includes("coverage\\proof.lcov"));
      return true;
    },
  );
});

test("ignored dependency directories remain allowed as execution environment", async (context) => {
  const root = await initializeRepository({
    ".gitignore": "node_modules/\n",
    "src/value.js": "export const value = 1;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  await commitChange(root, "export const value = 2;\n", "selected change");
  await writeFiles(root, { "node_modules/example/test_fake.py": "def test_fake():\n    assert True\n" });

  const report = await analyzeRepository({ repo: root, base });
  assert.deepEqual(report.assessments.map((item) => item.file.path), ["src/value.js"]);
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
