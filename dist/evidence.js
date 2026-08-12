import path from "node:path";
import { impactedFiles, symbolsChanged } from "./graph.js";
import { clamp, isTestFile, unique } from "./util.js";
function checkApplies(check, file, relatedTests) {
    if (check.targetFiles && !check.targetFiles.some((target) => relatedTests.includes(target)))
        return false;
    if (check.id.startsWith("js:"))
        return file.language === "javascript" || file.language === "typescript";
    if (check.id.startsWith("python:"))
        return file.language === "python";
    return true;
}
function verificationFor(file, relatedTests, checks) {
    const evidence = [];
    const executed = checks.filter((check) => check.status !== "not-run");
    const applicable = executed.filter((check) => checkApplies(check, file, relatedTests));
    const failures = applicable.filter((check) => ["failed", "error", "timed-out"].includes(check.status));
    const passing = applicable.filter((check) => check.status === "passed");
    const testExecutions = applicable.flatMap((check) => (check.targetFiles ?? [])
        .filter((target) => relatedTests.includes(target))
        .map((target) => ({ path: target, status: check.status, checkId: check.id })));
    const executedTests = unique(testExecutions.filter((execution) => execution.status === "passed").map((execution) => execution.path)).sort();
    for (const check of failures) {
        evidence.push({
            kind: "failing-check",
            label: check.label,
            detail: check.targetFiles?.length
                ? `${check.explanation} ProofDiff explicitly supplied ${check.targetFiles.length} related test file${check.targetFiles.length === 1 ? "" : "s"} to the recognized runner.`
                : check.explanation,
            confidence: "high",
            checkId: check.id,
        });
    }
    for (const check of passing) {
        evidence.push({
            kind: "passing-check",
            label: check.label,
            detail: check.kind === "test" && relatedTests.length > 0
                ? check.targetFiles?.length
                    ? `Passed with ${check.targetFiles.length} explicitly targeted test file${check.targetFiles.length === 1 ? "" : "s"}. This observes test-file execution, not changed-line coverage.`
                    : `Repository test command passed, but ProofDiff did not observe which test files it executed.`
                : "Command success is deterministic evidence, but is not by itself proof that changed behavior is correct.",
            confidence: "high",
            checkId: check.id,
        });
    }
    if (relatedTests.length > 0) {
        evidence.push({
            kind: "related-test",
            label: `${relatedTests.length} related test file${relatedTests.length === 1 ? "" : "s"}`,
            detail: "Related by resolved local import/dependency paths. This is a static relationship, not runtime coverage.",
            confidence: "medium",
        });
    }
    if (executedTests.length > 0) {
        evidence.push({
            kind: "executed-test",
            label: `${executedTests.length} related test file${executedTests.length === 1 ? "" : "s"} explicitly executed`,
            detail: "ProofDiff passed these file paths directly to a recognized test runner and observed a successful exit. This is execution evidence, not runtime line or branch coverage.",
            confidence: "high",
        });
    }
    if (failures.length > 0)
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
    if (relatedTests.length === 0 && !isTestFile(file.path)) {
        score += 18;
        reasons.push("No statically related test file was found.");
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
    const relatedTests = impact.files.filter((candidate) => graph.testFiles.has(candidate));
    if (isTestFile(file.path))
        relatedTests.unshift(file.path);
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
    if (file.deletedSymbolHints.length > 0)
        limitations.push("Deleted symbol names were inferred from removed declaration lines; ranges and full structure are unavailable.");
    if (file.language === "unknown")
        limitations.push("Only file-level analysis is available for this file type.");
    if (file.binary)
        limitations.push("Binary file contents were not inspected.");
    if (changedCallSites.truncated)
        limitations.push("Call references in changed lines were limited to the first 100 parser-observed sites.");
    if (relatedTests.length === 0)
        limitations.push("No test-to-change relationship was found; dynamic imports and runtime dispatch may not be visible statically.");
    else if (verification.executedTests.length === 0)
        limitations.push("Related test files were found statically, but no recognized runner was observed executing them successfully.");
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