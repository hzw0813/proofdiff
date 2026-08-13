import assert from "node:assert/strict";
import test from "node:test";
import { renderGithubSummary } from "../src/report/github.js";
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

test("GitHub summary distinguishes observed, static-only, failed, and unknown evidence", () => {
  const github = structuredClone(report);
  const observed = structuredClone(report.assessments[0]!);
  observed.file.path = "src/observed.ts";
  observed.status = "verified";
  observed.executedTests = ["test/observed.test.ts"];
  observed.relatedTests = ["test/observed.test.ts"];
  const staticOnly = structuredClone(report.assessments[0]!);
  staticOnly.file.path = "src/static.ts";
  staticOnly.status = "partially-verified";
  staticOnly.relatedTests = ["test/static.test.ts"];
  const failed = structuredClone(report.assessments[0]!);
  failed.file.path = "src/failing.ts";
  failed.status = "verification-failed";
  failed.testExecutions = [{ path: "test/failing.test.ts", status: "failed", checkId: "node:targeted" }];
  failed.executedTests = ["test/also-passed.test.ts"];
  const hostile = structuredClone(report.assessments[0]!);
  hostile.file.path = `src/</code><script>alert(1)</script>\n\u202Eunknown.ts${"x".repeat(300)}`;
  github.assessments = [observed, staticOnly, failed, hostile];
  github.notes = [`Analysis stopped at /tmp/<repo>/src and \u202Eneeds review.${"n".repeat(400)}`];
  github.summary = {
    ...github.summary,
    filesChanged: 4,
    overallStatus: "verification-failed",
    highestRisk: "high",
    counts: { verified: 1, "partially-verified": 1, unverified: 0, unknown: 1, "verification-failed": 1 },
  };

  const summary = renderGithubSummary(github, { htmlPath: "proofdiff-report.html" });
  assert.match(summary, /^## ProofDiff · Change Evidence/);
  assert.match(summary, /Observed passing target: <code>test\/observed\.test\.ts<\/code>/);
  assert.match(summary, /Static relationship only: <code>test\/static\.test\.ts<\/code>\. No passing target observation was recorded/);
  assert.match(summary, /Target outcome: <code>test\/failing\.test\.ts \(failed\)<\/code>/);
  assert.match(summary, /passing target was also observed: <code>test\/also-passed\.test\.ts<\/code>; it does not erase the relevant failure/);
  assert.match(summary, /No supported related test-like path was established/);
  assert.match(summary, /does not show that changed code ran or that behavior is correct/);
  assert.match(summary, /configured HTML report <code>proofdiff-report\.html<\/code>/);
  assert.doesNotMatch(summary, /<script>alert\(1\)<\/script>/);
  assert.match(summary, /&lt;script&gt;alert\(1\)&lt;\/script&gt; unknown\.ts/);
  assert.doesNotMatch(summary, /\u202E/);
  assert.match(summary, /…<\/code>/);
  assert.doesNotMatch(summary, /\/tmp\/<repo>/);
  assert.match(summary, /Analysis notes/);
  assert.match(summary, /Analysis stopped at &lt;repository&gt;\/src and needs review/);
  assert.match(summary, /…/);
  assert.match(summary, /Next step:.*relevant failure and full provenance/);
  assert.doesNotMatch(summary, /function · run/);
});

test("GitHub summary preserves zero, skipped, and unavailable target outcomes as non-strengthening", () => {
  for (const outcome of ["zero-tests", "skipped", "not-observed"] as const) {
    const inconclusive = structuredClone(report);
    inconclusive.assessments[0]!.status = "unverified";
    inconclusive.assessments[0]!.relatedTests = ["test/value.test.ts"];
    inconclusive.assessments[0]!.evidence.push({
      kind: "limitation",
      label: `test/value.test.ts: ${outcome}`,
      detail: "No positive observation.",
      confidence: "high",
      checkId: "node:targeted",
    });
    inconclusive.summary.overallStatus = "unverified";
    inconclusive.summary.counts = { verified: 0, "partially-verified": 0, unverified: 1, unknown: 0, "verification-failed": 0 };
    const summary = renderGithubSummary(inconclusive);
    assert.match(summary, new RegExp(`Target observation did not strengthen evidence: <code>test/value\\.test\\.ts: ${outcome}</code>`));
    assert.doesNotMatch(summary, /Observed passing target/);
  }
});

test("GitHub summary exposes an unattributed applicable failure without inventing target attribution", () => {
  const failed = structuredClone(report);
  failed.assessments[0]!.status = "verification-failed";
  failed.summary.overallStatus = "verification-failed";
  failed.summary.counts = { verified: 0, "partially-verified": 0, unverified: 0, unknown: 0, "verification-failed": 1 };
  const summary = renderGithubSummary(failed, { htmlPath: "/private/runner/work/repo/proofdiff-report.html" });
  assert.match(summary, /An applicable check failed, errored, or timed out; no exact target outcome was available/);
  assert.match(summary, /configured HTML report <code>proofdiff-report\.html<\/code>/);
  assert.doesNotMatch(summary, /private\/runner/);
});

test("GitHub summary preserves bounded analysis limitations and static-only guidance", () => {
  const limited = structuredClone(report);
  limited.notes = [
    "Repository source analysis was limited to the first 5,000 tracked/unignored files.",
    "Checks were discovered but not executed.",
    "Third note.",
    "Fourth note.",
  ];
  const summary = renderGithubSummary(limited);
  assert.match(summary, /Repository source analysis was limited to the first 5,000 tracked\/unignored files/);
  assert.match(summary, /1 more notes are available in the detailed report/);
  assert.match(summary, /Keep static-only analysis for untrusted changes/);
  assert.match(summary, /`run-checks: true` only in a secret-free isolated job/);
});

test("GitHub summary does not recommend rerunning checks when execution was already requested but unsupported", () => {
  const unsupported = structuredClone(report);
  unsupported.notes = ["Check execution was requested, but no supported checks were discovered."];
  const summary = renderGithubSummary(unsupported);
  assert.match(summary, /Check discovery found nothing it could run/);
  assert.match(summary, /do not treat this unknown state as a pass/);
  assert.doesNotMatch(summary, /use `run-checks: true`/);
});

test("GitHub summary bounds changed-file and related-path detail", () => {
  const bounded = structuredClone(report);
  bounded.assessments = Array.from({ length: 5 }, (_, index) => {
    const item = structuredClone(report.assessments[0]!);
    item.file.path = `src/file-${index}.ts`;
    item.relatedTests = ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"];
    return item;
  });
  bounded.summary.filesChanged = 5;
  bounded.summary.counts.unknown = 5;
  const summary = renderGithubSummary(bounded, { maxFiles: 2, maxPathsPerFile: 2 });
  assert.match(summary, /3 more changed files are omitted/);
  assert.match(summary, /\(\+1 more\)/);
  assert.doesNotMatch(summary, /src\/file-2\.ts/);
  assert.doesNotMatch(summary, /test\/c\.test\.ts/);
});
