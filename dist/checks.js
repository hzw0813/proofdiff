import path from "node:path";
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { constrainedCheckEnvironment, runProcess } from "./process.js";
import { pathExists, readUtf8File, sanitizeControlCharacters, unique } from "./util.js";
async function detectPythonTests(root, limit = 2_000) {
    const queue = [
        { absolute: path.join(root, "tests"), directory: "tests" },
        { absolute: path.join(root, "test"), directory: "test" },
    ];
    let inspected = 0;
    let detected = null;
    while (queue.length > 0 && inspected < limit) {
        const current = queue.shift();
        let entries;
        try {
            entries = await readdir(current.absolute, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            inspected += 1;
            if (inspected >= limit)
                break;
            const target = path.join(current.absolute, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink() && !["node_modules", ".git", "__pycache__"].includes(entry.name))
                queue.push({ absolute: target, directory: current.directory });
            if (entry.isFile() && /(?:^test_.*|.*_(?:test|spec))\.pyi?$/.test(entry.name)) {
                const content = await readUtf8File(target, 200_000);
                const framework = content !== null && /(?:^|\n)\s*(?:from\s+unittest\b|import\s+unittest\b)|unittest\.TestCase/.test(content) ? "unittest" : "pytest";
                if (framework === "pytest")
                    return { framework, directory: current.directory };
                detected = { framework, directory: current.directory };
            }
        }
    }
    return detected;
}
function packageManager(root, manifest) {
    const declared = manifest.packageManager?.split("@")[0];
    if (declared === "pnpm")
        return { command: "pnpm", runArgs: (name) => ["run", name], origin: "package.json" };
    if (declared === "yarn")
        return { command: "yarn", runArgs: (name) => ["run", name], origin: "package.json" };
    if (declared === "bun")
        return { command: "bun", runArgs: (name) => ["run", name], origin: "package.json" };
    return { command: "npm", runArgs: (name) => ["run", name, "--silent"], origin: "package.json" };
}
export function packageManagerInvocation(command, args, platform = process.platform) {
    if (platform !== "win32" || command === "bun")
        return { command, args };
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `${command}.cmd`, ...args] };
}
function classifyScript(name) {
    const normalized = name.toLowerCase();
    if (/^(?:test|test:unit|test:ci|test:all|check:test)$/.test(normalized))
        return "test";
    if (/^(?:typecheck|type-check|check:types|types)$/.test(normalized))
        return "typecheck";
    if (/^(?:lint|lint:ci|check:lint)$/.test(normalized))
        return "lint";
    return null;
}
function targetingForScript(kind, command) {
    if (kind !== "test")
        return null;
    const normalized = command.trim().replaceAll(/\s+/g, " ");
    if (/^(?:node|node\.exe) --test$/.test(normalized))
        return { targetRunner: "node-test" };
    const compiled = normalized.match(/(?:^|&& )(?:node|node\.exe) --test (.+)$/)?.[1];
    if (!compiled)
        return null;
    const arguments_ = compiled.split(" ");
    if (arguments_.length === 1 && arguments_[0] && (arguments_[0].match(/\*/g)?.length ?? 0) === 1 && /^[A-Za-z0-9_./*-]+\.[cm]?js$/.test(arguments_[0])) {
        return { targetRunner: "node-test", targetPattern: arguments_[0] };
    }
    if (arguments_.every((argument) => /^[A-Za-z0-9_./-]+\.[cm]?js$/.test(argument)))
        return { targetRunner: "node-test", targetPatterns: arguments_ };
    return null;
}
export async function discoverChecks(root) {
    const checks = [];
    const notes = [];
    const packagePath = path.join(root, "package.json");
    const packageContent = await readUtf8File(packagePath, 2_000_000);
    if (packageContent !== null) {
        try {
            const manifest = JSON.parse(packageContent);
            const manager = packageManager(root, manifest);
            for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
                const kind = classifyScript(name);
                if (!kind || typeof command !== "string")
                    continue;
                const targeting = targetingForScript(kind, command);
                const invocation = packageManagerInvocation(manager.command, manager.runArgs(name));
                checks.push({
                    id: `js:${kind}:${name}`,
                    label: `${kind}: ${name}`,
                    kind,
                    command: invocation.command,
                    args: invocation.args,
                    origin: `${manager.origin} script ${JSON.stringify(name)}`,
                    executesRepositoryCode: true,
                    ...(targeting === null ? {} : targeting),
                });
            }
            if (manifest.workspaces !== undefined)
                notes.push("Workspace package detected; root scripts are discovered, but package-level scripts are not inferred automatically.");
        }
        catch (error) {
            notes.push(`Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const localTsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
    if (!checks.some((check) => check.kind === "typecheck") && await pathExists(path.join(root, "tsconfig.json")) && await pathExists(localTsc)) {
        checks.push({ id: "js:typecheck:tsc", label: "typecheck: tsc --noEmit", kind: "typecheck", command: "node", args: [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--pretty", "false"], origin: "tsconfig.json + local TypeScript binary", executesRepositoryCode: true });
    }
    const hasPythonProject = await pathExists(path.join(root, "pyproject.toml"));
    const pyproject = hasPythonProject ? await readUtf8File(path.join(root, "pyproject.toml")) : null;
    const explicitPytest = await pathExists(path.join(root, "pytest.ini")) || pyproject?.includes("[tool.pytest.") === true;
    const pythonTests = await detectPythonTests(root);
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    if (explicitPytest || pythonTests?.framework === "pytest") {
        checks.push({ id: "python:test:pytest", label: "test: pytest", kind: "test", command: pythonCommand, args: ["-m", "pytest", "-q"], origin: explicitPytest ? "pytest configuration" : "Python test layout", executesRepositoryCode: true, targetRunner: "pytest" });
    }
    else if (pythonTests?.framework === "unittest") {
        checks.push({ id: "python:test:unittest", label: "test: unittest", kind: "test", command: pythonCommand, args: ["-m", "unittest", "discover", "-s", pythonTests.directory], origin: "Python unittest layout", executesRepositoryCode: true, targetRunner: "unittest" });
    }
    if (pyproject?.includes("[tool.mypy")) {
        checks.push({ id: "python:typecheck:mypy", label: "typecheck: mypy", kind: "typecheck", command: pythonCommand, args: ["-m", "mypy", "."], origin: "pyproject.toml [tool.mypy]", executesRepositoryCode: true });
    }
    if (pyproject?.includes("[tool.ruff")) {
        checks.push({ id: "python:lint:ruff", label: "lint: ruff", kind: "lint", command: pythonCommand, args: ["-m", "ruff", "check", "."], origin: "pyproject.toml [tool.ruff]", executesRepositoryCode: true });
    }
    const deduplicated = unique(checks.map((check) => check.id)).map((id) => checks.find((check) => check.id === id));
    return { checks: deduplicated, notes };
}
function compiledNodeTarget(file, pattern, patterns) {
    if (patterns?.length) {
        if (/\.[cm]?jsx?$/.test(file))
            return patterns.includes(file) ? file : null;
        if (!/\.(?:ts|tsx|mts|cts)$/.test(file))
            return null;
        const compiledSource = file.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
        const matches = patterns.filter((candidate) => candidate === compiledSource || candidate.endsWith(`/${compiledSource}`));
        return matches.length === 1 ? matches[0] : null;
    }
    if (pattern === undefined)
        return /\.[cm]?jsx?$/.test(file) ? file : null;
    if (!/\.(?:ts|tsx|mts|cts)$/.test(file))
        return null;
    const compiledName = path.posix.basename(file)
        .replace(/\.tsx?$/, ".js")
        .replace(/\.mts$/, ".mjs")
        .replace(/\.cts$/, ".cjs");
    const patternName = path.posix.basename(pattern);
    const [before = "", after = ""] = patternName.split("*");
    if (!compiledName.startsWith(before) || !compiledName.endsWith(after))
        return null;
    return path.posix.join(path.posix.dirname(pattern), compiledName);
}
export async function targetedTestChecks(root, definitions, relatedTests, limit = 100) {
    const sorted = unique(relatedTests).sort();
    const checks = [];
    let truncated = false;
    for (const definition of definitions) {
        if (!definition.targetRunner)
            continue;
        const candidates = [];
        for (const file of sorted) {
            if (definition.targetRunner === "node-test") {
                const argument = compiledNodeTarget(file, definition.targetPattern, definition.targetPatterns);
                if (argument && await pathExists(path.join(root, argument)))
                    candidates.push({ source: file, argument });
            }
            else if (/\.pyi?$/.test(file)) {
                candidates.push({ source: file, argument: file });
            }
        }
        if (candidates.length === 0)
            continue;
        const selected = candidates.slice(0, limit);
        const targetFiles = selected.map((candidate) => candidate.source);
        const targetArguments = selected.map((candidate) => candidate.argument);
        if (candidates.length > limit)
            truncated = true;
        let command;
        let args;
        if (definition.targetRunner === "node-test") {
            command = "node";
            args = ["--test", ...targetArguments];
        }
        else if (definition.targetRunner === "pytest") {
            command = definition.command;
            args = ["-m", "pytest", "-q", "--", ...targetArguments];
        }
        else {
            command = definition.command;
            args = ["-m", "unittest", ...targetArguments];
        }
        checks.push({
            id: `${definition.id}:targeted`,
            label: `targeted ${definition.targetRunner}: ${targetFiles.length} related test file${targetFiles.length === 1 ? "" : "s"}`,
            kind: "test",
            command,
            args,
            origin: `ProofDiff targeted execution derived from ${definition.origin}`,
            executesRepositoryCode: true,
            targetRunner: definition.targetRunner,
            ...(definition.targetPattern === undefined ? {} : { targetPattern: definition.targetPattern }),
            ...(definition.targetPatterns === undefined ? {} : { targetPatterns: definition.targetPatterns }),
            targetFiles,
        });
    }
    return { checks, truncated };
}
function redactSensitiveOutput(value, root) {
    const redactions = [
        { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED PRIVATE KEY]" },
        { pattern: /\b(?:ghp|github_pat|glpat|sk_live|sk_test|npm)_[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED]" },
        { pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, replacement: "[REDACTED]" },
        { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED]" },
        { pattern: /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+\/=-]{8,}/gi, replacement: "$1[REDACTED]" },
        { pattern: /\b(https?:\/\/[^\s\/:@]+:)[^\s\/@]+@/gi, replacement: "$1[REDACTED]@" },
        { pattern: /\b([A-Za-z][A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi, replacement: "$1[REDACTED]" },
        { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED]" },
    ];
    let output = sanitizeControlCharacters(value);
    for (const redaction of redactions)
        output = output.replace(redaction.pattern, redaction.replacement);
    const resolvedRoot = path.resolve(root).replace(/[\\/]$/, "");
    const roots = new Set([resolvedRoot]);
    if (resolvedRoot.startsWith("/var/"))
        roots.add(`/private${resolvedRoot}`);
    if (resolvedRoot.startsWith("/private/var/"))
        roots.add(resolvedRoot.slice("/private".length));
    const pathVariants = [...roots].flatMap((candidate) => [
        pathToFileURL(candidate).href.replace(/\/$/, ""),
        candidate,
        candidate.replaceAll("\\", "/"),
        candidate.replaceAll("/", "\\"),
    ]).filter((candidate) => candidate.length > 1).sort((a, b) => b.length - a.length);
    for (const localPath of pathVariants)
        output = output.replaceAll(localPath, "[REPOSITORY]");
    return output.split(/\r?\n/).map((line) => line.trimEnd()).join("\n").trim();
}
export async function runChecks(root, definitions, options) {
    const unknown = (options.selected ?? []).filter((selection) => !definitions.some((check) => check.id === selection || check.kind === selection));
    if (unknown.length > 0)
        throw new Error(`Unknown check selection: ${unknown.join(", ")}. Use a check id or one of test, typecheck, lint.`);
    const selected = options.selected?.length
        ? definitions.filter((check) => options.selected.includes(check.id) || options.selected.includes(check.kind))
        : definitions;
    const results = [];
    for (const check of selected) {
        const result = await runProcess(check.command, check.args, {
            cwd: root,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: options.maxOutputBytes,
            env: constrainedCheckEnvironment(),
        });
        const combined = redactSensitiveOutput([result.stdout, result.stderr].filter(Boolean).join("\n"), root);
        let status;
        let explanation;
        if (result.timedOut) {
            status = "timed-out";
            explanation = `Stopped after the ${Math.round(options.timeoutMs / 1_000)} second safety limit.`;
        }
        else if (result.error) {
            status = "error";
            explanation = `Could not start the check: ${result.error}`;
        }
        else if (result.exitCode === 0) {
            status = "passed";
            explanation = "The command exited successfully.";
        }
        else {
            status = "failed";
            explanation = `The command exited with code ${String(result.exitCode)}.`;
        }
        results.push({ ...check, status, exitCode: result.exitCode, durationMs: result.durationMs, output: combined, outputTruncated: result.truncated, explanation });
    }
    return results;
}
export function notRunResults(definitions) {
    return definitions.map((check) => ({ ...check, status: "not-run", exitCode: null, durationMs: 0, output: "", outputTruncated: false, explanation: "Discovered only. Pass --run-checks to execute repository code explicitly." }));
}
//# sourceMappingURL=checks.js.map