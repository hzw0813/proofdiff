import assert from "node:assert/strict";
import test from "node:test";
import { renderHtmlReport } from "../src/report/html.js";
import { renderTerminalReport } from "../src/report/terminal.js";
import type { AnalysisReport } from "../src/types.js";

const report: AnalysisReport = {
  schemaVersion: "1.0", proofdiffVersion: "0.1.0", generatedAt: "2026-01-01T00:00:00.000Z",
  repository: { root: "/tmp/<repo>", name: "<script>alert(1)</script>", head: "abc", branch: "main", dirty: true },
  selection: { mode: "working-tree", description: "working tree vs HEAD" },
  summary: { filesChanged: 1, symbolsChanged: 1, checksDiscovered: 0, checksRun: 0, counts: { verified: 0, "partially-verified": 0, unverified: 0, unknown: 1, "verification-failed": 0 }, overallStatus: "unknown", highestRisk: "medium" },
  assessments: [{ file: { path: "src/<unsafe>.ts", change: "modified", language: "typescript", additions: 1, deletions: 1, binary: false, hunks: [], deletedSymbolHints: [] }, changedSymbols: [{ name: "run", kind: "function", range: { start: 1, end: 1 }, exported: true, confidence: "high" }], changedCalls: [], impactedFiles: [], relatedTests: [], executedTests: [], testExecutions: [], status: "unknown", risk: "medium", riskScore: 40, reasons: ["No checks ran."], evidence: [], limitations: ["No tests found."] }],
  checks: [], discoveredChecks: [], notes: [], trust: { repositoryCodeExecuted: false, statement: "No repository code was executed." },
};

test("HTML report is self-contained, interactive, and escapes repository data", () => {
  const html = renderHtmlReport(report);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<link rel="icon" href="data:">/);
  assert.match(html, /id="status-filter"/);
  assert.match(html, /Calls in changed lines/);
  assert.match(html, /Related-file presence alone cannot produce/);
  assert.match(html, /Related test file passed/);
  assert.match(html, /changed-symbol or changed-line execution/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("HTML report describes mixed overall evidence without denying a file-level test pass", () => {
  const mixed = structuredClone(report);
  mixed.summary.filesChanged = 2;
  mixed.summary.overallStatus = "partially-verified";
  mixed.summary.counts.verified = 1;
  mixed.summary.counts.unknown = 1;
  const html = renderHtmlReport(mixed);
  assert.match(html, /Evidence strength differs across changed files/);
  assert.doesNotMatch(html, /Some applicable evidence passed, but no statically related test-file execution was observed/);
});

test("terminal report defines evidence semantics", () => {
  const output = renderTerminalReport(report, { color: false, width: 90 });
  assert.match(output, /UNKNOWN/);
  assert.match(output, /Trust boundary/);
  assert.match(output, /Related test file passed requires runner qualification, explicit supply, and a non-skipped passing test observed for that exact target/);
  assert.match(output, /not changed-symbol or changed-line coverage/);
});

test("HTML check details expose qualification and observations without dumping observer source", () => {
  const observed = structuredClone(report);
  observed.checks.push({
    id: "node:targeted",
    label: "targeted node-test",
    kind: "test",
    command: "node",
    args: ["--test", "--test-reporter=data:text/javascript,secret-observer-source", "test/value.test.js"],
    origin: "fixture",
    executesRepositoryCode: true,
    targetRunner: "node-test",
    targetFiles: ["test/value.test.js"],
    targetQualifications: [{ path: "test/value.test.js", runnerPath: "test/value.test.js", basis: "runner-default-pattern", confidence: "high", detail: "Matches a documented default.", limitation: "No line coverage." }],
    targetObservations: [{ path: "test/value.test.js", runnerPath: "test/value.test.js", outcome: "passed", testsObserved: 2, detail: "Two passed." }],
    status: "passed",
    exitCode: 0,
    durationMs: 10,
    output: "",
    outputTruncated: false,
    explanation: "Observed.",
  });
  const html = renderHtmlReport(observed);
  assert.match(html, /Target qualifications/);
  assert.match(html, /runner-default-pattern/);
  assert.match(html, /Target observations/);
  assert.match(html, /2 non-skipped observed/);
  assert.match(html, /--test-reporter=&lt;ProofDiff observer&gt;/);
  assert.doesNotMatch(html, /secret-observer-source/);
});

test("terminal report strips untrusted control sequences", () => {
  const hostile = structuredClone(report);
  hostile.assessments[0]!.file.path = "src/\u001b[2Junsafe.ts";
  hostile.checks.push({ id: "x", label: "\u001b[31mhostile", kind: "other", command: "x", args: [], origin: "fixture", executesRepositoryCode: false, status: "not-run", exitCode: null, durationMs: 0, output: "", outputTruncated: false, explanation: "test" });
  const output = renderTerminalReport(hostile, { color: false });
  assert.doesNotMatch(output, /\u001b/);
  assert.match(output, /src\/\[2Junsafe\.ts/);
});
