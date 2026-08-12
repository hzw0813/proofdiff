import path from "node:path";
import { impactedFiles, symbolsChanged } from "./graph.js";
import { clamp, isTestLikePath, unique } from "./util.js";
function checkApplies(check, file, relatedTests) {
    if (check.targetFiles && !check.targetFiles.some((target) => relatedTests.includes(target)))
        return false;
    if (check.id.startsWith("js:"))
        return file.language === "javascript" || file.language === "typescript";
    if (check.id.startsWith("python:"))
        return file.language === "python";
    return true;
}
function isRecognizedNoTestsExit(check) {
    return check.status === "failed" && check.exitCode === 5 && (check.targetRunner === "pytest" || check.targetRunner === "unittest");
}
function verificationFor(file, relatedTests, checks) {
    const evidence = [];
    const executed = checks.filter((check) => check.status !== "not-run");
    const applicable = executed.filter((check) => checkApplies(check, file, relatedTests));
    const observations = applicable.flatMap((check) => (check.targetObservations ?? [])
        .filter((observation) => relatedTests.includes(observation.path))
        .map((observation) => ({ check, observation })));
    const targetedFailures = observations.filter(({ observation }) => observation.outcome === "failed");
    const hasExactTargetFailure = (check) => check.targetObservations?.some((observation) => observation.outcome === "failed") === true;
    const hasUnavailableRelatedTarget = (check) => check.targetObservations?.some((observation) => relatedTests.includes(observation.path) && observation.outcome === "not-observed") === true;
    const localizedTargetedProcessFailures = applicable.filter((check) => check.targetQualifications !== undefined
        && check.status === "failed"
        && !isRecognizedNoTestsExit(check)
        && hasExactTargetFailure(check)
        && !hasUnavailableRelatedTarget(check));
    const unlocalizedTargetedFailures = applicable.filter((check) => check.targetQualifications !== undefined
        && check.status === "failed"
        && !isRecognizedNoTestsExit(check)
        && (!hasExactTargetFailure(check) || hasUnavailableRelatedTarget(check)));
    const opaqueFailures = applicable.filter((check) => check.targetQualifications === undefined
        && ["failed", "error", "timed-out"].includes(check.status)
        && !(check.kind === "test" && check.targetRunner !== undefined && localizedTargetedProcessFailures.some((targeted) => targeted.id === `${check.id}:targeted`))
        && !isRecognizedNoTestsExit(check));
    const operationalFailures = applicable.filter((check) => check.targetQualifications !== undefined && ["error", "timed-out"].includes(check.status));
    const passing = applicable.filter((check) => check.status === "passed" && check.targetQualifications === undefined);
    const testExecutions = observations
        .filter(({ observation }) => observation.outcome === "passed" || observation.outcome === "failed")
        .map(({ check, observation }) => ({ path: observation.path, status: observation.outcome === "passed" ? "passed" : "failed", checkId: check.id }));
    const executedTests = unique(observations.filter(({ observation }) => observation.outcome === "passed" && observation.testsObserved > 0).map(({ observation }) => observation.path)).sort();
    for (const check of [...opaqueFailures, ...operationalFailures]) {
        evidence.push({
            kind: "failing-check",
            label: check.label,
            detail: check.explanation,
            confidence: "high",
            checkId: check.id,
        });
    }
    for (const check of unlocalizedTargetedFailures) {
        evidence.push({
            kind: "failing-check",
            label: check.label,
            detail: `${check.explanation} The targeted runner failed, but its observer did not reliably attribute the complete process failure without leaving a related qualified target unavailable, so ProofDiff failed closed.`,
            confidence: "high",
            checkId: check.id,
        });
    }
    for (const { check, observation } of targetedFailures) {
        evidence.push({ kind: "failing-check", label: `${check.label}: ${observation.path}`, detail: `ProofDiff explicitly supplied this runner-qualified target. ${observation.detail}`, confidence: "high", checkId: check.id });
    }
    for (const check of passing.filter((candidate) => candidate.targetQualifications === undefined)) {
        evidence.push({
            kind: "passing-check",
            label: check.label,
            detail: check.kind === "test" && relatedTests.length > 0
                ? "Repository test command passed, but ProofDiff did not observe which test files it executed."
                : "Command success is deterministic evidence, but is not by itself proof that changed behavior is correct.",
            confidence: "high",
            checkId: check.id,
        });
    }
    if (relatedTests.length > 0) {
        evidence.push({
            kind: "related-test",
            label: `${relatedTests.length} statically related test-like path${relatedTests.length === 1 ? "" : "s"}`,
            detail: "Related by resolved local import/dependency paths or accepted runner qualification. Static relationship and runner identity are not runtime coverage.",
            confidence: "medium",
        });
    }
    if (executedTests.length > 0) {
        evidence.push({
            kind: "executed-test",
            label: `${executedTests.length} qualified related target${executedTests.length === 1 ? "" : "s"} observed passing`,
            detail: "ProofDiff explicitly supplied each qualified target and observed at least one non-skipped passing test for that exact path. This is file-scoped test evidence, not changed-symbol, changed-line, branch, assertion, or behavioral coverage.",
            confidence: "high",
        });
    }
    for (const { check, observation } of observations.filter(({ observation }) => !["passed", "failed"].includes(observation.outcome))) {
        evidence.push({ kind: "limitation", label: `${observation.path}: ${observation.outcome}`, detail: observation.detail, confidence: "high", checkId: check.id });
    }
    if (targetedFailures.length > 0 || unlocalizedTargetedFailures.length > 0 || opaqueFailures.length > 0 || operationalFailures.length > 0)
        return { status: "verification-failed", evidence, executedTests, testExecutions };
    if (applicable.length === 0) {
        if (executed.length > 0) {
            evidence.push({ kind: "limitation", label: "No applicable check", detail: "Checks ran, but none could be associated with this file's language.", confidence: "high" });
            return { status: "unverified", evidence, executedTests, testExecutions };
        }
        return { status: "unknown", evidence, executedTests, testExecutions };
    }
    if (executedTests.length > 0)
        return { status: "verified", evidence, executedTests, testExecutions };
    if (passing.length > 0)
        return { status: "partially-verified", evidence, executedTests, testExecutions };
    return { status: "unverified", evidence, executedTests, testExecutions };
}
function callsInChangedLines(file, analysis, limit = 100) {
    if (!analysis?.callSites || file.binary || file.change === "deleted")
        return { calls: [], truncated: false };
    const seen = new Set();
    const matching = analysis.callSites.filter((site) => {
        if (!file.hunks.some((hunk) => site.line >= hunk.newRange.start && site.line <= hunk.newRange.end))
            return false;
        const key = `${site.line}:${site.name}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
    return { calls: matching.slice(0, limit), truncated: matching.length > limit };
}
function riskFor(file, status, relatedTests, impacted, analysis) {
    let score = 10;
    const reasons = [];
    const changedLines = file.additions + file.deletions;
    if (status === "verification-failed") {
        score += 70;
        reasons.push("An applicable verification check failed.");
    }
    else if (status === "unverified") {
        score += 30;
        reasons.push("Executed checks provided no applicable successful evidence.");
    }
    else if (status === "unknown") {
        score += 22;
        reasons.push("No verification command was run for this change.");
    }
    else if (status === "partially-verified") {
        score += 12;
        reasons.push("Evidence exists but is not connected to a related passing test.");
    }
    if (relatedTests.length === 0 && !isTestLikePath(file.path)) {
        score += 18;
        reasons.push("No statically related test-like path was found.");
    }
    if (file.change === "deleted") {
        score += 12;
        reasons.push("Deleted behavior cannot be parsed from the current worktree.");
    }
    if (file.binary) {
        score += 25;
        reasons.push("Binary content cannot be inspected structurally.");
    }
    if (file.language === "unknown") {
        score += 10;
        reasons.push("No first-class language adapter applies.");
    }
    if (analysis?.confidence === "low") {
        score += 12;
        reasons.push("Structural analysis used a low-confidence fallback.");
    }
    if (analysis && analysis.diagnostics.length > 0) {
        score += 6;
        reasons.push("The parser reported diagnostics.");
    }
    if (changedLines >= 300) {
        score += 18;
        reasons.push(`Large change surface (${changedLines} changed lines).`);
    }
    else if (changedLines >= 100) {
        score += 9;
        reasons.push(`Broad change surface (${changedLines} changed lines).`);
    }
    if (impacted.length >= 25) {
        score += 16;
        reasons.push(`May affect at least ${impacted.length} dependent files.`);
    }
    else if (impacted.length >= 5) {
        score += 8;
        reasons.push(`May affect ${impacted.length} dependent files.`);
    }
    if (/^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements[^/]*\.txt)$/.test(path.basename(file.path))) {
        score += 15;
        reasons.push("Dependency or build metadata changed.");
    }
    if (/(?:^|\/)(?:access|auth|crypto|security|permissions?|payments?)(?:\/|\.|$)/i.test(file.path)) {
        score += 15;
        reasons.push("Security-sensitive path name warrants focused human review.");
    }
    const bounded = clamp(score, 0, 100);
    const level = bounded >= 80 ? "critical" : bounded >= 55 ? "high" : bounded >= 30 ? "medium" : "low";
    return { score: bounded, level, reasons };
}
export function assessFile(file, graph, checks) {
    const analysis = graph.analyses.get(file.path);
    const impact = impactedFiles(graph, file.path);
    const relationshipImpact = impactedFiles(graph, file.path, 5_000);
    const impactedSet = new Set([file.path, ...relationshipImpact.files]);
    const staticallyTestLike = relationshipImpact.files.filter((candidate) => graph.testLikeFiles.has(candidate));
    if (isTestLikePath(file.path))
        staticallyTestLike.unshift(file.path);
    const qualified = checks.flatMap((check) => check.targetQualifications ?? []).map((qualification) => qualification.path).filter((candidate) => impactedSet.has(candidate));
    const relatedTests = unique([...staticallyTestLike, ...qualified]).sort();
    const changedCallSites = callsInChangedLines(file, analysis);
    const verification = verificationFor(file, relatedTests, checks);
    const risk = riskFor(file, verification.status, relatedTests, impact.files, analysis);
    const limitations = [];
    if (!analysis && file.language !== "unknown" && file.change !== "deleted")
        limitations.push("Source could not be read or analyzed.");
    if (analysis?.diagnostics.length)
        limitations.push(...analysis.diagnostics);
    if (impact.truncated)
        limitations.push("Impact traversal stopped at 250 dependent files.");
    if (relationshipImpact.truncated)
        limitations.push("Test-like relationship and qualification traversal stopped at 5,000 dependent files.");
    if (file.deletedSymbolHints.length > 0)
        limitations.push("Deleted symbol names were inferred from removed declaration lines; ranges and full structure are unavailable.");
    if (file.language === "unknown")
        limitations.push("Only file-level analysis is available for this file type.");
    if (file.binary)
        limitations.push("Binary file contents were not inspected.");
    if (changedCallSites.truncated)
        limitations.push("Call references in changed lines were limited to the first 100 parser-observed sites.");
    if (relatedTests.length === 0)
        limitations.push("No test-like path or runner-qualified target was related to the change; dynamic imports and runtime dispatch may not be visible statically.");
    else if (verification.executedTests.length === 0)
        limitations.push("Statically related test-like paths were found, but no runner-qualified exact target produced a non-skipped passing test observation.");
    else
        limitations.push("Qualified related targets produced passing tests, but ProofDiff did not observe whether changed symbols, lines, branches, or relevant assertions executed.");
    const unqualifiedTestLike = staticallyTestLike.filter((candidate) => !qualified.includes(candidate));
    if (unqualifiedTestLike.length > 0)
        limitations.push(`${unqualifiedTestLike.length} statically related test-like path${unqualifiedTestLike.length === 1 ? " was" : "s were"} not qualified by a recognized runner convention or configuration.`);
    const evidence = [...verification.evidence];
    if (changedCallSites.calls.length > 0) {
        const names = unique(changedCallSites.calls.map((site) => site.name)).slice(0, 8);
        const confidence = changedCallSites.calls.some((site) => site.confidence === "low") ? "low" : changedCallSites.calls.some((site) => site.confidence === "medium") ? "medium" : "high";
        evidence.push({
            kind: "static-relationship",
            label: `${changedCallSites.calls.length} call reference${changedCallSites.calls.length === 1 ? "" : "s"} in changed lines`,
            detail: `Parser-observed name-only call sites: ${names.join(", ")}${unique(changedCallSites.calls.map((site) => site.name)).length > names.length ? ", …" : ""}. Targets are not resolved and runtime execution is not implied.`,
            confidence,
        });
    }
    if (impact.files.length > 0) {
        evidence.push({ kind: "static-relationship", label: `${impact.files.length} impacted file${impact.files.length === 1 ? "" : "s"}`, detail: "Reachable through resolved reverse import relationships. This is an impact estimate, not proof of runtime behavior.", confidence: "medium" });
    }
    if (analysis) {
        evidence.push({ kind: "inference", label: `${analysis.parser} structural analysis`, detail: `Parser confidence: ${analysis.confidence}. Structural findings are evidence about code shape, not correctness.`, confidence: analysis.confidence });
    }
    return {
        file,
        changedSymbols: symbolsChanged(file, analysis),
        changedCalls: changedCallSites.calls,
        impactedFiles: impact.files,
        relatedTests,
        executedTests: verification.executedTests,
        testExecutions: verification.testExecutions,
        status: verification.status,
        risk: risk.level,
        riskScore: risk.score,
        reasons: risk.reasons,
        evidence,
        limitations,
    };
}
//# sourceMappingURL=evidence.js.map