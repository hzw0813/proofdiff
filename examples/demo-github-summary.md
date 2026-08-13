## ProofDiff · Change Evidence

**Partially verified** · 2 changed files · highest risk **HIGH**
1 related test file passed · 1 unverified.

**Run mode:** Repository-defined checks ran with explicit consent. They were bounded, but not sandboxed.

### Changed files

- ⚠️ **Unverified** · <code>services/email.py</code> · HIGH risk
  - No supported related test-like path was established.

- ✅ **Related test file passed** · <code>src/discount.js</code> · LOW risk
  - Observed passing target: <code>test/checkout.test.js</code>. At least one non-skipped test was observed for each named target.

**Next step:** Inspect the files without passing target observations and the detailed limitations before deciding whether more verification is needed.

> **Trust boundary:** A related target pass means ProofDiff observed at least one non-skipped test for that exact runner-qualified target. It does not show that changed code ran or that behavior is correct.

Full provenance remains in the job log and configured HTML report <code>demo-report.html</code>. Upload that file as a workflow artifact to retain it.
