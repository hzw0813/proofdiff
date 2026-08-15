import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { CoverageError } from "../src/coverage.js";
import { git, initializeRepository, runCli, writeFiles } from "./helpers.js";

const baseline = {
  "src/value.js": "export function value(input) {\n  return input + 1;\n}\n",
};

async function committedChange(): Promise<{ root: string; base: string; head: string }> {
  const root = await initializeRepository(baseline);
  const base = git(root, "rev-parse", "HEAD").trim();
  await writeFiles(root, {
    "src/value.js": "export function value(input) {\n  const normalized = Number(input);\n  return normalized + 1;\n}\n",
  });
  git(root, "add", "src/value.js");
  git(root, "commit", "-qm", "change");
  const head = git(root, "rev-parse", "HEAD").trim();
  return { root, base, head };
}

test("declared-commit-matched LCOV adds artifact-reported changed-line evidence without changing historical verification status", async (context) => {
  const { root, base, head } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  const baselineReport = await analyzeRepository({ repo: root, base });
  await writeFiles(root, {
    "coverage/lcov.info": "TN:\nSF:src/value.js\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n",
  });
  const report = await analyzeRepository({
    repo: root,
    base,
    coverageLcov: "coverage/lcov.info",
    coverageCommit: head,
  });
  const item = report.assessments[0];
  assert.equal(report.coverage?.accepted, true);
  assert.equal(report.coverage?.commitBinding, "declared-commit-matched");
  assert.equal(item?.status, "unknown");
  assert.equal(item?.coverage?.state, "all-covered");
  assert.equal(item?.coverage?.changedLines, 2);
  assert.equal(item?.coverage?.coveredChangedLines, 2);
  assert.deepEqual(item?.evidenceBoundary, baselineReport.assessments[0]?.evidenceBoundary);
  assert.ok(item?.evidence.some((entry) => entry.kind === "coverage-artifact"));
  assert.ok(item?.evidence.some((entry) => entry.kind === "coverage-artifact" && /reported with hits by the supplied artifact/.test(entry.label)));
  assert.ok(item?.evidence.every((entry) => !/execution was observed|runtime line-execution evidence/.test(`${entry.label} ${entry.detail}`)));
  assert.equal(report.trust.repositoryCodeExecuted, false);
  assert.match(report.trust.statement, /LCOV artifact was parsed as bounded data/);
});

test("LCOV source paths preserve leading and trailing whitespace instead of aliasing another repository file", async (context) => {
  const cases = ["src/value.js ", "src/value.js\u00a0", " src/value.js"];
  for (const source of cases) {
    const { root, base, head } = await committedChange();
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFiles(root, {
      "coverage/lcov.info": `SF:${source}\nDA:2,1\nDA:3,1\nend_of_record\n`,
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

test("partial changed-line coverage is not generalized to the rest of the change", async (context) => {
  const { root, base, head } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  const baselineReport = await analyzeRepository({ repo: root, base });
  await writeFiles(root, {
    "coverage/lcov.info": "SF:src/value.js\nDA:2,1\nDA:3,0\nend_of_record\n",
  });
  const report = await analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: head });
  const item = report.assessments[0];
  assert.equal(item?.coverage?.state, "partially-covered");
  assert.equal(item?.coverage?.coveredChangedLines, 1);
  assert.equal(item?.coverage?.uncoveredChangedLines, 1);
  assert.deepEqual(item?.evidenceBoundary, baselineReport.assessments[0]?.evidenceBoundary);
});

test("zero-hit changed lines remain negative evidence for only the supplied coverage artifact", async (context) => {
  const { root, base, head } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  const baselineReport = await analyzeRepository({ repo: root, base });
  await writeFiles(root, {
    "coverage/lcov.info": "SF:src/value.js\nDA:2,0\nDA:3,0\nend_of_record\n",
  });
  const report = await analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: head });
  const item = report.assessments[0];
  assert.equal(item?.coverage?.state, "uncovered");
  assert.deepEqual(item?.evidenceBoundary, baselineReport.assessments[0]?.evidenceBoundary);
  assert.ok(item?.evidence.some((entry) => entry.label === "Changed lines measured with zero hits"));
});

test("the explicit LCOV exemption does not authorize sibling untracked inputs", async (context) => {
  const { root, base, head } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "coverage/lcov.info": "SF:src/value.js\nDA:2,1\nDA:3,1\nend_of_record\n",
    "coverage/extra.txt": "outside the declared artifact\n",
  });
  await assert.rejects(
    analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: head }),
    /Git-visible untracked file.*coverage\/extra\.txt/,
  );
});

test("coverage from a different commit is rejected without strengthening any file", async (context) => {
  const { root, base } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "coverage/lcov.info": "SF:src/value.js\nDA:2,1\nDA:3,1\nend_of_record\n",
  });
  const report = await analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: base });
  assert.equal(report.coverage?.accepted, false);
  assert.equal(report.coverage?.commitBinding, "commit-mismatch");
  assert.equal(report.assessments[0]?.coverage, undefined);
  assert.match(report.notes.join("\n"), /Coverage artifact was not used/);
});

test("working-tree selections reject committed coverage binding", async (context) => {
  const root = await initializeRepository(baseline);
  context.after(() => rm(root, { recursive: true, force: true }));
  const head = git(root, "rev-parse", "HEAD").trim();
  await writeFiles(root, {
    "src/value.js": "export function value(input) {\n  return Number(input) + 1;\n}\n",
    "coverage/lcov.info": "SF:src/value.js\nDA:2,1\nend_of_record\n",
  });
  const report = await analyzeRepository({ repo: root, coverageLcov: "coverage/lcov.info", coverageCommit: head });
  assert.equal(report.coverage?.accepted, false);
  assert.equal(report.coverage?.commitBinding, "uncommitted-selection");
  assert.equal(report.assessments.find((item) => item.file.path === "src/value.js")?.coverage, undefined);
});

test("malformed LCOV fails closed instead of producing partial trusted evidence", async (context) => {
  const { root, base, head } = await committedChange();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "coverage/lcov.info": "SF:src/value.js\nDA:not-a-line,1\nend_of_record\n",
  });
  await assert.rejects(
    analyzeRepository({ repo: root, base, coverageLcov: "coverage/lcov.info", coverageCommit: head }),
    CoverageError,
  );
});

test("changed-line reconstruction is bounded and fails closed for oversized changes", async (context) => {
  const root = await initializeRepository({ "notes.txt": "seed\n" });
  context.after(() => rm(root, { recursive: true, force: true }));
  const base = git(root, "rev-parse", "HEAD").trim();
  const oversized = Array.from({ length: 50_001 }, (_, index) => `line-${index + 1}`).join("\n") + "\n";
  await writeFiles(root, { "notes.txt": oversized });
  git(root, "add", "notes.txt");
  git(root, "commit", "-qm", "oversized change");
  const head = git(root, "rev-parse", "HEAD").trim();
  await writeFiles(root, {
    "coverage/lcov.info": "SF:notes.txt\nDA:1,1\nend_of_record\n",
  });

  const report = await analyzeRepository({
    repo: root,
    base,
    coverageLcov: "coverage/lcov.info",
    coverageCommit: head,
  });
  const item = report.assessments.find((assessment) => assessment.file.path === "notes.txt");
  assert.equal(report.coverage?.accepted, true);
  assert.equal(item?.coverage?.state, "unmeasured");
  assert.equal(item?.coverage?.coveredChangedLines, 0);
  assert.match(item?.coverage?.detail ?? "", /50000 current-line limit/);
  assert.ok(item?.evidence.every((entry) => entry.kind !== "coverage-artifact"));
});

test("coverage options are paired for library callers as well as the CLI", async (context) => {
  const root = await initializeRepository(baseline);
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(analyzeRepository({ repo: root, coverageLcov: "coverage/lcov.info" }), CoverageError);
  const cli = runCli(["--repo", root, "--coverage-lcov", "coverage/lcov.info"]);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /--coverage-lcov and --coverage-commit must be supplied together/);
});