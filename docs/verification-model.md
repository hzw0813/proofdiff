# Verification model

ProofDiff answers “what evidence exists?” It does not answer “is this safe?” with a probability or guarantee.

## Facts, relationships, and inference

Facts are directly observed: Git changed a path, a parser found a declaration or name-only call site, or a command exited with a particular code. Call sites are filtered to changed lines and do not claim target resolution or runtime execution.

Static relationships are reproducible but incomplete: file A imports file B; a test reaches a changed file through resolvable local imports. They are labeled medium confidence because they do not show that a runtime path executed.

“Test-like path” and “runnable test target” are separate facts. Broad path shapes help find static relationships, including root `test.js` and `unittests/`, but never authorize execution. A recognized runner's documented convention, supported configuration, exact file list, or unambiguous compiled-source mapping must independently qualify a target.

Inference ranks review attention: broad changes, missing related tests, deleted code, dependency files, parser fallbacks, and security-sensitive paths raise the score. Risk is not failure probability.

## Status algorithm

For each changed file, the stable JSON status algorithm is:

1. A genuine applicable failure, error, or timeout yields **Verification failed**. In a targeted batch, pass/failure is attributed only to the associated path.
2. `verified`, displayed as **Related test file passed**, requires all of: a static relationship, runner qualification, explicit target supply, at least one non-skipped test observed for that exact target, a successful per-target outcome, and no relevant failure.
3. Other applicable passing commands yield **Partially verified**. A target observed with zero tests, only skipped tests, or no trustworthy record cannot strengthen evidence; it is partial only when another applicable command passed, otherwise unverified.
4. If checks ran but none applied successfully, the result is **Unverified**.
5. If no applicable checks ran, the result is **Unknown**.

The overall JSON result is `verification-failed` if any file failed, `verified` only if every file has a related test-file pass, `unverified`/`unknown` if every file has that same state, and `partially-verified` for mixed results.

The `verified` machine value is retained for schema compatibility; it is not a runtime-coverage claim. A file labeled **Related test file passed** can still contain bugs, missing assertions, unexecuted symbols, lines, or branches, environmental differences, flaky behavior, or threats outside the discovered graph.

ProofDiff currently stops at the fourth level in this evidence ladder:

1. changed file observed;
2. statically related test-like path identified;
3. exact path qualified and supplied to a recognized runner;
4. at least one non-skipped test observed passing for that target;
5. changed symbol executed;
6. changed lines or branches executed;
7. relevant assertions exercised;
8. behavior shown correct.

Levels 5–8 are not observed today. Successful file-scoped test execution must not be interpreted as evidence for them.

Runner semantics are deliberately narrow:

- Node `--test` qualifies documented default file patterns, exact file lists from the discovered command, and existing unambiguous compiled-source mappings. It uses an owned data-URL reporter over `TestsStream` file summaries. Supported name/skip filters are preserved, so filtered-to-zero is observed as zero rather than a pass. Arbitrary paths under `tests/` do not qualify by directory alone.
- pytest reads bounded, data-only `pytest.toml`, `.pytest.toml`, `pytest.ini`, `.pytest.ini`, `pyproject.toml` (`[tool.pytest]` and `[tool.pytest.ini_options]`), `tox.ini`, and `setup.cfg` configuration in pytest precedence order. `python_files` defaults to `test_*.py` and `*_test.py`. A fixed in-process plugin records per-file call outcomes; exit 5 is treated as no collection, not a genuine test failure.
- unittest uses the default `test*.py` discovery convention and detected test root. A fixed `TestResult` observer records per-file successes, failures, errors, skips, and `testsRun`; unsupported custom loaders remain conservative.

Observer records travel over a separate bounded control pipe. Missing, malformed, truncated, duplicate, or unmatched records are rejected. The repository-wide command remains useful opaque evidence, but cannot lend one target's tests to another target in the same batch.

## Current limitations

- ProofDiff does not ingest runtime code coverage.
- JavaScript package aliases and TypeScript `paths` mappings are not resolved.
- Python namespace packages and dynamic imports may be missed.
- Root project scripts are discovered; monorepo package scripts are only noted.
- Deleted symbols are inferred only from recognizable removed declarations.
- File-scoped observations prove only that a qualified target produced non-skipped tests with the recorded outcome; they do not prove which changed symbols, lines, branches, assertions, or runtime paths executed.
- AVA, Vitest, Jest, Mocha, Hereby, aliases, package exports, custom unittest loaders, coverage, and additional languages/runners remain unsupported.

Each applicable limit is surfaced in the report.
