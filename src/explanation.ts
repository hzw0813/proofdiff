import type { CheckResult, EvidenceBoundary, EvidenceNextAction, FileAssessment } from "./types.js";

function checkApplies(check: CheckResult, item: FileAssessment): boolean {
  if (check.targetFiles) return check.targetFiles.some((target) => item.relatedTests.includes(target));
  if (check.id.startsWith("js:")) return item.file.language === "javascript" || item.file.language === "typescript";
  if (check.id.startsWith("python:")) return item.file.language === "python";
  return true;
}

function recognizedNoTestsExit(check: CheckResult): boolean {
  return check.status === "failed" && check.exitCode === 5 && (check.targetRunner === "pytest" || check.targetRunner === "unittest");
}

function action(kind: EvidenceNextAction["kind"], detail: string, requiresRepositoryCodeExecution = false): EvidenceNextAction {
  return { kind, detail, requiresRepositoryCodeExecution };
}

export function explainEvidenceBoundary(item: FileAssessment, checks: CheckResult[]): EvidenceBoundary {
  const executed = checks.filter((check) => check.status !== "not-run");
  const applicable = executed.filter((check) => checkApplies(check, item));
  const relevantQualifications = checks.flatMap((check) => check.targetQualifications ?? []).filter((qualification) => item.relatedTests.includes(qualification.path));
  const qualifiedPaths = new Set(relevantQualifications.filter((qualification) => qualification.confidence === "high").map((qualification) => qualification.path));
  const targetedForRelated = checks.filter((check) => (check.targetQualifications ?? []).some((qualification) => qualification.confidence === "high" && item.relatedTests.includes(qualification.path)));
  const observations = applicable.flatMap((check) => (check.targetObservations ?? [])
    .filter((observation) => item.relatedTests.includes(observation.path))
    .map((observation) => ({ check, observation })));
  const qualificationForObservation = (check: CheckResult, observation: NonNullable<CheckResult["targetObservations"]>[number]) => check.targetQualifications?.find((qualification) => qualification.path === observation.path && qualification.runnerPath === observation.runnerPath);
  const exactObservations = observations.filter(({ check, observation }) => qualificationForObservation(check, observation)?.confidence === "high");
  const failedObservation = exactObservations.find(({ observation }) => observation.outcome === "failed");
  const unavailableObservation = exactObservations.find(({ observation }) => observation.outcome === "not-observed");
  const zeroObservation = exactObservations.find(({ observation }) => observation.outcome === "zero-tests");
  const skippedObservation = exactObservations.find(({ observation }) => observation.outcome === "skipped");
  const unlocalizedTargetFailure = applicable.some((check) => check.targetQualifications !== undefined
    && check.status === "failed"
    && !recognizedNoTestsExit(check)
    && (
      check.targetObservations?.some((observation) => observation.outcome === "failed" && qualificationForObservation(check, observation)?.confidence === "high") !== true
      || check.targetObservations?.some((observation) => item.relatedTests.includes(observation.path) && observation.outcome === "not-observed" && qualificationForObservation(check, observation)?.confidence === "high") === true
    ));
  const passingOpaqueCheck = applicable.some((check) => check.status === "passed" && check.targetQualifications === undefined);
  const unsupportedSemantics = item.file.language === "unknown"
    || item.file.binary
    || item.limitations.includes("Source could not be read or analyzed.");
  const strongestWithoutTarget = passingOpaqueCheck ? "passing-check" : item.relatedTests.length > 0 ? "static-relationship" : "change-observed";

  if (item.status === "verification-failed") {
    if (unlocalizedTargetFailure) {
      return {
        strongestEvidence: "verification-failure",
        stage: "failure-attribution",
        reason: "failure-unattributed",
        detail: "A relevant targeted process failed, but ProofDiff could not completely attribute that failure to exact related targets and intentionally refused to strengthen the result.",
        proofdiffFailClosed: true,
        nextAction: action("inspect-failure", "Inspect the relevant failure and observer provenance before relying on any passing target elsewhere."),
      };
    }
    if (failedObservation) {
      return {
        strongestEvidence: "verification-failure",
        stage: "runtime-observation",
        reason: "target-failed",
        detail: "A runner-qualified related target was explicitly supplied and observed failing.",
        proofdiffFailClosed: false,
        nextAction: action("inspect-failure", "Inspect the attributed target failure before seeking stronger positive evidence."),
      };
    }
    return {
      strongestEvidence: "verification-failure",
      stage: "target-invocation",
      reason: "check-failed",
      detail: "An applicable verification command failed, errored, or timed out without a stronger passing related-target observation.",
      proofdiffFailClosed: false,
      nextAction: action("inspect-failure", "Inspect the applicable command failure and full provenance before treating the change as verified."),
    };
  }

  if (item.executedTests.length > 0) {
    return {
      strongestEvidence: "related-test-file-passed",
      stage: "changed-code-execution",
      reason: "changed-code-execution-unobserved",
      detail: "A runner-qualified related test file passed, but ProofDiff did not observe whether changed symbols, lines, branches, or relevant assertions executed.",
      proofdiffFailClosed: true,
      nextAction: null,
    };
  }

  if (unavailableObservation) {
    return {
      strongestEvidence: item.relatedTests.length > 0 ? "static-relationship" : strongestWithoutTarget,
      stage: "runtime-observation",
      reason: "observer-inconclusive",
      detail: "A qualified related target reached runtime observation, but the observer did not produce a trustworthy exact-target outcome, so ProofDiff failed closed.",
      proofdiffFailClosed: true,
      nextAction: action("inspect-observer", "Inspect the target observation and bounded runner output; do not convert missing or malformed observation into a pass."),
    };
  }

  if (zeroObservation) {
    return {
      strongestEvidence: item.relatedTests.length > 0 ? "static-relationship" : strongestWithoutTarget,
      stage: "runtime-observation",
      reason: "zero-tests",
      detail: "The qualified related target was invoked, but zero non-skipped tests were observed for that exact target.",
      proofdiffFailClosed: false,
      nextAction: action("inspect-target-selection", "Inspect runner filters and target selection so the intended test actually collects and runs."),
    };
  }

  if (skippedObservation) {
    return {
      strongestEvidence: item.relatedTests.length > 0 ? "static-relationship" : strongestWithoutTarget,
      stage: "runtime-observation",
      reason: "all-skipped",
      detail: "The qualified related target was observed, but all observed tests for that exact target were skipped.",
      proofdiffFailClosed: false,
      nextAction: action("inspect-target-selection", "Inspect skip conditions and test selection before treating this target as runtime verification."),
    };
  }

  if (unsupportedSemantics) {
    return {
      strongestEvidence: strongestWithoutTarget,
      stage: "static-relationship",
      reason: "unsupported-semantics",
      detail: "ProofDiff could not establish first-class structural semantics for this changed file, so stronger inferred relationship claims were not made.",
      proofdiffFailClosed: true,
      nextAction: action("inspect-static-limitations", "Inspect the file-level and static-analysis limitations. If you know an exact source-to-test relationship ProofDiff cannot infer, a bounded --test-map can record that declaration without bypassing runner qualification or runtime observation."),
    };
  }

  if (item.relatedTests.length === 0) {
    return {
      strongestEvidence: strongestWithoutTarget,
      stage: "static-relationship",
      reason: "no-related-test",
      detail: passingOpaqueCheck
        ? "An applicable command passed, but ProofDiff established no supported related test-like path for this change."
        : "ProofDiff established no supported related test-like path for this change.",
      proofdiffFailClosed: false,
      nextAction: action("inspect-static-limitations", "Inspect static-analysis limitations and test relationships. If you know an exact source-to-test relationship ProofDiff cannot infer, supply a bounded --test-map declaration; the declaration records provenance only and still requires independent runner qualification and runtime observation."),
    };
  }

  if (qualifiedPaths.size === 0) {
    return {
      strongestEvidence: strongestWithoutTarget,
      stage: "runner-qualification",
      reason: passingOpaqueCheck ? "opaque-passing-check" : "runner-unqualified",
      detail: passingOpaqueCheck
        ? "A repository command passed, but no related test-like path had high-confidence qualification as an exact source target for a recognized runner."
        : "Related test-like paths were found or declared, but none had high-confidence qualification as exact source targets for a recognized runner.",
      proofdiffFailClosed: true,
      nextAction: action("qualify-related-test", "Use a supported runner convention or explicit source target so ProofDiff can bind runtime observation to the related test file with high confidence. A --test-map declaration does not bypass runner qualification."),
    };
  }

  if (targetedForRelated.length > 0 && targetedForRelated.every((check) => check.status === "not-run")) {
    return {
      strongestEvidence: "static-relationship",
      stage: "target-invocation",
      reason: "checks-not-run",
      detail: "A related test target was identified and runner-qualified, but repository checks were not executed in this run.",
      proofdiffFailClosed: false,
      nextAction: action(
        "review-run-checks",
        "After reviewing the change, rerun with --run-checks if you want runtime observations. Repository-defined commands run with operating-system permissions and are not sandboxed.",
        true,
      ),
    };
  }

  if (targetedForRelated.some((check) => check.status === "not-run") && executed.length > 0) {
    return {
      strongestEvidence: strongestWithoutTarget,
      stage: "target-invocation",
      reason: "target-not-invoked",
      detail: "A related target was qualified, but it was not invoked in this run even though other checks executed.",
      proofdiffFailClosed: false,
      nextAction: action("inspect-target-selection", "Inspect selected checks and target selection so the qualified related target is actually invoked."),
    };
  }

  if (applicable.length === 0 && executed.length > 0) {
    return {
      strongestEvidence: "static-relationship",
      stage: "target-invocation",
      reason: "no-applicable-check",
      detail: "Checks ran, but none could be associated with this changed file and its related test target.",
      proofdiffFailClosed: false,
      nextAction: action("add-supported-check", "Configure or select a supported check that applies to this file before seeking stronger runtime evidence."),
    };
  }

  return {
    strongestEvidence: strongestWithoutTarget,
    stage: "runtime-observation",
    reason: "observer-inconclusive",
    detail: "A related target was qualified, but no trustworthy non-skipped passing observation was available, so ProofDiff did not strengthen the evidence.",
    proofdiffFailClosed: true,
    nextAction: action("inspect-observer", "Inspect target observations and runner provenance before drawing a stronger conclusion."),
  };
}
