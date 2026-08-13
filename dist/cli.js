#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { analyzeRepository, VERSION } from "./analyze.js";
import { GitError } from "./git.js";
import { renderGithubSummary } from "./report/github.js";
import { renderHtmlReport } from "./report/html.js";
import { renderTerminalReport } from "./report/terminal.js";
const help = `ProofDiff ${VERSION} — evidence-based review of code changes

Usage:
  proofdiff [options]

Diff selection (choose at most one):
  --base <ref>          Compare merge-base(ref, HEAD) with HEAD
  --range <a..b>        Compare an explicit commit range
  --staged              Analyze only staged changes
                       Default: working tree (tracked + untracked) vs HEAD

Verification:
  --run-checks          Explicitly allow discovered repository checks to run
  --check <id|kind>     Run only a check id or test/typecheck/lint (repeatable)
  --timeout <seconds>   Per-check timeout, 1–1800 seconds (default: 120)

Reports and CI:
  --format <terminal|json>  Primary output format (default: terminal)
  --json                Alias for --format json
  --output <file>       Write primary output to a file instead of stdout
  --html <file>         Also write a self-contained interactive HTML report
  --github-summary <file>  Write a concise GitHub Actions job summary
  --fail-on <policy>    never, failed, unverified, partial, or high-risk
                        Default: failed
  --no-color            Disable ANSI color

Other:
  --repo <directory>    Repository or subdirectory (default: current directory)
  -h, --help            Show help
  -v, --version         Show version

Trust boundary:
  Static analysis never executes repository code. --run-checks is explicit consent
  to run repository-defined commands; output and duration are bounded, but this is
  not an operating-system sandbox. Analyze untrusted repositories without it.
`;
class UsageError extends Error {
    name = "UsageError";
}
function valueAfter(args, index, option) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${option} requires a value.`);
    return value;
}
function parseArgs(args) {
    const options = {
        repo: ".",
        runChecks: false,
        selectedChecks: [],
        timeoutMs: 120_000,
        format: "terminal",
        color: process.stdout.isTTY && !process.env.NO_COLOR,
        failOn: "failed",
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "-h" || arg === "--help")
            return "help";
        if (arg === "-v" || arg === "--version")
            return "version";
        if (arg === "--run-checks") {
            options.runChecks = true;
            continue;
        }
        if (arg === "--staged") {
            options.staged = true;
            continue;
        }
        if (arg === "--no-color") {
            options.color = false;
            continue;
        }
        if (arg === "--json") {
            options.format = "json";
            continue;
        }
        if (arg === "--repo") {
            options.repo = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--base") {
            options.base = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--range") {
            options.range = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--check") {
            options.selectedChecks.push(valueAfter(args, index, arg));
            index += 1;
            continue;
        }
        if (arg === "--output") {
            options.output = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--html") {
            options.html = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--github-summary") {
            options.githubSummary = valueAfter(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--timeout") {
            const seconds = Number(valueAfter(args, index, arg));
            if (!Number.isFinite(seconds) || seconds < 1 || seconds > 1_800)
                throw new UsageError("--timeout must be between 1 and 1800 seconds.");
            options.timeoutMs = Math.round(seconds * 1_000);
            index += 1;
            continue;
        }
        if (arg === "--format") {
            const value = valueAfter(args, index, arg);
            if (value !== "terminal" && value !== "json")
                throw new UsageError("--format must be terminal or json.");
            options.format = value;
            index += 1;
            continue;
        }
        if (arg === "--fail-on") {
            const value = valueAfter(args, index, arg);
            if (!["never", "failed", "unverified", "partial", "high-risk"].includes(value))
                throw new UsageError("--fail-on must be never, failed, unverified, partial, or high-risk.");
            options.failOn = value;
            index += 1;
            continue;
        }
        throw new UsageError(`Unknown option: ${arg}`);
    }
    if (options.selectedChecks.length > 0 && !options.runChecks)
        throw new UsageError("--check requires --run-checks; static analysis does not execute repository code.");
    return options;
}
async function writeOutput(file, content) {
    const destination = path.resolve(file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { encoding: "utf8", mode: 0o600 });
    await chmod(destination, 0o600);
}
function policyFailed(report, policy) {
    if (policy === "never")
        return false;
    if (policy === "failed")
        return report.summary.overallStatus === "verification-failed";
    if (policy === "unverified")
        return report.assessments.some((item) => item.status === "verification-failed" || item.status === "unverified");
    if (policy === "partial")
        return report.assessments.some((item) => item.status !== "verified");
    return report.assessments.some((item) => item.risk === "critical" || item.risk === "high");
}
async function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed === "help") {
        process.stdout.write(help);
        return;
    }
    if (parsed === "version") {
        process.stdout.write(`${VERSION}\n`);
        return;
    }
    const report = await analyzeRepository({
        repo: parsed.repo,
        ...(parsed.base === undefined ? {} : { base: parsed.base }),
        ...(parsed.range === undefined ? {} : { range: parsed.range }),
        ...(parsed.staged === undefined ? {} : { staged: parsed.staged }),
        runChecks: parsed.runChecks,
        selectedChecks: parsed.selectedChecks,
        timeoutMs: parsed.timeoutMs,
    });
    const primary = parsed.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderTerminalReport(report, { color: parsed.color, width: process.stdout.columns });
    if (parsed.output)
        await writeOutput(parsed.output, primary);
    else
        process.stdout.write(primary.endsWith("\n") ? primary : `${primary}\n`);
    if (parsed.html) {
        await writeOutput(parsed.html, renderHtmlReport(report));
        if (parsed.format === "terminal")
            process.stdout.write(`HTML report: ${path.resolve(parsed.html)}\n`);
    }
    if (parsed.githubSummary) {
        await writeOutput(parsed.githubSummary, renderGithubSummary(report, parsed.html ? { htmlPath: parsed.html } : {}));
    }
    if (policyFailed(report, parsed.failOn))
        process.exitCode = 1;
}
main().catch((error) => {
    if (error instanceof UsageError) {
        process.stderr.write(`proofdiff: ${error.message}\nRun proofdiff --help for usage.\n`);
        process.exitCode = 2;
        return;
    }
    if (error instanceof GitError) {
        process.stderr.write(`proofdiff: ${error.message}\nCheck the repository path and diff selection, then try again.\n`);
        process.exitCode = 2;
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`proofdiff: analysis failed: ${message}\nNo safety conclusion was produced.\n`);
    process.exitCode = 2;
});
//# sourceMappingURL=cli.js.map