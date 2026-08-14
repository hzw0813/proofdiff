import assert from "node:assert/strict";
import path from "node:path";
import { rm, symlink } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { listRepositoryFiles } from "../src/git.js";
import { loadTestMap, TestMapError, testMapRepositoryPath } from "../src/test-map.js";
import { git, initializeRepository, writeFiles } from "./helpers.js";

function mapFor(source: string, tests: string[]): string {
  return JSON.stringify({ version: 1, relationships: [{ source, tests }] }, null, 2);
}

test("a declared relationship can bridge static discovery but cannot bypass exact runtime evidence", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "declared-map", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
    "src/value.js": "export const value = 1;\n",
    "test/declared.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; test('declared', () => assert.equal(2 + 2, 4));\n",
    "proofdiff.test-map.json": mapFor("src/value.js", ["test/declared.test.js"]),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });

  const withoutMap = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  assert.deepEqual(withoutMap.assessments[0]?.relatedTests, []);
  assert.deepEqual(withoutMap.assessments[0]?.executedTests, []);
  assert.equal(withoutMap.assessments[0]?.status, "partially-verified");
  assert.equal(withoutMap.assessments[0]?.evidenceBoundary?.reason, "no-related-test");
  assert.match(withoutMap.assessments[0]?.evidenceBoundary?.nextAction?.detail ?? "", /--test-map/);
  assert.match(withoutMap.assessments[0]?.evidenceBoundary?.nextAction?.detail ?? "", /still requires independent runner qualification and runtime observation/);
  assert.ok(!withoutMap.checks.some((check) => check.id.endsWith(":targeted")));

  const staticOnly = await analyzeRepository({ repo: root, testMap: "proofdiff.test-map.json" });
  assert.deepEqual(staticOnly.assessments[0]?.relatedTests, ["test/declared.test.js"]);
  assert.deepEqual(staticOnly.assessments[0]?.executedTests, []);
  assert.equal(staticOnly.assessments[0]?.status, "unknown");
  assert.equal(staticOnly.assessments[0]?.evidenceBoundary?.stage, "target-invocation");
  assert.equal(staticOnly.assessments[0]?.evidenceBoundary?.reason, "checks-not-run");
  assert.match(staticOnly.assessments[0]?.evidence.find((item) => item.label.includes("user-declared test relationship"))?.detail ?? "", /provenance only/);

  const withMap = await analyzeRepository({ repo: root, testMap: "proofdiff.test-map.json", runChecks: true, timeoutMs: 20_000 });
  const assessment = withMap.assessments[0];
  assert.deepEqual(assessment?.relatedTests, ["test/declared.test.js"]);
  assert.deepEqual(assessment?.executedTests, ["test/declared.test.js"]);
  assert.equal(assessment?.status, "verified");
  assert.equal(assessment?.evidenceBoundary?.stage, "changed-code-execution");
  assert.ok(withMap.checks.some((check) => check.id.endsWith(":targeted") && check.status === "passed"));
  assert.match(assessment?.limitations.join("\n") ?? "", /user-declared by --test-map/);
  assert.match(assessment?.reasons.join("\n") ?? "", /user-declared relationship provenance does not remove this review signal/);
  assert.match(withMap.trust.statement, /test map was parsed as bounded data/);
  assert.match(withMap.trust.statement, /not independently verified semantic relevance/);
  assert.match(withMap.notes.join("\n"), /Declarations provide relationship provenance only/);
});

test("an exact declared target can apply across source and test languages without making opaque checks cross-language", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "cross-language-map", private: true, type: "module", scripts: { test: "node --test" } }, null, 2),
    "src/value.py": "VALUE = 1\n",
    "test/integration.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; test('integration', () => assert.equal('ok'.toUpperCase(), 'OK'));\n",
    "proofdiff.test-map.json": mapFor("src/value.py", ["test/integration.test.js"]),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.py": "VALUE = 2\n" });

  const report = await analyzeRepository({ repo: root, testMap: "proofdiff.test-map.json", runChecks: true, timeoutMs: 20_000 });
  const assessment = report.assessments.find((item) => item.file.path === "src/value.py");
  assert.equal(assessment?.status, "verified");
  assert.deepEqual(assessment?.relatedTests, ["test/integration.test.js"]);
  assert.deepEqual(assessment?.executedTests, ["test/integration.test.js"]);
  assert.ok(report.checks.some((check) => check.targetFiles?.includes("test/integration.test.js") && check.status === "passed"));
  assert.match(assessment?.reasons.join("\n") ?? "", /user-declared relationship provenance does not remove this review signal/);
});

test("immutable selections reject a test map modified by the same selection", async (context) => {
  const root = await initializeRepository({
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "export const observed = true;\n",
    "proofdiff.test-map.json": mapFor("src/value.js", ["test/value.test.js"]),
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();

  await writeFiles(root, {
    "src/value.js": "export const value = 2;\n",
    "proofdiff.test-map.json": `${mapFor("src/value.js", ["test/value.test.js"])}\n`,
  });

  const workingTree = await analyzeRepository({ repo: root, testMap: "proofdiff.test-map.json" });
  assert.match(workingTree.notes.join("\n"), /part of the mutable working-tree selection/);
  assert.match(workingTree.trust.statement, /immutable diff selections reject this self-modifying declaration pattern/);

  git(root, "add", ".");
  git(root, "commit", "-qm", "change source and declaration");
  await assert.rejects(
    () => analyzeRepository({ repo: root, base, testMap: "proofdiff.test-map.json" }),
    (error: unknown) => {
      assert.ok(error instanceof TestMapError);
      assert.match(error.message, /part of the selected base diff/);
      assert.match(error.message, /cannot strengthen the same immutable change/);
      return true;
    },
  );
});

test("test-map visibility can use the complete Git inventory independently of a truncated analysis slice", async (context) => {
  const root = await initializeRepository({
    "a-first.js": "export const first = true;\n",
    "src/value.js": "export const value = 1;\n",
    "zz/value.test.js": "export const observed = true;\n",
    "proofdiff.test-map.json": mapFor("src/value.js", ["zz/value.test.js"]),
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const limited = await listRepositoryFiles(root, 1);
  assert.equal(limited.truncated, true);
  assert.equal(limited.files.length, 1);
  await assert.rejects(() => loadTestMap(root, "proofdiff.test-map.json", limited.files), /not Git-visible/);

  const complete = await listRepositoryFiles(root, Number.MAX_SAFE_INTEGER);
  assert.equal(complete.truncated, false);
  const loaded = await loadTestMap(root, "proofdiff.test-map.json", complete.files);
  assert.deepEqual(loaded.bySource.get("src/value.js"), ["zz/value.test.js"]);
});

test("test map artifact paths are bounded and symbolic-link maps are rejected", async (context) => {
  const root = await initializeRepository({
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "export const observed = true;\n",
    "real-map.json": mapFor("src/value.js", ["test/value.test.js"]),
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(await testMapRepositoryPath(root, "real-map.json"), "real-map.json");
  assert.equal(await testMapRepositoryPath(root, path.join("..", "outside-map.json")), null);

  if (process.platform === "win32") return;
  await symlink("real-map.json", path.join(root, "linked-map.json"));
  await assert.rejects(() => loadTestMap(root, "linked-map.json", ["src/value.js", "test/value.test.js"]), /must not be a symbolic link/);
});

test("test maps reject unsafe, stale, non-test-like, and ambiguous declarations", async (context) => {
  const root = await initializeRepository({
    "src/value.js": "export const value = 1;\n",
    "src/helper.js": "export const helper = true;\n",
    "test/value.test.js": "export const observed = true;\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  const visible = ["src/value.js", "src/helper.js", "test/value.test.js"];

  const cases = [
    { name: "escape", content: mapFor("../outside.js", ["test/value.test.js"]), pattern: /stay inside the repository/ },
    { name: "stale-source", content: mapFor("src/missing.js", ["test/value.test.js"]), pattern: /neither Git-visible nor selected as changed/ },
    { name: "stale-test", content: mapFor("src/value.js", ["test/missing.test.js"]), pattern: /not Git-visible/ },
    { name: "non-test-like", content: mapFor("src/value.js", ["src/helper.js"]), pattern: /not a supported test-like source file/ },
    {
      name: "duplicate-source",
      content: JSON.stringify({ version: 1, relationships: [
        { source: "src/value.js", tests: ["test/value.test.js"] },
        { source: "src/value.js", tests: ["test/value.test.js"] },
      ] }),
      pattern: /declares source more than once/,
    },
    { name: "extra-field", content: JSON.stringify({ version: 1, relationships: [], typo: true }), pattern: /unsupported field/ },
  ];

  for (const fixture of cases) {
    const file = `map-${fixture.name}.json`;
    await writeFiles(root, { [file]: fixture.content });
    await assert.rejects(() => loadTestMap(root, file, [...visible, file]), (error: unknown) => {
      assert.ok(error instanceof TestMapError);
      assert.match(error.message, fixture.pattern);
      return true;
    });
  }
});
