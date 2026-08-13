## ProofDiff · Change Evidence

**Partially verified** · 1 changed file · highest risk **MEDIUM**
1 partially verified.

**Run mode:** Repository-defined checks ran with explicit consent. They were bounded, but not sandboxed.

### Changed files

- ⚠️ **Partially verified** · <code>src/access.js</code> · MEDIUM risk
  - Static relationship only: <code>test/access.test.js</code>. No passing target observation was recorded.
  - Evidence boundary: <code>runner-qualification</code> · <code>opaque-passing-check</code>. A repository command passed, but no related test-like path was qualified as an exact target for a recognized runner. ProofDiff intentionally failed closed at this boundary.
  - Next action: <code>qualify-related-test</code> — Use a supported runner convention or explicit runner target so ProofDiff can bind runtime observation to the related test file.

**Next step:** Inspect the files without passing target observations and the detailed limitations before deciding whether more verification is needed.

> **Trust boundary:** A related target pass means ProofDiff observed at least one non-skipped test for that exact runner-qualified target. It does not show that changed code ran or that behavior is correct.

Full provenance remains in the job log and configured HTML report <code>opaque-test-script.html</code>. Upload that file as a workflow artifact to retain it.
