import { discoverChecks, notRunResults, runChecks, targetedTestChecks } from "./checks.js";
import { assessFile } from "./evidence.js";
import { buildRepositoryGraph, impactedFiles } from "./graph.js";
import { changedFiles, findRepository, listRepositoryFiles, listUntrackedFiles, repositoryInfo, selectDiff } from "./git.js";
import type { AnalysisReport, AnalysisSummary, AnalyzeOptions, FileAssessment, RiskLevel, VerificationStatus } from "./types.js";
import { stableSort } from "./util.js";

export const VERSION = "0.1.0";

const statusRank: Record<VerificationStatus, number> = {
  "verification-failed": 5,
  unverified: 4,
  unknown: 3,
  "partially-verified": 2,
  verified: 1,
};
const riskRank: Record<RiskLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function summarize(assessments: FileAssessment[], checksRun: number, discovered: number): AnalysisSummary {
  const counts: AnalysisSummary["counts"] = {
    verified: 0,
    "partially-verified": 0,
    unverified: 0,
    unknown: 0,
    "verification-failed": 0,
  };
  for (const assessment of assessments) counts[assessment.status] += 1;
  let overallStatus: VerificationStatus;
  if (assessments.length === 0) overallStatus = "unknown";
  else if (counts["verification-failed"] > 0) overallStatus = "verification-failed";
  else if (counts.verified === assessments.length) overallStatus = "verified";
  else if (counts.unverified === assessments.length) overallStatus = "unverified";
  else if (counts.unknown === assessments.length) overallStatus = "unknown";
  else overallStatus = "partially-verified";
  const highestRisk = assessments.reduce<RiskLevel | null>((highest, item) => highest === null || riskRank[item.risk] > riskRank[highest] ? item.risk : highest, null);
  return {
    filesChanged: assessments.length,
    symbolsChanged: assessments.reduce((total, item) => total + item.changedSymbols.length, 0),
    checksDiscovered: discovered,
    checksRun,
    counts,
    overallStatus,
    highestRisk,
  };
}

export async function analyzeRepository(options: AnalyzeOptions): Promise<AnalysisReport> {
  const root = await findRepository(options.repo);
  const { selection, args } = await selectDiff(root, options);
  const includeUntracked = selection.mode === "working-tree";
  const untracked = includeUntracked ? await listUntrackedFiles(root) : [];
  const files = await changedFiles(root, args, includeUntracked, untracked);
  const inventory = await listRepositoryFiles(root);
  const graph = await buildRepositoryGraph(root, inventory.files, files);
  const discovery = await discoverChecks(root);
  const impactedPaths = files.flatMap((file) => [file.path, ...impactedFiles(graph, file.path).files]);
  const targeted = await targetedTestChecks(root, discovery.checks, impactedPaths);
  const allChecks = [...discovery.checks, ...targeted.checks];
  const checks = options.runChecks
    ? await runChecks(root, allChecks, {
      ...(options.selectedChecks === undefined ? {} : { selected: options.selectedChecks }),
      timeoutMs: options.timeoutMs ?? 120_000,
      maxOutputBytes: options.maxOutputBytes ?? 256_000,
    })
    : notRunResults(allChecks);
  const assessments = stableSort(
    files.map((file) => assessFile(file, graph, checks)),
    (a, b) => riskRank[b.risk] - riskRank[a.risk] || b.riskScore - a.riskScore || statusRank[b.status] - statusRank[a.status] || a.file.path.localeCompare(b.file.path),
  );
  const checksRun = checks.filter((check) => check.status !== "not-run").length;
  const notes = [...discovery.notes, ...graph.diagnostics];
  const generatedUntracked = untracked.filter((file) => /^(?:node_modules|vendor|dist|build|coverage|\.venv|venv)\//.test(file));
  if (generatedUntracked.length > 0) {
    const directories = [...new Set(generatedUntracked.map((file) => file.split("/")[0]))].sort();
    const directoryList = directories.map((directory) => `${directory}/`).join(", ");
    notes.push(`Working-tree selection includes ${generatedUntracked.length} Git-visible untracked file${generatedUntracked.length === 1 ? "" : "s"} under ${directoryList}. ProofDiff did not hide them; review git status and .gitignore if they are unintended.`);
  }
  if (inventory.truncated) notes.push("Repository source analysis was limited to the first 5,000 tracked/unignored files.");
  if (targeted.truncated) notes.push("Runner-qualified targeted test execution was limited to the first 100 statically impacted paths.");
  if (files.length === 0) notes.push("No changes matched the selected diff.");
  if (!options.runChecks && allChecks.length > 0) notes.push("Checks were discovered but not executed. Repository code execution requires explicit --run-checks consent.");
  if (options.runChecks && allChecks.length === 0) notes.push("Check execution was requested, but no supported checks were discovered.");
  return {
    schemaVersion: "1.0",
    proofdiffVersion: VERSION,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    repository: await repositoryInfo(root),
    selection,
    summary: summarize(assessments, checksRun, allChecks.length),
    assessments,
    checks,
    discoveredChecks: allChecks,
    notes,
    trust: {
      repositoryCodeExecuted: checksRun > 0,
      statement: checksRun > 0
        ? "Repository-defined checks were executed because --run-checks was explicitly supplied. Output was bounded, the repository root and common secret patterns were redacted; this is not an operating-system sandbox."
        : "No repository code was executed. Git inspection and language parsing were performed locally.",
    },
  };
}
