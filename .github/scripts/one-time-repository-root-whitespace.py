from pathlib import Path

# Preserve repository-root path identity: Git's rev-parse output is line-delimited,
# but String.trim() also erases valid trailing path whitespace.
git_path = Path("src/git.ts")
git_text = git_path.read_text()
old_find = '''export async function findRepository(value: string): Promise<string> {
  const candidate = await resolveRepositoryPath(value);
  const result = await gitResult(candidate, ["rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) throw new GitError(`Not a Git repository: ${candidate}`);
  return (await resolveRepositoryPath(result.stdout.trim()));
}
'''
new_find = '''export async function findRepository(value: string): Promise<string> {
  const candidate = await resolveRepositoryPath(value);
  const result = await gitResult(candidate, ["rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) throw new GitError(`Not a Git repository: ${candidate}`);
  const lineEndingLength = process.platform === "win32" && result.stdout.endsWith("\\r\\n")
    ? 2
    : result.stdout.endsWith("\\n") ? 1 : 0;
  const topLevel = lineEndingLength === 0 ? result.stdout : result.stdout.slice(0, -lineEndingLength);
  return await resolveRepositoryPath(topLevel);
}
'''
if git_text.count(old_find) != 1:
    raise SystemExit(f"expected one findRepository block, found {git_text.count(old_find)}")
git_path.write_text(git_text.replace(old_find, new_find))

# Regression: create a real repo whose top-level directory ends in a space and a
# sibling at the trimmed spelling. The old code silently returned the sibling.
test_path = Path("tests/git.test.ts")
test_text = test_path.read_text()
old_import = 'import { rm, symlink, writeFile } from "node:fs/promises";'
new_import = 'import { mkdir, rm, symlink, writeFile } from "node:fs/promises";'
if test_text.count(old_import) != 1:
    raise SystemExit("git test fs import anchor was not unique")
test_text = test_text.replace(old_import, new_import)
marker = '''test("revision-like options are rejected before reaching git", async (context) => {'''
if test_text.count(marker) != 1:
    raise SystemExit("git regression insertion marker was not unique")
block = '''test("findRepository preserves trailing whitespace in the repository root", { skip: process.platform === "win32" }, async (context) => {
  const parent = await temporaryDirectory("proofdiff-root-space-");
  const root = path.join(parent, "repository ");
  const trimmedSibling = path.join(parent, "repository");
  context.after(() => rm(parent, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(trimmedSibling, { recursive: true });
  git(root, "init", "-q");
  assert.equal(await findRepository(path.join(root, "src")), root);
});

'''
test_path.write_text(test_text.replace(marker, block + marker))

changelog = Path("CHANGELOG.md")
change_text = changelog.read_text()
change_marker = "## [Unreleased]\n\n### Fixed\n\n"
if change_text.count(change_marker) != 1:
    raise SystemExit("unreleased changelog marker was not unique")
bullet = "- Preserved trailing whitespace in Git repository-root paths. `findRepository()` now removes only Git's record line terminator instead of applying JavaScript `String.trim()`, preventing a repository such as `repository ` from being silently redirected to a sibling path with the trimmed spelling.\n"
changelog.write_text(change_text.replace(change_marker, change_marker + bullet, 1))
