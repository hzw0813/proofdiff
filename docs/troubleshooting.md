# Troubleshooting

Start with `proofdiff --help`. ProofDiff uses exit code `1` for a completed analysis that failed the selected policy and exit code `2` when it could not produce a conclusion.

## “Not a Git repository”

Run ProofDiff inside a Git worktree or pass its path explicitly:

```bash
proofdiff --repo /absolute/path/to/repository
```

The repository must be readable by the current user. Avoid analyzing a `.git` directory obtained from an untrusted archive; see the trust boundary in [SECURITY.md](../SECURITY.md).

## The report says there are no changed files

The default selection compares the working tree—including untracked, non-ignored files—with `HEAD`. Confirm the intended change exists with `git status`, or choose exactly one explicit selection:

```bash
proofdiff --staged
proofdiff --base origin/main
proofdiff --range v1.0.0..HEAD
```

For `--base`, fetch enough history for Git to find a merge base. For `--range`, both endpoints must resolve to commits.

## Checks are listed as “NOT RUN”

This is the safe default. ProofDiff does not execute repository code until you opt in:

```bash
proofdiff --run-checks
```

Only do this for code you trust. The timeout, environment filtering, and output limits are not an operating-system sandbox.

## No checks were discovered

ProofDiff deliberately recognizes a narrow set of conventional root-level test, typecheck, and lint configurations. Confirm the relevant script exists in `package.json`, or that conventional Python tests are present. A custom or monorepo-specific command is currently outside automatic discovery; the report should remain `Unknown` or `Unverified`, not imply safety.

## A passing test command is only “Partially verified”

A repository-wide command can pass without proving which test file ran. ProofDiff only reports `Verified` when it can explicitly pass a statically related test file to a recognized runner and observe success. See [verification-model.md](verification-model.md) for supported runner shapes and limitations.

## Python analysis is degraded

Install Python 3 and ensure `python3` or `python` is available on `PATH`. Without it, ProofDiff keeps file-level and lexical analysis useful but labels the lower confidence. ProofDiff invokes Python in isolated mode and never imports repository modules.

## A check timed out or produced truncated output

Increase the per-check limit when the repository is trusted:

```bash
proofdiff --run-checks --timeout 300
```

Captured output is intentionally bounded. Run the reported command directly in a suitable isolated environment when complete diagnostics are required.

## CI cannot resolve the base revision

Ensure checkout history is available. With GitHub Actions, use `actions/checkout` with `fetch-depth: 0`; the complete example is in [github-actions.md](github-actions.md).

## The HTML report contains sensitive names or output

Reports are local files but may include paths, symbols, commands, and bounded check output. ProofDiff creates requested output files with user-only permissions where supported. Review a report before sharing it and delete it using your normal secure workflow if it should not persist.

If a reproducible problem remains, include the ProofDiff version, operating system, Node.js version, exact non-secret command, exit code, and a minimal repository fixture in the issue. Never attach credentials or private source code.
