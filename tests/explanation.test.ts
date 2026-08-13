import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { explainEvidenceBoundary } from "../src/explanation.js";
import { renderGithubSummary } from "../src/report/github.js";
import { renderHtmlReport } from "../src/report/html.js";
import { renderTerminalReport } from "../src/report/terminal.js";
import type { CheckResult, FileAssessment } from "../src/types.js";
import { initializeRepository, writeFiles } from "./helpers.js";

function assessment(overrides: Partial<FileAssessment> = {}): FileAssessment {
  return {
    file: { path: "src/value.js", change: "modified", language: "javascript", additions: 1, deletions: 1, binary: false, hunks: [], deletedSymbolHints: [] },
    changedSymbols: [],
    changedCalls: [],
    impactedFiles: [],
    relatedTests: ["test/value.test.js"],
    executedTests: [],
    testExecutions: [],
    status: "unverified",
    risk: "medium",
    riskScore: 40,
    reasons: [],
    evidence: [],
    limitations: [],
    ...overrides,
  };
}

function targetedCheck(outcome: "passed" | "failed" | "zero-tests" | "skipped" | "not-observed", status: CheckResult["status"] = "passed"): CheckResult {
  return {
    id: "js:test:node:targeted",
    label: "targeted node test",
    kind: "test",
    command: "node",
    args: ["--test", "test/value.test.js"],
    origin: "fixture",
    executesRepositoryCode: true,
    targetRunner: "node-test",
    targetFiles: ["test/value.test.js"],
    targetQualifications: [{ path: "test/value.test.js", runnerPath: "test/value.test.js", basis: "runner-default-pattern", confidence: "high", detail: "Qualified.", limitation: "File-scoped only." }],
    targetObservations: [{ path: "test/value.test.js", runnerPath: "test/value.test.js", outcome, testsObserved: outcome === "passed" || outcome === "failed" ? 1 : 0, detail: "Observed fixture outcome." }],
    status,
    exitCode: status === "passed" ? 0 : 1,
    durationMs: 1,
    output: "",
    outputTruncated: false,
    explanation: "Fixture result.",
  };
}

test("static-only first run exposes a machine-readable actionable boundary across output surfaces", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "actionable", private: true, type: "module", scripts: { test: "node --test" } }),
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value, 2));\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });

  const report = await analyzeRepository({ repo: root, now: () => new Date("2026-01-01T00:00:00Z") });
  const boundary = report.assessments[0]?.evidenceBoundary;
  assert.equal(boundary?.strongestEvidence, "static-relationship");
  assert.equal(boundary?.stage, "target-invocation");
  assert.equal(boundary?.reason, "checks-not-run");
  assert.equal(boundary?.proofdiffFailClosed, false);
  assert.equal(boundary?.nextAction?.kind, "review-run-checks");
  assert.equal(boundary?.nextAction?.requiresRepositoryCodeExecution, true);
  assert.match(boundary?.nextAction?.detail ?? "", /not sandboxed/);
  assert.match(JSON.stringify(report), /"evidenceBoundary"/);
  assert.match(renderTerminalReport(report, { color: false }), /Boundary: target-invocation · checks-not-run/);
  assert.match(renderGithubSummary(report), /Evidence boundary: <code>target-invocation<\/code> · <code>checks-not-run<\/code>/);
  assert.match(renderHtmlReport(report), /Evidence boundary · target-invocation · checks-not-run/);
});

test("a passing related target stops honestly at changed-code execution", async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ name: "actionable-pass", private: true, type: "module", scripts: { test: "node --test" } }),
    "src/value.js": "export const value = 1;\n",
    "test/value.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value', () => assert.equal(value, 2));\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFiles(root, { "src/value.js": "export const value = 2;\n" });

  const report = await analyzeRepository({ repo: root, runChecks: true, timeoutMs: 20_000 });
  const boundary = report.assessments[0]?.evidenceBoundary;
  assert.equal(report.assessments[0]?.status, "verified");
  assert.equal(boundary?.strongestEvidence, "related-test-file-passed");
  assert.equal(boundary?.stage, "changed-code-execution");
  assert.equal(boundary?.reason, "changed-code-execution-unobserved");
  assert.equal(boundary?.proofdiffFailClosed, true);
  assert.equal(boundary?.nextAction, null);
});

test("zero, skipped, and unavailable target observations remain non-strengthening with distinct reasons", () => {
  for (const [outcome, reason, failClosed] of [
    ["zero-tests", "zero-tests", false],
    ["skipped", "all-skipped", false],
    ["not-observed", "observer-inconclusive", true],
  ] as const) {
    const boundary = explainEvidenceBoundary(assessment(), [targetedCheck(outcome)]);
    assert.equal(boundary.stage, "runtime-observation");
    assert.equal(boundary.reason, reason);
    assert.equal(boundary.proofdiffFailClosed, failClosed);
    assert.notEqual(boundary.strongestEvidence, "related-test-file-passed");
  }
});

test("an unattributed targeted process failure is classified at the failure-attribution boundary", () => {
  const check = targetedCheck("not-observed", "failed");
  check.targetObservations = [{ path: "test/value.test.js", runnerPath: "test/value.test.js", outcome: "not-observed", testsObserved: 0, detail: "Observer unavailable." }];
  const boundary = explainEvidenceBoundary(assessment({ status: "verification-failed" }), [check]);
  assert.equal(boundary.strongestEvidence, "verification-failure");
  assert.equal(boundary.stage, "failure-attribution");
  assert.equal(boundary.reason, "failure-unattributed");
  assert.equal(boundary.proofdiffFailClosed, true);
  assert.equal(boundary.nextAction?.kind, "inspect-failure");
});

test("an inconclusive observation from a passing targeted process does not invent failure attribution", () => {
  const inconclusive = targetedCheck("not-observed", "passed");
  const opaqueFailure: CheckResult = {
    id: "js:lint:opaque",
    label: "lint",
    kind: "lint",
    command: "npm",
    args: ["run", "lint"],
    origin: "package.json",
    executesRepositoryCode: true,
    status: "failed",
    exitCode: 1,
    durationMs: 1,
    output: "",
    outputTruncated: false,
    explanation: "Opaque lint failure.",
  };
  const boundary = explainEvidenceBoundary(assessment({ status: "verification-failed" }), [inconclusive, opaqueFailure]);
  assert.equal(boundary.strongestEvidence, "verification-failure");
  assert.equal(boundary.stage, "target-invocation");
  assert.equal(boundary.reason, "check-failed");
  assert.equal(boundary.proofdiffFailClosed, false);
});

test("an opaque passing command cannot cross the runner-qualification boundary", () => {
  const check: CheckResult = {
    id: "js:test:opaque",
    label: "npm test",
    kind: "test",
    command: "npm",
    args: ["test"],
    origin: "package.json",
    executesRepositoryCode: true,
    status: "passed",
    exitCode: 0,
    durationMs: 1,
    output: "",
    outputTruncated: false,
    explanation: "Passed without target identity.",
  };
  const boundary = explainEvidenceBoundary(assessment({ status: "partially-verified" }), [check]);
  assert.equal(boundary.strongestEvidence, "passing-check");
  assert.equal(boundary.stage, "runner-qualification");
  assert.equal(boundary.reason, "opaque-passing-check");
  assert.equal(boundary.proofdiffFailClosed, true);
  assert.equal(boundary.nextAction?.kind, "qualify-related-test");
});

test("unsupported file semantics are explicit instead of being collapsed into generic unknown", () => {
  const item = assessment({
    file: { path: "policy/access.rego", change: "modified", language: "unknown", additions: 1, deletions: 1, binary: false, hunks: [], deletedSymbolHints: [] },
    relatedTests: [],
    status: "unknown",
    limitations: ["Only file-level analysis is available for this file type."],
  });
  const boundary = explainEvidenceBoundary(item, []);
  assert.equal(boundary.stage, "static-relationship");
  assert.equal(boundary.reason, "unsupported-semantics");
  assert.equal(boundary.proofdiffFailClosed, true);
  assert.equal(boundary.nextAction?.kind, "inspect-static-limitations");
});
