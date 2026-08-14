import { discoverChecks, notRunResults, runChecks, targetedTestChecks } from "./checks.js";
import { attachCoverageEvidence, CoverageError, loadCoverageEvidence } from "./coverage.js";
import { assessFile } from "./evidence.js";
import { explainEvidenceBoundary } from "./explanation.js";
import { buildRepositoryGraph, impactedFiles } from "./graph.js";
import { changedFiles, findRepository, listRepositoryFiles, listUntrackedFiles, repositoryInfo, selectDiff } from "./git.js";
import { targetedJsFrameworkChecks } from "./js-runners.js";
import { assertSelectionWorkspaceAligned } from "./selection-workspace.js";
import { bindTestMapToSelectionSnapshot } from "./test-map-binding.js";
import { loadTestMap, TestMapError, testMapRepositoryPath } from "./test-map.js";
import { compareCodeUnits, stableSort, unique } from "./util.js";
export const VERSION = "0.5.1";
const statusRank = {
    "verification-failed": 5,
    unverified: 4,
    unknown: 3,
    "partially-verified": 2,
    verified: 1,
};
const riskRank = { critical: 4, high: 3, medium: 2, low: 1 };
function summarize(assessments, checksRun, discovered) {
    const counts = {
        verified: 0,
        "partially-verified": 0,
        unverified: 0,
        unknown: 0,
        "verification-failed": 0,
    };
    for (const assessment of assessments)
        counts[assessment.status] += 1;
    let overallStatus;
    if (assessments.length === 0)
        overallStatus = "unknown";
    else if (counts["verification-failed"] > 0)
        overallStatus = "verification-failed";
    else if (counts.verified === assessments.length)
        overallStatus = "verified";
    else if (counts.unverified === assessments.length)
        overallStatus = "unverified";
    else if (counts.unknown === assessments.length)
        overallStatus = "unknown";
    else
        overallStatus = "partially-verified";
    const highestRisk = assessments.reduce((highest, item) => highest === null || riskRank[item.risk] > riskRank[highest] ? item.risk : highest, null);
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
export async function analyzeRepository(options) {
    const root = await findRepository(options.repo);
    const { selection, args } = await selectDiff(root, options);
    const includeUntracked = selection.mode === "working-tree";
    const untracked = includeUntracked ? await listUntrackedFiles(root) : [];
    const files = await changedFiles(root, args, includeUntracked, untracked);
    if ((options.coverageLcov === undefined) !== (options.coverageCommit === undefined)) {
        throw new CoverageError("Coverage evidence requires both coverageLcov and coverageCommit.");
    }
    const testMapPath = options.testMap === undefined ? null : await testMapRepositoryPath(root, options.testMap);
    const testMapChanged = testMapPath !== null && files.some((file) => file.path === testMapPath || file.previousPath === testMapPath);
    if (testMapChanged && selection.mode !== "working-tree") {
        throw new TestMapError(`Test map is part of the selected ${selection.mode} diff: ${testMapPath}. A relationship declaration cannot strengthen the same immutable change that authored or modified it. Review and land the map separately, or supply a trusted map outside the selected repository diff.`);
    }
    const inventory = await listRepositoryFiles(root);
    let testMapVisibleFiles = inventory.files;
    if (options.testMap !== undefined && inventory.truncated) {
        const completeVisibility = await listRepositoryFiles(root, Number.MAX_SAFE_INTEGER);
        if (completeVisibility.truncated) {
            throw new TestMapError("Repository path inventory exceeds ProofDiff's bounded Git-output limit, so test-map Git visibility cannot be established completely. ProofDiff failed closed instead of treating a partial inventory as authoritative.");
        }
        testMapVisibleFiles = completeVisibility.files;
    }
    const testMap = options.testMap === undefined
        ? undefined
        : await loadTestMap(root, options.testMap, testMapVisibleFiles, files.map((file) => file.path));
    const testMapBinding = testMap !== undefined && testMapPath !== null && selection.mode !== "working-tree"
        ? await bindTestMapToSelectionSnapshot(root, selection, testMapPath, options.testMap)
        : undefined;
    if (testMapBinding !== undefined && !testMapBinding.matched) {
        throw new TestMapError(`${testMapBinding.detail} Repository-local relationship declarations used for an immutable diff must be bound to that selected snapshot; use the snapshot-matching map or an explicitly trusted map outside the repository.`);
    }
    await assertSelectionWorkspaceAligned(root, selection, {
        ...(options.coverageLcov === undefined ? {} : { allowedDataArtifacts: [options.coverageLcov] }),
        repositoryCodeWillExecute: options.runChecks === true,
    });
    const graph = await buildRepositoryGraph(root, inventory.files, files);
    const discovery = await discoverChecks(root);
    const impactedPaths = unique(files.flatMap((file) => [
        file.path,
        ...impactedFiles(graph, file.path, 5_000).files,
        ...(testMap?.bySource.get(file.path) ?? []),
    ]));
    const targeted = await targetedTestChecks(root, discovery.checks, impactedPaths);
    const jsFrameworkTargeted = await targetedJsFrameworkChecks(root, discovery.checks, impactedPaths);
    const allChecks = [...discovery.checks, ...targeted.checks, ...jsFrameworkTargeted.checks];
    const checks = options.runChecks
        ? await runChecks(root, allChecks, {
            ...(options.selectedChecks === undefined ? {} : { selected: options.selectedChecks }),
            timeoutMs: options.timeoutMs ?? 120_000,
            maxOutputBytes: options.maxOutputBytes ?? 256_000,
        })
        : notRunResults(allChecks);
    const coverage = options.coverageLcov !== undefined && options.coverageCommit !== undefined
        ? await loadCoverageEvidence(root, selection, options.coverageLcov, options.coverageCommit, files)
        : undefined;
    const assessments = stableSort(files.map((file) => {
        const declaredTests = testMap?.bySource.get(file.path) ?? [];
        const assessment = attachCoverageEvidence(assessFile(file, graph, checks, declaredTests), coverage?.byPath.get(file.path));
        const evidenceBoundary = explainEvidenceBoundary(assessment, checks);
        const failClosed = evidenceBoundary.proofdiffFailClosed ? " ProofDiff intentionally failed closed at this boundary." : "";
        const nextAction = evidenceBoundary.nextAction ? ` Next action: ${evidenceBoundary.nextAction.detail}` : "";
        return {
            ...assessment,
            evidenceBoundary,
            evidence: [
                ...assessment.evidence,
                {
                    kind: "limitation",
                    label: `Evidence boundary · ${evidenceBoundary.stage} · ${evidenceBoundary.reason}`,
                    detail: `${evidenceBoundary.detail}${failClosed}${nextAction}`,
                    confidence: "high",
                },
            ],
        };
    }), (a, b) => riskRank[b.risk] - riskRank[a.risk] || b.riskScore - a.riskScore || statusRank[b.status] - statusRank[a.status] || compareCodeUnits(a.file.path, b.file.path));
    const checksRun = checks.filter((check) => check.status !== "not-run").length;
    const notes = [...discovery.notes, ...graph.diagnostics];
    const generatedUntracked = untracked.filter((file) => /^(?:node_modules|vendor|dist|build|coverage|\.venv|venv)\//.test(file));
    if (generatedUntracked.length > 0) {
        const directories = [...new Set(generatedUntracked.map((file) => file.split("/")[0]))].sort();
        const directoryList = directories.map((directory) => `${directory}/`).join(", ");
        notes.push(`Working-tree selection includes ${generatedUntracked.length} Git-visible untracked file${generatedUntracked.length === 1 ? "" : "s"} under ${directoryList}. ProofDiff did not hide them; review git status and .gitignore if they are unintended.`);
    }
    if (testMap) {
        const matched = files.filter((file) => testMap.bySource.has(file.path)).length;
        notes.push(`Loaded ${testMap.artifact}: ${testMap.relationships} user-declared source relationship${testMap.relationships === 1 ? "" : "s"} with ${testMap.testPaths} test path${testMap.testPaths === 1 ? "" : "s"}; ${matched} selected changed source${matched === 1 ? "" : "s"} matched. Declarations provide relationship provenance only; ProofDiff does not independently attest semantic relevance, runner identity, execution, coverage, or correctness.`);
        if (testMapChanged)
            notes.push(`The supplied test map ${testMap.artifact} is itself part of the mutable working-tree selection. ProofDiff allows this for local iteration, but the declaration is not pre-existing review policy; immutable base/range/staged selections fail closed when their supplied map is changed by the same selection.`);
        if (testMapBinding?.matched)
            notes.push(`Repository-local test-map snapshot binding: ${testMapBinding.detail}`);
    }
    if (inventory.truncated) {
        notes.push(`Repository source analysis was limited to the first 5,000 tracked/unignored files.${testMap ? " Test-map Git visibility was validated against a separate complete bounded Git-visible inventory rather than this analysis slice." : ""}`);
    }
    if (targeted.truncated || jsFrameworkTargeted.truncated)
        notes.push("Runner-qualified targeted test execution was limited to the first 100 statically impacted or user-declared paths.");
    if (files.length === 0)
        notes.push("No changes matched the selected diff.");
    if (!options.runChecks && allChecks.length > 0)
        notes.push("Checks were discovered but not executed. Repository code execution requires explicit --run-checks consent.");
    if (options.runChecks && allChecks.length === 0)
        notes.push("Check execution was requested, but no supported checks were discovered.");
    if (coverage && !coverage.summary.accepted)
        notes.push(`Coverage artifact was not used. ${coverage.summary.detail}`);
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
        ...(coverage === undefined ? {} : { coverage: coverage.summary }),
        trust: {
            repositoryCodeExecuted: checksRun > 0,
            statement: `${checksRun > 0
                ? "Repository-defined checks were executed because --run-checks was explicitly supplied. Output was bounded, the repository root and common secret patterns were redacted; this is not an operating-system sandbox."
                : "No repository code was executed. Git inspection and language parsing were performed locally."}${coverage?.summary.accepted
                ? " A declared-commit-matched LCOV artifact was parsed as bounded data; ProofDiff did not execute code to produce it."
                : ""}${testMap
                ? " A user-supplied test map was parsed as bounded data. Its source-to-test relationships are declarations, not independently verified semantic relevance."
                : ""}${testMapBinding?.matched
                ? ` Its repository-local declaration content was matched to the selected immutable ${testMapBinding.target === "index" ? "index" : "target"} snapshot.`
                : ""}${testMapChanged
                ? " The supplied test map is part of the mutable working-tree selection; immutable diff selections reject this self-modifying declaration pattern."
                : ""}`,
        },
    };
}
//# sourceMappingURL=analyze.js.map