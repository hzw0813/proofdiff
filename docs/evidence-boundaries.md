# Evidence boundaries

ProofDiff reports the strongest verification evidence it actually observed for each changed file, then records where stronger evidence stopped.

This is intentionally separate from the file status. A status answers whether ProofDiff observed a qualifying result; an evidence boundary answers **what was observed, why the evidence is not stronger, and what action is safe to take next**.

## Machine-readable fields

Each analyzed file may include an additive `evidenceBoundary` object in JSON output:

- `strongestEvidence`: the strongest evidence level ProofDiff observed for the file.
- `stage`: the evidence pipeline stage where stronger evidence stopped.
- `reason`: a stable deterministic reason category.
- `detail`: a bounded human explanation derived from observed state.
- `proofdiffFailClosed`: whether ProofDiff intentionally refused to strengthen ambiguous or unsupported evidence.
- `nextAction`: a bounded next-action category and explanation, or `null` when ProofDiff has no trustworthy stronger action to recommend.

The existing report `schemaVersion` remains `1.0`; this field is additive and optional so older stored reports can still be rendered.

## Evidence stages

ProofDiff uses these stages:

1. `static-relationship`
2. `runner-qualification`
3. `target-invocation`
4. `runtime-observation`
5. `failure-attribution`
6. `changed-code-execution`

A later stage never retroactively strengthens an earlier claim. In particular:

- process exit 0 is not evidence that a meaningful test ran;
- a static relationship is not runtime execution;
- a related test file pass is not evidence that changed code ran;
- changed-code execution would still not prove behavior correct.

## Stop reasons

Current reason categories include:

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

These are evidence categories, not safety probabilities.

## Trust boundary for next actions

A `review-run-checks` next action means runtime evidence is available only after explicit consent to run repository-defined checks. `--run-checks` executes those commands with operating-system permissions and is **not sandboxed**. Static-only mode never executes repository code.

ProofDiff does not invent a cause when the available state cannot support one. Ambiguous observer output, incomplete failure attribution, unsupported semantics, and missing target identity remain explicit limitations instead of being upgraded into positive evidence.
