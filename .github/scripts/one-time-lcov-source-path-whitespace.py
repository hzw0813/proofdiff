from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "src/coverage.ts",
    '      const source = record.slice(3).trim();\n',
    '      const source = record.slice(3);\n',
)

marker = '''test("partial changed-line coverage is not generalized to the rest of the change", async (context) => {\n'''
regression = '''test("LCOV source paths preserve leading and trailing whitespace instead of aliasing another repository file", async (context) => {
  const cases = ["src/value.js ", "src/value.js\\u00a0", " src/value.js"];
  for (const source of cases) {
    const { root, base, head } = await committedChange();
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFiles(root, {
      "coverage/lcov.info": `SF:${source}\\nDA:2,1\\nDA:3,1\\nend_of_record\\n`,
    });
    const report = await analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: head });
    const item = report.assessments.find((assessment) => assessment.file.path === "src/value.js");
    assert.equal(report.coverage?.accepted, true);
    assert.equal(report.coverage?.filesParsed, 1);
    assert.equal(item?.coverage?.state, "unmeasured", JSON.stringify(source));
    assert.equal(item?.coverage?.coveredChangedLines, 0, JSON.stringify(source));
    assert.ok(item?.evidence.every((entry) => entry.kind !== "coverage-artifact"), JSON.stringify(source));
  }
});

'''
replace_once("tests/coverage.test.ts", marker, regression + marker)

replace_once(
    "CHANGELOG.md",
    "## [Unreleased]\n\n### Fixed\n\n",
    "## [Unreleased]\n\n### Fixed\n\n- Preserved LCOV `SF:` source paths exactly instead of applying JavaScript-style whitespace trimming. Leading or trailing spaces and Unicode whitespace are valid path characters, so silently erasing them could alias artifact coverage for one path onto a different changed repository file and overstate changed-line evidence.\n",
)
