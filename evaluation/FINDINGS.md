# Baseline external evaluation findings

## Decision summary

ProofDiff `0.1.0` at commit `a9b721ca7500da4b316c737dbb159ded6e6d3577` was evaluated against ten static-only cases drawn from nine pinned public repositories, plus six controlled cases. The corpus is purposive and mechanism-seeking. Its counts describe these cases only; they are not estimates of ecosystem prevalence or product accuracy.

The highest-value next investment is **runner-aware test-target qualification**: replace path-only test identity with evidence that a related path is a runnable test entrypoint, and prevent a targeted command that ran zero tests from producing `verified` / “Related test file passed.” This recommendation is driven by a false-strength controlled result and two opposite, clearly grounded external misses. Runner breadth should expand only after this evidence boundary is sound.

The external and controlled observations preserve the baseline unchanged. One narrow compatibility repair was made afterward: the already-supported explicit `node --test` target parser now accepts the positive-integer `--test-concurrency=<n>` option used by ProofDiff's own test script. The baseline commit had added that option without updating the parser, breaking the dogfood invariant. Unsupported Node options still fail closed. No roadmap feature was implemented.

## Observed facts

The authoritative observations are [`results.json`](results.json) and [`controlled-results.json`](controlled-results.json). Each is checked against its committed JSON Schema plus cross-artifact semantic invariants. The table below is a concise interpretation of the pinned baseline data.

| Case | Structure or mechanism | Relationship observation | Check / target observation |
| --- | --- | --- | --- |
| `p-map-root-test-file` | Root AVA suite directly imports `index.js` | Clearly expected `test.js` missed; zero files classified as tests | Expected `test` script found; no target runner |
| `fastify-relative-cjs` | Direct CommonJS test import | Clearly expected test found | All expected root scripts found; Borp command not targetable |
| `zod-package-self-export` | Package self-reference through conditional exports | Clearly expected test missed | Expected root scripts found; no target runner |
| `vitest-ts-path-alias` | `tsconfig` path mapping | Clearly expected test missed | All expected root scripts found; no target runner |
| `eslint-medium-relative-cjs` | Direct CommonJS import at medium scale | Clearly expected test found | Expected root scripts found; Makefile runner not targetable |
| `flask-python-src-layout` | Python `src/` root and transitive package import | Clearly expected test found | pytest, mypy, and Ruff found; pytest target constructed |
| `httpx-python-flat-package` | Flat Python package root | Clearly expected test found | pytest, mypy, and Ruff found; pytest target constructed |
| `pytest-current-tool-table` | Python `src/` root, `testing/` suite, current tool table | Clearly expected test found | mypy and Ruff found; `[tool.pytest]` test configuration missed |
| `typescript-custom-unittest-layout` | Generated barrels and custom unit-test naming | Clearly expected unit test missed | Expected root scripts found; no target runner |
| `typescript-cap-tail` | Changed compiler input at Git index position 61,780 | Ambiguous by design; no relationship asserted | Inventory truncated at 5,000; changed file not structurally analyzed |

Across the nine cases with a clear, enumerated import chain, ProofDiff found all expected paths in five and missed at least one expected path in four. The tenth case remains ambiguous and is excluded from that partition. These are selected mechanism observations, not precision or recall.

All ten external runs kept `repositoryCodeExecuted` false, and every discovered external check remained `not-run`. All external statuses therefore remained `unknown`; a found static relationship was not treated as runtime verification.

### Structural analysis

- Nine of ten changed paths received high-confidence parsing. The TypeScript inventory-tail path did not enter structural analysis because the repository had 81,368 tracked files and the baseline inventory stopped at 5,000.
- The TypeScript source change in `src/compiler/core.ts` was parsed at high confidence, but reverse impact traversal stopped at 250 files.
- Each TypeScript case recorded 778 lexical fallbacks, all grouped under `tests/baselines/reference`. Manual review shows these are generated compiler baseline outputs; they must not be described as 778 production-source parser failures. Two files over the 1 MB analysis limit were skipped in each run: `src/compiler/checker.ts` and `src/lib/dom.generated.d.ts`.
- Smaller fallback groups occurred in Vitest and ESLint, primarily under product or test-fixture paths. The changed paths in those cases still parsed at high confidence.
- Single-host durations ranged from 176 ms to 2,242 ms. They are operational observations only, not comparable benchmark results.

### Check discovery and targeting

- All expected check IDs were discovered in nine of ten case configurations. The exception was pytest itself: the baseline found mypy and Ruff but not the expected pytest check expressed through the repository's current `[tool.pytest]` table.
- A targeted definition was constructed in two of ten external cases, both for pytest (Flask and HTTPX). This does not mean the commands would pass: external repositories were deliberately not executed.
- JavaScript and TypeScript root scripts were usually visible, but AVA, Borp, Vitest, Makefile, and Hereby runner shapes were not targetable by the baseline. This is a breadth limitation, distinct from dependency resolution and test identity.

## Controlled validation

Six evaluator-owned fixtures confirm that the harness preserves distinct evidence states:

1. A direct relative Node test was found, explicitly targeted, and passed, producing `verified`.
2. A clear TypeScript path-alias relationship remained unresolved and `unknown`.
3. A support module at `tests/fixtures/helper.js` was classified as a test, passed under `node --test` while containing no test definitions, and produced `verified`.
4. A repository-wide passing command that excluded the related test remained `partially-verified` with no executed related test.
5. An explicitly targeted related test failed and produced `verification-failed`.
6. An unsupported Rego file remained `unknown` rather than being forced into a binary relationship result.

Case 3 is the most important correctness observation. Node's successful exit establishes that the file was loadable, not that a test ran. Because the current classifier treats supported source files anywhere under `test/`, `tests/`, or `__tests__/` as tests, a helper or fixture can cross the product's human-facing evidence boundary without test execution. The external Flask case supplies ecologically valid structure for this risk: 15 of its 39 statically related paths were directory-only candidates, including application factories and support modules. This does **not** establish real-world incidence or show that Flask would be falsely verified; Flask was not executed.

The opposite boundary also fails in grounded external examples: p-map's root `test.js` and TypeScript's `src/testRunner/unittests/compilerCore.ts` are genuine test entrypoints with explicit import chains, but the path heuristic does not identify them. ESLint's genuine `tests/lib/api.js` demonstrates why replacing directory rules with filename rules alone would also be incorrect.

## Failure-mode taxonomy

### 1. Path-only test identity is both over- and under-inclusive

- **Observed cases:** two clear external misses (p-map and TypeScript), one controlled false-strength case, and directory-only related paths in several external results.
- **Mechanism:** test identity is inferred from a narrow filename pattern or broad directory membership, without runner/configuration evidence that the path is a runnable test entrypoint.
- **Evidence consequence:** legitimate relationships can disappear; helpers can be treated as explicitly executed tests; in the controlled Node case this raised the status to `verified`.
- **Current workaround:** users must inspect the named test target and command output; avoiding `--run-checks` also avoids crossing the execution and false-strength boundary.

### 2. Non-relative JavaScript / TypeScript resolution is incomplete

- **Observed cases:** one clear package self-export miss (Zod) and one clear `tsconfig` paths miss (Vitest).
- **Mechanism:** the graph resolves relative imports but not package self-references, conditional exports, or compiler path mappings.
- **Evidence consequence:** related tests remain absent even though the changed file and test parse successfully.
- **Current workaround:** none inside ProofDiff; a maintainer must recognize the unsupported resolution mechanism from repository configuration.

### 3. Runner recognition limits targeted evidence

- **Observed cases:** only two of ten external cases produced target definitions. Five distinct JavaScript / TypeScript runner or orchestration shapes remained non-targetable. The pytest repository's current test configuration was not discovered.
- **Mechanism:** root script discovery is broader than the small set of safely parameterizable runner shapes.
- **Evidence consequence:** ProofDiff can report a static relationship yet remain at `unknown` or repository-wide `partially-verified` evidence.
- **Current workaround:** use repository-wide checks, understanding that a pass does not establish execution of a related test file.

### 4. Fixed inventory and traversal ceilings affect very large repositories

- **Observed cases:** TypeScript's 81,368 tracked files exceeded the 5,000-file inventory cap. One early changed source parsed successfully but reached the 250-dependent traversal cap; one tail changed path was not structurally analyzed.
- **Mechanism:** first-N inventory and fixed reverse-impact limits bound work by truncating evidence.
- **Evidence consequence:** conclusions depend on file ordering, and a changed path beyond the inventory can lack structural evidence entirely.
- **Current workaround:** none that preserves whole-repository analysis; the limitation is reported explicitly.

### 5. Parser fallbacks are repository-region dependent

- **Observed cases:** fallbacks were concentrated in generated TypeScript baselines and smaller fixture/product groups in Vitest and ESLint. All clear relationship mutation targets parsed at high confidence.
- **Mechanism:** syntactically unusual or intentionally invalid fixtures and generated outputs can defeat the primary parser.
- **Evidence consequence:** affected dependency edges use lower-confidence lexical evidence; changed-file conclusions in this corpus were usually unaffected.
- **Current workaround:** inspect per-path diagnostics and confidence rather than treating an aggregate fallback count as a product score.

Python package-root resolution did not produce a clear miss in the three selected Python cases. That supports the current root/`src` heuristic for these structures only; it says nothing about namespace packages or other Python layouts.

## Roadmap implications

| Candidate direction | Evaluation effect | Reason |
| --- | --- | --- |
| Runner-aware test identity / target qualification | **Higher priority; recommended next** | Addresses both missing evidence and the only observed path to false-strength `verified` evidence; supported by controlled and external cases |
| Broader runner recognition | **Higher priority, after test identity** | Eight of ten external cases lacked target definitions, but breadth added before qualification could amplify false confidence |
| TypeScript paths and package/workspace resolution | **Higher priority** | Two distinct clear misses; likely one follow-on resolution program, but lower severity than an incorrect evidence upgrade |
| Large-repository streaming / complete changed-path inclusion | **Higher priority but not first** | One very large repository exposed both inventory and traversal ceilings; the corpus does not establish broader prevalence |
| Explicit check configuration | **Still uncertain / potentially useful** | Could cover opaque and current runner metadata, but safe target semantics need a stronger identity model first |
| Python package resolution | **Lower priority from this corpus** | Three clear Python relationships were found across flat, `src`, and custom test layouts; unmeasured layouts remain open |
| Runtime coverage ingestion | **Lower priority for the next goal** | It would not repair missing test identity, unresolved static edges, or runner targeting; the current evaluation did not measure runtime coverage |
| Go and Rust adapters | **Irrelevant for now** | Unsupported-language breadth was not the dominant measured limitation and no external Go/Rust cases were evaluated |
| PR-native / GitHub integration | **Irrelevant for now** | Integration would surface the same evidence gaps rather than correct them |

## Single next priority

The next goal should establish **runner-aware test-target qualification** before adding runner breadth:

> Replace path-only test classification with explicit, reviewable test-target evidence derived from runner configuration and repository conventions. Distinguish runnable test entrypoints from helpers, fixtures, compiler inputs, and type-only cases. Ensure that a targeted command which executes zero tests cannot yield `verified` / “Related test file passed.” Preserve the evidence used to classify each target and add controlled regressions for p-map-style root tests, TypeScript-style custom unit layouts, ESLint-style generic names, and directory-only helpers. Do not broaden runner support until this boundary is sound.

This is one evidence-model hardening investment, not a request to implement general path aliases, coverage, new languages, or v0.2.0 in this evaluation change.

## Implementation change after baseline measurement

Baseline observations remain attached to `a9b721ca7500da4b316c737dbb159ded6e6d3577`. During final validation, `npm run dogfood` exposed an unambiguous compatibility defect already present at that commit: the repository's test script used `node --test --test-concurrency=1` while `targetingForScript` rejected every Node option, so ProofDiff could not construct its own intended targeted test-file invocation.

The post-measurement repair allowlists only `--test-concurrency=<positive integer>` in the existing explicit Node test list. A regression test covers the repository's command shape, and a second test confirms an unsupported option still disables targeting. This restores the existing dogfood contract; it does not alter the recorded baseline, implement general runner recognition, or address the separately recommended test-identity work.

Hosted validation then reproduced a second baseline defect on Windows with Node 24: after a check reached its configured timeout, process-tree termination could complete without the child emitting the `close` event awaited by `runProcess`, leaving the Promise pending indefinitely. The Windows timeout path now settles after both the process-tree terminator and the child's `exit` event complete, with a bounded forced-settlement fallback; POSIX termination also has a bounded fallback. Both paths destroy inherited process streams and retain the `timedOut` result. The existing timeout test now also asserts a bounded return and tolerates only bounded Windows filesystem-release delay during fixture cleanup. This is a safety-contract repair required to make configured timeouts truthful; it does not affect the baseline corpus observations.

## Adversarial second-pass review

The second pass weakened and clarified several initial interpretations:

- **Selection bias:** the corpus was deliberately chosen for mechanism variation. Failure counts cannot be generalized to GitHub prevalence, and nine repositories are not a representative market sample.
- **Synthetic-change bias:** comments preserve repository structure and make graph behavior reproducible, but they do not model real diff size, changed-symbol semantics, behavioral risk, or maintainer intent.
- **Ground truth:** only the enumerated expected chains are strong judgments. ProofDiff's additional related paths are observations, not automatically relevant tests. No independent second maintainer supplied inter-rater agreement.
- **Static/runtime boundary:** no external command ran. Target construction is capability evidence, not proof that a test passes or exercises the changed code.
- **Parser interpretation:** the large TypeScript fallback count initially looked like a broad parser failure. Grouping and manual inspection showed concentration in generated compiler baselines, so the conclusion was narrowed.
- **Test identity remedy:** the p-map and TypeScript misses initially suggested broader filename matching. ESLint's genuine generic `tests/lib/api.js` and the controlled helper case show that neither filename-only nor directory-only rules are sufficient.
- **Priority tension:** runner breadth affected more external cases than test identity. The recommendation nevertheless puts qualification first because runner gaps keep evidence weak, whereas the controlled identity gap can incorrectly strengthen evidence. This is a severity and sequencing judgment, not a prevalence claim.
- **Performance:** durations were recorded for operational visibility but are not compared across cases as benchmark data. Repeated repositories also prevent meaningful aggregate parser or file-count totals.

The review did not change the raw structured results. It changed the leading recommendation from broad runner support to test-target qualification first, and it weakened parser and prevalence language.

## Reproducible sources

Every external revision, mutation, expected chain, and selection reason is pinned in [`corpus.json`](corpus.json). Examples can be inspected at the exact revisions:

- [p-map](https://github.com/sindresorhus/p-map/tree/bc26cf03f81292325236a1188063dac8e7a4de0f)
- [Fastify](https://github.com/fastify/fastify/tree/e4ffc205328db294d550c5855d2573b33f5e9d62)
- [Zod](https://github.com/colinhacks/zod/tree/2d90846af918af9602e088812d63a035d47cdbe4)
- [Vitest](https://github.com/vitest-dev/vitest/tree/667c13954daff2d1bec8a866702da8934b9ce539)
- [ESLint](https://github.com/eslint/eslint/tree/dc1e7a8416937edefe04cf836ee202a6fc03bedd)
- [Flask](https://github.com/pallets/flask/tree/2a8a38b051fc248865730bf3511bf2e2ea325e81)
- [HTTPX](https://github.com/encode/httpx/tree/b5addb64f0161ff6bfe94c124ef76f6a1fba5254)
- [pytest](https://github.com/pytest-dev/pytest/tree/5fd2be03b1f8b5eef48d507d001ebf0a82e875a1)
- [TypeScript](https://github.com/microsoft/TypeScript/tree/b465fdbfe175304d9b977da137b2c178ae1091d3)

The methodology and rerun commands are documented in [`README.md`](README.md). The ordinary ProofDiff test suite validates the artifact invariants without network access. External acquisition remains an explicit, separate command.
