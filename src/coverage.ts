import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import type {
  ChangedFile,
  CoverageArtifactSummary,
  CoverageFileEvidence,
  DiffSelection,
  FileAssessment,
} from "./types.js";
import { diffTargetCommit, resolveRevisionCommit } from "./git.js";
import { normalizeRepoPath } from "./util.js";

const MAX_COVERAGE_BYTES = 16 * 1024 * 1024;
const MAX_COVERAGE_FILES = 10_000;
const MAX_COVERAGE_LINES = 250_000;
const MAX_CHANGED_LINES = 50_000;
const MAX_REPORTED_LINES = 50;

export class CoverageError extends Error {
  override name = "CoverageError";
}

interface ParsedCoverage {
  files: Map<string, Map<number, number>>;
  lineRecords: number;
}

function sourceToRepoPath(root: string, source: string): string | null {
  if (!source || /[\u0000-\u001F\u007F]/.test(source)) return null;
  if (path.win32.isAbsolute(source) && process.platform !== "win32") return null;
  const absolute = path.isAbsolute(source) ? path.normalize(source) : path.resolve(root, source);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return normalizeRepoPath(relative);
}

async function parseLcov(root: string, file: string): Promise<ParsedCoverage> {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  let metadata;
  try {
    metadata = await stat(absolute);
  } catch {
    throw new CoverageError(`Coverage artifact does not exist: ${file}`);
  }
  if (!metadata.isFile()) throw new CoverageError(`Coverage artifact is not a file: ${file}`);
  if (metadata.size > MAX_COVERAGE_BYTES) throw new CoverageError(`Coverage artifact exceeds the ${MAX_COVERAGE_BYTES / (1024 * 1024)} MB limit.`);

  const raw = await readFile(absolute, "utf8");
  const files = new Map<string, Map<number, number>>();
  let current: string | null | undefined;
  let lineRecords = 0;

  for (const record of raw.split(/\r?\n/)) {
    if (record.startsWith("SF:")) {
      const source = record.slice(3).trim();
      if (!source) throw new CoverageError("Coverage artifact contains an empty SF record.");
      current = sourceToRepoPath(root, source);
      if (current !== null && !files.has(current)) {
        if (files.size >= MAX_COVERAGE_FILES) throw new CoverageError(`Coverage artifact exceeds the ${MAX_COVERAGE_FILES} file limit.`);
        files.set(current, new Map());
      }
      continue;
    }
    if (record.startsWith("DA:")) {
      const match = record.match(/^DA:(\d+),(\d+)(?:,.*)?$/);
      if (!match || match[1] === undefined || match[2] === undefined) throw new CoverageError("Coverage artifact contains a malformed DA record.");
      if (current === undefined) throw new CoverageError("Coverage artifact contains a DA record before any SF record.");
      const line = Number(match[1]);
      const count = Number(match[2]);
      if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(count) || count < 0) throw new CoverageError("Coverage artifact contains an invalid line or hit count.");
      lineRecords += 1;
      if (lineRecords > MAX_COVERAGE_LINES) throw new CoverageError(`Coverage artifact exceeds the ${MAX_COVERAGE_LINES} line-record limit.`);
      if (current !== null) {
        const lineMap = files.get(current)!;
        lineMap.set(line, Math.max(lineMap.get(line) ?? 0, count));
      }
      continue;
    }
    if (record === "end_of_record") current = undefined;
  }

  return { files, lineRecords };
}

type ChangedLineFailure = "line-limit" | "diff-mismatch";

function changedCurrentLines(file: ChangedFile): { lines: number[]; exact: boolean; failure?: ChangedLineFailure } {
  if (file.binary || file.change === "deleted" || file.additions === 0) return { lines: [], exact: true };
  if (file.additions > MAX_CHANGED_LINES) return { lines: [], exact: false, failure: "line-limit" };

  const lines = new Set<number>();
  let expandedLines = 0;
  for (const hunk of file.hunks) {
    const { start, end } = hunk.newRange;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      return { lines: [], exact: false, failure: "diff-mismatch" };
    }
    const span = end - start + 1;
    if (!Number.isSafeInteger(span) || span > MAX_CHANGED_LINES - expandedLines) {
      return { lines: [], exact: false, failure: "line-limit" };
    }
    expandedLines += span;
    for (let line = start; line <= end; line += 1) lines.add(line);
  }
  const sorted = [...lines].sort((a, b) => a - b);
  const exact = sorted.length === file.additions;
  return exact ? { lines: sorted, exact } : { lines: sorted, exact, failure: "diff-mismatch" };
}

function evaluateFile(file: ChangedFile, coverage: Map<number, number> | undefined): CoverageFileEvidence {
  const changed = changedCurrentLines(file);
  if (file.change === "deleted") {
    return {
      state: "not-applicable",
      changedLines: 0,
      measuredChangedLines: 0,
      coveredChangedLines: 0,
      uncoveredChangedLines: 0,
      unmeasuredChangedLines: 0,
      uncoveredLineNumbers: [],
      unmeasuredLineNumbers: [],
      detail: "Deleted-only code has no current changed lines that an LCOV artifact can measure.",
    };
  }
  if (!changed.exact) {
    return {
      state: "unmeasured",
      changedLines: file.additions,
      measuredChangedLines: 0,
      coveredChangedLines: 0,
      uncoveredChangedLines: 0,
      unmeasuredChangedLines: file.additions,
      uncoveredLineNumbers: [],
      unmeasuredLineNumbers: changed.lines.slice(0, MAX_REPORTED_LINES),
      detail: changed.failure === "line-limit"
        ? `Changed-line reconstruction exceeds the ${MAX_CHANGED_LINES} current-line limit, so ProofDiff failed closed instead of expanding an unbounded coverage surface.`
        : "Changed-line ranges could not be reconstructed exactly from the zero-context diff, so ProofDiff failed closed instead of guessing coverage.",
    };
  }
  if (changed.lines.length === 0) {
    return {
      state: "not-applicable",
      changedLines: 0,
      measuredChangedLines: 0,
      coveredChangedLines: 0,
      uncoveredChangedLines: 0,
      unmeasuredChangedLines: 0,
      uncoveredLineNumbers: [],
      unmeasuredLineNumbers: [],
      detail: "This change has no current added or modified lines to compare with line coverage.",
    };
  }

  const measured = coverage ? changed.lines.filter((line) => coverage.has(line)) : [];
  const covered = coverage ? measured.filter((line) => (coverage.get(line) ?? 0) > 0) : [];
  const uncovered = coverage ? measured.filter((line) => (coverage.get(line) ?? 0) === 0) : [];
  const unmeasured = changed.lines.filter((line) => !coverage?.has(line));
  const state: CoverageFileEvidence["state"] = covered.length === changed.lines.length
    ? "all-covered"
    : covered.length > 0
      ? "partially-covered"
      : measured.length > 0
        ? "uncovered"
        : "unmeasured";
  const detail = state === "all-covered"
    ? `The declared-commit-matched LCOV artifact measured and recorded hits for all ${changed.lines.length} changed current lines.`
    : state === "partially-covered"
      ? `The declared-commit-matched LCOV artifact recorded hits for ${covered.length} of ${changed.lines.length} changed current lines; ${uncovered.length} were measured with zero hits and ${unmeasured.length} were not measured.`
      : state === "uncovered"
        ? `The declared-commit-matched LCOV artifact measured ${measured.length} changed current lines but recorded zero hits for all of them.`
        : "The declared-commit-matched LCOV artifact did not measure any current changed line for this file.";
  return {
    state,
    changedLines: changed.lines.length,
    measuredChangedLines: measured.length,
    coveredChangedLines: covered.length,
    uncoveredChangedLines: uncovered.length,
    unmeasuredChangedLines: unmeasured.length,
    uncoveredLineNumbers: uncovered.slice(0, MAX_REPORTED_LINES),
    unmeasuredLineNumbers: unmeasured.slice(0, MAX_REPORTED_LINES),
    detail,
  };
}

export async function loadCoverageEvidence(
  root: string,
  selection: DiffSelection,
  coverageFile: string,
  coverageCommit: string,
  changedFiles: ChangedFile[],
): Promise<{ summary: CoverageArtifactSummary; byPath: Map<string, CoverageFileEvidence> }> {
  const resolvedCommit = await resolveRevisionCommit(root, coverageCommit);
  const targetCommit = await diffTargetCommit(root, selection);
  const artifact = path.basename(coverageFile);
  if (targetCommit === null) {
    return {
      summary: {
        format: "lcov",
        artifact,
        suppliedCommit: coverageCommit,
        resolvedCommit,
        targetCommit: null,
        commitBinding: "uncommitted-selection",
        accepted: false,
        filesParsed: 0,
        lineRecords: 0,
        detail: "Coverage was not used because working-tree and staged selections include content that cannot be proven identical to a committed coverage artifact.",
      },
      byPath: new Map(),
    };
  }
  if (resolvedCommit !== targetCommit) {
    return {
      summary: {
        format: "lcov",
        artifact,
        suppliedCommit: coverageCommit,
        resolvedCommit,
        targetCommit,
        commitBinding: "commit-mismatch",
        accepted: false,
        filesParsed: 0,
        lineRecords: 0,
        detail: "Coverage was not used because its resolved commit does not exactly match the selected diff target commit.",
      },
      byPath: new Map(),
    };
  }

  const parsed = await parseLcov(root, coverageFile);
  const byPath = new Map<string, CoverageFileEvidence>();
  for (const file of changedFiles) byPath.set(file.path, evaluateFile(file, parsed.files.get(file.path)));
  return {
    summary: {
      format: "lcov",
      artifact,
      suppliedCommit: coverageCommit,
      resolvedCommit,
      targetCommit,
      commitBinding: "declared-commit-matched",
      accepted: true,
      filesParsed: parsed.files.size,
      lineRecords: parsed.lineRecords,
      detail: "The user-declared coverage commit matched the selected diff target commit exactly. LCOV was parsed as bounded data, but ProofDiff did not independently prove that the artifact was produced by that commit.",
    },
    byPath,
  };
}

export function attachCoverageEvidence(item: FileAssessment, coverage: CoverageFileEvidence | undefined): FileAssessment {
  if (!coverage) return item;
  const evidence = [...item.evidence];
  const limitations = [...item.limitations];
  if (coverage.state === "all-covered") {
    evidence.push({
      kind: "coverage-artifact",
      label: `${coverage.coveredChangedLines}/${coverage.changedLines} changed lines reported with hits by the supplied artifact`,
      detail: `${coverage.detail} This records what the supplied artifact reports. ProofDiff did not independently attest artifact provenance, test relevance, branch coverage, assertion relevance, or correctness.`,
      confidence: "high",
    });
    limitations.push("The supplied declared-commit-matched coverage artifact reported hits for all changed lines, but ProofDiff did not independently attest artifact provenance, assertion relevance, or behavioral correctness.");
  } else if (coverage.state === "partially-covered") {
    evidence.push({
      kind: "coverage-artifact",
      label: `${coverage.coveredChangedLines}/${coverage.changedLines} changed lines reported with hits by the supplied artifact`,
      detail: `${coverage.detail} Artifact-reported hits for only part of the change must not be generalized to the remaining changed lines, branches, assertions, or behavior.`,
      confidence: "high",
    });
    limitations.push("The supplied declared-commit-matched coverage artifact reported hits for only part of the current changed-line surface.");
  } else if (coverage.state === "uncovered") {
    evidence.push({
      kind: "limitation",
      label: "Changed lines measured with zero hits",
      detail: `${coverage.detail} This describes only the supplied coverage artifact and does not prove the code can never execute.`,
      confidence: "high",
    });
    limitations.push("The supplied declared-commit-matched coverage artifact measured changed lines but recorded no execution hits for them.");
  } else if (coverage.state === "unmeasured") {
    evidence.push({
      kind: "limitation",
      label: "Changed lines absent from coverage measurement",
      detail: coverage.detail,
      confidence: "high",
    });
    limitations.push("The supplied declared-commit-matched coverage artifact could not establish execution for the current changed lines.");
  }
  return { ...item, coverage, evidence, limitations };
}
