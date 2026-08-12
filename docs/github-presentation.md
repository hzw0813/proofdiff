# GitHub presentation checklist

Use only after the repository owner and final URL are known.

## Repository description

> Evidence-based review of code changes: connect diffs to tests and checks, locally, without accounts, uploads, or false confidence.

## Suggested topics

`code-review`, `git`, `testing`, `static-analysis`, `developer-tools`, `typescript`, `python`, `javascript`, `ci`, `security`

## Launch note draft

ProofDiff asks a narrower and more useful review question than “does CI pass?”: what evidence is actually connected to this change?

The first release analyzes working-tree or commit-range diffs, finds changed symbols and statically resolvable dependents, discovers conventional checks, and produces an auditable terminal or self-contained HTML report. Static analysis is the default; repository code runs only with explicit consent. Every relationship, confidence level, and limitation is labeled.

The demo gallery is intentionally adversarial: it shows narrow passing evidence, an opaque green command that excluded a related failing test, an explicitly targeted failure, and an unsupported policy change. Every result comes from the real tool, because honest uncertainty is a feature.

Try the quickstart in the README, inspect the evidence model, and report cases where ProofDiff is too confident, too vague, or misses an important relationship.

## Before making public

- Confirm repository references resolve to `hzw0813/proofdiff`.
- Enable private vulnerability reporting and protected `npm` publication environment.
- Run the hosted OS/Node CI matrix.
- Pin the README screenshot and demo outputs from `npm run demo`.
- Confirm package-name availability and publish only with explicit owner approval.
