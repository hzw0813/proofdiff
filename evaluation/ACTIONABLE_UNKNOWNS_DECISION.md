# Actionable Unknowns Decision

## Baseline

Baseline: `main` at `48f4a3bfc8d51f3caf33594c0358eac9ec6e23c9`, the commit released as ProofDiff v0.2.0.

The existing product already distinguished static relationships, opaque passing commands, qualified related targets, exact target observations, and relevant failures. The main usability gap was that `unknown`, `unverified`, and `partially-verified` states still required users to infer where evidence stopped by reading multiple evidence and limitation entries.

## Selected bottleneck

This cycle selects **actionable evidence boundaries** over runner expansion, resolver expansion, or coverage ingestion.

Why:

- Runner expansion increases breadth but does not solve the interpretation problem for evidence states ProofDiff already produces.
- Resolver expansion improves selected static relationships but does not make runtime uncertainty easier to understand.
- Coverage ingestion could provide stronger evidence, but trustworthy use requires separate provenance, staleness, path-normalization, and partial-report research.
- The current product can deterministically explain many existing uncertainty states without executing more code or weakening the trust boundary.

## Product decision

For every analyzed changed file, derive an additive `evidenceBoundary` object that records:

- strongest evidence observed;
- the pipeline stage where stronger evidence stopped;
- a stable reason category;
- a bounded explanation;
- whether ProofDiff intentionally failed closed;
- one bounded next action when a trustworthy action exists.

No new CLI command is added. Existing terminal, JSON, HTML, and GitHub summary surfaces are strengthened instead.

## Trust constraints

The evidence model remains unchanged:

- process exit 0 ≠ meaningful test;
- static relationship ≠ runtime execution;
- related test file pass ≠ changed-code execution;
- changed-code execution ≠ correctness.

Static-only mode remains static-only. `--run-checks` remains explicit, trusted, and unsandboxed opt-in execution of repository-defined commands.
