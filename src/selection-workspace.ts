import { diffTargetCommit, GitError, gitNullDevice, listUntrackedFiles, resolveRevisionCommit } from "./git.js";
import { runProcess, safeExecutablePath, type ProcessResult } from "./process.js";
import type { DiffSelection } from "./types.js";

const IGNORED_DISCOVERY_PATHS = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "pytest.toml",
  ".pytest.toml",
  "pytest.ini",
  ".pytest.ini",
  "tox.ini",
  "setup.cfg",
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
const PYTHON_SCAN_EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"]);

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: safeExecutablePath(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitNullDevice(),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  for (const key of ["SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function runGit(root: string, args: string[], maxOutputBytes = 64_000): Promise<ProcessResult> {
  return await runProcess("git", [
    "--no-pager",
    "-c", "core.quotepath=false",
    "-c", "core.fsmonitor=false",
    "-c", `core.hooksPath=${gitNullDevice()}`,
    "-c", "diff.external=",
    "-c", "attr.tree=refs/proofdiff/no-attributes",
    ...args,
  ], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes,
    env: gitEnvironment(),
  });
}

async function trackedFilesystemMatches(root: string, target: string | null): Promise<boolean> {
  const result = await runGit(root, [
    "diff",
    "--quiet",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=all",
    ...(target === null ? [] : [target]),
    "--",
  ]);
  if (result.timedOut) throw new GitError("Timed out while checking whether the selected immutable snapshot matches the checked-out filesystem.");
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  const message = result.stderr.trim() || result.error || `git diff exited with ${String(result.exitCode)}`;
  throw new GitError(`Could not establish immutable snapshot/workspace alignment: ${message}`);
}

function outsidePythonDiscoveryExcludedDirectory(file: string): boolean {
  const segments = file.replaceAll("\\", "/").split("/");
  return !segments.slice(0, -1).some((segment) => PYTHON_SCAN_EXCLUDED_DIRECTORIES.has(segment));
}

async function ignoredDiscoveryInputs(root: string): Promise<string[]> {
  const result = await runGit(root, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
    "--",
    ...IGNORED_DISCOVERY_PATHS,
  ], 512_000);
  if (result.timedOut || result.truncated) {
    throw new GitError("Could not completely establish whether ignored files can influence immutable check discovery within ProofDiff's bounded Git limits.");
  }
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || result.error || `git ls-files exited with ${String(result.exitCode)}`;
    throw new GitError(`Could not inspect ignored check-discovery inputs: ${message}`);
  }
  return [...new Set(result.stdout.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")).filter(outsidePythonDiscoveryExcludedDirectory))].sort();
}

function boundedDetail(files: string[]): string {
  const shown = files.slice(0, 5);
  const remainder = files.length - shown.length;
  return `${shown.join(", ")}${remainder > 0 ? `, and ${remainder} more` : ""}`;
}

/**
 * Graph analysis, check discovery, and exact-target execution currently use the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is aligned with the selected target,
 * and ignored files that the discovery layer would otherwise inspect are absent.
 */
export async function assertSelectionWorkspaceAligned(root: string, selection: DiffSelection): Promise<void> {
  if (selection.mode === "working-tree") return;

  let target: string | null = null;
  if (selection.mode === "base" || selection.mode === "range") {
    target = await diffTargetCommit(root, selection);
    if (target === null) throw new GitError(`Could not resolve the target commit for the selected ${selection.mode} diff.`);
    const head = await resolveRevisionCommit(root, "HEAD");
    if (target !== head) {
      throw new GitError(`The selected ${selection.mode} diff targets commit ${target}, but the checked-out HEAD is ${head}. ProofDiff currently reads source, configuration, test, and execution inputs from the checked-out filesystem, so analyzing a different target commit could mix snapshots. Check out the target commit (or use a separate worktree) and retry.`);
    }
  }

  const untracked = await listUntrackedFiles(root);
  if (untracked.length > 0) {
    throw new GitError(`The selected ${selection.mode} diff is immutable, but the checked-out filesystem contains ${untracked.length} Git-visible untracked file${untracked.length === 1 ? "" : "s"}: ${boundedDetail(untracked)}. Those files are outside the selected snapshot but can influence static analysis or check discovery. Commit, stage as appropriate, remove, or isolate them before retrying.`);
  }

  const ignoredInputs = await ignoredDiscoveryInputs(root);
  if (ignoredInputs.length > 0) {
    throw new GitError(`The selected ${selection.mode} diff is immutable, but ignored filesystem input${ignoredInputs.length === 1 ? "" : "s"} visible to ProofDiff's check-discovery logic exist outside the selected snapshot: ${boundedDetail(ignoredInputs)}. Remove or isolate those ignored metadata/test inputs before retrying; ignored dependency/install directories such as node_modules remain allowed as execution environment.`);
  }

  const aligned = await trackedFilesystemMatches(root, selection.mode === "staged" ? null : target);
  if (!aligned) {
    const expected = selection.mode === "staged" ? "the staged index" : "the selected HEAD target";
    throw new GitError(`The selected ${selection.mode} diff is immutable, but tracked checked-out content does not match ${expected}. ProofDiff failed closed rather than combine an immutable diff with source, configuration, test, or execution inputs from another filesystem state. Align the worktree with ${expected} (or use a separate worktree) and retry.`);
  }
}
