# Demo scenarios

Run `npm run demo` to create every report below from disposable Git repositories and actual ProofDiff execution. The generator asserts each expected status and fails if product behavior drifts.

| Scenario | Real change | Observed result | Why it matters |
| --- | --- | --- | --- |
| Mixed evidence | JavaScript discount validation plus a Python retry loop | One verified file, one unverified file; overall partial | Demonstrates transitive dependency impact, targeted related-test success, and honest missing Python evidence. |
| Opaque test script | Access-control logic broadens while the package script runs only an unrelated smoke test | Partially verified | The repository test command passes, but the related test is not observed executing and would fail if run. ProofDiff does not promote file presence to verification. |
| Failing check | Tax rate changes from 20% to 2% | Verification failed | Both the repository test command and the explicitly targeted related test fail. The changed file is critical risk. |
| Unsupported change | Rego policy adds a support-role allowance | Unknown | No adapter or check applies. ProofDiff keeps file-level risk useful without implying language understanding. |

Generated artifacts live in `examples/`; fixture inputs live in `fixtures/demo/` and `fixtures/scenarios/`. `examples/demo-gallery.html` is the visual index, while every scenario also has terminal, JSON, and self-contained HTML reports.

The demo deliberately contains failure and uncertainty. Editing generated output to make it look greener is a release-blocking documentation bug.
