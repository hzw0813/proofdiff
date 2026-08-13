# External evaluation methodology

This evaluation asks a narrow engineering question: **which mechanisms most often prevent ProofDiff from producing useful structural, related-test, check-discovery, or targeted-test evidence in a deliberately varied external corpus?** Its purpose is roadmap selection, not a product score.

The preserved external product observation is commit `a9b721ca7500da4b316c737dbb159ded6e6d3577` (`proofdiff@0.1.0`) in `results.json` and `controlled-results.json`. The evidence-boundary implementation starts from clean `main` at `8871fdcecceda59e0cf16a525dcccf8af65b4393`; candidate artifacts name their evaluated commit separately. The preserved baseline files and schemas are never overwritten by ordinary candidate commands. The harness observes ProofDiff; it must not patch or reconfigure the product under evaluation.

The decision that separates static test-like relationships, runner-qualified targets, and per-target observations is recorded in [`TARGET_QUALIFICATION_DECISION.md`](TARGET_QUALIFICATION_DECISION.md).
The subsequent bounded compiler-path/package-self-export decision is recorded in [`STATIC_MODULE_RESOLUTION_DECISION.md`](STATIC_MODULE_RESOLUTION_DECISION.md).
The independent post-substitution probing review and corrected before/after evidence are recorded in [`TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md`](TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md) and [`TYPESCRIPT_PATHS_PROBING_BLOCKER_FINDINGS.md`](TYPESCRIPT_PATHS_PROBING_BLOCKER_FINDINGS.md).

## Evaluation questions

1. Does the baseline structurally analyze the changed source and the repository files needed for the case without fallback, size truncation, or unsupported-language loss?
2. Given an expected test relationship supported by a reviewable static import chain, does ProofDiff find that test? If not, what exact resolution mechanism prevents it?
3. Which root checks does ProofDiff discover, and do those match the conventional checks a maintainer can identify from repository metadata?
4. When a related test is found, does the discovered runner shape permit ProofDiff to construct an explicit targeted test-file invocation?
5. Which failure mechanisms recur across materially different repository structures, and which single next investment would remove the largest meaningful limitation in this corpus without creating false confidence?

## What can be measured objectively

The following are recorded as observations rather than judgments:

- repository identity, immutable commit, selection type, and exact mutation or commit range;
- Git-listed file count, ProofDiff's 5,000-file truncation note, changed files, language classification, parser identity, confidence, and diagnostics;
- ProofDiff-reported impacted files, related tests, discovered check definitions, target-runner metadata, and whether a targeted definition was constructed;
- whether an expected path and every edge in its documented import chain exist at the pinned revision;
- static-analysis wall time on the evaluation host, labeled as an operational observation rather than a portable benchmark;
- whether the report states that repository code executed. External cases must record `false`.

Counts are reported only with their corpus denominator. They describe this purposive corpus and are not prevalence estimates for GitHub or any ecosystem.

## What requires evaluator judgment

The evaluator chooses cases, decides whether repository documentation identifies a conventional check, and labels the strength of expected test relationships. Relationship review uses these labels:

- `clearly-expected-found`: a documented static import chain connects the test to the changed source and ProofDiff reports the test;
- `clearly-expected-missed`: the same strong evidence exists but ProofDiff does not report the test;
- `plausible-found`: ProofDiff reports a relationship that is structurally credible, but relevance to the synthetic change is not strong ground truth;
- `ambiguous`: evidence is insufficient or conflicting, so the case is not treated as a success or failure;
- `unsupported-pattern`: the relationship depends on a mechanism the baseline explicitly does not model, recorded without implying that all such relationships should be resolved.

An unexpected result is not automatically a false positive or false negative. Strong relationship labels require an explicit, reviewable chain in the corpus manifest. When that cannot be supplied, uncertainty remains in the result.

## Sampling strategy

The corpus is a purposive, maximum-variation sample, not a random sample. Cases are selected for distinct information about the supported JavaScript, TypeScript, and Python ecosystems: relative imports, package-root imports, `src` layouts, aliases, workspace boundaries, conventional and opaque runners, and materially different repository sizes. A repository is included only when it contributes a mechanism not already established by a smaller case.

Sample size is therefore justified by **mechanism coverage and saturation**, not a round target number. Selection stops when the planned support boundaries have at least one ecologically valid external case and further candidates would duplicate an already observed mechanism without improving ground truth. Controlled fixtures validate evaluator behavior but never contribute to claims about real-world prevalence.

## Ground-truth strategy

External relationship expectations are established at the pinned commit from one or more of:

1. a direct static import from a test to the changed source;
2. a short, enumerated transitive import chain whose files and import specifiers are recorded;
3. repository-owned runner configuration or package metadata;
4. direct inspection of the source and test responsibility.

Synthetic mutations are syntax-preserving comments applied to real repository files. They test the repository's real dependency and runner structure but are not historical bugs, behavioral changes, or evidence of maintainer intent. Historical ranges, if used, identify both immutable endpoints and are described separately.

The evaluator records both supporting evidence and uncertainty. This first foundation has one maintainer review; it does not claim inter-rater agreement. The adversarial second pass may weaken labels but must not silently strengthen them.

## Reproducibility strategy

- External repositories are identified by HTTPS URL and immutable commit SHA in `corpus.json`.
- The manifest records every mutation, expected relationship chain, and relevant check metadata.
- Acquisition and execution use a separate, networked evaluation command. The ordinary test suite never clones repositories or requires network access.
- External runs are static-only: no dependency installation, lifecycle script, build, test, linter, typechecker, or other repository code is executed.
- Controlled fixtures run only repository-owned evaluation fixture code and cover runner outcomes that cannot safely be exercised on external input.
- Raw baseline observations are stored once in structured JSON. The findings document is generated from or reconciled against that data to avoid duplicate hand-maintained totals.
- Temporary clones live outside committed artifacts. Third-party source is never vendored.

## Known biases

- Public GitHub repositories are easier to pin and inspect than other forges or private codebases.
- Explicitly reviewable import chains favor static relationships over dependency injection, generated registries, reflection, and runtime dispatch.
- Projects with legible source/test layouts are easier to ground than highly framework-driven applications.
- Syntax-preserving mutations isolate graph behavior but do not represent the distribution of real change sizes or bug types.
- A single evaluation host provides useful scale warnings but not controlled cross-machine performance benchmarks.
- One evaluator cannot establish independent inter-rater reliability; ambiguous cases therefore remain ambiguous.
- The corpus is designed to expose different mechanisms, so its failure counts must not be extrapolated as ecosystem prevalence.

## What this evaluation will not claim

This evaluation will not produce an accuracy, safety, trust, or aggregate benchmark score. It will not claim runtime coverage, assertion relevance, behavioral correctness, representative ecosystem prevalence, or benchmark-quality performance. A test-file relationship is static evidence only. A targeted definition indicates that ProofDiff could construct an invocation; external repositories are not executed to prove that invocation succeeds.

## Security boundary

External cases are untrusted. The harness must invoke ProofDiff without `--run-checks`, verify `trust.repositoryCodeExecuted === false`, avoid package installation, and place clones in an explicit scratch directory. ProofDiff's reduced check environment is not treated as a sandbox. Only controlled fixtures may cross the execution boundary.

## Decision rule for the next priority

Candidate investments are ranked after measurement by: observed cases and severity addressed, evidence completeness gained, false-confidence risk, breadth, user value, maintainability, implementation complexity, regression risk, compatibility, and availability of a rigorous regression oracle. The recommendation must name one investment and cite concrete cases. Existing `ROADMAP.md` entries are hypotheses, not preferred answers.

## Reproducing the baseline

Build the preserved baseline in a clean detached worktree, then run the controlled fixtures against that build:

```sh
git worktree add --detach work/evaluation-baseline a9b721ca7500da4b316c737dbb159ded6e6d3577
npm --prefix work/evaluation-baseline ci
npm --prefix work/evaluation-baseline run build
npm run evaluation:controlled -- --proofdiff-root work/evaluation-baseline --output work/baseline-controlled-check.json
npm run evaluation:validate
```

The controlled command creates temporary evaluator-owned repositories and may execute only their local fixture code. It does not require network access.

External evaluation is deliberately separate from ordinary tests. It requires network access to acquire public repositories at their immutable commits, stores clones only in the explicit ignored scratch directory, applies the manifest's syntax-preserving mutation, and invokes ProofDiff with repository code execution disabled:

```sh
npm run evaluation:external -- \
  --cache work/evaluation-corpus \
  --proofdiff-root work/evaluation-baseline \
  --output work/baseline-external-check.json
npm run evaluation:validate
```

The external runner refuses a dirty ProofDiff candidate worktree, verifies every remote and commit, checks the recorded tracked-file count, and never installs external dependencies or runs external checks. Candidate runs default to `evaluation/results.candidate.json` and controlled runs default to `evaluation/controlled-results.candidate.json`; explicit output paths are still recommended for scratch reruns.

Validate both preserved baseline artifacts and a candidate comparison with:

```sh
npm run evaluation:validate -- \
  --candidate-external evaluation/results.candidate.json \
  --candidate-controlled evaluation/controlled-results.candidate.json
```

`evaluation/results.json` contains one host's wall-clock durations. Reruns should expect those values and `generatedAt` to differ; the relationship, check, trust, and structural fields are the decision evidence. `evaluation/controlled-results.json` uses a fixed clock and deterministic fixtures.
