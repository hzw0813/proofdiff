# Test-target evidence boundary: before and after

## Evaluation identity

- Recovered repository starting point: clean `main` at `8871fdcecceda59e0cf16a525dcccf8af65b4393`.
- Preserved external observation baseline: `proofdiff@0.1.0` at `a9b721ca7500da4b316c737dbb159ded6e6d3577`.
- Clean implementation candidate evaluated here: `37cccdfdfa89d7fb12c969a5ba364e16782b5eb4`.
- Decision record: [`TARGET_QUALIFICATION_DECISION.md`](TARGET_QUALIFICATION_DECISION.md).

The preserved baseline artifacts and both schemas are unchanged. Their SHA-256 values after candidate generation are:

| Artifact | SHA-256 |
| --- | --- |
| `results.json` | `efdf8e33beb8b73ae358e9911c0e0526e604c9efb152e3b6cee7decf1f5f9b02` |
| `controlled-results.json` | `9a77067b88b0793acf7537406c04bdf394e09f6d1d5b1d8d8d2fed6dfad35f1d` |
| `results.schema.json` | `397c9c49d1a6fd142b6865cc44a113c2c4626204f0055bf83a0dcdf1f3a1d04c` |
| `controlled-results.schema.json` | `12d9d2b480d089c733741713e87bf8bbe6521626e0f1fe86e097ef76a97c69cc` |

Candidate observations are separately stored in `results.candidate.json` and `controlled-results.candidate.json`.

## Recovered failure and invariant

The baseline treated `tests/fixtures/helper.js` as a test because of its directory, passed it to `node --test`, and promoted an exit-zero process that declared no tests to `verified`. Static test-like relationship, runnable identity, explicit supply, process success, and target execution were collapsed.

The candidate invariant is:

> `verified` requires a static relationship, runner qualification, explicit target supply, at least one non-skipped test observed for that exact target, a successful target outcome, and no relevant failure.

Broad paths remain useful for review discovery but cannot authorize execution. In a batch, observations are joined to exact normalized runner paths; another target's pass or failure cannot be borrowed.

## Controlled before and after

The preserved six-case control recorded the false-strength helper as `verified`, with `tests/fixtures/helper.js` in `executedTests` and a passing targeted command. The candidate keeps that helper in `relatedTests`, constructs no targeted command for it, leaves `executedTests` empty, and reports `partially-verified` only because the separate repository-wide command passed.

All 14 candidate controls passed. They cover conventional success, unresolved aliases, the directory helper boundary, root `test.js`, an exact custom Node path, an opaque repository-wide pass, a genuine failure, Node zero-test, Node filtered-to-zero, Node all-skipped, positive and zero-test unittest outcomes, mixed-batch attribution, and an unsupported file. Additional product tests cover pytest 9 configuration and observer records, ambiguous compiled mappings, type-only inputs, Windows separators, unsupported Node options, unittest subtests, and malformed/truncated/unmatched control records.

Runner-specific results:

- Node file summaries distinguish positive, failed, skipped, and zero-test targets. Root/default and exact configured paths qualify; the directory-only helper does not.
- pytest `python_files` defaults and supported configuration tables qualify paths without executing configuration. A fixed plugin emits per-file call observations; exit 5 remains no-collection evidence rather than a test failure.
- unittest `test*.py` identity and `TestResult` observations distinguish positive, skipped, zero-test, failure, error, unexpected-success, and subtest-failure outcomes.

## External corpus before and after

All ten immutable external cases were rerun static-only. No external dependency was installed and no external repository code or check ran.

| Classification | Preserved baseline | Candidate |
| --- | ---: | ---: |
| Clearly expected found | 5 | 7 |
| Clearly expected missed | 4 | 2 |
| Ambiguous | 1 | 1 |

Material changes:

- `p-map-root-test-file`: missed → found through the documented root `test.js` shape. Its AVA command remains deliberately non-targetable.
- `typescript-custom-unittest-layout`: missed → found through the `unittests/` shape using the separately bounded relationship traversal rather than the 250-file displayed-impact cap. Its Hereby command remains deliberately non-targetable.
- `pytest-current-tool-table`: relationship remains found; pytest configuration now constructs an inspectable static targeted definition.

The two remaining clear misses are package self-exports (`zod-package-self-export`) and TypeScript path aliases (`vitest-ts-path-alias`). The TypeScript cap-tail case remains explicitly ambiguous. Every external assessment remains `unknown`, every check remains `not-run`, and `repositoryCodeExecuted` remains `false`; these are not runtime claims.

## Compatibility and security effects

- JSON `schemaVersion: "1.0"`, machine status values, CLI flags, and fail policies are unchanged.
- `targetQualifications`, `targetObservations`, and `targetRunnerArgs` are optional additive fields; `targetFiles` and `relatedTests` remain available.
- Existing `verified` results may become partial or unverified when no positive exact-target observation exists.
- stdout/stderr retain their existing cap and redaction. Structured observations use a separate 64 KB pipe and fixed inline observer code, with no temporary repository files or shell execution.
- Missing, malformed, duplicate, truncated, or unmatched observations fail closed. pytest configuration parsing is bounded and data-only.
- `--run-checks` remains arbitrary repository-code execution with user permissions, not a sandbox.

## Skeptical-review findings

The adversarial pass confirmed helpers, fixtures, root/custom paths, generated/compiled targets, type-only files, zero/filtered/skipped tests, supported and unsupported runner options, mixed batches, Windows normalization, control truncation, and unittest subtests. It also found and fixed two secondary ambiguity risks: multiple source files can no longer share one compiled runner target, and the 250-file impact display cap no longer hides test-like relationships within the separately bounded analyzed inventory.

## Next single engineering priority

Add bounded, configuration-aware static module resolution for package self-exports and TypeScript `paths`. It directly addresses both remaining clear external misses without weakening the new runtime-evidence boundary. Runner expansion (AVA, Vitest, Jest, Mocha, and Hereby) should remain deferred until each runner can provide equally trustworthy per-target observations.
