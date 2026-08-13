import path from "node:path";
import type { AnalysisReport, FileAssessment, VerificationStatus } from "../types.js";
import { escapeHtml, plural, sanitizeControlCharacters } from "../util.js";

export interface GithubSummaryOptions {
  htmlPath?: string;
  maxFiles?: number;
  maxPathsPerFile?: number;
}

const statusLabels: Record<VerificationStatus, string> = {
  verified: "Related test file passed",
  "partially-verified": "Partially verified",
  unverified: "Unverified",
  unknown: "Unknown",
  "verification-failed": "Verification failed",
};

const statusIcons: Record<VerificationStatus, string> = {
  verified: "✅",
  "partially-verified": "⚠️",
  unverified: "⚠️",
  unknown: "❔",
  "verification-failed": "❌",
};

function inlineCode(value: string): string {
  const singleLine = sanitizeControlCharacters(value)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, " ");
  const bounded = singleLine.length > 240 ? `${singleLine.slice(0, 239)}…` : singleLine;
  return `<code>${escapeHtml(bounded)}</code>`;
}

function summaryText(value: string, repositoryRoot: string): string {
  let sanitized = sanitizeControlCharacters(value)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, " ");
  for (const root of new Set([repositoryRoot, repositoryRoot.replaceAll("\\", "/"), repositoryRoot.replaceAll("/", "\\")])) {
    if (root.length > 1) sanitized = sanitized.replaceAll(root, "<repository>");
  }
  const bounded = sanitized.length > 320 ? `${sanitized.slice(0, 319)}…` : sanitized;
  return escapeHtml(bounded);
}

function pathList(paths: string[], limit: number): string {
  const displayed = paths.slice(0, limit).map(inlineCode).join(", ");
  return paths.length > limit ? `${displayed} (+${paths.length - limit} more)` : displayed;
}

function targetEvidence(item: FileAssessment, maxPaths: number): string {
  if (item.status === "verification-failed") {
    const outcomes = item.testExecutions.map((execution) => `${execution.path} (${execution.status})`);
    const attributed = outcomes.length > 0
      ? `Target ${outcomes.length === 1 ? "outcome" : "outcomes"}: ${pathList(outcomes, maxPaths)}.`
      : "An applicable check failed, errored, or timed out; no exact target outcome was available.";
    const alsoPassed = item.executedTests.length > 0
      ? ` A passing target was also observed: ${pathList(item.executedTests, maxPaths)}; it does not erase the relevant failure.`
      : "";
    return `${attributed}${alsoPassed}`;
  }
  if (item.executedTests.length > 0) {
    return `Observed passing ${item.executedTests.length === 1 ? "target" : "targets"}: ${pathList(item.executedTests, maxPaths)}. At least one non-skipped test was observed for each named target.`;
  }
  if (item.testExecutions.length > 0) {
    const outcomes = item.testExecutions.map((execution) => `${execution.path} (${execution.status})`);
    return `Target ${outcomes.length === 1 ? "outcome" : "outcomes"}: ${pathList(outcomes, maxPaths)}. No passing target observation strengthened this file.`;
  }
  const inconclusiveTargets = item.evidence
    .filter((entry) => entry.kind === "limitation" && entry.checkId !== undefined)
    .map((entry) => entry.label);
  if (inconclusiveTargets.length > 0) {
    return `Target observation did not strengthen evidence: ${pathList(inconclusiveTargets, maxPaths)}.`;
  }
  if (item.relatedTests.length > 0) {
    return `Static relationship only: ${pathList(item.relatedTests, maxPaths)}. No passing target observation was recorded.`;
  }
  return "No supported related test-like path was established.";
}

function reportPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return path.isAbsolute(value) || path.win32.isAbsolute(value) ? path.posix.basename(normalized) : normalized;
}

export function renderGithubSummary(report: AnalysisReport, options: GithubSummaryOptions = {}): string {
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 12, 50));
  const maxPaths = Math.max(1, Math.min(options.maxPathsPerFile ?? 3, 10));
  const risk = report.summary.highestRisk?.toUpperCase() ?? "NONE";
  const counts = (Object.keys(statusLabels) as VerificationStatus[])
    .filter((status) => report.summary.counts[status] > 0)
    .map((status) => `${report.summary.counts[status]} ${statusLabels[status].toLowerCase()}`)
    .join(" · ");
  const output = [
    "## ProofDiff · Change Evidence",
    "",
    `**${statusLabels[report.summary.overallStatus]}** · ${plural(report.summary.filesChanged, "changed file")} · highest risk **${risk}**`,
    counts ? `${counts}.` : "No changed files were assessed.",
    "",
    report.trust.repositoryCodeExecuted
      ? "**Run mode:** Repository-defined checks ran with explicit consent. They were bounded, but not sandboxed."
      : "**Run mode:** Static only. No repository code was executed.",
    "",
    "### Changed files",
    "",
  ];

  if (report.assessments.length === 0) output.push("No changed files matched the selected diff.", "");
  for (const item of report.assessments.slice(0, maxFiles)) {
    output.push(`- ${statusIcons[item.status]} **${statusLabels[item.status]}** · ${inlineCode(item.file.path)} · ${item.risk.toUpperCase()} risk`);
    output.push(`  - ${targetEvidence(item, maxPaths)}`);
    output.push("");
  }
  if (report.assessments.length > maxFiles) {
    output.push(`_${report.assessments.length - maxFiles} more changed ${report.assessments.length - maxFiles === 1 ? "file is" : "files are"} omitted from this bounded summary._`, "");
  }

  if (report.notes.length > 0) {
    output.push("### Analysis notes", "");
    for (const note of report.notes.slice(0, 3)) output.push(`- ${summaryText(note, report.repository.root)}`);
    if (report.notes.length > 3) output.push(`- _${report.notes.length - 3} more notes are available in the detailed report._`);
    output.push("");
  }

  if (report.summary.overallStatus === "verification-failed") {
    output.push("**Next step:** Inspect the relevant failure and full provenance; a passing target elsewhere does not erase it.", "");
  } else if (report.notes.some((note) => note.startsWith("Check execution was requested"))) {
    output.push("**Next step:** Check discovery found nothing it could run. Inspect the supported conventions and detailed limitations; do not treat this unknown state as a pass.", "");
  } else if (!report.trust.repositoryCodeExecuted && report.summary.filesChanged > 0) {
    output.push("**Next step:** Keep static-only analysis for untrusted changes. After review, use `run-checks: true` only in a secret-free isolated job if you want ProofDiff to seek runner observations.", "");
  } else if (report.assessments.some((item) => item.status !== "verified")) {
    output.push("**Next step:** Inspect the files without passing target observations and the detailed limitations before deciding whether more verification is needed.", "");
  }

  output.push("> **Trust boundary:** A related target pass means ProofDiff observed at least one non-skipped test for that exact runner-qualified target. It does not show that changed code ran or that behavior is correct.", "");
  if (options.htmlPath) {
    output.push(`Full provenance remains in the job log and configured HTML report ${inlineCode(reportPath(options.htmlPath))}. Upload that file as a workflow artifact to retain it.`);
  } else {
    output.push("Full provenance remains in the job log and any configured JSON or HTML report.");
  }
  output.push("");
  return output.join("\n");
}
