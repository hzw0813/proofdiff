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
      - uses: hzw0813/proofdiff@main
        with:
          base: ${{ github.event.pull_request.base.sha }}
          fail-on: failed
          html: proofdiff-report.html
      - uses: actions/upload-artifact@v7
        with:
          name: proofdiff-report
          path: proofdiff-report.html
```

Until a version tag exists, `main` is the runnable repository reference. For a stable or security-sensitive integration, replace it with a reviewed full commit SHA. This default is static-only and safe for unreviewed fork code. Set `run-checks: true` only in a job isolated from secrets and after accepting the repository-code execution risk described in [SECURITY.md](../SECURITY.md). Avoid `pull_request_target` for untrusted code.

The action installs only ProofDiff's production parser dependency with lifecycle scripts disabled. It requires a checkout with full history for merge-base analysis.
