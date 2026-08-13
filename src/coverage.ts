import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import type {
  ChangedFile,
  CoverageArtifactSummary,
  CoverageFileEvidence,
  DiffSelection,
  FileAssessment,
} from "./types.js";
import { diffTargetCommit, resolveCommit } from "./git.js";
import { normalizeRepoPath } from "./util.js";

const MAX_COVERAGE_BYTES = 16 * 1024 * 1024;
const MAX_COVERAGE_FILES = 10_000;
const MAX_COVERAGE_LINES = 250_000;
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
  const absolute = path.resolve(file);
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
    if (record === "end_of_record") {
      current = undefined;
    }
  }

  return { files, lineRecords };
}

function changedCurrentLines(file: ChangedFile): { lines: number[]; exact: boolean } {
  if (file.binary || file.change === "deleted" || file.additions === 0) return { lines: [], exact: true };
  const lines = new Set<number>();
  for (const hunk of file.hunks) {
    for (let line = hunk.newRange.start; line <= hunk.newRange.end; line += 1) lines.add(line);
  }
  const sorted = [...lines].sort((a, b) => a - b);
  return { lines: sorted, exact: sorted.length === file.additions };
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
      detail: "Changed-line ranges could not be reconstructed exactly from the zero-context diff, so ProofDiff failed closed instead of guessing coverage.",
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
    ? `The provenance-matched LCOV artifact measured and recorded hits for all ${changed.lines.length} changed current lines.`
    : state === "partially-covered"
      ? `The provenance-matched LCOV artifact recorded hits for ${covered.length} of ${changed.lines.length} changed current lines; ${uncovered.length} were measured with zero hits and ${unmeasured.length} were not measured.`
      : state === "uncovered"
        ? `The provenance-matched LCOV artifact measured ${measured.length} changed current lines but recorded zero hits for all of them.`
        : "The provenance-matched LCOV artifact did not measure any current changed line for this file.";
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
  const resolvedCommit = await resolveCommit(root, coverageCommit);
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
        provenance: "uncommitted-selection",
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
        provenance: "commit-mismatch",
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
      provenance: "matched-target-commit",
      accepted: true,
      filesParsed: parsed.files.size,
      lineRecords: parsed.lineRecords,
      detail: "Coverage provenance matched the selected diff target commit exactly. LCOV was parsed as bounded data; repository code was not executed to obtain or validate it.",
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
      kind: "runtime-coverage",
      label: `${coverage.coveredChangedLines}/${coverage.changedLines} changed lines recorded as executed`,
      detail: `${coverage.detail} This is runtime line-execution evidence from the supplied artifact; it does not establish test relevance, branch coverage, assertion relevance, or correctness.`,
      confidence: "high",
    });
    limitations.push("Changed-line execution was observed through a provenance-matched coverage artifact, but relevant assertions and behavioral correctness remain unobserved.");
  } else if (coverage.state === "partially-covered") {
    evidence.push({
      kind: "runtime-coverage",
      label: `${coverage.coveredChangedLines}/${coverage.changedLines} changed lines recorded as executed`,
      detail: `${coverage.detail} Partial line execution must not be generalized to the remaining changed lines, branches, assertions, or behavior.`,
      confidence: "high",
    });
    limitations.push("Only part of the current changed-line surface was recorded as executed by the provenance-matched coverage artifact.");
  } else if (coverage.state === "uncovered") {
    evidence.push({
      kind: "limitation",
      label: "Changed lines measured with zero hits",
      detail: `${coverage.detail} This describes only the supplied coverage run and does not prove the code can never execute.`,
      confidence: "high",
    });
    limitations.push("The supplied provenance-matched coverage run measured changed lines but recorded no execution hits for them.");
  } else if (coverage.state === "unmeasured") {
    evidence.push({
      kind: "limitation",
      label: "Changed lines absent from coverage measurement",
      detail: coverage.detail,
      confidence: "high",
    });
    limitations.push("The supplied provenance-matched coverage artifact could not establish execution for the current changed lines.");
  }
  return { ...item, coverage, evidence, limitations };
}
