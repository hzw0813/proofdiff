import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function temporaryDirectory(prefix = "proofdiff-test-"): Promise<string> {
  return await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export async function initializeRepository(files: Record<string, string>): Promise<string> {
  const root = await temporaryDirectory();
  git(root, "init", "-q");
  git(root, "config", "user.email", "proofdiff-tests@example.invalid");
  git(root, "config", "user.name", "ProofDiff Tests");
  await writeFiles(root, files);
  git(root, "add", ".");
  git(root, "commit", "-qm", "baseline");
  return root;
}

/** A local old-form submodule, requiring no network or protocol-policy overrides. */
export async function addSubmodule(root: string, directory: string, files: Record<string, string>): Promise<string> {
  const nested = path.join(root, directory);
  await mkdir(nested, { recursive: true });
  git(nested, "init", "-q");
  git(nested, "config", "user.email", "proofdiff-tests@example.invalid");
  git(nested, "config", "user.name", "ProofDiff Tests");
  await writeFiles(nested, { ".gitattributes": "* text eol=lf\n", ...files });
  git(nested, "add", ".");
  git(nested, "commit", "-qm", "nested baseline");
  await writeFiles(root, { ".gitmodules": `[submodule "nested"]\n\tpath = ${directory}\n\turl = https://example.invalid/nested.git\n` });
  git(root, "add", ".gitmodules", directory);
  git(root, "commit", "-qm", "add nested repository");
  return nested;
}

export function runCli(args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
