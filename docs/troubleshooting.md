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

## Immutable base/range/staged analysis is rejected for workspace drift

This is a fail-closed provenance check, not a verification failure. ProofDiff currently reads graph/config/test inputs from the checked-out filesystem, so v0.5.2 refuses to combine an immutable diff with another filesystem state. For `--base` and `--range`, make sure the selected target is the checked-out `HEAD` and the tracked worktree is clean relative to it. For `--staged`, make sure there are no unstaged tracked changes so the worktree matches the index. To inspect a historical `A..B` range, check out `B` or create a separate worktree at `B` first.

Git-visible untracked files are also outside an immutable selection. Commit, stage where appropriate, remove, ignore, or isolate them. Static-only analysis additionally rejects ignored metadata/Python tests that check discovery would consume. With `--run-checks`, ignored repository-local inputs are rejected more broadly because repository commands could read them; dependency/cache directories such as `node_modules` and virtual environments remain allowed environment inputs.

If you explicitly pass `--coverage-lcov`, only that exact LCOV artifact may receive the narrow data-artifact exemption from the generic untracked/ignored gate, and only when its path is not discovery-sensitive metadata or a Python test. Its declared commit must still match the selected target. Other files beside it remain ordinary workspace inputs and can still trigger the fail-closed check.

## Checks are listed as “NOT RUN”

This is the safe default. ProofDiff does not execute repository code until you opt in:

```bash
proofdiff --run-checks
```

Only do this for code you trust. The timeout, environment filtering, and output limits are not an operating-system sandbox.

## No checks were discovered

ProofDiff deliberately recognizes a narrow set of conventional root-level test, typecheck, and lint configurations. Confirm the relevant script exists in `package.json`, or that conventional Python tests are present. A custom or monorepo-specific command is currently outside automatic discovery; the report should remain `Unknown` or `Unverified`, not imply safety. A `--test-map` can declare which exact test file is related to a source file, but it cannot add support for a runner or command shape ProofDiff does not recognize.

## ProofDiff found no related test, but I know which test is relevant

First inspect the file's `Boundary` and `Next` lines. Missing static discovery can be caused by dynamic imports, workspace boundaries, unsupported aliases, generated wiring, or other intentionally bounded analysis. If you already know an exact source→test relationship, you can record that fact explicitly instead of asking ProofDiff to infer it:

```json
{
  "version": 1,
  "relationships": [
    {
      "source": "src/payment.ts",
      "tests": ["test/payment.test.ts"]
    }
  ]
}
```

```bash
proofdiff --test-map proofdiff.test-map.json
proofdiff --test-map proofdiff.test-map.json --run-checks
```

This is not a coverage override. The report records that the relationship was **user-declared**. ProofDiff still independently requires a supported runner qualification, explicit exact-target supply, and a trustworthy non-skipped runtime pass before the file can become **Related test file passed**. If the runner remains unsupported, the evidence boundary stops at `runner-qualification` and the declaration does not bypass it.

Test-map inputs are exact and fail closed. Test paths must be repository-relative, Git-visible, supported test-like source files. Traversal/absolute paths, stale test paths, duplicate source/test declarations, self-relations, unsupported fields, malformed JSON, or configured bounds cause the map to be rejected as a whole with exit code `2`; ProofDiff does not silently use the valid-looking subset.

## A passing test command is only “Partially verified”

A repository-wide command can pass without proving which test file ran. ProofDiff only reports **Related test file passed** (JSON status `verified`) when a related path established by supported static discovery or explicit declaration provenance is runner-qualified, explicitly supplied, and produces at least one non-skipped passing test observation with no relevant failure. A declaration establishes only that the user named the relationship.

Exact per-target pass observations are currently supported for:

- Node.js built-in test runner (`node --test`)
- Jest for bounded root scripts such as `jest`, `jest --ci`, and `jest --runInBand`, optionally preceded by up to four literal `NAME=value` assignments or by a locally installed `cross-env` plus those assignments
- Vitest for bounded root scripts `vitest`, `vitest run`, or `vitest --run`, with the same bounded literal environment-prefix and local `cross-env` support
- pytest
- Python `unittest`

For Jest and Vitest, recognized literal environment values are preserved in the exact-target child process; sensitive propagated environment names are called out in check provenance without exposing their values. ProofDiff explicitly supplies the qualified related targets and consumes a bounded JSON result artifact. Missing, malformed, oversized, or unmatched per-file results cannot strengthen evidence. Duplicate Jest target results remain fail-closed. For Vitest multi-project output, multiple valid records that resolve to the same already-qualified exact physical target are aggregated; any failing duplicate fails that target, and malformed or overflowed aggregation still fails closed. Shell substitution/chaining, duplicate or excessive environment assignments, `cross-env-shell`, `dotenv`, `concurrently`, arbitrary wrappers, unsupported CLI/config shapes, package-manager layouts without a local `node_modules/<runner>` package, Mocha, AVA, and other runners may still execute as deterministic repository checks, but remain partial or unverified when ProofDiff cannot establish exact target identity and a trustworthy non-skipped pass. See [verification-model.md](verification-model.md) for the runner semantics and limitations.

## A helper under `tests/` is related but not executed

This is intentional. Directory placement is useful for static “test-like” discovery but does not establish runnable target identity. Node's default runner discovers JavaScript under `test/` (singular), not every arbitrary helper under `tests/`; pytest and unittest use their filename configuration/conventions. Jest and Vitest support is also conservative: a path must first be related and test-like, then be explicitly supplied to a recognized bounded runner shape, and finally produce an exact per-file runtime observation. A test-map declaration can establish relationship provenance but still cannot make a helper runnable. The report keeps unsupported helpers visible without treating directory placement or declaration as execution evidence.

## A TypeScript alias or package self-reference is still missing

ProofDiff deliberately supports only bounded, high-evidence metadata shapes. Compiler mappings require an inventory-visible nearest ancestor `tsconfig.json`, repository-relative string inheritance, supported project-membership rules that include the importer, and an exact or single-wildcard `paths` key; `baseUrl` only anchors those targets. Without `baseUrl`, target values must begin with `./` or `../`. Explicit extensions use TypeScript's documented substitution families. Extensionless file/index lookup requires an explicit Bundler or Node10 mode; NodeNext-family import/require context, directory `package.json` precedence, non-default `moduleSuffixes`, and unknown extensions remain unresolved. Package self-imports require an explicit export-aware mode plus the nearest visible owning package's exact declared name and exact export key with an explicit supported target extension. Hidden metadata, excluded project files, JavaScript without `allowJs`, versioned export conditions, export patterns/arrays, unknown runtime-condition choices, package-based configuration inheritance, standalone `baseUrl`, workspace dependency linking, third-party packages, and `node_modules` remain unresolved. Malformed, cyclic, excessive, ambiguous, escaping, or symlinked metadata fails closed and may appear in report notes.

Even when an alias or self-export is found, it adds only a static graph edge. It cannot qualify a runner target, populate `executedTests`, or produce `verified` without the independent per-target runtime evidence described above. If the exact source→test relationship is known despite the unresolved edge, `--test-map` can record the declaration; the later runtime gates remain unchanged.

## A targeted check passed but the result is still partial or unverified

Inspect `targetObservations` in JSON or expand the check in the HTML report. A runner process can succeed after collecting zero tests, filtering every test, or skipping every test. Missing, malformed, truncated, or unmatched observer records are also rejected. Duplicate Jest observations are rejected; valid duplicate Vitest observations for the same already-qualified exact physical path are aggregated, but malformed duplicates still fail closed. None of the rejected or zero/skip-only outcomes produces `executedTests`. If another applicable opaque command passed the file is partial; otherwise it remains unverified.

Also inspect `evidenceBoundary.stage`, `reason`, and `nextAction`. The boundary is intentionally actionable without changing the evidence strength: `no-related-test` can suggest `--test-map` when an exact relationship is already known; `runner-unqualified` says the relationship exists but the runner gate is still missing; `checks-not-run` says the target is qualified but runtime execution was not requested; `observer-inconclusive` says execution happened without a trustworthy exact-target observation.

## A related test file passed, but the changed symbol may not have run

This is expected under the current file-level evidence model. ProofDiff observes a runner-qualified exact related target and at least one non-skipped passing test for that file. Relationship provenance may come from bounded static discovery or an explicit user declaration; neither proves that changed code executed. ProofDiff does not use the passing target to claim that a changed symbol, line, branch, relevant assertion, or behavior ran. Optional LCOV coverage-artifact evidence is reported separately and does not change the historical `verified` status. The terminal and HTML reports display this result as **Related test file passed**; the stable JSON value remains `verified`.

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

Reports are local files but may include paths, symbols, commands, user-declared relationship paths, and bounded check output. ProofDiff creates requested output files with user-only permissions where supported. Review a report before sharing it and delete it using your normal secure workflow if it should not persist.

## The GitHub job summary is missing

The composite Action enables it by default. Confirm `job-summary` was not set to `false` and that the Action step ran far enough to produce a report. Custom CLI workflows must pass `--github-summary "$GITHUB_STEP_SUMMARY"`. The summary is attached to the job/run surface, not posted as a pull-request comment, and needs no write permission.

If a reproducible problem remains, include the ProofDiff version, operating system, Node.js version, exact non-secret command, exit code, and a minimal repository fixture in the issue. Never attach credentials or private source code.
