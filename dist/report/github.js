import path from "node:path";
import { escapeHtml, plural, sanitizeControlCharacters } from "../util.js";
const statusLabels = {
    verified: "Related test file passed",
    "partially-verified": "Partially verified",
    unverified: "Unverified",
    unknown: "Unknown",
    "verification-failed": "Verification failed",
};
const statusIcons = {
    verified: "✅",
    "partially-verified": "⚠️",
    unverified: "⚠️",
    unknown: "❔",
    "verification-failed": "❌",
};
function inlineCode(value) {
    const singleLine = sanitizeControlCharacters(value)
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
        .replace(/[\r\n\t]+/g, " ");
    const bounded = singleLine.length > 240 ? `${singleLine.slice(0, 239)}…` : singleLine;
    return `<code>${escapeHtml(bounded)}</code>`;
}
function safeSummaryNotes(notes) {
    const staticLimitationNotes = new Set([
        "Could not parse package.json; check discovery skipped its scripts.",
        "Workspace package detected; root scripts are discovered, but package-level scripts are not inferred automatically.",
        "Repository source analysis was limited to the first 5,000 tracked/unignored files.",
        "Runner-qualified targeted test execution was limited to the first 100 statically impacted paths.",
    ]);
    const exact = new Set([
        "Could not parse package.json; check discovery skipped its scripts.",
        "Workspace package detected; root scripts are discovered, but package-level scripts are not inferred automatically.",
        "Repository source analysis was limited to the first 5,000 tracked/unignored files.",
        "Runner-qualified targeted test execution was limited to the first 100 statically impacted paths.",
        "No changes matched the selected diff.",
        "Checks were discovered but not executed. Repository code execution requires explicit --run-checks consent.",
        "Check execution was requested, but no supported checks were discovered.",
    ]);
    const safe = notes.filter((note) => exact.has(note));
    if (notes.some((note) => note.startsWith("Working-tree selection includes "))) {
        safe.push("Working-tree selection includes Git-visible files under a common generated directory; inspect Git status and ignore rules if unintended.");
    }
    const categoryRules = [
        {
            pattern: /malformed compiler configuration/i,
            message: "Compiler configuration could not be parsed; static alias resolution was unavailable.",
        },
        {
            pattern: /compiler configuration .* does not include the importer|ancestor project selection is unknown|extends target .* unsupported/i,
            message: "Compiler configuration did not establish that it applies to every importer; some static alias relationships may be unavailable.",
        },
        {
            pattern: /compiler paths|package self-reference|module-resolution|package boundary|export condition|standalone baseUrl|wildcard mapping|mapped target|paths target|candidate expansion|higher-precedence candidate/i,
            message: "Repository-local module resolution encountered an unsupported or ambiguous case; some static relationships may be unavailable.",
        },
        {
            pattern: /^Skipped .*unreadable, binary, or larger than 1 MB/i,
            message: "Some source files could not be structurally analyzed because they were unreadable, binary, or larger than 1 MB.",
        },
    ];
    const categories = categoryRules.filter((category) => notes.some((note) => category.pattern.test(note)));
    safe.push(...categories.map((category) => category.message));
    const categorized = notes.filter((note) => categoryRules.some((category) => category.pattern.test(note))).length;
    const knownCount = notes.filter((note) => exact.has(note) || note.startsWith("Working-tree selection includes ")).length;
    const omitted = Math.max(0, notes.length - knownCount - categorized);
    if (omitted > 0)
        safe.push(`${omitted} additional static-analysis ${omitted === 1 ? "diagnostic is" : "diagnostics are"} available only in the detailed report.`);
    return { notes: safe, hasStaticLimitation: notes.some((note) => staticLimitationNotes.has(note)) || categories.length > 0 || omitted > 0 };
}
function pathList(paths, limit) {
    const displayed = paths.slice(0, limit).map(inlineCode).join(", ");
    return paths.length > limit ? `${displayed} (+${paths.length - limit} more)` : displayed;
}
function targetEvidence(item, maxPaths) {
    if (item.status === "verification-failed") {
        const failedTargets = item.testExecutions.filter((execution) => execution.status !== "passed").map((execution) => `${execution.path} (${execution.status})`);
        const ambiguousTargets = item.evidence
            .filter((entry) => entry.kind === "limitation" && entry.checkId !== undefined)
            .map((entry) => entry.label);
        const unattributed = item.evidence.some((entry) => entry.kind === "failing-check" && /did not reliably attribute|failed closed/i.test(entry.detail));
        const details = [];
        if (failedTargets.length > 0)
            details.push(`Attributed failed ${failedTargets.length === 1 ? "target" : "targets"}: ${pathList(failedTargets, maxPaths)}.`);
        if (unattributed) {
            details.push(ambiguousTargets.length > 0
                ? `The targeted process also failed without complete attribution; ambiguous related ${ambiguousTargets.length === 1 ? "target" : "targets"}: ${pathList(ambiguousTargets, maxPaths)}.`
                : "The targeted process also failed without complete target attribution, so ProofDiff failed closed.");
        }
        else if (failedTargets.length === 0) {
            details.push("An applicable check failed, errored, or timed out; no exact failed target outcome was available.");
        }
        if (item.executedTests.length > 0)
            details.push(`Independently passing ${item.executedTests.length === 1 ? "target" : "targets"}: ${pathList(item.executedTests, maxPaths)}; ${item.executedTests.length === 1 ? "it does" : "they do"} not erase the relevant failure.`);
        return details.join(" ");
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
function reportPath(value) {
    const normalized = value.replaceAll("\\", "/");
    return path.isAbsolute(value) || path.win32.isAbsolute(value) ? path.posix.basename(normalized) : normalized;
}
export function renderGithubSummary(report, options = {}) {
    const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 12, 50));
    const maxPaths = Math.max(1, Math.min(options.maxPathsPerFile ?? 3, 10));
    const risk = report.summary.highestRisk?.toUpperCase() ?? "NONE";
    const counts = Object.keys(statusLabels)
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
    if (report.assessments.length === 0)
        output.push("No changed files matched the selected diff.", "");
    for (const item of report.assessments.slice(0, maxFiles)) {
        output.push(`- ${statusIcons[item.status]} **${statusLabels[item.status]}** · ${inlineCode(item.file.path)} · ${item.risk.toUpperCase()} risk`);
        output.push(`  - ${targetEvidence(item, maxPaths)}`);
        output.push("");
    }
    if (report.assessments.length > maxFiles) {
        output.push(`_${report.assessments.length - maxFiles} more changed ${report.assessments.length - maxFiles === 1 ? "file is" : "files are"} omitted from this bounded summary._`, "");
    }
    const noteProjection = safeSummaryNotes(report.notes);
    if (noteProjection.notes.length > 0) {
        output.push("### Analysis notes", "");
        for (const note of noteProjection.notes.slice(0, 3))
            output.push(`- ${note}`);
        if (noteProjection.notes.length > 3)
            output.push(`- _${noteProjection.notes.length - 3} more notes are available in the detailed report._`);
        output.push("");
    }
    if (report.summary.overallStatus === "verification-failed") {
        output.push("**Next step:** Inspect the relevant failure and full provenance; a passing target elsewhere does not erase it.", "");
    }
    else if (report.notes.some((note) => note.startsWith("Check execution was requested"))) {
        output.push("**Next step:** Check discovery found nothing it could run. Inspect the supported conventions and detailed limitations; do not treat this unknown state as a pass.", "");
    }
    else if (noteProjection.hasStaticLimitation) {
        output.push("**Next step:** Inspect and, where appropriate, fix the static-analysis limitation before seeking stronger runtime evidence.", "");
    }
    else if (!report.trust.repositoryCodeExecuted && report.summary.filesChanged > 0) {
        output.push("**Next step:** Keep static-only analysis for untrusted changes. After review, use `run-checks: true` only in a secret-free isolated job if you want ProofDiff to seek runner observations.", "");
    }
    else if (report.assessments.some((item) => item.status !== "verified")) {
        output.push("**Next step:** Inspect the files without passing target observations and the detailed limitations before deciding whether more verification is needed.", "");
    }
    output.push("> **Trust boundary:** A related target pass means ProofDiff observed at least one non-skipped test for that exact runner-qualified target. It does not show that changed code ran or that behavior is correct.", "");
    if (options.htmlPath) {
        output.push(`Full provenance remains in the job log and configured HTML report ${inlineCode(reportPath(options.htmlPath))}. Upload that file as a workflow artifact to retain it.`);
    }
    else {
        output.push("Full provenance remains in the job log and any configured JSON or HTML report.");
    }
    output.push("");
    return output.join("\n");
}
//# sourceMappingURL=github.js.map