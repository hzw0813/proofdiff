# ProofDiff

[![CI](https://github.com/hzw0813/proofdiff/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hzw0813/proofdiff/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/proofdiff?logo=npm)](https://www.npmjs.com/package/proofdiff)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> ## Deterministic evidence for every code change.
>
> See what changed, what verification actually ran, and what remains unverified.

**No LLM / No upload / No account / No telemetry**

[![A 15-second walkthrough generated from a real Git diff and real ProofDiff output](assets/proofdiff-launch-demo.gif)](https://hzw0813.github.io/proofdiff/)

The walkthrough uses an actual fixture diff, actual ProofDiff execution, and the real interactive report—no hand-authored results. [Explore the live evidence gallery →](https://hzw0813.github.io/proofdiff/)

## Try it in seconds

Requires Git, Node.js 22+, and npm. From any Git repository with a change:

```bash
npx proofdiff --html proofdiff-report.html
```

That default is static-only: it inspects Git and parses supported source files, but does **not** execute repository code. Open `proofdiff-report.html` for the self-contained interactive report.

To install the CLI once, run `npm install --global proofdiff`.

> [!WARNING]
> `--run-checks` executes repository-defined tests, typechecks, and linters with your operating-system permissions. Timeouts, output limits, and a reduced environment are defense in depth—not a sandbox. Never enable it for untrusted code; see [SECURITY.md](SECURITY.md).

For a repository you explicitly trust:

```bash
npx proofdiff --run-checks --html proofdiff-report.html
```

## Why ProofDiff?

AI review and ProofDiff answer different questions. AI reviewers can suggest possible issues; ProofDiff records reproducible evidence: the selected diff, static relationships, checks discovered, checks actually executed, their outcomes, and the gaps that remain. It never turns inference into coverage or claims that a change is safe.

```text
PARTIAL  ·  highest risk HIGH  ·  2 files  ·  2 symbols
1 verified  0 partial  1 unverified  0 unknown  0 failed

UNVERIFIED services/email.py  HIGH 58
  Evidence: none observed; status is not a safety claim.

VERIFIED   src/discount.js  LOW 10
  Evidence: 1 related test file explicitly executed
  Executed tests: test/checkout.test.js
```

## Read the evidence

| Status | What ProofDiff observed |
| --- | --- |
| **Verified** | A statically related test file was passed directly to a recognized runner and succeeded. This is not runtime coverage or proof of correctness. |
| **Partially verified** | A relevant deterministic check passed, but no related test-file execution was observed. |
| **Unverified** | Checks ran, but supplied no applicable successful evidence. |
| **Unknown** | No applicable check ran, or analysis could not reach a conclusion. |
| **Verification failed** | An applicable check failed, errored, or timed out. |

Impact and test relationships are explicitly labeled static estimates.

## Use it in GitHub Actions

The released composite Action is available at `hzw0813/proofdiff@v0.1.0`. Use the released tag for normal stable integration, or the reviewed full commit SHA for an immutable security-sensitive pin. See the [complete workflow and trust guidance](docs/github-actions.md).

## Useful commands

```bash
proofdiff                         # working tree, including untracked files
proofdiff --staged                # staged changes only
proofdiff --base origin/main      # merge-base comparison
proofdiff --range v1.0.0..HEAD    # explicit commit range
proofdiff --json                  # stable machine-readable schema
proofdiff --fail-on partial       # CI policy: require every file to be verified
```

TypeScript and JavaScript receive AST and local dependency-graph analysis. Python receives isolated standard-library AST analysis when Python is available. Other files retain honest file-level diff and risk analysis without structural claims.

Full options: [`proofdiff --help`](docs/cli.md). Evidence semantics: [verification model](docs/verification-model.md). Demo provenance: [demo scenarios](docs/demo-scenarios.md). Common problems: [troubleshooting](docs/troubleshooting.md). Architecture and contribution guidance: [ARCHITECTURE.md](ARCHITECTURE.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

ProofDiff is pre-1.0. Its evidence model, JSON schema, and CLI may evolve with release notes. MIT licensed.
