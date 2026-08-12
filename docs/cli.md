# CLI reference

Run `proofdiff --help` for the canonical option list.

## Diff selection

- Default: tracked modifications (staged and unstaged) plus untracked, non-ignored files compared with `HEAD`.
- `--staged`: index compared with `HEAD` (or the empty tree before the first commit).
- `--base <ref>`: merge-base comparison `<ref>...HEAD`, appropriate for pull-request review.
- `--range <from>..<to>` or `<from>...<to>`: exact Git commit range.

Only one selector may be used. Revisions are validated as commits before analysis.

## Execution and selection

`--run-checks` opts into all discovered checks. `--check test`, `--check typecheck`, `--check lint`, or a check ID limits execution and can be repeated. `--timeout` controls the per-check limit.

## Reports

`--format terminal` is the default. `--json` emits `AnalysisReport` schema 1.0. `--output` redirects the primary report. `--html` writes an additional self-contained report with no external assets.

Output files are created with user-only permissions where the operating system supports them because reports may contain sensitive repository metadata and command output.

## Exit codes

- `0`: analysis completed and the selected failure policy passed.
- `1`: analysis completed but `--fail-on` policy failed.
- `2`: invalid usage, repository/revision error, or analysis failure; no conclusion was produced.

Policies:

- `failed` (default): fail only on verification failure/error/timeout.
- `unverified`: also fail when a file is unverified.
- `partial`: require every changed file to reach JSON status `verified`, displayed as **Related test file passed**. This requires a runner-qualified, explicitly supplied related target with at least one non-skipped passing test observation; it does not require or imply changed-code runtime coverage.
- `high-risk`: fail when any file is high or critical risk.
- `never`: report only.
