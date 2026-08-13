# GitHub change-evidence summary decision

## Baseline and user experience

This decision starts from merged `main` at `cf02d31ee86be3b051d77d93123b4236c3e0fd1e`.

ProofDiff's local terminal and HTML reports expose the evidence model, but the
composite GitHub Action only writes the terminal report to the step log and an
HTML file to the workspace. The documented workflow uploads that HTML file as
an artifact. A reviewer therefore has to open a job log or download an artifact
to learn which changed files have observed target evidence, which have only a
static relationship, and which remain unknown.

This is observable on the merged PR #5: the pull request has no ProofDiff
comment, and the completed check runs have no check output title, summary, or
text. The Action requires only `contents: read`.

The 30-second local test also found first-run friction: a static-only run is
truthful but leaves the next action in prose, and a generated HTML report in the
repository appears as an untracked changed file on the next run. That is a real
CLI polish issue, but it is separate from making existing Action evidence
visible where review happens.

## Candidate directions

### First-run and CLI experience

The terminology is careful and the default makes the no-execution boundary
visible. Clearer next steps and excluding an explicitly generated report from a
subsequent working-tree analysis would improve local adoption. This affects
initial use, but it does not solve the current CI retention problem: installed
Action users still have to dig through logs and artifacts.

### GitHub pull-request experience

This has the highest immediate value. Every Action run already has the complete
structured report, yet the review surface exposes none of it. A concise native
job summary can show the per-file evidence state without changing evidence
semantics or executing more code. GitHub documents `GITHUB_STEP_SUMMARY` as a
per-step Markdown file whose content is grouped into the job summary, expressly
so important results can be read without opening logs:

<https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#adding-a-job-summary>

A pull-request comment was considered and deferred. It needs write-capable API
access and stable comment identity/update logic, while fork pull requests often
receive read-only tokens. GitHub recommends least-privilege `GITHUB_TOKEN`
permissions. A job summary preserves the Action's current `contents: read`
example, produces one stable surface per job, and cannot spam the PR timeline:

<https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication>

### Real-repository compatibility

The final pinned static corpus finds all nine clearly enumerated relationships;
the tenth case is intentionally ambiguous at the large-repository cap. Only
three of ten cases have targeted runner definitions, so runner breadth remains
a meaningful limitation. However, AVA, Vitest, Borp, Makefile, Hereby, and
custom unittest support each require runner-specific qualification and runtime
observation work. No single bounded compatibility mechanism currently has
evidence strong enough to beat a surface that improves every Action run.

### Stronger runtime evidence

The repository's own coverage gate emits Node's textual coverage report and no
provenance-bearing artifact. ProofDiff has no evidence tying a prospective
coverage file to the selected commit, command, target set, freshness, source-map
transform, or partial/full-suite scope. Ingesting ordinary LCOV-like data would
therefore risk turning stale or unrelated execution into changed-code evidence.
Research remains valuable, but production support is not yet sound.

## Decision

Add a concise, bounded GitHub Actions job summary generated from the same
`AnalysisReport` as terminal, JSON, and HTML output.

The summary will:

- show the overall evidence state, changed-file count, risk, and whether
  repository code ran;
- show each changed file's exact status;
- distinguish observed passing targets, other target outcomes, static-only
  related paths, and no supported relationship;
- state that a related target pass is not changed-code execution or correctness;
- cap file and path detail while directing users to logs and the configured HTML
  report for full provenance;
- escape repository-controlled text before Markdown rendering;
- contain no check output, source snippets, symbols, absolute repository paths,
  or observer payloads.

The composite Action will enable the summary by default with an additive boolean
input to disable it. It will keep `contents: read`, will not call the GitHub API,
and will not create or update a pull-request comment. The CLI will expose an
explicit output-file option so the renderer is deterministic and testable
outside GitHub.

## Deferred work

- Local next-action guidance and generated-report self-exclusion.
- Pull-request comments, check annotations, and direct artifact links.
- New runners or test layouts.
- TypeScript project references, package imports, and export patterns.
- Coverage or other runtime-artifact ingestion.

These remain separate product decisions. This slice changes how existing
evidence is presented, not what ProofDiff claims.
