# Production readiness audit — 2026-09-22

Baseline: `74ac7c8ba00ac98d830532b231fc73d9b4e85a59`.

This pass reviewed Git selection and filesystem alignment, static parsing and graph construction, process execution, runner observation boundaries, report generation, dependency installation, and CI/release gates. The baseline suite passed all 154 tests. Passing that suite did not rule out the failures below; targeted reproductions exposed eleven failing cases before the fixes.

## Prioritized fixes

| Priority | Observed weakness | Change and regression evidence |
| --- | --- | --- |
| High | The immutable-workspace `git diff --quiet` path bypassed content-driver suppression and could run a configured clean filter during static analysis. Long-lived driver caching and omitted worktree config left additional bypasses. | One shared static Git launcher, refreshed effective driver discovery, NUL-delimited keys, and fail-closed discovery bounds. Regressions cover base/range/staged modes, linked worktrees, changed config in the same process, and oversized config. |
| High | Truncated Git output was parsed as evidence, and per-file patch failures were ignored. A patch above 8 MB could produce a partial report. | Reject incomplete Git reads before parsing. Tests cover a real oversized patch, an incomplete path record, and CLI exit 2 with no newly written report even under `--fail-on never`. |
| High | A path such as `src/[a].js` also matched `src/a.js`, mixing per-file hunks. Renames had the same ambiguity. | Literal pathspecs for both old and new names. Tests check exact hunk ranges for bracket names, renames, and pathspec-magic names. |
| Medium | A child that exited without consuming its stdin caused an unhandled `EPIPE`; Python accepted valid-looking JSON even when process metadata reported failure. | Record input errors without crashing; Python retries or reports a low-confidence fallback. Tests include failed spawn, full input consumption, early exit, timeout, and truncation. |
| Medium | Unborn repositories assumed Git's SHA-1 empty-tree object. | Ask Git for its native empty-tree object without writing it. Working-tree and staged regressions use a real SHA-256 repository; existing SHA-1 tests remain. |
| Medium | Concurrent parser/I/O completion order leaked into collected analyses and diagnostics. | Collect results in inventory order after concurrent parsing. A mixed Python/JavaScript/TypeScript regression failed with the original implementation. |
| Medium | Dogfood expected verified source evidence despite an opaque chained test script and filename-only compiled mappings. | Move preparation to npm `pretest`, retain an exact serial test list, and require every compiled target to have a positive passing observation while source evidence stays partial. Add self-discovery regression coverage and a PR CI gate. Command-chain recognition and compiled-source confidence remain conservative. |

## Trust and compatibility

No runtime network, telemetry, source upload, LLM, dependency, automatic test execution, or new evidence status is introduced. Static analysis remains the default. JSON schema `1.0` and the meaning of `verified` remain unchanged: an observed related test-file pass, not changed-code coverage or correctness.

Large or incomplete Git reads now stop analysis instead of returning partial results; this is an intentional fail-closed behavior change. The 5,000-file structural-analysis cap remains a separately reported limitation. Driver configuration is inspected before each Git operation instead of cached, trading additional local Git calls for consistent suppression across long-lived library use. This is not protection against concurrent mutation of the trusted Git directory.

## Validation

Local validation uses Linux, Node 24.19.0, Git 2.51.1, Python 3.12.14, and the unchanged lockfile (TypeScript 5.9.3 and Babel parser 7.29.8). The expanded suite has 170 tests. Validation commands and their actual outcomes are recorded in the pull request; cross-platform success must come from the existing Linux/macOS/Windows × Node 22/24/26 CI matrix, not extrapolation from local results.

The repository's `lint` command is TypeScript typechecking, not a separate stylistic linter. Release checks also include Action smoke, dogfood, generated demos, packaging lifecycle tests, and clean-build `dist/` parity. Dependency audit results are point-in-time advisory data, not a guarantee of security.

## Remaining boundaries

- Git submodule contents are not analyzed; current diff inspection ignores submodules. The superproject report must not be interpreted as verification of nested repositories.
- Immutable selections still require alignment with the checked-out filesystem; arbitrary historical snapshots and concurrent filesystem changes are not isolated.
- Exact-target support remains limited to the documented runner/configuration subsets. Monorepo scripts, dynamic imports, and unsupported resolvers remain explicit limitations.
- Check execution remains arbitrary repository code with reduced environment and bounded output, not an OS sandbox or authenticated coverage attestation.
- Dependency major-version PRs are separate compatibility decisions and were not merged by this audit.

This is a tested hardening pass, not a claim that every real-world repository or threat has been verified.
