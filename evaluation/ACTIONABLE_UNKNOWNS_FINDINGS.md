# Actionable Unknowns Findings

Status: implementation and adversarial review complete; merge remains gated on the final PR CI run after temporary validation-harness cleanup.

## Baseline

This cycle started from `main` at `48f4a3bfc8d51f3caf33594c0358eac9ec6e23c9`, the commit released as ProofDiff v0.2.0.

## Before

A first-time user could see statuses, evidence entries, related paths, target outcomes, and limitations, but often had to infer the answer to three questions:

1. What is the strongest evidence actually observed?
2. Exactly where did stronger evidence stop?
3. What is the safest next action?

Examples included static-only qualified targets, opaque passing test commands, zero-test or skipped targets, unsupported file semantics, and failures without complete target attribution.

## After

Each analyzed file now carries an additive deterministic `evidenceBoundary` with:

- `strongestEvidence`;
- `stage`;
- `reason`;
- `detail`;
- `proofdiffFailClosed`;
- bounded `nextAction` metadata.

The terminal and GitHub summary surface the boundary directly. The detailed HTML report receives the same boundary through the shared evidence list. JSON exposes the structured categories for agents and downstream tooling.

A static-only related and runner-qualified target now reports `target-invocation / checks-not-run` and explicitly says that `--run-checks` executes repository-defined commands with operating-system permissions and is not sandboxed. A passing exact related target reports `changed-code-execution / changed-code-execution-unobserved` rather than implying that the changed code ran. Zero-test, skipped-only, unavailable observer, unsupported semantics, opaque passing commands, exact target failures, and incomplete failure attribution retain distinct non-strengthening categories.

## Taxonomy

Stages:

- `static-relationship`
- `runner-qualification`
- `target-invocation`
- `runtime-observation`
- `failure-attribution`
- `changed-code-execution`

Reason categories:

- `no-related-test`
- `unsupported-semantics`
- `runner-unqualified`
- `checks-not-run`
- `target-not-invoked`
- `no-applicable-check`
- `opaque-passing-check`
- `zero-tests`
- `all-skipped`
- `observer-inconclusive`
- `failure-unattributed`
- `target-failed`
- `check-failed`
- `changed-code-execution-unobserved`

These categories describe evidence boundaries, not safety probabilities.

## Compatibility

The historical JSON status `verified` remains unchanged and continues to mean “Related test file passed” in human-facing output. `schemaVersion` remains `1.0`; `evidenceBoundary` is additive and optional in the TypeScript interface so older stored reports remain renderable.

No runner breadth, resolver breadth, coverage ingestion, network dependency, LLM dependency, telemetry, account requirement, or hidden repository execution was added.

## Adversarial review

An independent pass found one real overclaim bug in the first implementation: a `not-observed` result from a targeted process that had actually passed could be combined with a separate opaque failing check and incorrectly classify the boundary as `failure-unattributed`, which would imply that the targeted process itself failed.

The classifier was tightened so `failure-unattributed` requires an actual failed targeted process with incomplete attribution. A regression test now covers the mixed case and requires the generic `check-failed` boundary instead. This preserves the rule that ProofDiff never invents a cause from missing observer evidence.

The review also rechecked the core invariants:

- process exit 0 ≠ meaningful test;
- static relationship ≠ runtime execution;
- related test file pass ≠ changed-code execution;
- changed-code execution ≠ correctness.

No remaining evidence-strengthening blocker was found in the reviewed source diff.

## Validation

Dedicated hosted validation on Node 24 completed the following successfully:

- TypeScript typecheck;
- production `dist` regeneration with `git diff --exit-code -- dist` and a clean worktree before evaluation;
- pinned external static-only corpus: all 9 clear expected relationships found, with the existing 1 deliberately ambiguous case remaining ambiguous;
- full test suite: 96/96 passed, 0 failed, 0 skipped;
- coverage: 89.92% lines, 82.34% branches, 93.25% functions overall; `src/explanation.ts` reached 85.00% lines, 94.81% branches, 96.00% functions;
- GitHub Action smoke: production-only install, static default, trusted checks, base diff, HTML output, and bounded job summaries passed;
- dogfood: related test-file pass observed and all 4 executed checks passed;
- controlled evaluation: 17/17 cases completed successfully;
- demo generation: 4 truthful scenarios generated with their expected statuses;
- `npm pack --dry-run`: passed and produced the expected `proofdiff@0.2.0` package surface.

The committed historical evaluation baseline remains intentionally unchanged, so its validator still describes the older 5-clear-found / 4-clear-missed / 1-ambiguous baseline. The fresh pinned external run above is the candidate measurement for this branch.

Generated demo files contain real command durations and test-run timing, and the controlled candidate embeds the candidate commit, so those files are not byte-stable across independent executions. The meaningful generated-runtime consistency gate is `dist`, which regenerated cleanly. Demo generation itself passed.

Final merge remains conditional on the ordinary PR CI matrix being green after the temporary branch-only validation workflow is removed.

## Release hygiene

The main CI published-Action smoke target is updated from released v0.1.0 to released v0.2.0. This PR does not create a new tag or publish a new release.
