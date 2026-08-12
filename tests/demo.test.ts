import assert from "node:assert/strict";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { git, temporaryDirectory } from "./helpers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function analyzeFixture(relative: string) {
  const fixture = path.join(projectRoot, relative);
  const root = await temporaryDirectory("proofdiff-demo-test-");
  await cp(path.join(fixture, "base"), root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "demo-tests@example.invalid");
  git(root, "config", "user.name", "ProofDiff Demo Tests");
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  await cp(path.join(fixture, "after"), root, { recursive: true, force: true });
  git(root, "add", "-u");
  return { root, report: await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 }) };
}

test("mixed demo combines observed JavaScript evidence with unverified Python", async (context) => {
  const { root, report } = await analyzeFixture("fixtures/demo");
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(report.summary.overallStatus, "partially-verified");
  assert.equal(report.summary.counts.verified, 1);
  assert.equal(report.summary.counts.unverified, 1);
  const discount = report.assessments.find((item) => item.file.path === "src/discount.js");
  assert.deepEqual(discount?.executedTests, ["test/checkout.test.js"]);
  assert.ok(discount?.impactedFiles.includes("src/checkout.js"));
});

test("opaque-script demo stays partial when a related failing test was excluded", async (context) => {
  const { root, report } = await analyzeFixture("fixtures/scenarios/opaque-test-script");
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(report.checks[0]?.status, "passed");
  assert.equal(report.assessments[0]?.status, "partially-verified");
  assert.deepEqual(report.assessments[0]?.relatedTests, ["test/access.test.js"]);
  assert.deepEqual(report.assessments[0]?.testExecutions, []);
});

test("failing demo connects a changed file to a targeted failed test", async (context) => {
  const { root, report } = await analyzeFixture("fixtures/scenarios/failing-check");
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(report.summary.overallStatus, "verification-failed");
  assert.equal(report.assessments[0]?.risk, "critical");
  assert.deepEqual(report.assessments[0]?.testExecutions.map((execution) => [execution.path, execution.status]), [["test/tax.test.js", "failed"]]);
});

test("unsupported demo remains unknown without inventing structural evidence", async (context) => {
  const { root, report } = await analyzeFixture("fixtures/scenarios/unsupported-change");
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(report.summary.overallStatus, "unknown");
  assert.equal(report.summary.checksDiscovered, 0);
  assert.equal(report.assessments[0]?.file.language, "unknown");
  assert.equal(report.assessments[0]?.changedSymbols.length, 0);
  assert.match(report.assessments[0]?.limitations.join(" ") ?? "", /file-level analysis/);
});
