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

A repository-wide command can pass without proving which test file ran. ProofDiff only reports **Related test file passed** (JSON status `verified`) when the exact statically related path is runner-qualified, explicitly supplied, and produces at least one non-skipped passing test observation with no relevant failure.

Exact per-target pass observations are currently supported for:

- Node.js built-in test runner (`node --test`)
- Jest for bounded root scripts such as `jest`, `jest --ci`, and `jest --runInBand`, with a locally installed `node_modules/jest` runner
- Vitest for bounded root scripts `vitest`, `vitest run`, or `vitest --run`, with a locally installed `node_modules/vitest` runner
- pytest
- Python `unittest`

For Jest and Vitest, ProofDiff explicitly supplies the qualified related targets and consumes a bounded JSON result artifact. Missing, malformed, oversized, duplicate, or unmatched per-file results cannot strengthen evidence. Custom wrappers, unsupported CLI/config shapes, package-manager layouts without a local `node_modules/<runner>` package, Mocha, AVA, and other runners may still execute as deterministic repository checks, but remain partial or unverified when ProofDiff cannot establish exact target identity and a trustworthy non-skipped pass. See [verification-model.md](verification-model.md) for the runner semantics and limitations.

## A helper under `tests/` is related but not executed

This is intentional. Directory placement is useful for static “test-like” discovery but does not establish runnable target identity. Node's default runner discovers JavaScript under `test/` (singular), not every arbitrary helper under `tests/`; pytest and unittest use their filename configuration/conventions. Jest and Vitest support is also conservative: a path must first be statically related and test-like, then be explicitly supplied to a recognized bounded runner shape, and finally produce an exact per-file runtime observation. The report keeps unsupported helpers visible without treating directory placement as execution evidence.

## A TypeScript alias or package self-reference is still missing

ProofDiff deliberately supports only bounded, high-evidence metadata shapes. Compiler mappings require an inventory-visible nearest ancestor `tsconfig.json`, repository-relative string inheritance, supported project-membership rules that include the importer, and an exact or single-wildcard `paths` key; `baseUrl` only anchors those targets. Without `baseUrl`, target values must begin with `./` or `../`. Explicit extensions use TypeScript's documented substitution families. Extensionless file/index lookup requires an explicit Bundler or Node10 mode; NodeNext-family import/require context, directory `package.json` precedence, non-default `moduleSuffixes`, and unknown extensions remain unresolved. Package self-imports require an explicit export-aware mode plus the nearest visible owning package's exact declared name and exact export key with an explicit supported target extension. Hidden metadata, excluded project files, JavaScript without `allowJs`, versioned export conditions, export patterns/arrays, unknown runtime-condition choices, package-based configuration inheritance, standalone `baseUrl`, workspace dependency linking, third-party packages, and `node_modules` remain unresolved. Malformed, cyclic, excessive, ambiguous, escaping, or symlinked metadata fails closed and may appear in report notes.

Even when an alias or self-export is found, it adds only a static graph edge. It cannot qualify a runner target, populate `executedTests`, or produce `verified` without the independent per-target runtime evidence described above.

## A targeted check passed but the result is still partial or unverified

Inspect `targetObservations` in JSON or expand the check in the HTML report. A runner process can succeed after collecting zero tests, filtering every test, or skipping every test. Missing, malformed, truncated, duplicate, or unmatched observer records are also rejected. None of those outcomes produces `executedTests`. If another applicable opaque command passed the file is partial; otherwise it remains unverified.

## A related test file passed, but the changed symbol may not have run

This is expected under the current file-level evidence model. ProofDiff observes a runner-qualified exact target and at least one non-skipped passing test for that file. It does not use that fact to claim that a changed symbol, line, branch, relevant assertion, or behavior ran. Optional LCOV coverage-artifact evidence is reported separately and does not change the historical `verified` status. The terminal and HTML reports display this result as **Related test file passed**; the stable JSON value remains `verified`.

## Unexpected `node_modules` or generated files appear

Working-tree analysis follows Git: it includes untracked, non-ignored files. ProofDiff does not silently hide `node_modules`, build output, vendored code, or other Git-visible changes. Confirm the selection with `git status --short --untracked-files=all`, then add an appropriate `.gitignore`, stage only the intended change and use `--staged`, or select a committed comparison with `--base`/`--range`. Reports add a warning when common generated directories contain Git-visible untracked files.

## Python analysis is degraded

Install Python 3 and ensure `python3` or `python` is available on `PATH`. Without it, ProofDiff keeps file-level and lexical analysis useful but labels the lower confidence. ProofDiff invokes Python in isolated mode and never imports repository modules during static analysis.

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

## The GitHub job summary is missing

The composite Action enables it by default. Confirm `job-summary` was not set to `false` and that the Action step ran far enough to produce a report. Custom CLI workflows must pass `--github-summary "$GITHUB_STEP_SUMMARY"`. The summary is attached to the job/run surface, not posted as a pull-request comment, and needs no write permission.

If a reproducible problem remains, include the ProofDiff version, operating system, Node.js version, exact non-secret command, exit code, and a minimal repository fixture in the issue. Never attach credentials or private source code.
