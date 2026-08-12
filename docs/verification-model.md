# Verification model

ProofDiff answers “what evidence exists?” It does not answer “is this safe?” with a probability or guarantee.

## Facts, relationships, and inference

Facts are directly observed: Git changed a path, a parser found a declaration or name-only call site, or a command exited with a particular code. Call sites are filtered to changed lines and do not claim target resolution or runtime execution.

Static relationships are reproducible but incomplete: file A imports file B; a test reaches a changed file through resolvable local imports. They are labeled medium confidence because they do not show that a runtime path executed.

Inference ranks review attention: broad changes, missing related tests, deleted code, dependency files, parser fallbacks, and security-sensitive paths raise the score. Risk is not failure probability.

## Status algorithm

For each changed file:

1. An applicable failing, errored, or timed-out check yields **Verification failed**.
2. A passing targeted check that explicitly supplied a statically related test file to a recognized runner yields **Verified**.
3. Other applicable passing checks yield **Partially verified**.
4. If checks ran but none applied successfully, the result is **Unverified**.
5. If no applicable checks ran, the result is **Unknown**.

The overall result is failed if any file failed, verified only if every file is verified, unverified/unknown if every file has that same state, and partially verified for mixed results.

This vocabulary describes evidence completeness. A “Verified” file can still contain bugs, missing assertions, unexecuted lines or branches, environmental differences, flaky behavior, or threats outside the discovered graph.

ProofDiff currently creates targeted execution evidence for exact `node --test` package scripts, safe explicit compiled Node test-file lists, a single recognizable compiled-test glob, and discovered `pytest` or standard-library `unittest` projects. Explicit compiled lists are mapped back to source tests only when one unambiguous listed path matches. A passing opaque or filtered repository test script remains partial even when a related test file exists, because ProofDiff did not observe that file executing. The repository-wide check is still retained as useful evidence.

## Current limitations

- ProofDiff does not ingest runtime code coverage.
- JavaScript package aliases and TypeScript `paths` mappings are not resolved.
- Python namespace packages and dynamic imports may be missed.
- Root project scripts are discovered; monorepo package scripts are only noted.
- Deleted symbols are inferred only from recognizable removed declarations.
- Targeted execution proves that a test file was supplied to a runner and the command succeeded; it does not prove which changed lines, branches, assertions, or runtime paths executed.

Each applicable limit is surfaced in the report.
