from pathlib import Path

selection = Path("src/selection-workspace.ts")
text = selection.read_text()
old_import = 'import type { DiffSelection } from "./types.js";\n'
new_import = old_import + 'import { normalizeRepoPath } from "./util.js";\n'
if old_import not in text:
    raise SystemExit("selection-workspace import anchor not found")
text = text.replace(old_import, new_import, 1)
old_parse = '  return [...new Set(result.stdout.split("\\0").filter(Boolean).map((file) => file.replaceAll("\\\\", "/")))].sort();\n'
new_parse = '  return [...new Set(result.stdout.split("\\0").filter(Boolean).map(normalizeRepoPath))].sort();\n'
if old_parse not in text:
    raise SystemExit("ignoredFiles parser anchor not found")
text = text.replace(old_parse, new_parse, 1)
selection.write_text(text)

tests = Path("tests/selection-workspace.test.ts")
text = tests.read_text()
anchor = 'test("ignored dependency directories remain allowed as execution environment", async (context) => {\n'
if anchor not in text:
    raise SystemExit("selection-workspace test anchor not found")
regression = r'''test("ignored POSIX paths preserve literal backslashes instead of aliasing allowed artifacts", { skip: process.platform === "win32" }, async (context) => {
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

'''
text = text.replace(anchor, regression + anchor, 1)
tests.write_text(text)

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
anchor = "### Fixed\n\n"
if anchor not in text:
    raise SystemExit("CHANGELOG fixed section not found")
item = "- Preserved ignored-file path identity across platforms when enforcing immutable workspace alignment. POSIX filenames containing literal backslashes are no longer rewritten as directory separators, so a distinct ignored runtime input such as `coverage\\proof.lcov` cannot alias an explicitly allowed `coverage/proof.lcov` data artifact and bypass the pre-execution fail-closed gate.\n"
text = text.replace(anchor, anchor + item, 1)
changelog.write_text(text)
