import path from "node:path";
import type { AnalysisReport, RiskLevel, VerificationStatus } from "../types.js";
import { plural, sanitizeControlCharacters } from "../util.js";

export interface TerminalRenderOptions {
  color?: boolean;
  width?: number;
}

const labels: Record<VerificationStatus, string> = {
  verified: "RELATED TEST FILE PASSED",
  "partially-verified": "PARTIAL",
  unverified: "UNVERIFIED",
  unknown: "UNKNOWN",
  "verification-failed": "FAILED",
};

function palette(enabled: boolean) {
  const wrap = (code: number) => (value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    bold: wrap(1), dim: wrap(2), cyan: wrap(36), green: wrap(32), yellow: wrap(33), red: wrap(31), magenta: wrap(35), gray: wrap(90),
  };
}

function statusColor(status: VerificationStatus, colors: ReturnType<typeof palette>): (value: string) => string {
  if (status === "verified") return colors.green;
  if (status === "partially-verified") return colors.yellow;
  if (status === "verification-failed") return colors.red;
  if (status === "unverified") return colors.magenta;
  return colors.gray;
}

function riskColor(risk: RiskLevel, colors: ReturnType<typeof palette>): (value: string) => string {
  if (risk === "critical" || risk === "high") return colors.red;
  if (risk === "medium") return colors.yellow;
  return colors.green;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(1, width - 1))}…`;
}

export function renderTerminalReport(report: AnalysisReport, options: TerminalRenderOptions = {}): string {
  const width = Math.max(60, options.width ?? 100);
  const colors = palette(options.color ?? false);
  const safe = (value: string): string => sanitizeControlCharacters(value);
  const output: string[] = [];
  output.push("");
  output.push(`${colors.bold(colors.cyan("ProofDiff"))}  ${colors.dim("Evidence for this change")}`);
  output.push(colors.dim("─".repeat(Math.min(width, 100))));
  output.push(`${colors.bold(safe(path.basename(report.repository.root)))}  ${colors.dim(safe(report.selection.description))}${report.repository.head ? `  ${colors.dim(`@ ${safe(report.repository.head)}`)}` : ""}`);
  output.push("");

  const status = statusColor(report.summary.overallStatus, colors)(labels[report.summary.overallStatus]);
  const risk = report.summary.highestRisk ? riskColor(report.summary.highestRisk, colors)(report.summary.highestRisk.toUpperCase()) : "NONE";
  output.push(`${colors.bold(status)}  ·  highest risk ${colors.bold(risk)}  ·  ${plural(report.summary.filesChanged, "file")}  ·  ${plural(report.summary.symbolsChanged, "symbol")}`);
  output.push(`${report.summary.counts.verified} related test-file pass${report.summary.counts.verified === 1 ? "" : "es"}  ${report.summary.counts["partially-verified"]} partial  ${report.summary.counts.unverified} unverified  ${report.summary.counts.unknown} unknown  ${report.summary.counts["verification-failed"]} failed`);
  output.push("");

  if (report.assessments.length === 0) {
    output.push(colors.dim("No changed files to assess."));
  }

  for (const assessment of report.assessments) {
    const badge = statusColor(assessment.status, colors)(labels[assessment.status].padEnd(10));
    const riskBadge = riskColor(assessment.risk, colors)(`${assessment.risk.toUpperCase()} ${assessment.riskScore}`);
    output.push(`${badge} ${colors.bold(truncate(safe(assessment.file.path), width - 44))}  ${riskBadge}`);
    const change = `${assessment.file.change}, +${assessment.file.additions}/-${assessment.file.deletions}`;
    const symbols = assessment.changedSymbols.length > 0
      ? assessment.changedSymbols.slice(0, 5).map((symbol) => safe(symbol.name)).join(", ")
      : "no changed symbol identified";
    output.push(`  ${colors.dim(change)}  ·  ${symbols}`);
    if (assessment.changedCalls.length > 0) {
      const suffix = " (structural references; not runtime)";
      const calls = `${assessment.changedCalls.slice(0, 5).map((site) => `${site.name}:${site.line}`).join(", ")}${assessment.changedCalls.length > 5 ? ` (+${assessment.changedCalls.length - 5})` : ""}`;
      output.push(`  ${colors.cyan("Calls:")} ${truncate(safe(calls), Math.max(12, width - 9 - suffix.length))}${colors.dim(suffix)}`);
    }
    if (assessment.reasons[0]) output.push(`  ${colors.yellow("Review:")} ${safe(assessment.reasons.slice(0, 2).join(" "))}`);
    const executed = assessment.evidence.find((item) => item.kind === "executed-test");
    const passing = assessment.evidence.find((item) => item.kind === "passing-check" && item.checkId?.endsWith(":targeted"))
      ?? assessment.evidence.find((item) => item.kind === "passing-check" && item.checkId?.includes(":test:"))
      ?? assessment.evidence.find((item) => item.kind === "passing-check");
    const failing = assessment.evidence.find((item) => item.kind === "failing-check" && item.checkId?.endsWith(":targeted"))
      ?? assessment.evidence.find((item) => item.kind === "failing-check");
    if (failing) output.push(`  ${colors.red("Evidence:")} ${safe(failing.label)} — ${safe(failing.detail)}`);
    else if (executed) output.push(`  ${colors.green("Evidence:")} ${safe(executed.label)} — ${safe(executed.detail)}`);
    else if (passing) output.push(`  ${colors.green("Evidence:")} ${safe(passing.label)} — ${safe(passing.detail)}`);
    else output.push(`  ${colors.gray("Evidence:")} none observed; status is not a safety claim.`);
    if (assessment.executedTests.length > 0) {
      output.push(`  ${colors.green("Executed tests:")} ${truncate(safe(assessment.executedTests.slice(0, 4).join(", ")), width - 19)}${assessment.executedTests.length > 4 ? ` (+${assessment.executedTests.length - 4})` : ""}`);
    } else if (assessment.testExecutions.length > 0) {
      const targeted = assessment.testExecutions.slice(0, 4).map((execution) => `${execution.path} (${execution.status})`).join(", ");
      output.push(`  ${colors.red("Targeted tests:")} ${truncate(safe(targeted), width - 19)}${assessment.testExecutions.length > 4 ? ` (+${assessment.testExecutions.length - 4})` : ""}`);
    } else if (assessment.relatedTests.length > 0) {
      output.push(`  ${colors.cyan("Related tests:")} ${truncate(safe(assessment.relatedTests.slice(0, 4).join(", ")), width - 18)}${assessment.relatedTests.length > 4 ? ` (+${assessment.relatedTests.length - 4})` : ""} ${colors.dim("(not observed executing)")}`);
    }
    output.push("");
  }

  output.push(colors.bold("Checks"));
  if (report.checks.length === 0) {
    output.push("  None discovered. Add conventional test, typecheck, or lint configuration.");
  } else {
    for (const check of report.checks) {
      const marker = check.status === "passed" ? colors.green("PASS") : check.status === "not-run" ? colors.gray("NOT RUN") : colors.red(check.status.toUpperCase());
      output.push(`  ${marker.padEnd(options.color ? 18 : 9)} ${safe(check.label)}  ${colors.dim(safe(check.origin))}${check.durationMs ? `  ${check.durationMs}ms` : ""}`);
    }
  }
  output.push("");
  output.push(`${colors.bold("Trust boundary:")} ${safe(report.trust.statement)}`);
  for (const note of report.notes.slice(0, 5)) output.push(`${colors.dim("Note:")} ${safe(note)}`);
  output.push("");
  output.push(colors.dim("Related test file passed means that file was supplied to a recognized runner and the invocation passed—not that changed symbols or lines ran."));
  return output.join("\n");
}
