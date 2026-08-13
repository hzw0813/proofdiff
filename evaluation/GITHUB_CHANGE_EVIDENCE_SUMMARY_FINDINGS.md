# GitHub change-evidence summary: before and after

## Baseline

- Merged baseline: `cf02d31ee86be3b051d77d93123b4236c3e0fd1e`.
- Product decision: [`GITHUB_CHANGE_EVIDENCE_SUMMARY_DECISION.md`](GITHUB_CHANGE_EVIDENCE_SUMMARY_DECISION.md).
- Scope: presentation of the existing `AnalysisReport` in GitHub Actions. No
  graph, qualification, observation, status, risk, failure-policy, or schema
  semantics changed.

## Thirty-second product test

The README makes the local/static trust boundary visible and gives a one-command
start. On a clean realistic fixture, `npx proofdiff --html
proofdiff-report.html` completed quickly and truthfully reported two `Unknown`
files, one with a static test-like relationship. Friction observed:

1. The terminal report leaves the next action in explanatory prose rather than
   a compact next-step block.
2. A report written inside the repository appears as an untracked high-risk
   changed file in the next working-tree run unless ignored or written outside
   the worktree.
3. The published `0.1.0` package predates the merged evidence-boundary and
   resolver work, so current source and published first-run wording differ until
   the next release.

Those are genuine first-run issues, but the selected slice does not silently
mix them into the GitHub surface change.

## Pull-request experience before

The merged Action printed terminal output and optionally created an HTML file.
The documented workflow uploaded the file. It did not write
`GITHUB_STEP_SUMMARY`, create a check summary, or create/update a PR comment.

The merged PR #5 supplies a live example: it has no ProofDiff comment, and its
completed check-run objects have `output.title`, `output.summary`, and
`output.text` all null. A reviewer has to enter the job log or download the
artifact to find the evidence state.

## Pull-request experience after

The Action writes one native job summary by default. It needs no API call and no
write permission. The summary includes:

- overall state, changed-file count, highest risk, and status counts;
- whether repository-defined code ran;
- a bounded per-file line for the exact existing status;
- passing target observations, attributed failures, zero/skipped/unavailable
  observations, static-only relationships, or no supported relationship;
- up to three bounded analysis notes and a context-aware next step;
- the explicit boundary that a target pass is not changed-code execution or
  correctness;
- direction to logs and the configured HTML artifact for full provenance.

It shows at most 12 files and 3 paths per file by default. Renderer-level caps
allow no more than 50 files and 10 paths per file, and individual untrusted text
fields are truncated. Repository-controlled text is escaped and bidirectional
format controls are removed. Absolute HTML-report paths are reduced to their
basename.

The summary excludes source text, symbol names, commands, check output,
qualification explanations, observer payloads, repository roots, and absolute
paths. It is still repository-sensitive because changed and target paths remain
visible to anyone who can access the workflow run.

## Real-repository observations

The complete ten-case pinned external corpus was rerun static-only at the
implementation commit. Results remain 9/9 clearly expected relationships found
plus one intentionally ambiguous large-repository case; all assessments remain
`unknown`, every check remains `not-run`, and `repositoryCodeExecuted` remains
false. Single-host durations were 169–2,168 ms.

The new concise surface was also rendered directly for three unfamiliar pinned
repositories with syntax-preserving mutations:

| Repository case | Concise result | Useful distinction |
| --- | --- | --- |
| p-map root source | `Unknown` | Names root `test.js` and the second test-like path as static-only, not executed |
| Flask configuration source | `Unknown` | Shows three of 39 related paths, then `+36 more`; no false runtime claim |
| TypeScript inventory-tail test | `Unknown` | Initial render exposed that the 5,000-file cap was missing from the summary |

The TypeScript observation caused a correction before delivery: bounded report
notes are now retained, so an `Unknown` result does not lose the reason visible
in terminal/HTML output. A regression asserts the exact 5,000-file limitation.

## Adversarial communication checks

Focused semantic coverage asserts:

- a positive exact target is described as a target observation only;
- static-only relationships never say that a test ran;
- zero-test, skipped, and unavailable observations remain non-strengthening;
- attributed and unattributed relevant failures remain visible;
- a mixed pass plus failure does not let the pass erase the failure;
- a partially localized process failure separately names attributed failures,
  unavailable related targets, and independently passing targets;
- an execution request with no supported checks does not recommend merely
  enabling execution again;
- hostile HTML/Markdown, newlines, control characters, bidirectional controls,
  excessive paths, notes, and absolute repository paths are escaped, removed,
  redacted, or bounded;
- the GitHub renderer never includes symbols, source, commands, or check output.
- malformed metadata parse errors use a fixed report note, while the summary
  projects only fixed safe note categories and reduces all other diagnostics to
  a count; parser source excerpts cannot enter the job summary.

## Compatibility and trust effect

- `schemaVersion: "1.0"`, status names, evidence computation, and failure
  policies are unchanged.
- `--github-summary <file>` is additive.
- Action input `job-summary` defaults to `true` and accepts `false` to disable.
- The documented workflow keeps `permissions: contents: read`.
- No network call, PR comment, token, source upload, telemetry, or repository
  execution was added.
- Summary generation is linear in the already bounded displayed subset and does
  not change repository analysis time materially.

## Remaining limitations

- A native job summary is visible from the workflow/check surface, not inline
  in the PR conversation. Direct comments remain deferred because safe fork
  behavior, update identity, write permission, and spam prevention need a
  separate design.
- GitHub does not provide a stable pre-upload artifact URL to this composite
  step, so the summary names the configured HTML report rather than inventing a
  link. The documented upload remains the deep-inspection path.
- The job summary does not add runners, relationships, runtime observations, or
  coverage. Unsupported evidence stays unsupported.
- Released tag `v0.1.0` predates the summary; users need a subsequent release or
  reviewed immutable post-merge SHA before the Action behavior is available.
- Local report self-exclusion and richer terminal next-step guidance remain
  separate first-run work.
