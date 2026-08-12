# Changelog

All notable changes are documented here. This project follows Semantic Versioning and the Keep a Changelog structure.

## [Unreleased]

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

## [0.1.0] - 2026-08-12

Initial release candidate. Not yet published.
