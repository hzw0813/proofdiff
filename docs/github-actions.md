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
      - uses: hzw0813/proofdiff@v0.5.2
        with:
          fail-on: failed
          html: proofdiff-report.html
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: proofdiff-report
          path: proofdiff-report.html
```

On `pull_request`, the released `v0.5.2` Action can omit `base`: ProofDiff auto-resolves the exact `pull_request.base.sha` from GitHub's event payload. An explicit `base` always wins. If PR metadata is missing or malformed, the Action fails with an actionable error instead of silently falling back to an empty clean-working-tree diff. Other non-PR events preserve the historical working-tree fallback when `base` is omitted.

Omitted `base` on `pull_request_target` fails closed instead of auto-resolving. GitHub's default checkout for `pull_request_target` normally points at the base repository revision, so combining that checkout with the PR base could misleadingly produce a zero diff. Prefer `pull_request` for untrusted changes. If you intentionally use `pull_request_target`, explicitly check out the trusted revision you intend to analyze and set `base` yourself.

## Declared source-to-test relationships

The released `v0.5.2` Action exposes a `test-map` input corresponding to CLI `--test-map`.

```yaml
      - uses: hzw0813/proofdiff@v0.5.2
        with:
          test-map: proofdiff.test-map.json
          run-checks: true
          fail-on: failed
          html: proofdiff-report.html
```

A test map is parsed as bounded data. It names exact source→test relationships that ProofDiff could not infer, but it does not authorize arbitrary execution or bypass runner qualification. `run-checks: true` remains the separate consent to execute repository-defined commands. A declared path must still be runner-qualified, explicitly supplied, and observed with a non-skipped pass before it can contribute **Related test file passed** evidence.

Because the map is verification metadata, review it separately from changes that depend on it. With immutable `base`/`range` selections, a repository-local map must match the selected target commit; with `staged`, it must match the index. A repository-local map modified by the same immutable selection is rejected instead of being allowed to strengthen that selection. Mutable working-tree analysis still permits local iteration with a changed map and reports that weaker provenance. An explicitly supplied map outside the repository remains an external trust input.

ProofDiff validates bounded map structure, exact test-path visibility, and snapshot binding where applicable, but it does not independently determine whether the human-declared relationship is semantically correct. Invalid maps fail the Action rather than being partially applied.

## Immutable diff workspace binding

The released `v0.5.2` Action deliberately fails closed when an immutable Git selection would otherwise be analyzed against a different checked-out filesystem state. For `base`/`range`, the selected target commit must be the checked-out `HEAD` and tracked worktree content must match it. For `staged`, tracked worktree content must match the index. Historical `A..B` analysis where `B` is not checked out should run from a checkout or separate worktree at `B`.

Git-visible untracked files outside the immutable selection are rejected. Static-only analysis also rejects ignored root metadata and Python test-like files that current check discovery would read. When `run-checks: true`, ignored repository-local runtime inputs are rejected more broadly because repository-defined commands can consume them; bounded dependency/cache directories such as `node_modules` and virtual environments remain execution environment rather than declaration provenance.

An explicitly supplied LCOV file is a narrow exception to the generic untracked/ignored gate only for that exact data-artifact path, provided the path cannot double as discovery-sensitive metadata or a Python test. It still must satisfy ProofDiff's independent declared-commit and bounded LCOV validation. Sibling files receive no exemption. These restrictions are conservative preconditions around the current filesystem-backed analyzer, not a claim that ProofDiff has a virtualized historical filesystem.

The released Action writes a **ProofDiff · Change Evidence** job summary by default. The summary shows the overall state, a bounded per-file distinction between observed passing targets, other target outcomes, relationship evidence, and no supported relationship, plus the per-file evidence boundary and trust-aware next step. This uses GitHub's native `GITHUB_STEP_SUMMARY` file: it does not call the GitHub API, request write permission, or create a pull-request comment. Set `job-summary: false` to disable it.

The summary is intentionally concise. Keep the upload step to retain the self-contained HTML report with full evidence, qualifications, observations, limitations, evidence-boundary detail, and bounded check output. The artifact step uses `if: always()` so a genuine verification failure does not hide its report.

Use the released `v0.5.2` tag for normal stable integration. For an immutable security-sensitive pin, replace the tag with release snapshot `d2927b13aedb64403bdf1d6b3fe70f1148d1dce6`.

The default is static-only and does not execute repository code. Set `run-checks: true` only in a job isolated from secrets and after accepting the repository-code execution risk described in [SECURITY.md](../SECURITY.md). Avoid `pull_request_target` for untrusted code. A **Related test file passed** result records a runner-qualified exact related target with at least one non-skipped passing test observation; relationship provenance can be inferred or explicitly declared, but neither shows that changed symbols or lines ran and neither is proof of correctness.

The action installs only ProofDiff's production parser dependency with lifecycle scripts disabled. It requires a checkout with full history for merge-base analysis.
