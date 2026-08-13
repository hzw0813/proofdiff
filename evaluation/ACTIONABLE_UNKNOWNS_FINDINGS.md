# Actionable Unknowns Findings

Status: implementation candidate; final validation is recorded after hosted CI and adversarial review.

## Before

A first-time user could see statuses, evidence entries, related paths, target outcomes, and limitations, but often had to infer the answer to three questions:

1. What is the strongest evidence actually observed?
2. Exactly where did stronger evidence stop?
3. What is the safest next action?

Examples included static-only qualified targets, opaque passing test commands, zero-test or skipped targets, unsupported file semantics, and failures without complete target attribution.

## Candidate after

Each analyzed file now carries an additive deterministic `evidenceBoundary` with:

- `strongestEvidence`;
- `stage`;
- `reason`;
- `detail`;
- `proofdiffFailClosed`;
- bounded `nextAction` metadata.

The terminal and GitHub summary surface the boundary directly. The detailed HTML report receives the same boundary through the shared evidence list. JSON exposes the structured categories for agents and downstream tooling.

## Initial taxonomy

Stages:

- `static-relationship`
- `runner-qualification`
- `target-invocation`
- `runtime-observation`
- `failure-attribution`
- `changed-code-execution`

Reason categories cover no related test, unsupported semantics, unqualified runners, checks not run, qualified target not invoked, no applicable check, opaque passing checks, zero tests, all skipped, inconclusive observers, unattributed failures, exact target failures, generic applicable check failures, and the unobserved changed-code boundary after a related test file pass.

## Compatibility

The historical JSON status `verified` remains unchanged and continues to mean “Related test file passed” in human-facing output. `schemaVersion` remains `1.0`; `evidenceBoundary` is additive and optional in the TypeScript interface so older stored reports remain renderable.

## Release hygiene

The main CI published-Action smoke target is updated from released v0.1.0 to released v0.2.0.

## Validation pending

Hosted CI, full matrix, Action smoke, dogfood, packaging, generated-file consistency, evaluation, and final adversarial review are pending at this point in the branch history and will be updated before merge.
