from pathlib import Path

selection = Path("src/selection-workspace.ts")
text = selection.read_text()
old = '  const normalized = relative.replaceAll("\\\\", "/");\n'
new = '  const normalized = normalizeRepoPath(relative);\n'
if old not in text:
    raise SystemExit("repoLocalDataArtifact normalization anchor not found")
selection.write_text(text.replace(old, new, 1))

tests = Path("tests/selection-workspace.test.ts")
text = tests.read_text()
anchor = 'test("ignored POSIX paths preserve literal backslashes instead of aliasing allowed artifacts", { skip: process.platform === "win32" }, async (context) => {\n'
if anchor not in text:
    raise SystemExit("selection-workspace regression anchor not found")
regression = r'''test("explicit POSIX data artifacts preserve literal backslashes in their own identity", { skip: process.platform === "win32" }, async (context) => {
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

'''
tests.write_text(text.replace(anchor, regression + anchor, 1))
