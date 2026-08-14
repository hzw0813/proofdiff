import { diffTargetCommit, GitError, gitNullDevice, listUntrackedFiles, resolveRevisionCommit } from "./git.js";
import { runProcess, safeExecutablePath } from "./process.js";
import type { DiffSelection } from "./types.js";

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

async function trackedFilesystemMatches(root: string, target: string | null): Promise<boolean> {
  const result = await runProcess("git", [
    "--no-pager",
    "-c", "core.quotepath=false",
    "-c", "core.fsmonitor=false",
    "-c", `core.hooksPath=${gitNullDevice()}`,
    "-c", "diff.external=",
    "-c", "attr.tree=refs/proofdiff/no-attributes",
    "diff",
    "--quiet",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=all",
    ...(target === null ? [] : [target]),
    "--",
  ], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: 64_000,
    env: gitEnvironment(),
  });
  if (result.timedOut) throw new GitError("Timed out while checking whether the selected immutable snapshot matches the checked-out filesystem.");
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  const message = result.stderr.trim() || result.error || `git diff exited with ${String(result.exitCode)}`;
  throw new GitError(`Could not establish immutable snapshot/workspace alignment: ${message}`);
}

function visibleUntrackedDetail(files: string[]): string {
  const shown = files.slice(0, 5);
  const remainder = files.length - shown.length;
  return `${shown.join(", ")}${remainder > 0 ? `, and ${remainder} more` : ""}`;
}

/**
 * ProofDiff's graph, metadata discovery, and check execution currently read the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is the same snapshot the diff targets.
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
    throw new GitError(`The selected ${selection.mode} diff is immutable, but the checked-out filesystem contains ${untracked.length} Git-visible untracked file${untracked.length === 1 ? "" : "s"}: ${visibleUntrackedDetail(untracked)}. Those files are outside the selected snapshot but could influence static analysis or check discovery. Commit, stage as appropriate, remove, or isolate them before retrying.`);
  }

  const aligned = await trackedFilesystemMatches(root, selection.mode === "staged" ? null : target);
  if (!aligned) {
    const expected = selection.mode === "staged" ? "the staged index" : "the selected HEAD target";
    throw new GitError(`The selected ${selection.mode} diff is immutable, but tracked checked-out content does not match ${expected}. ProofDiff failed closed rather than combine an immutable diff with source, configuration, test, or execution inputs from another filesystem state. Align the worktree with ${expected} (or use a separate worktree) and retry.`);
  }
}
