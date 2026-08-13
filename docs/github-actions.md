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
      - uses: hzw0813/proofdiff@v0.2.0
        with:
          base: ${{ github.event.pull_request.base.sha }}
          fail-on: failed
          html: proofdiff-report.html
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: proofdiff-report
          path: proofdiff-report.html
```

The released Action writes a **ProofDiff · Change Evidence** job summary by default. The summary shows the overall state, a bounded per-file distinction between observed passing targets, other target outcomes, static-only relationships, and no supported relationship, plus bounded analysis notes and a trust-aware next step. This uses GitHub's native `GITHUB_STEP_SUMMARY` file: it does not call the GitHub API, request write permission, or create a pull-request comment. Set `job-summary: false` to disable it.

The summary is intentionally concise. Keep the upload step to retain the self-contained HTML report with full evidence, qualifications, observations, limitations, and bounded check output. The artifact step uses `if: always()` so a genuine verification failure does not hide its report.

Use the released `v0.2.0` tag for normal stable integration. For an immutable security-sensitive pin, replace the tag with the exact release commit SHA shown on the `v0.2.0` GitHub Release after publication.

The default is static-only and does not execute repository code. Set `run-checks: true` only in a job isolated from secrets and after accepting the repository-code execution risk described in [SECURITY.md](../SECURITY.md). Avoid `pull_request_target` for untrusted code. A **Related test file passed** result records a runner-qualified exact target with at least one non-skipped passing test observation; it does not show that changed symbols or lines ran and is not proof of correctness.

The action installs only ProofDiff's production parser dependency with lifecycle scripts disabled. It requires a checkout with full history for merge-base analysis.
