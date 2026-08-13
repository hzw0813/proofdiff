## ProofDiff · Change Evidence

**Verification failed** · 1 changed file · highest risk **CRITICAL**
1 verification failed.

**Run mode:** Repository-defined checks ran with explicit consent. They were bounded, but not sandboxed.

### Changed files

- ❌ **Verification failed** · <code>src/tax.js</code> · CRITICAL risk
  - Attributed failed target: <code>test/tax.test.js (failed)</code>.
  - Evidence boundary: <code>runtime-observation</code> · <code>target-failed</code>. A runner-qualified related target was explicitly supplied and observed failing.
  - Next action: <code>inspect-failure</code> — Inspect the attributed target failure before seeking stronger positive evidence.

**Next step:** Inspect the relevant failure and full provenance; a passing target elsewhere does not erase it.

> **Trust boundary:** A related target pass does not show that changed code ran or that behavior is correct. Declared-commit-matched LCOV can add separate artifact-reported coverage evidence, but ProofDiff does not independently attest that artifact provenance, relevant assertions, or behavioral correctness.

Full provenance remains in the job log and configured HTML report <code>failing-check.html</code>. Upload that file as a workflow artifact to retain it.
