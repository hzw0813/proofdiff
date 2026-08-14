# Verification model

ProofDiff answers “what evidence exists?” It does not answer “is this safe?” with a probability or guarantee.

## Facts, relationships, and inference

Facts are directly observed: Git changed a path, a parser found a declaration or name-only call site, a user supplied a specific source-to-test declaration, or a command exited with a particular code. Call sites are filtered to changed lines and do not claim target resolution or runtime execution.

Static relationships are reproducible but incomplete: file A imports file B; a test reaches a changed file through resolvable local imports. They are labeled medium confidence because they do not show that a runtime path executed.

For JavaScript/TypeScript, “resolvable local imports” includes relative paths plus two bounded metadata-backed subsets: exact/single-wildcard compiler `paths` mappings and exact self-references through the importing package's own `name` and `exports`. A matched `paths` target is resolved only through documented explicit-extension substitution, or through extensionless file/index lookup when Bundler or Node10 is explicitly configured. NodeNext-family extensionless lookup is context-sensitive and remains unresolved. ProofDiff records the metadata path, matched key, mechanism, target, and limitation internally. This stronger static evidence does not say that a runtime, bundler, or test runner used the same mapping.

A user-declared relationship is a different provenance source. `--test-map` accepts bounded JSON that names an exact source path and one or more exact repository-relative test-like source paths. ProofDiff records that the user declared those paths related; it does not independently attest that the semantic relationship is true. The declaration is not runner qualification, target execution, changed-code coverage, assertion relevance, or correctness. It exists to bridge relationships the bounded static graph cannot infer without asking ProofDiff to guess.

The map format is deliberately narrow: version `1`, at most 1,000 source relationships, at most 100 test paths per source, at most 5,000 total test paths, and at most 256 KB. Test paths must be Git-visible supported source files and match ProofDiff's test-like path rules. Absolute/escaping/control-character paths, duplicate sources, duplicate tests, self-relations, stale test paths, unsupported fields, malformed JSON, oversized inputs, and symbolic-link map artifacts are rejected as a whole rather than partially accepted. Test-map Git visibility is validated independently from the 5,000-file static-analysis slice, so a large repository does not make a later legitimate test path appear stale merely because graph analysis was truncated.

Repository-local declaration data has an additional snapshot trust boundary. For immutable `base` and `range` selections, the current repository-local map must match the selected target commit's bounded JSON declarations; for `staged`, it must match the index. A repository-local map modified by the same immutable selected diff is rejected even when its final JSON would otherwise validate. This prevents the change being evaluated from authoring or substituting the relationship policy that strengthens that same immutable change. A map outside the repository is treated as an explicit external trust input rather than silently bound to repository history. Mutable working-tree analysis still permits a map being edited alongside the code for local iteration, but reports that the declaration is not pre-existing review policy.

“Test-like path” and “runnable test target” are separate facts. Broad path shapes help find static relationships, including root `test.js` and `unittests/`, but never authorize execution. Declaring a path in `--test-map` likewise does not authorize it as runnable. A recognized runner's documented convention, supported configuration, exact file list, or a bounded exact-supply rule must independently qualify a target.

Inference ranks review attention: broad changes, missing related tests, deleted code, dependency files, parser fallbacks, and security-sensitive paths raise the score. Risk is not failure probability.

## Status algorithm

For each changed file, the stable JSON status algorithm is:

1. A genuine applicable failure, error, or timeout yields **Verification failed**. In a targeted batch, pass/failure is attributed only to the associated path.
2. `verified`, displayed as **Related test file passed**, requires all of: supported relationship provenance (bounded static discovery or an explicit user-declared relationship), runner qualification, explicit target supply, at least one non-skipped test observed for that exact target, a successful per-target outcome, and no relevant failure. A declaration establishes only that the user named the relationship; it does not strengthen any later step.
3. Other applicable passing commands yield **Partially verified**. A target observed with zero tests, only skipped tests, or no trustworthy record cannot strengthen evidence; it is partial only when another applicable command passed, otherwise unverified.
4. If checks ran but none applied successfully, the result is **Unverified**.
5. If no applicable checks ran, the result is **Unknown**.

The overall JSON result is `verification-failed` if any file failed, `verified` only if every file has a related test-file pass, `unverified`/`unknown` if every file has that same state, and `partially-verified` for mixed results.

Terminal, JSON, HTML, and GitHub job-summary output are projections of this same algorithm. The job summary does not recompute, infer, or strengthen evidence; it presents a bounded per-file subset and directs users to the detailed reports.

The `verified` machine value is retained for schema compatibility; it is not a runtime-coverage claim. A file labeled **Related test file passed** can still contain bugs, a wrong user-declared relationship, missing assertions, unexecuted symbols, lines, or branches, environmental differences, flaky behavior, or threats outside the discovered graph.

ProofDiff can consume an explicitly supplied LCOV artifact with a declared commit that matches the selected target to add artifact-reported changed-line coverage evidence without executing repository code itself. This is additive evidence and does not change the historical `verified` status algorithm above. The artifact is accepted only when its supplied commit resolves exactly to the committed target of the selected diff. Working-tree/staged selections, commit mismatches, malformed artifacts, ambiguous/out-of-repository paths, and parser bounds fail closed.

The primary evidence ladder is:

1. changed file observed;
2. related test-like path identified through supported static discovery or explicit declaration provenance;
3. exact path qualified and supplied to a recognized runner;
4. at least one non-skipped test observed passing for that target;
5. changed symbol executed;
6. changed lines or branches executed;
7. relevant assertions exercised;
8. behavior shown correct.

ProofDiff's primary evidence boundary follows this ladder and currently stops at level 4. A user declaration can supply provenance at level 2 only; it cannot advance levels 3 or 4. Supplied LCOV is reported on a separate additive coverage-evidence axis and does not advance the primary boundary or imply that earlier ladder levels were satisfied. When the user-declared coverage commit matches the selected target commit, ProofDiff can report which changed current lines the artifact says received hits. ProofDiff does not independently attest the artifact's provenance, and LCOV does not establish symbol identity, branch execution, test relevance, assertion relevance, or correctness. Partial coverage is reported as partial rather than generalized.

The evidence boundary is also the main guidance mechanism. If no relationship is inferred, the safe next action may recommend a bounded `--test-map` when the user already knows an exact relationship. If a relationship is declared but cannot be runner-qualified, the boundary stops at `runner-qualification` and explicitly says the declaration does not bypass that gate. If a target is qualified but checks were not executed, it stops at `target-invocation`. This keeps UNKNOWN/UNVERIFIED actionable without upgrading weaker evidence.

Runner semantics are deliberately narrow:

- Node `--test` qualifies documented default file patterns, exact file lists from the discovered command, and existing unambiguous compiled-source mappings. It uses an owned data-URL reporter over `TestsStream` file summaries. Supported name/skip filters are preserved, so filtered-to-zero is observed as zero rather than a pass. Arbitrary paths under `tests/` do not qualify by directory alone.
- Jest support is limited to recognized root scripts whose runner command is `jest` with no extra options other than `--ci` and/or `--runInBand`. The runner may be preceded by up to four literal `NAME=value` assignments, or by a leading `cross-env` followed by those assignments when `node_modules/cross-env/package.json` is locally present. Literal values are preserved in the targeted child process. ProofDiff still requires a local `node_modules/jest` package with a bounded package-declared binary, explicitly supplies the qualified test-like files with `--runTestsByPath`, and asks Jest for a temporary JSON result artifact. Only an exact per-file result with parseable test statuses can strengthen evidence. Missing, oversized, malformed, duplicate, or unmatched results fail closed.
- Vitest support is limited to recognized root scripts `vitest`, `vitest run`, or `vitest --run`, with the same bounded literal environment-prefix and local `cross-env` handling. Literal values are preserved in the targeted child process. ProofDiff requires a local `node_modules/vitest` package with a bounded package-declared binary, explicitly supplies the qualified test-like files in run mode, and asks Vitest for a temporary JSON result artifact. Only results that resolve to already-qualified exact target paths with parseable test statuses can strengthen evidence. Valid multi-project records that repeat the same exact physical target are aggregated with safe-integer counts; any failing duplicate fails that target. Missing, oversized, malformed, overflowed, or unmatched results still fail closed.
- pytest reads bounded, data-only `pytest.toml`, `.pytest.toml`, `pytest.ini`, `.pytest.ini`, `pyproject.toml` (`[tool.pytest]` and `[tool.pytest.ini_options]`), `tox.ini`, and `setup.cfg` configuration in pytest precedence order. `python_files` defaults to `test_*.py` and `*_test.py`. A fixed in-process plugin records per-file call outcomes; exit 5 is treated as no collection, not a genuine test failure.
- unittest uses the default `test*.py` discovery convention and detected test root. A fixed `TestResult` observer records per-file successes, failures, errors, skips, and `testsRun`; unsupported custom loaders remain conservative.

Node, pytest, and unittest observer records travel over a separate bounded control pipe. Jest and Vitest convert their bounded temporary JSON result artifact into the same control-pipe observation schema. Missing, malformed, truncated, or unmatched observations are rejected; duplicate Jest target observations are rejected, while valid duplicate Vitest observations for the same already-qualified exact physical path are aggregated as described above. The repository-wide command remains useful opaque evidence, but cannot lend one target's tests to another target in the same batch.

## Current limitations

- User-declared test maps use exact paths only. They do not support globs, regular expressions, package selectors, generated target discovery, build-tool queries, or semantic predicates. ProofDiff verifies map syntax and test-path visibility, not whether the declared relationship is semantically correct. Repository-local maps used with immutable selections must be pre-existing snapshot-matched declaration data; mutable working-tree maps are explicitly weaker governance provenance.
- Coverage ingestion is currently limited to explicitly supplied LCOV plus a user-declared commit that must resolve to the selected target. ProofDiff verifies that equality but does not independently attest artifact provenance. Changed-line reconstruction is capped at 50,000 current lines per file and otherwise remains unmeasured. ProofDiff does not run coverage tools, merge artifacts from different commits, remap source maps, guess CI workspace prefixes, or claim branch/assertion coverage.
- Compiler resolution is intentionally partial: NodeNext-family extensionless paths, directory package metadata, non-default `moduleSuffixes`, Classic lookup, package or array `extends`, project references, standalone `baseUrl`, `${configDir}`, multiple-wildcard mappings, installed packages, and arbitrary bundler aliases are not resolved.
- Package resolution is intentionally partial: only the importing package's exact self-exports under an explicit export-aware compiler mode are considered. Hidden package boundaries, versioned or unmodeled conditions, export patterns/arrays, package imports, workspace dependencies, third-party packages, and `node_modules` are not resolved. Compiler aliases also require bounded evidence that the selected config includes the importer.
- Python namespace packages and dynamic imports may be missed.
- Root project scripts are discovered; monorepo package scripts are only noted.
- Jest/Vitest exact-target support does not interpret shell substitution or chaining, duplicate or more than four environment assignments, `cross-env-shell`, `dotenv`, `concurrently`, arbitrary wrappers, custom runner options/config shapes, workspace package scripts, or package-manager layouts that do not expose the runner as a local `node_modules/<runner>` package. Those cases remain ordinary opaque checks rather than being guessed. A test-map declaration can name a relationship in these repositories, but it cannot make an unsupported runner command exact-target-capable.
- Deleted symbols are inferred only from recognizable removed declarations.
- File-scoped observations prove only that a qualified target produced non-skipped tests with the recorded outcome; they do not prove which changed symbols, lines, branches, assertions, or runtime paths executed.
- Mocha, AVA, Hereby, custom unittest loaders, and additional languages/runners remain unsupported for exact per-target evidence. Finding or declaring a test relationship does not add runner support.

Each applicable limit is surfaced in the report.
