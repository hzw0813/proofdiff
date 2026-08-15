from pathlib import Path


def replace_once(file: str, before: str, after: str) -> None:
    path = Path(file)
    source = path.read_text()
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{file}: expected exactly one replacement target, found {count}")
    path.write_text(source.replace(before, after, 1))


replace_once(
    "src/checks.ts",
    '      if (entry.isFile() && /(?:^test_.*|.*_(?:test|spec))\\.pyi?$/.test(entry.name)) {',
    '      if (entry.isFile() && /(?:^test_.*|.*_(?:test|spec))\\.py$/.test(entry.name)) {',
)

anchor = 'test("stdlib unittest projects use unittest without requiring pytest", async (context) => {'
source = Path("tests/checks.test.ts").read_text()
if source.count(anchor) != 1:
    raise RuntimeError("tests/checks.test.ts: insertion anchor missing or duplicated")
regression = '''test("Python stub files do not invent executable pytest or unittest checks", async (context) => {
  const root = await initializeRepository({
    "tests/test_contract.pyi": "def test_contract() -> None: ...\\n",
    "tests/test_legacy.pyi": "import unittest\\nclass Contract(unittest.TestCase): ...\\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const { checks } = await discoverChecks(root);
  assert.deepEqual(checks.filter((check) => check.kind === "test"), []);
});

'''
Path("tests/checks.test.ts").write_text(source.replace(anchor, regression + anchor, 1))

anchor = 'test("a passing filtered test script cannot imply that an unexecuted related test passed", async (context) => {'
source = Path("tests/analyze.test.ts").read_text()
if source.count(anchor) != 1:
    raise RuntimeError("tests/analyze.test.ts: insertion anchor missing or duplicated")
regression = '''test("Python stubs remain static test relationships without inventing a runnable framework", async (context) => {
  const root = await initializeRepository({
    "value.py": "def value():\\n    return 1\\n",
    "tests/test_value.pyi": "from value import value\\ndef test_value() -> None: ...\\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "value.py": "def value():\\n    return 2\\n" });

  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const assessment = report.assessments[0];
  assert.deepEqual(report.checks, []);
  assert.deepEqual(assessment?.relatedTests, ["tests/test_value.pyi"]);
  assert.deepEqual(assessment?.executedTests, []);
  assert.equal(assessment?.status, "unknown");
  assert.equal(assessment?.evidenceBoundary?.stage, "runner-qualification");
  assert.equal(assessment?.evidenceBoundary?.reason, "runner-unqualified");
});

'''
Path("tests/analyze.test.ts").write_text(source.replace(anchor, regression + anchor, 1))

replace_once(
    "docs/verification-model.md",
    "- Python namespace packages and dynamic imports may be missed.",
    "- Python namespace packages and dynamic imports may be missed. `.pyi` stubs remain supported static-analysis and test-like relationship inputs, but they do not establish an executable pytest/`unittest` framework or qualify as Python runtime test targets.",
)

replace_once(
    "CHANGELOG.md",
    "## [Unreleased]\\n\\n## [0.5.3] - 2026-08-15",
    '''## [Unreleased]

### Fixed

- Stopped `.pyi` stub files with test-like names from inventing executable pytest or `unittest` checks. Stubs remain available to static Python analysis and relationship discovery, but framework discovery now requires an executable `.py` test file; this prevents `--run-checks` from launching a Python test runner merely because a repository contains test-shaped type stubs.

## [0.5.3] - 2026-08-15''',
)
