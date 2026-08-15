from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement, found {count}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "src/checks.ts",
    '  const normalized = command.trim().replaceAll(/[ \\t]+/g, " ");\n',
    '  const normalized = command.replace(/^[ \\t]+|[ \\t]+$/g, "").replaceAll(/[ \\t]+/g, " ");\n',
)

replace_once(
    "src/js-runners.ts",
    '  const tokens = command.trim().replaceAll(/[ \\t]+/g, " ").split(" ").filter(Boolean);\n',
    '  const tokens = command.replace(/^[ \\t]+|[ \\t]+$/g, "").replaceAll(/[ \\t]+/g, " ").split(" ").filter(Boolean);\n',
)

replace_once(
    "tests/js-runners.test.ts",
    '    "package.json": JSON.stringify({ scripts: { test: "NODE_ENV=test CI=1 jest --ci" } }),\n',
    '    "package.json": JSON.stringify({ scripts: { test: " \\tNODE_ENV=test CI=1 jest --ci\\t " } }),\n',
)

replace_once(
    "tests/js-runners.test.ts",
    '    { label: "non-ASCII whitespace", script: "jest\\u00a0--ci" },\n',
    '    { label: "non-ASCII whitespace", script: "jest\\u00a0--ci" },\n    { label: "leading non-ASCII whitespace", script: "\\u00a0jest --ci" },\n    { label: "trailing non-ASCII whitespace", script: "jest --ci\\u00a0" },\n',
)

marker = 'test("Node targeted discovery rejects command-chain prefixes", async (context) => {\n'
node_test = '''test("Node targeted discovery trims only ASCII space and tab around scripts", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: {
      test: " \\tnode --test\\t ",
      "test:unit": "\\u00a0node --test",
      "test:ci": "node --test\\u00a0",
    } }),
    "test/value.test.js": "import test from 'node:test'; test('value', () => {});\\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const { checks } = await discoverChecks(root);
  assert.equal(checks.find((check) => check.id === "js:test:test")?.targetRunner, "node-test");
  assert.equal(checks.find((check) => check.id === "js:test:test:unit")?.targetRunner, undefined);
  assert.equal(checks.find((check) => check.id === "js:test:test:ci")?.targetRunner, undefined);
  assert.deepEqual((await targetedTestChecks(root, checks, ["test/value.test.js"])).checks.map((check) => check.id), ["js:test:test:targeted"]);
});

'''
replace_once("tests/checks.test.ts", marker, node_test + marker)

replace_once(
    "CHANGELOG.md",
    "### Fixed\n\n",
    "### Fixed\n\n- Restricted recognized Node/Jest/Vitest package-script trimming to ASCII spaces and tabs. JavaScript `String.trim()` also removes non-ASCII whitespace such as NBSP, which shells do not treat as ordinary script separators; leading or trailing Unicode whitespace can therefore no longer be erased into a different executable command and accidentally qualify for exact targeted evidence.\n",
)
