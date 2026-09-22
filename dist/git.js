import path from "node:path";
import { GitError, runGit as gitResult } from "./git-command.js";
import { compareCodeUnits, isLikelyBinaryFile, languageForPath, normalizeRepoPath, readUtf8File, resolveRepositoryPath, unique } from "./util.js";
export { GitError, gitNullDevice } from "./git-command.js";
async function git(root, args, allowFailure = false) {
    const result = await gitResult(root, args);
    if (!allowFailure && result.exitCode !== 0) {
        const message = result.stderr.trim() || result.error || `git exited with ${String(result.exitCode)}`;
        throw new GitError(message);
    }
    return result.stdout;
}
/** Git's cached stat flags must not hide inputs that filesystem-backed analysis reads. */
async function assertInspectableIndex(root) {
    const output = await git(root, ["ls-files", "--stage", "-v", "-z"]);
    const conflicts = [];
    const hidden = [];
    if (output !== "" && !output.endsWith("\0"))
        throw new GitError("Incomplete Git index inventory; cannot establish evidence.");
    for (const record of output.split("\0").filter(Boolean)) {
        // Parse only the fixed prefix; paths may contain tabs, newlines, and literal backslashes.
        const entry = record.match(/^([A-Za-z?]) [0-7]{6} (?:[0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t([\s\S]+)$/);
        if (!entry)
            throw new GitError("Unrecognized Git index record; cannot establish evidence.");
        const [, tag, stage, file] = entry;
        if (stage !== "0")
            conflicts.push(file);
        if (tag === "S" || tag !== tag.toUpperCase())
            hidden.push(file);
    }
    const detail = (files) => {
        const paths = unique(files);
        return `${paths.slice(0, 5).map((file) => JSON.stringify(file)).join(", ")}${paths.length > 5 ? `, and ${paths.length - 5} more` : ""}`;
    };
    if (conflicts.length > 0) {
        throw new GitError(`The Git index contains unresolved merge stages: ${detail(conflicts)}. Resolve and stage the conflicts (or abort the merge) before analysis; combined conflict diffs cannot establish a single source snapshot.`);
    }
    if (hidden.length > 0) {
        throw new GitError(`The Git index contains assume-unchanged or skip-worktree entries: ${detail(hidden)}. Those flags can hide changed or missing filesystem inputs. Use a full checkout (git sparse-checkout disable for sparse checkouts), or clear the flags with git update-index --no-assume-unchanged --no-skip-worktree -- <path>, then retry. ProofDiff does not modify the index.`);
    }
}
export async function findRepository(value) {
    const candidate = await resolveRepositoryPath(value);
    const result = await gitResult(candidate, ["rev-parse", "--show-toplevel"]);
    if (result.exitCode !== 0)
        throw new GitError(`Not a Git repository: ${candidate}`);
    const lineEndingLength = process.platform === "win32" && result.stdout.endsWith("\r\n")
        ? 2
        : result.stdout.endsWith("\n") ? 1 : 0;
    const topLevel = lineEndingLength === 0 ? result.stdout : result.stdout.slice(0, -lineEndingLength);
    return await resolveRepositoryPath(topLevel);
}
async function hasHead(root) {
    const result = await gitResult(root, ["rev-parse", "--verify", "HEAD"]);
    return result.exitCode === 0;
}
function validateRevision(value, label) {
    if (!value || value.startsWith("-") || /[\u0000-\u001F\u007F\s]/.test(value)) {
        throw new GitError(`Invalid ${label}: revisions cannot start with '-' or contain whitespace.`);
    }
}
async function assertRevision(root, value) {
    validateRevision(value, "revision");
    const result = await gitResult(root, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`]);
    if (result.exitCode !== 0)
        throw new GitError(`Unknown commit or ref: ${value}`);
}
export async function resolveRevisionCommit(root, value) {
    await assertRevision(root, value);
    const resolved = (await git(root, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`])).trim().toLowerCase();
    if (!/^[0-9a-f]{40,64}$/.test(resolved))
        throw new GitError(`Git returned an invalid commit for: ${value}`);
    return resolved;
}
export async function diffTargetCommit(root, selection) {
    if (selection.mode === "base")
        return await resolveRevisionCommit(root, "HEAD");
    if (selection.mode === "range" && selection.value) {
        const match = selection.value.match(/^(.+?)(\.\.\.?)(.+)$/);
        if (!match?.[3])
            return null;
        return await resolveRevisionCommit(root, match[3]);
    }
    return null;
}
async function emptyTree(root) {
    const result = await gitResult(root, ["hash-object", "-t", "tree", "--stdin"], { stdin: "" });
    const object = result.stdout.trim();
    if (result.exitCode !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(object)) {
        throw new GitError("Could not resolve the empty tree for this repository object format.");
    }
    return object;
}
export async function selectDiff(root, options) {
    const selected = Number(options.base !== undefined) + Number(options.range !== undefined) + Number(options.staged === true);
    if (selected > 1)
        throw new GitError("Choose only one of --base, --range, or --staged.");
    if (options.base !== undefined) {
        await assertRevision(root, options.base);
        if (!(await hasHead(root)))
            throw new GitError("--base requires a repository with a HEAD commit.");
        return {
            selection: { mode: "base", value: options.base, description: `${options.base}...HEAD (merge-base diff)` },
            args: [`${options.base}...HEAD`],
        };
    }
    if (options.range !== undefined) {
        validateRevision(options.range, "range");
        const match = options.range.match(/^(.+?)(\.\.\.?)(.+)$/);
        if (!match || match[1] === undefined || match[3] === undefined) {
            throw new GitError("--range must look like <from>..<to> or <from>...<to>.");
        }
        await assertRevision(root, match[1]);
        await assertRevision(root, match[3]);
        return {
            selection: { mode: "range", value: options.range, description: options.range },
            args: [options.range],
        };
    }
    if (options.staged === true) {
        const args = (await hasHead(root)) ? ["--cached"] : ["--cached", await emptyTree(root)];
        return { selection: { mode: "staged", description: "staged changes" }, args };
    }
    const args = (await hasHead(root)) ? ["HEAD"] : [await emptyTree(root)];
    return { selection: { mode: "working-tree", description: "working tree vs HEAD" }, args };
}
function parseRawStatus(raw) {
    const fields = raw.split("\0");
    if (fields.at(-1) === "")
        fields.pop();
    const entries = [];
    for (let index = 0; index < fields.length;) {
        const header = fields[index++] ?? "";
        const match = header.match(/^:([0-7]{6}) ([0-7]{6}) [0-9a-f]{40,64} [0-9a-f]{40,64} ([ACDMRTUXB][0-9]*)$/);
        if (!match)
            throw new GitError("Unrecognized raw Git diff record; cannot establish complete evidence.");
        const status = match[3];
        const kind = match[1] === "160000" || match[2] === "160000" ? { submodule: true } : {};
        if (/^[RC]/.test(status)) {
            const previousPath = fields[index++] ?? "";
            const currentPath = fields[index++] ?? "";
            if (!previousPath || !currentPath)
                throw new GitError("Incomplete renamed Git path record.");
            entries.push({ status, path: normalizeRepoPath(currentPath), previousPath: normalizeRepoPath(previousPath), ...kind });
        }
        else {
            const currentPath = fields[index++] ?? "";
            if (!currentPath)
                throw new GitError("Incomplete Git path record.");
            entries.push({ status, path: normalizeRepoPath(currentPath), ...kind });
        }
    }
    return entries.filter((entry) => entry.path.length > 0);
}
function parseNumstat(raw) {
    const result = new Map();
    const fields = raw.split("\0");
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (!field)
            continue;
        const match = field.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
        if (!match)
            continue;
        let file = match[3] ?? "";
        if (file === "" && fields[index + 2] !== undefined) {
            file = fields[index + 2] ?? "";
            index += 2;
        }
        result.set(normalizeRepoPath(file), {
            additions: match[1] === "-" ? 0 : Number(match[1]),
            deletions: match[2] === "-" ? 0 : Number(match[2]),
            binary: match[1] === "-" || match[2] === "-",
        });
    }
    return result;
}
function parseHunks(patch) {
    const hunks = [];
    for (const line of patch.split("\n")) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!match)
            continue;
        const oldStart = Number(match[1]);
        const oldCount = Number(match[2] ?? "1");
        const newStart = Number(match[3]);
        const newCount = Number(match[4] ?? "1");
        hunks.push({
            oldRange: { start: oldStart, end: oldCount === 0 ? oldStart : oldStart + oldCount - 1 },
            newRange: { start: newStart, end: newCount === 0 ? newStart : newStart + newCount - 1 },
        });
    }
    return hunks;
}
function deletedSymbolHints(patch) {
    const hints = [];
    const patterns = [
        /^-\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/,
        /^-\s*(?:export\s+)?class\s+([\w$]+)/,
        /^-\s*(?:async\s+)?def\s+([\w_]+)/,
        /^-\s*class\s+([\w_]+)/,
    ];
    for (const line of patch.split("\n")) {
        if (line.startsWith("---"))
            continue;
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match?.[1])
                hints.push(match[1]);
        }
    }
    return unique(hints);
}
function changeKind(status) {
    switch (status[0]) {
        case "A": return "added";
        case "M": return "modified";
        case "D": return "deleted";
        case "R": return "renamed";
        case "C": return "copied";
        default: return "unknown";
    }
}
export async function changedFiles(root, diffArgs, includeUntracked, knownUntracked) {
    await assertInspectableIndex(root);
    // Observe gitlink identities without asking Git to inspect nested dirty contents.
    const safeDiffOptions = ["--no-ext-diff", "--no-textconv", "--ignore-submodules=dirty", "--submodule=short"];
    const status = parseRawStatus(await git(root, ["diff", ...safeDiffOptions, "--raw", "--no-abbrev", "-z", "--find-renames", ...diffArgs, "--"]));
    const stats = parseNumstat(await git(root, ["diff", ...safeDiffOptions, "--numstat", "-z", "--find-renames", ...diffArgs, "--"]));
    if (includeUntracked) {
        const untracked = knownUntracked ?? await listUntrackedFiles(root);
        for (const file of untracked)
            status.push({ status: "A", path: normalizeRepoPath(file) });
    }
    const files = [];
    for (const entry of status) {
        if (entry.submodule) {
            files.push({ path: entry.path, ...(entry.previousPath === undefined ? {} : { previousPath: entry.previousPath }),
                submodule: true, change: changeKind(entry.status), language: "unknown", additions: 0, deletions: 0,
                binary: false, hunks: [], deletedSymbolHints: [] });
            continue;
        }
        const isUntracked = includeUntracked && !(stats.has(entry.path));
        let patch = "";
        let metric = stats.get(entry.path);
        if (isUntracked) {
            const absoluteFile = path.join(root, entry.path);
            const binary = await isLikelyBinaryFile(absoluteFile);
            const content = binary ? null : await readUtf8File(absoluteFile);
            const lines = content === null || content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
            metric = { additions: lines, deletions: 0, binary };
            patch = content === null ? "" : `@@ -0,0 +1,${lines} @@\n${content.split("\n").map((line) => `+${line}`).join("\n")}`;
        }
        else {
            const pathspec = entry.previousPath === undefined ? [entry.path] : [entry.previousPath, entry.path];
            patch = await git(root, ["diff", ...safeDiffOptions, "--unified=0", "--find-renames", ...diffArgs, "--", ...pathspec.map((file) => `:(literal)${file}`)]);
        }
        files.push({
            path: entry.path,
            ...(entry.previousPath === undefined ? {} : { previousPath: entry.previousPath }),
            change: changeKind(entry.status),
            language: languageForPath(entry.path),
            additions: metric?.additions ?? 0,
            deletions: metric?.deletions ?? 0,
            binary: metric?.binary ?? false,
            hunks: parseHunks(patch),
            deletedSymbolHints: deletedSymbolHints(patch),
        });
    }
    return files.sort((a, b) => compareCodeUnits(a.path, b.path));
}
export async function listUntrackedFiles(root) {
    return (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
        .split("\0")
        .filter(Boolean)
        .map(normalizeRepoPath)
        .sort();
}
export async function listSubmodulePaths(root) {
    const records = (await git(root, ["ls-files", "--stage", "-z"])).split("\0");
    return unique(records.filter((record) => record.startsWith("160000 ")).map((record) => normalizeRepoPath(record.slice(record.indexOf("\t") + 1)))).sort();
}
export async function listRepositoryFiles(root, limit = 5_000) {
    const result = await gitResult(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    if (result.exitCode !== 0) {
        const message = result.stderr.trim() || result.error || `git exited with ${String(result.exitCode)}`;
        throw new GitError(message);
    }
    const submodules = await listSubmodulePaths(root);
    const links = new Set(submodules);
    const files = unique(result.stdout.split("\0").filter(Boolean).map(normalizeRepoPath)).filter((file) => !links.has(file)).sort();
    return { files: files.slice(0, limit), truncated: result.truncated || files.length > limit, submodules };
}
export async function repositoryInfo(root) {
    const head = (await hasHead(root)) ? (await git(root, ["rev-parse", "--short=12", "HEAD"])).trim() : null;
    const branchRaw = (await git(root, ["symbolic-ref", "--short", "HEAD"], true)).trim();
    const dirty = (await git(root, ["status", "--porcelain=v1", "--ignore-submodules=dirty"])).length > 0;
    return {
        root,
        name: path.basename(root),
        head,
        branch: branchRaw || null,
        dirty,
    };
}
//# sourceMappingURL=git.js.map