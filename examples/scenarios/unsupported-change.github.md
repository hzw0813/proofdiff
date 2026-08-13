## ProofDiff · Change Evidence

**Unknown** · 1 changed file · highest risk **HIGH**
1 unknown.

**Run mode:** Static only. No repository code was executed.

### Changed files

- ❔ **Unknown** · <code>policy/access.rego</code> · HIGH risk
  - No supported related test-like path was established.
  - Evidence boundary: <code>static-relationship</code> · <code>unsupported-semantics</code>. ProofDiff could not establish first-class structural semantics for this changed file, so stronger relationship claims were not made. ProofDiff intentionally failed closed at this boundary.
  - Next action: <code>inspect-static-limitations</code> — Inspect the file-level and static-analysis limitations; add or connect explicit verification rather than inferring that no tests exist.

### Analysis notes

- Check execution was requested, but no supported checks were discovered.

**Next step:** Check discovery found nothing it could run. Inspect the supported conventions and detailed limitations; do not treat this unknown state as a pass.

> **Trust boundary:** A related target pass means ProofDiff observed at least one non-skipped test for that exact runner-qualified target. It does not show that changed code ran or that behavior is correct.

Full provenance remains in the job log and configured HTML report <code>unsupported-change.html</code>. Upload that file as a workflow artifact to retain it.
