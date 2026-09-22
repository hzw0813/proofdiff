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

- Git submodule contents are not analyzed. The follow-up after PR #70 below makes gitlink changes visible, without interpreting a superproject report as verification of nested repositories.
- Immutable selections still require alignment with the checked-out filesystem; arbitrary historical snapshots and concurrent filesystem changes are not isolated.
- Exact-target support remains limited to the documented runner/configuration subsets. Monorepo scripts, dynamic imports, and unsupported resolvers remain explicit limitations.
- Check execution remains arbitrary repository code with reduced environment and bounded output, not an OS sandbox or authenticated coverage attestation.
- Dependency major-version PRs are separate compatibility decisions and were not merged by this audit.

This is a tested hardening pass, not a claim that every real-world repository or threat has been verified.

## Follow-up after PR #69

Baseline: current main `9b886a25abe7f809112c13d26184ed28cc5b173b`. The downloaded text files were checked against that commit's Git blob identities before editing. This follow-up examined the remaining filesystem-alignment assumptions and process lifetime boundary. Six new regression cases reproduced five failures against the baseline; the inherited-output descendant case already passed and now protects the existing behavior.

| Priority | Reproduced weakness | Fix and regression coverage |
| --- | --- | --- |
| High | `assume-unchanged` and `skip-worktree` hid a modified source file from `git diff`; immutable analysis accepted it as aligned and reported no changes. | Read index stages and flags as bounded NUL-delimited data before diff extraction. Reject hidden inputs in working-tree, base, range, and staged modes before checks run. Tests assert exit 2 even under `--fail-on never`, no new report or execution marker, preserved flags, and successful analysis after the caller clears flags. |
| High | A real sparse-index checkout with absent source/test paths passed immutable analysis. An unresolved merge also reached analysis and execution despite lacking a single resolved snapshot. | Reject sparse/skip-worktree entries and nonzero merge stages with recovery guidance. Regressions create a real cone-mode sparse index and a conflicting merge, including all four selection modes for conflicts. |
| Medium | A timed-out POSIX parent exited and closed its pipes, cancelling the escalation timer while a TERM-resistant descendant with redirected output kept running. | Parent close no longer completes a POSIX timeout before process-group KILL escalation. Real-process tests check that a descendant heartbeat stops with both redirected and inherited output. Windows retains its native termination path. |

These changes add no dependencies, runtime network access, telemetry, uploads, or automatic check execution. They do not strengthen verification statuses or change schema `1.0`. Sparse checkouts are deliberately rejected rather than claimed supported; use a full checkout. Even clean flagged entries are rejected because cached Git stat assumptions cannot independently establish filesystem alignment. The index inventory uses the existing 8 MB output bound and fails closed if incomplete. No index flags or checkout contents are changed by inspection.

The expanded suite contains 176 tests, including two new POSIX-only process tests. Full validation outcomes, including the existing Linux/macOS/Windows × Node 22/24/26 matrix, are recorded in the draft PR. Remaining work includes the submodule visibility limitation above, broader bounded runner/monorepo support, and isolated snapshot analysis. Process-group cleanup remains best effort: deliberately detached descendants and arbitrary repository code require an external OS sandbox. Concurrent repository mutation remains outside this pass.

## Follow-up after PR #70

Baseline: current main `72211d94539ca3166e1bac056bbdd094383b63f5`, whose tree matches the previously validated PR #70 head. This pass prioritized a demonstrated completeness failure over expanding runner guesses: a committed submodule pointer update produced an empty-change report. The audit also found Python discovery crossing nested-repository boundaries and immutable execution accepting unbound nested inputs. Six regression cases failed against the baseline distribution before the fixes.

| Priority | Finding | Change and regression coverage |
| --- | --- | --- |
| High | `--ignore-submodules=all` silently removed gitlink changes from selected diffs. | Read bounded raw NUL-delimited mode/path records with pointer visibility enabled. Tests cover additions, updates, renames, deletions, gitlink-to-file transitions, base/range/staged selections, working-tree HEAD movement, and repository ignore/diff-format overrides. |
| High | A source-shaped gitlink could enter structural candidate inventories; adding pointer visibility alone would let declared tests or synthetic Git patch lines imply nested verification/coverage. | Optional `submodule: true`, metadata-only unknown assessments, no source hunks/counts, and no borrowed test/LCOV evidence. Tests cover source-shaped names, graph exclusion, passing root checks, user-declared relationships, LCOV, and the GitHub summary. |
| High | Python discovery walked submodules outside the superproject inventory. Immutable checks could consume nested dirty/untracked inputs while alignment ignored them. | Exclude submodules and embedded Git repositories from discovery. Reject immutable execution with indexed submodules before checks run. Tests cover nested tests under the seeded `tests/` directory, a removed gitlink with its checkout left behind, all three immutable modes, and absence of an execution marker. |

Static immutable analysis still works with submodules, including uninitialized gitlinks. Explicit working-tree execution remains available, but gitlink evidence stays unknown. Submodules are never fetched, initialized, updated, or recursively verified. Nested content-only dirtiness is deliberately excluded from repository dirty status, and the report explains that boundary. A nested filesystem-monitor regression checks that pointer inspection does not execute that helper.

The full suite now contains 182 tests. Validation includes lint/typecheck, tests/build, dogfood, asserted demos, Action smoke, packaging lifecycle, generated-dist parity, and the existing three-OS/three-Node CI matrix; actual outcomes are recorded in the draft PR. No runtime dependencies, telemetry, uploads, LLM calls, or automatic execution were added. JSON schema remains `1.0` with an additive optional gitlink marker.

Remaining priorities include isolated immutable snapshots, protection from concurrent mutation, broader bounded monorepo/runner support, and unsupported module-resolution cases. This pass does not claim recursive submodule verification or adversarial filesystem isolation. Immutable execution in repositories with submodules is intentionally more restrictive until nested inputs can be bound reliably.
