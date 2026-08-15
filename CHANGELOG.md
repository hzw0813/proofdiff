# Changelog

All notable changes are documented here. This project follows Semantic Versioning and the Keep a Changelog structure.

## [Unreleased]

### Fixed

- Preserved LCOV `SF:` source paths exactly instead of applying JavaScript-style whitespace trimming. Leading or trailing spaces and Unicode whitespace are valid path characters, so silently erasing them could alias artifact coverage for one path onto a different changed repository file and overstate changed-line evidence.
- Restricted recognized Node/Jest/Vitest package-script trimming to ASCII spaces and tabs. JavaScript `String.trim()` also removes non-ASCII whitespace such as NBSP, which shells do not treat as ordinary script separators; leading or trailing Unicode whitespace can therefore no longer be erased into a different executable command and accidentally qualify for exact targeted evidence.
- Stopped `.pyi` stub files with test-like names from inventing executable pytest or `unittest` checks. Stubs remain available to static Python analysis and relationship discovery, but framework discovery now requires an executable `.py` test file; this prevents `--run-checks` from launching a Python test runner merely because a repository contains test-shaped type stubs.
- Updated current stable Action guidance and the published-Action CI smoke from v0.5.2 to the already-released v0.5.3 snapshot, including the immutable full-SHA pin, so documentation and release verification no longer lag the latest public release.

## [0.5.3] - 2026-08-15

### Fixed

- Refused to dereference symbolic-link repository source/config/test paths during static reads and exact-target qualification. Working-tree untracked symlinks no longer cause ProofDiff to read their targets, symlinked repository metadata cannot enable checks by existence alone, and symlinked test paths cannot produce exact per-target evidence. Dependency/package-manager environment paths and explicitly supplied external data artifacts keep their existing separate trust rules.

### Changed

- JSON `schemaVersion: "1.0"` and the human meaning of `verified` remain unchanged: **Related test file passed**. This patch strengthens filesystem/snapshot boundaries and does not claim changed-symbol execution, changed-line execution, assertion relevance, coverage completeness, or correctness.

## [0.5.2] - 2026-08-15

### Fixed

- Restored repository Action/runtime parity by clean-regenerating the tracked `dist/` tree from the current source. The composite Action executes tracked `dist/cli.js` directly, while npm release packaging rebuilds `dist`; keeping these trees synchronized prevents a GitHub Action tag and npm package with the same version from carrying different runtime code.
- Added a permanent clean-build `Generated dist / source parity` CI gate. CI removes generated output, rebuilds it, and requires the committed `dist/` tree to match exactly, including detection of stale orphaned generated files.
- Bound immutable `--base`, `--range`, and `--staged` analysis to the checked-out filesystem state consumed by graph analysis, check discovery, runner qualification, and optional execution. Base/range targets must match checked-out HEAD; tracked drift, Git-visible untracked inputs, and discovery-sensitive ignored metadata/tests fail closed; staged analysis requires worktree/index alignment.
- Tightened immutable `--run-checks` workspace trust: ignored repository-local runtime inputs are rejected before repository code execution, while bounded dependency/cache directories remain environment inputs. Static-only analysis uses the narrower discovery-sensitive ignored-input boundary.
- Preserved explicit LCOV semantics under the workspace gate: only the exact supplied LCOV data artifact may be exempt from generic untracked/ignored rejection, it still undergoes declared-commit and bounded parsing checks, and sibling files or discovery-sensitive metadata/test paths receive no exemption. Historical range targets that are not checked out now fail closed with guidance to use the matching checkout or a separate worktree rather than mixing snapshots.

### Changed

- JSON `schemaVersion: "1.0"` and the human meaning of `verified` remain unchanged: **Related test file passed**. These changes strengthen runtime/provenance boundaries and do not claim changed-symbol execution, changed-line execution, assertion relevance, coverage completeness, or correctness.

## [0.5.1] - 2026-08-15

### Fixed

- Bound repository-local `--test-map` declarations to immutable selections: `--base` and `--range` now require the current declaration content to match the selected target commit, `--staged` requires it to match the index, and a map changed by the same immutable selection fails closed. Mutable working-tree iteration remains allowed with an explicit trust caveat; an external map remains an explicit external trust input.
- Hardened Git provenance against local replacement objects by disabling `.git/refs/replace` semantics for ProofDiff Git inspection and test-map snapshot reads. Real regression tests confirm ordinary Git can be spoofed by a replacement blob while ProofDiff still observes the original committed content.
- Fixed test-map visibility in repositories whose static graph inventory exceeds 5,000 paths. Relationship validation now uses a separate bounded Git-visible inventory, and fails closed if even that inventory exceeds the underlying Git-output bound instead of treating a partial list as authoritative.
- Rejected symbolic-link test-map artifacts and canonicalized repository-local map identity before immutable-selection trust checks.
- Made Python AST interpreter discovery resilient across platforms: Windows now prefers `python` before `python3`, other platforms retain `python3` first, and a missing, timed-out, nonzero, or malformed-output candidate no longer prevents ProofDiff from trying the alternate interpreter before visibly falling back to lexical analysis.

### Changed

- JSON `schemaVersion: "1.0"` and the historical human meaning of `verified` remain unchanged: **Related test file passed**. These hardening changes do not make declarations proof of coverage and do not claim the broader historical/staged filesystem is snapshot-bound beyond the test-map declaration checks described above.

## [0.5.0] - 2026-08-15

### Added

- Added bounded user-declared source-to-test relationships through CLI `--test-map`, the library `AnalyzeRepositoryOptions.testMap`, and the composite Action `test-map` input. The exact-path JSON map is parsed as bounded data, rejects escaping/stale/duplicate/unsupported inputs as a whole, and records declaration provenance without pretending ProofDiff independently proved semantic relevance.
- Added actionable evidence-boundary guidance for relationship gaps: when ProofDiff cannot infer an exact relationship, `nextAction` can point to `--test-map`; a declared-but-unqualified target stops at `runner-qualification`, and a qualified target whose checks were not run stops at `target-invocation`.

### Changed

- User declarations may add a related test candidate to targeted discovery, but they do not bypass runner qualification, explicit exact-target supply, runtime observation, or the non-skipped-pass requirement. A declaration alone cannot create `executedTests` or `verified`, and it does not claim changed-symbol execution, changed-line coverage, assertion relevance, or correctness.
- Exact targeted checks are associated by their declared/qualified target path even when source and test languages differ, while opaque repository-wide checks remain language-scoped. This supports explicit cross-language integration-test relationships without lending broad test success across languages.
- Declared-only relationships do not erase the existing risk signal for missing statically inferred test relationships; the report keeps that distinction visible instead of allowing an expert map to game the review score.
- JSON `schemaVersion: "1.0"` and the historical human meaning of `verified` remain unchanged: **Related test file passed**.

## [0.4.2] - 2026-08-14

### Fixed

- Fixed real Vitest multi-project JSON compatibility: when Vitest emits multiple valid suite records for the same exact physical target path, ProofDiff now aggregates those observations instead of discarding the entire report as duplicate-path ambiguity. Aggregation is Vitest-only, uses safe-integer counts, preserves exact target identity, treats any failing duplicate as a target failure, and still fails closed on malformed data; duplicate Jest target records remain fail-closed.

### Changed

- Targeted Jest/Vitest check provenance now explicitly warns when bounded literal prefixes propagate sensitive environment names such as `PATH`, `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, or `DYLD_*`. The values are not exposed and the variables remain supported rather than blocked, preserving repository test-script semantics and the documented `--run-checks` trust boundary.
- JSON `schemaVersion: "1.0"` and the historical `verified` meaning **Related test file passed** remain unchanged. The Vitest fix was validated against pinned Zod with real Vitest 4.1.5: an exact target that previously remained `not-observed` was observed as 110 passing tests, while a pinned Vitest workspace-orchestration negative control remained opaque.

## [0.4.1] - 2026-08-14

### Changed

- Expanded bounded Jest/Vitest exact-target recognition to accept up to four literal `NAME=value` environment prefixes and an optional leading `cross-env` wrapper when `cross-env` is locally installed. Recognized environment values are preserved in the targeted runner process; the existing Jest/Vitest runner and option allowlists, exact-target identity, non-skipped-pass requirement, failure attribution, and JSON fail-closed behavior are unchanged.
- Shell substitution and chaining, duplicate/excessive environment assignments, `cross-env-shell`, `dotenv`, `concurrently`, unsupported Jest/Vitest options/config shapes, and other ambiguous wrappers remain opaque instead of being guessed. JSON `schemaVersion: "1.0"` and the historical `verified` meaning remain unchanged.

## [0.4.0] - 2026-08-14

### Added

- Added bounded exact per-target runtime observations for conventional root Jest and Vitest scripts. ProofDiff resolves the locally installed runner, explicitly supplies statically related test-like targets, consumes a bounded per-file JSON result artifact, and fails closed on unsupported command shapes or missing, malformed, oversized, duplicate, and unmatched results. The historical `verified` meaning remains **Related test file passed**; this does not claim changed-symbol execution, changed-line execution, assertion relevance, or correctness.

## [0.3.0] - 2026-08-14

### Changed

- Added an additive deterministic per-file `evidenceBoundary` that reports the strongest observed evidence, the exact stage and reason where stronger evidence stopped, whether ProofDiff failed closed, and a bounded next action. Terminal, GitHub summary, HTML, and JSON now expose the same distinction without changing the historical `verified` meaning or JSON `schemaVersion: "1.0"`.
- GitHub Action `pull_request` runs can now omit `base`: ProofDiff auto-resolves the exact PR base commit SHA from GitHub's event payload, while explicit `base` still wins and other non-PR events preserve working-tree fallback. Missing or malformed PR metadata fails closed instead of silently analyzing an empty clean working tree; omitted `base` on `pull_request_target` also fails closed because its default checkout normally points at the base revision rather than the PR change.
- Added explicitly supplied LCOV coverage-artifact evidence behind paired `--coverage-lcov` and `--coverage-commit` inputs. ProofDiff accepts the artifact only when the user-declared commit resolves exactly to the committed target of the selected diff, rejects working-tree/staged and mismatched bindings, parses LCOV as bounded data, caps changed-line reconstruction at 50,000 current lines per file, and fails closed on malformed or oversized inputs. This evidence is reported on a separate additive coverage axis: it does not advance the primary `evidenceBoundary`, alter the historical `verified` meaning, or claim independent artifact provenance, changed-symbol execution, test relevance, assertion relevance, branch coverage, or correctness.

## [0.2.0] - 2026-08-13

### Changed

- Added a concise, bounded GitHub Actions job summary that distinguishes observed passing targets, other target outcomes, static-only relationships, and unsupported relationships without changing evidence semantics. The summary is default-on, disableable, permission-free, escaped, and omits source, symbols, commands, check output, observer payloads, and absolute repository paths.
- Added bounded, data-only resolution for exact/single-wildcard TypeScript `paths` mappings and exact repository-local package self-exports. Post-`paths` lookup uses TypeScript's explicit-extension substitution families and permits extensionless file/index lookup only under explicit Bundler or Node10 resolution; ambiguous NodeNext context, directory package metadata, non-default suffix precedence, malformed, cyclic, excessive, external, nested-boundary, and unsupported cases remain unresolved. Successful non-relative edges retain inspectable graph evidence.
- Tightened static resolver ownership after adversarial review: compiler configs must include the importer, hidden package/config metadata blocks ancestry claims, package self-exports require an explicit export-aware mode, and unmodeled versioned conditions fail closed.
- Preserved the static/runtime boundary: alias and export relationships cannot qualify runner targets or create execution evidence, and JSON `schemaVersion: "1.0"` is unchanged.
- Separated broad static test-like relationships from runner-qualified target identity. Node default/explicit patterns, bounded pytest configuration (including pytest 9 `[tool.pytest]`), and unittest discovery now retain inspectable qualification records.
- Added separately bounded Node `TestsStream`, pytest plugin, and unittest `TestResult` observers. `verified` now requires an exact positive non-skipped per-target observation; zero-test, filtered, skipped, malformed, missing, truncated, and cross-target records cannot strengthen evidence.
- Added exact batched-target attribution so one target's pass or failure is not lent to another target, while preserving status names, fail policies, CLI flags, and JSON `schemaVersion: "1.0"` with additive optional fields.
- Reworked the repository front page around a verified zero-install quickstart, a real-product launch walkthrough, and the distinction between deterministic evidence and AI review.
- Published the generated interactive demo gallery through GitHub Pages and added repository-ready social-preview artwork.
- Updated GitHub Action guidance and hosted smoke coverage to use the released `v0.1.0` integration instead of `main`.
- Added a first-visit demo landing story, generated from the real passing-but-partially-verified access-control scenario, before the detailed evidence gallery.
- Scoped the human-facing `verified` label to **Related test file passed**, moved the changed-symbol/line coverage boundary beside prominent results, and preserved the existing JSON status and file-level evidence algorithm.
- Added an evaluation case for a passing related test file that does not exercise the changed symbol, plus a non-invasive warning for Git-visible untracked generated directories.

## [0.1.0] - 2026-08-12

Initial public release.

### Added

- Local Git working-tree, staged, merge-base, and explicit-range analysis.
- AST-backed TypeScript/JavaScript and Python symbol/import analysis with visible fallbacks.
- Static dependency impact and related-test estimation.
- Line-numbered JavaScript/TypeScript and Python call references when parser-observed call sites intersect changed lines, explicitly labeled as structural rather than runtime evidence.
- Conservative five-state evidence model and explainable risk queue.
- Opt-in, bounded test/typecheck/lint execution with environment minimization and output redaction.
- Expanded check-output redaction for lowercase credential keys, Basic authorization, credential-bearing URLs, private keys, JWTs, and common provider-token formats.
- Hardened Git inspection that suppresses repository-configured hooks, filesystem monitors, content filters, text conversion, and external diff helpers.
- Targeted related-test execution for Node's built-in runner, pytest, and unittest; “Verified” no longer follows from a passing filtered/opaque test script plus file presence alone.
- Unambiguous source-to-compiled mapping for explicit Node test-file lists, retaining targeted evidence without shell globs.
- Terminal, JSON, and self-contained interactive HTML reports.
- Four real-repository demo scenarios and a responsive evidence-state gallery.
- CI failure policies, a reusable GitHub composite action with a production-only smoke test, and reproducible GitHub/npm release automation.
- Unit, integration, CLI, security, fixture-repository, report, and end-to-end tests.
- Troubleshooting guidance for selection, checks, Python fallback, CI history, timeouts, and sensitive reports.
- Cross-platform test-file enumeration that does not depend on shell glob expansion in the Windows CI jobs.
