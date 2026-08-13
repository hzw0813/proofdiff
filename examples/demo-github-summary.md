## ProofDiff · Change Evidence

**Partially verified** · 2 changed files · highest risk **HIGH**
1 related test file passed · 1 unverified.

**Run mode:** Repository-defined checks ran with explicit consent. They were bounded, but not sandboxed.

### Changed files

- ⚠️ **Unverified** · <code>services/email.py</code> · HIGH risk
  - No supported related test-like path was established.
  - Evidence boundary: <code>static-relationship</code> · <code>no-related-test</code>. ProofDiff established no supported related test-like path for this change.
  - Next action: <code>inspect-static-limitations</code> — Inspect static-analysis limitations and test relationships; absence of a discovered relationship is not proof that no relevant test exists.

- ✅ **Related test file passed** · <code>src/discount.js</code> · LOW risk
  - Observed passing target: <code>test/checkout.test.js</code>. At least one non-skipped test was observed for each named target.
  - Evidence boundary: <code>changed-code-execution</code> · <code>changed-code-execution-unobserved</code>. A runner-qualified related test file passed, but ProofDiff did not observe whether changed symbols, lines, branches, or relevant assertions executed. ProofDiff intentionally failed closed at this boundary.

**Next step:** Inspect the files without passing target observations and the detailed limitations before deciding whether more verification is needed.

> **Trust boundary:** A related target pass does not show that changed code ran or that behavior is correct. Declared-commit-matched LCOV can add separate artifact-reported coverage evidence, but ProofDiff does not independently attest that artifact provenance, relevant assertions, or behavioral correctness.

Full provenance remains in the job log and configured HTML report <code>demo-report.html</code>. Upload that file as a workflow artifact to retain it.
