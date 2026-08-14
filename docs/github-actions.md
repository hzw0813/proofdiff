# GitHub Actions

The repository includes a composite action. Pin released use to a full commit SHA in security-sensitive workflows.

```yaml
name: ProofDiff
on: pull_request

permissions:
  contents: read

jobs:
  evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: hzw0813/proofdiff@v0.4.2
        with:
          fail-on: failed
          html: proofdiff-report.html
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: proofdiff-report
          path: proofdiff-report.html
```

On `pull_request`, the released `v0.4.2` Action can omit `base`: ProofDiff auto-resolves the exact `pull_request.base.sha` from GitHub's event payload. An explicit `base` always wins. If PR metadata is missing or malformed, the Action fails with an actionable error instead of silently falling back to an empty clean-working-tree diff. Other non-PR events preserve the historical working-tree fallback when `base` is omitted.

Omitted `base` on `pull_request_target` fails closed instead of auto-resolving. GitHub's default checkout for `pull_request_target` normally points at the base repository revision, so combining that checkout with the PR base could misleadingly produce a zero diff. Prefer `pull_request` for untrusted changes. If you intentionally use `pull_request_target`, explicitly check out the trusted revision you intend to analyze and set `base` yourself.

## Declared source-to-test relationships

The current source-tree Action exposes a `test-map` input corresponding to CLI `--test-map`. Use it with a release that includes this input; older released tags such as `v0.4.2` do not acquire new Action inputs retroactively.

```yaml
      - uses: hzw0813/proofdiff@<release-with-test-map>
        with:
          test-map: proofdiff.test-map.json
          run-checks: true
          fail-on: failed
          html: proofdiff-report.html
```

A test map is parsed as bounded data. It names exact source→test relationships that ProofDiff could not infer, but it does not authorize arbitrary execution or bypass runner qualification. `run-checks: true` remains the separate consent to execute repository-defined commands. A declared path must still be runner-qualified, explicitly supplied, and observed with a non-skipped pass before it can contribute **Related test file passed** evidence.

Because the map is repository input, review changes to it like other verification metadata. ProofDiff validates its bounded structure and test-path visibility but does not independently determine whether the human-declared relationship is semantically correct. Invalid maps fail the Action rather than being partially applied.

The released Action writes a **ProofDiff · Change Evidence** job summary by default. The summary shows the overall state, a bounded per-file distinction between observed passing targets, other target outcomes, relationship evidence, and no supported relationship, plus the per-file evidence boundary and trust-aware next step. This uses GitHub's native `GITHUB_STEP_SUMMARY` file: it does not call the GitHub API, request write permission, or create a pull-request comment. Set `job-summary: false` to disable it.

The summary is intentionally concise. Keep the upload step to retain the self-contained HTML report with full evidence, qualifications, observations, limitations, evidence-boundary detail, and bounded check output. The artifact step uses `if: always()` so a genuine verification failure does not hide its report.

Use the released `v0.4.2` tag for normal stable integration until a newer release is published. For an immutable security-sensitive pin, replace the tag with the exact release commit SHA shown on the chosen GitHub Release after publication.

The default is static-only and does not execute repository code. Set `run-checks: true` only in a job isolated from secrets and after accepting the repository-code execution risk described in [SECURITY.md](../SECURITY.md). Avoid `pull_request_target` for untrusted code. A **Related test file passed** result records a runner-qualified exact related target with at least one non-skipped passing test observation; relationship provenance can be inferred or explicitly declared, but neither shows that changed symbols or lines ran and neither is proof of correctness.

The action installs only ProofDiff's production parser dependency with lifecycle scripts disabled. It requires a checkout with full history for merge-base analysis.
