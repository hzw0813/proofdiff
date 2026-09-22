import { runProcess, safeExecutablePath, type ProcessResult } from "./process.js";

export class GitError extends Error {
  override name = "GitError";
}

export function gitNullDevice(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "NUL" : "/dev/null";
}

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

interface GitOptions {
  maxOutputBytes?: number;
  stdin?: string;
}

async function rawGit(root: string, args: string[], overrides: string[], options: GitOptions): Promise<ProcessResult> {
  const maxOutputBytes = options.maxOutputBytes ?? 8_000_000;
  const result = await runProcess("git", [
    "--no-pager",
    "-c", "core.quotepath=false",
    "-c", "core.fsmonitor=false",
    "-c", `core.hooksPath=${gitNullDevice()}`,
    "-c", "diff.external=",
    "-c", "attr.tree=refs/proofdiff/no-attributes",
    ...overrides,
    ...args,
  ], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes,
    env: gitEnvironment(),
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  });
  if (result.error !== undefined) throw new GitError(`Could not run Git: ${result.error}`);
  if (result.timedOut) throw new GitError("Git inspection timed out; incomplete output cannot establish evidence.");
  if (result.truncated) throw new GitError(`Git output exceeded the ${maxOutputBytes} byte limit; incomplete output cannot establish evidence. Narrow the selected diff or use a smaller checkout.`);
  return result;
}

/** All static Git reads share one boundary, including snapshot/workspace checks. */
export async function runGit(root: string, args: string[], options: GitOptions = {}): Promise<ProcessResult> {
  // Do not cache across calls: library callers and linked worktrees can change configuration.
  // The sanitized environment excludes system/global config while retaining worktree config.
  const config = await rawGit(root, ["config", "--includes", "--null", "--name-only", "--get-regexp", "^(filter|diff)\\..*\\.(clean|smudge|process|required|command|textconv)$"], [], { maxOutputBytes: 64_000 });
  if (config.exitCode !== 0 && !(config.exitCode === 1 && config.stdout === "")) {
    throw new GitError("Could not inspect Git content-driver configuration; static inspection failed closed.");
  }
  const prefixes = new Set<string>();
  for (const key of config.stdout.split("\0").filter(Boolean)) {
    const match = key.match(/^((?:filter|diff)\..+)\.(?:clean|smudge|process|required|command|textconv)$/is);
    if (match?.[1]) prefixes.add(match[1]);
  }
  const overrides: string[] = [];
  for (const prefix of prefixes) {
    const properties = prefix.toLowerCase().startsWith("filter.")
      ? ["clean", "smudge", "process", "required"]
      : ["command", "textconv"];
    for (const property of properties) overrides.push("-c", `${prefix}.${property}=${property === "required" ? "false" : ""}`);
  }
  return await rawGit(root, args, overrides, options);
}
