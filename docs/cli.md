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

## Declared test relationships

`--test-map <file>` reads a bounded JSON source-to-test relationship map as data. It is intended for an expert who knows an exact relationship that ProofDiff's bounded static graph cannot infer.

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

Example:

```bash
proofdiff --test-map proofdiff.test-map.json
proofdiff --test-map proofdiff.test-map.json --run-checks
```

The declaration itself is not execution evidence. ProofDiff records the source→test relationship as user-provided provenance, then independently applies the normal runner-qualification, exact-target-supply, and runtime-observation gates. `--test-map` therefore cannot turn an unsupported runner command into exact-target evidence and cannot by itself produce JSON status `verified`.

The parser is fail-closed and exact-path only: version `1`, up to 256 KB, 1,000 source relationships, 100 tests per source, and 5,000 total test paths. Test paths must be repository-relative, Git-visible supported test-like source files. Traversal/absolute paths, duplicate sources or tests, self-relations, stale test paths, unsupported fields, malformed JSON, and oversized inputs cause exit code `2`; no subset of the map is silently applied.

When static discovery finds no relationship, `evidenceBoundary.nextAction` can recommend `--test-map` if the exact relationship is already known. A declared relationship that remains runner-unqualified stops at the runner-qualification boundary rather than being upgraded.

## Existing coverage artifacts

`--coverage-lcov <file>` and `--coverage-commit <ref>` are an explicit pair. ProofDiff parses the LCOV artifact as bounded data and only reports artifact coverage evidence when the user-declared commit resolves exactly to the selected committed diff target (`HEAD` for `--base`, or the right-hand commit for `--range`).

Working-tree and staged selections reject coverage reporting because their content is not identified by a commit. Commit mismatches also fail closed. This verifies the declaration against the diff target; it does not independently attest that the artifact was actually produced by that commit. Relative `SF:` paths are resolved only from the repository root; paths outside the repository and ambiguous cross-platform absolute paths are ignored rather than guessed.

Coverage can report that the supplied artifact contains hits for changed current lines; ProofDiff does not independently attest that the artifact was produced by the declared commit. It does not establish which test was relevant, whether branches or assertions were exercised, or whether behavior is correct. It does not change the historical JSON `verified` meaning.

Example: `proofdiff --base origin/main --coverage-lcov coverage/lcov.info --coverage-commit HEAD`

## Reports

`--format terminal` is the default. `--json` emits `AnalysisReport` schema 1.0. `--output` redirects the primary report. `--html` writes an additional self-contained report with no external assets. `--github-summary <file>` writes bounded GitHub-flavored Markdown intended for `GITHUB_STEP_SUMMARY`; it is a concise projection of the same report, not a stronger evidence source.

Output files are created with user-only permissions where the operating system supports them because reports may contain sensitive repository metadata, user-declared relationship paths, and command output.

The GitHub summary includes changed paths and related/observed target paths, but deliberately omits source text, symbols, commands, check output, observer payloads, and absolute repository paths. Terminal, JSON, and HTML remain the inspectable provenance surfaces.

## Exit codes

- `0`: analysis completed and the selected failure policy passed.
- `1`: analysis completed but `--fail-on` policy failed.
- `2`: invalid usage, rejected test-map/coverage input, repository/revision error, or analysis failure; no conclusion was produced.

Policies:

- `failed` (default): fail only on verification failure/error/timeout.
- `unverified`: also fail when a file is unverified.
- `partial`: require every changed file to reach JSON status `verified`, displayed as **Related test file passed**. This requires supported relationship provenance plus a runner-qualified, explicitly supplied related target with at least one non-skipped passing test observation; it does not require or imply changed-code runtime coverage.
- `high-risk`: fail when any file is high or critical risk.
- `never`: report only.
