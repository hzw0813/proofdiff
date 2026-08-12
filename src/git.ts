import path from "node:path";
import os from "node:os";
import { runProcess, safeExecutablePath, type ProcessResult } from "./process.js";
import type { ChangedFile, ChangeKind, DiffHunk, DiffSelection, RepositoryInfo } from "./types.js";
import { isLikelyBinaryFile, languageForPath, normalizeRepoPath, readUtf8File, resolveRepositoryPath, unique } from "./util.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export class GitError extends Error {
  override name = "GitError";
}

export function gitNullDevice(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "NUL" : os.devNull;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: safeExecutablePath(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitNullDevice(),
    GIT_ATTR_NOSYSTEM: "1",
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

const driverOverrideCache = new Map<string, string[]>();

async function rawGitResult(root: string, args: string[], driverOverrides: string[] = []): Promise<ProcessResult> {
  return await runProcess("git", [
    "--no-pager",
    "-c", "core.quotepath=false",
    "-c", "core.fsmonitor=false",
    "-c", `core.hooksPath=${gitNullDevice()}`,
    "-c", "diff.external=",
    "-c", "attr.tree=refs/proofdiff/no-attributes",
    ...driverOverrides,
    ...args,
  ], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: 8_000_000,
    env: gitEnvironment(),
  });
}

async function configuredDriverOverrides(root: string): Promise<string[]> {
  const cached = driverOverrideCache.get(root);
  if (cached) return cached;
  const result = await rawGitResult(root, ["config", "--local", "--includes", "--name-only", "--get-regexp", "^(filter|diff)\\..*\\.(clean|smudge|process|required|command|textconv)$"]);
  const prefixes = new Set<string>();
  for (const key of result.stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const match = key.match(/^((?:filter|diff)\..+)\.(?:clean|smudge|process|required|command|textconv)$/i);
    if (match?.[1]) prefixes.add(match[1]);
  }
  const overrides: string[] = [];
  for (const prefix of prefixes) {
    const properties = prefix.toLowerCase().startsWith("filter.")
      ? ["clean", "smudge", "process", "required"]
      : ["command", "textconv"];
    for (const property of properties) overrides.push("-c", `${prefix}.${property}=${property === "required" ? "false" : ""}`);
  }
  driverOverrideCache.set(root, overrides);
  return overrides;
}

async function gitResult(root: string, args: string[]): Promise<ProcessResult> {
  return await rawGitResult(root, args, await configuredDriverOverrides(root));
}

async function git(root: string, args: string[], allowFailure = false): Promise<string> {
  const result = await gitResult(root, args);
  if (!allowFailure && result.exitCode !== 0) {
    const message = result.stderr.trim() || result.error || `git exited with ${String(result.exitCode)}`;
    throw new GitError(message);
  }
  return result.stdout;
}

export async function findRepository(value: string): Promise<string> {
  const candidate = await resolveRepositoryPath(value);
  const result = await gitResult(candidate, ["rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) throw new GitError(`Not a Git repository: ${candidate}`);
  return (await resolveRepositoryPath(result.stdout.trim()));
}

async function hasHead(root: string): Promise<boolean> {
  const result = await gitResult(root, ["rev-parse", "--verify", "HEAD"]);
  return result.exitCode === 0;
}

function validateRevision(value: string, label: string): void {
  if (!value || value.startsWith("-") || /[\u0000-\u001F\u007F\s]/.test(value)) {
    throw new GitError(`Invalid ${label}: revisions cannot start with '-' or contain whitespace.`);
  }
}

async function assertRevision(root: string, value: string): Promise<void> {
  validateRevision(value, "revision");
  const result = await gitResult(root, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`]);
  if (result.exitCode !== 0) throw new GitError(`Unknown commit or ref: ${value}`);
}

export async function selectDiff(root: string, options: { base?: string; range?: string; staged?: boolean }): Promise<{ selection: DiffSelection; args: string[] }> {
  const selected = Number(options.base !== undefined) + Number(options.range !== undefined) + Number(options.staged === true);
  if (selected > 1) throw new GitError("Choose only one of --base, --range, or --staged.");

  if (options.base !== undefined) {
    await assertRevision(root, options.base);
    if (!(await hasHead(root))) throw new GitError("--base requires a repository with a HEAD commit.");
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
    const args = (await hasHead(root)) ? ["--cached"] : ["--cached", EMPTY_TREE];
    return { selection: { mode: "staged", description: "staged changes" }, args };
  }
  const args = (await hasHead(root)) ? ["HEAD"] : [EMPTY_TREE];
  return { selection: { mode: "working-tree", description: "working tree vs HEAD" }, args };
}

function parseNameStatus(raw: string): Array<{ status: string; path: string; previousPath?: string }> {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const entries: Array<{ status: string; path: string; previousPath?: string }> = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++] ?? "";
    if (/^[RC]/.test(status)) {
      const previousPath = fields[index++] ?? "";
      const currentPath = fields[index++] ?? "";
      entries.push({ status, path: normalizeRepoPath(currentPath), previousPath: normalizeRepoPath(previousPath) });
    } else {
      const currentPath = fields[index++] ?? "";
      entries.push({ status, path: normalizeRepoPath(currentPath) });
    }
  }
  return entries.filter((entry) => entry.path.length > 0);
}

function parseNumstat(raw: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const result = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  const fields = raw.split("\0");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field) continue;
    const match = field.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!match) continue;
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

function parseHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  for (const line of patch.split("\n")) {
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
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

function deletedSymbolHints(patch: string): string[] {
  const hints: string[] = [];
  const patterns = [
    /^-\s*(?:export\s+)?(?:async\s+)?function\s+([\w$]+)/,
    /^-\s*(?:export\s+)?class\s+([\w$]+)/,
    /^-\s*(?:async\s+)?def\s+([\w_]+)/,
    /^-\s*class\s+([\w_]+)/,
  ];
  for (const line of patch.split("\n")) {
    if (line.startsWith("---")) continue;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) hints.push(match[1]);
    }
  }
  return unique(hints);
}

function changeKind(status: string): ChangeKind {
  switch (status[0]) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    case "C": return "copied";
    default: return "unknown";
  }
}

export async function changedFiles(root: string, diffArgs: string[], includeUntracked: boolean): Promise<ChangedFile[]> {
  const safeDiffOptions = ["--no-ext-diff", "--no-textconv", "--ignore-submodules=all"];
  const status = parseNameStatus(await git(root, ["diff", ...safeDiffOptions, "--name-status", "-z", "--find-renames", ...diffArgs, "--"]));
  const stats = parseNumstat(await git(root, ["diff", ...safeDiffOptions, "--numstat", "-z", "--find-renames", ...diffArgs, "--"]));

  if (includeUntracked) {
    const untracked = (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    for (const file of untracked) status.push({ status: "A", path: normalizeRepoPath(file) });
  }

  const files: ChangedFile[] = [];
  for (const entry of status) {
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
    } else {
      patch = await git(root, ["diff", ...safeDiffOptions, "--unified=0", "--find-renames", ...diffArgs, "--", entry.path], true);
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
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listRepositoryFiles(root: string, limit = 5_000): Promise<{ files: string[]; truncated: boolean }> {
  const raw = await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const files = unique(raw.split("\0").filter(Boolean).map(normalizeRepoPath)).sort();
  return { files: files.slice(0, limit), truncated: files.length > limit };
}

export async function repositoryInfo(root: string): Promise<RepositoryInfo> {
  const head = (await hasHead(root)) ? (await git(root, ["rev-parse", "--short=12", "HEAD"])).trim() : null;
  const branchRaw = (await git(root, ["symbolic-ref", "--short", "HEAD"], true)).trim();
  const dirty = (await git(root, ["status", "--porcelain=v1", "--ignore-submodules=all"])).length > 0;
  return {
    root,
    name: path.basename(root),
    head,
    branch: branchRaw || null,
    dirty,
  };
}
