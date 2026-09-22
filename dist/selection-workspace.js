import path from "node:path";
import { diffTargetCommit, GitError, listSubmodulePaths, listUntrackedFiles, resolveRevisionCommit } from "./git.js";
import { runGit } from "./git-command.js";
import { normalizeRepoPath } from "./util.js";
const ROOT_DISCOVERY_METADATA = new Set([
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "pytest.toml",
    ".pytest.toml",
    "pytest.ini",
    ".pytest.ini",
    "tox.ini",
    "setup.cfg",
]);
const IGNORED_DISCOVERY_PATHS = [
    ...ROOT_DISCOVERY_METADATA,
    ":(glob)test_*.py",
    ":(glob)*_test.py",
    ":(glob)*_spec.py",
    ":(glob)test_*.pyi",
    ":(glob)*_test.pyi",
    ":(glob)*_spec.pyi",
    ":(glob)**/test_*.py",
    ":(glob)**/*_test.py",
    ":(glob)**/*_spec.py",
    ":(glob)**/test_*.pyi",
    ":(glob)**/*_test.pyi",
    ":(glob)**/*_spec.pyi",
];
const STATIC_PYTHON_SCAN_EXCLUDED_DIRECTORIES = ["node_modules", "__pycache__", ".venv", "venv", "dist", "build"];
const EXECUTION_ENVIRONMENT_DIRECTORIES = ["node_modules", "__pycache__", ".venv", "venv"];
function exclusionPathspecs(directories) {
    return directories.flatMap((directory) => [
        `:(exclude,glob)${directory}/**`,
        `:(exclude,glob)**/${directory}/**`,
    ]);
}
const IGNORED_DISCOVERY_EXCLUSIONS = exclusionPathspecs(STATIC_PYTHON_SCAN_EXCLUDED_DIRECTORIES);
const IGNORED_EXECUTION_EXCLUSIONS = exclusionPathspecs(EXECUTION_ENVIRONMENT_DIRECTORIES);
async function trackedFilesystemMatches(root, target) {
    const result = await runGit(root, [
        "diff",
        "--quiet",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=all",
        ...(target === null ? [] : [target]),
        "--",
    ], { maxOutputBytes: 64_000 });
    if (result.exitCode === 0)
        return true;
    if (result.exitCode === 1)
        return false;
    const message = result.stderr.trim() || result.error || `git diff exited with ${String(result.exitCode)}`;
    throw new GitError(`Could not establish immutable snapshot/workspace alignment: ${message}`);
}
async function ignoredFiles(root, pathspecs, exclusions) {
    const result = await runGit(root, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        ...pathspecs,
        ...exclusions,
    ], { maxOutputBytes: 512_000 });
    if (result.exitCode !== 0) {
        const message = result.stderr.trim() || result.error || `git ls-files exited with ${String(result.exitCode)}`;
        throw new GitError(`Could not inspect ignored immutable-workspace inputs: ${message}`);
    }
    return [...new Set(result.stdout.split("\0").filter(Boolean).map(normalizeRepoPath))].sort();
}
function isPythonDiscoveryPath(repoPath) {
    const segments = repoPath.split("/");
    if (segments.slice(0, -1).some((segment) => STATIC_PYTHON_SCAN_EXCLUDED_DIRECTORIES.includes(segment)))
        return false;
    const name = segments.at(-1) ?? "";
    return /^(?:test_.*|.*_test|.*_spec)\.pyi?$/.test(name);
}
function isDiscoverySensitivePath(repoPath) {
    return (!repoPath.includes("/") && ROOT_DISCOVERY_METADATA.has(repoPath)) || isPythonDiscoveryPath(repoPath);
}
function repoLocalDataArtifact(root, artifact) {
    const absolute = path.isAbsolute(artifact) ? path.normalize(artifact) : path.resolve(root, artifact);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        return null;
    const normalized = normalizeRepoPath(relative);
    return isDiscoverySensitivePath(normalized) ? null : normalized;
}
function boundedDetail(files) {
    const shown = files.slice(0, 5);
    const remainder = files.length - shown.length;
    return `${shown.join(", ")}${remainder > 0 ? `, and ${remainder} more` : ""}`;
}
/**
 * Graph analysis, check discovery, and exact-target execution currently use the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is aligned with the selected target.
 * Explicit data artifacts are exempt only from the generic untracked/ignored gate when their own path cannot
 * double as repository metadata or a Python test consumed by discovery; their separate provenance checks still apply.
 */
export async function assertSelectionWorkspaceAligned(root, selection, options = {}) {
    if (selection.mode === "working-tree")
        return;
    if (options.repositoryCodeWillExecute && (options.submodulePaths ?? await listSubmodulePaths(root)).length > 0) {
        throw new GitError("Immutable check execution with Git submodules is unsupported: nested filesystem inputs are not bound to the selected snapshot. Use static analysis, analyze the submodules separately, or explicitly use working-tree analysis for local execution without immutable snapshot claims.");
    }
    let target = null;
    if (selection.mode === "base" || selection.mode === "range") {
        target = await diffTargetCommit(root, selection);
        if (target === null)
            throw new GitError(`Could not resolve the target commit for the selected ${selection.mode} diff.`);
        const head = await resolveRevisionCommit(root, "HEAD");
        if (target !== head) {
            throw new GitError(`The selected ${selection.mode} diff targets commit ${target}, but the checked-out HEAD is ${head}. ProofDiff currently reads source, configuration, test, and execution inputs from the checked-out filesystem, so analyzing a different target commit could mix snapshots. Check out the target commit (or use a separate worktree) and retry.`);
        }
    }
    const allowedArtifacts = new Set((options.allowedDataArtifacts ?? []).map((artifact) => repoLocalDataArtifact(root, artifact)).filter((artifact) => artifact !== null));
    const untracked = (await listUntrackedFiles(root)).filter((file) => !allowedArtifacts.has(file));
    if (untracked.length > 0) {
        throw new GitError(`The selected ${selection.mode} diff is immutable, but the checked-out filesystem contains ${untracked.length} Git-visible untracked file${untracked.length === 1 ? "" : "s"}: ${boundedDetail(untracked)}. Those files are outside the selected snapshot but can influence static analysis or check discovery. Commit, stage as appropriate, remove, or isolate them before retrying.`);
    }
    const ignoredInputs = options.repositoryCodeWillExecute
        ? await ignoredFiles(root, ["."], IGNORED_EXECUTION_EXCLUSIONS)
        : await ignoredFiles(root, IGNORED_DISCOVERY_PATHS, IGNORED_DISCOVERY_EXCLUSIONS);
    const unsafeIgnoredInputs = ignoredInputs.filter((file) => !allowedArtifacts.has(file));
    if (unsafeIgnoredInputs.length > 0) {
        const scope = options.repositoryCodeWillExecute ? "repository execution" : "check discovery";
        throw new GitError(`The selected ${selection.mode} diff is immutable, but ignored filesystem input${unsafeIgnoredInputs.length === 1 ? "" : "s"} visible to ${scope} exist outside the selected snapshot: ${boundedDetail(unsafeIgnoredInputs)}. Remove or isolate those inputs before retrying; bounded dependency/cache directories remain environment inputs rather than repository declarations.`);
    }
    const aligned = await trackedFilesystemMatches(root, selection.mode === "staged" ? null : target);
    if (!aligned) {
        const expected = selection.mode === "staged" ? "the staged index" : "the selected HEAD target";
        throw new GitError(`The selected ${selection.mode} diff is immutable, but tracked checked-out content does not match ${expected}. ProofDiff failed closed rather than combine an immutable diff with source, configuration, test, or execution inputs from another filesystem state. Align the worktree with ${expected} (or use a separate worktree) and retry.`);
    }
}
//# sourceMappingURL=selection-workspace.js.map