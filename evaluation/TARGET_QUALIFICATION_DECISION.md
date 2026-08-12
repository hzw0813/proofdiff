# Test-target evidence boundary decision

## Current invariant

ProofDiff currently upgrades a changed file to `verified` when a path classified as a test is statically related to the change, is supplied to a recognized runner, and the process exits successfully.

## Observed failure

A support module under `tests/fixtures/` is classified as a test by directory alone. `node --test` accepts that path and exits successfully even though the module declares no tests, allowing the related source file to become `verified`.

## Root cause

Static test-like relationship, runnable-target identity, supplied target, process success, and per-target test execution are collapsed into one path heuristic and one process status.

## What ProofDiff currently knows

ProofDiff knows static import reachability, recognized runner shapes, supplied paths, process outcomes, and bounded command output.

## What ProofDiff does not know

It does not know whether a path is a runner-discovered entrypoint, whether each target in a batched command produced a test, or whether tests were filtered or skipped to zero.

## Options considered

1. Broaden or narrow filename and directory heuristics.
2. Treat runner configuration alone as sufficient.
3. Parse ordinary human runner output.
4. Add runtime coverage.
5. Separate static test-like relationships, runner-qualified targets, and runner-native per-target observations.

## Chosen design

Keep path heuristics only for static test-like relationship discovery. Qualify runnable targets independently from recognized runner rules and configuration. Require a successful, non-skipped test observation for the exact target before creating `executed-test` evidence.

## Why

This repairs the false-strength boundary and permits explicit custom conventions without adding coverage or broadening runner support. Runner-owned event/result APIs provide a more stable contract than ordinary terminal output.

## False-positive tradeoff

Helpers may remain visible as related test-like paths, but they cannot authorize targeted evidence without runner qualification and a positive observation for that exact path.

## False-negative tradeoff

Node files containing only top-level assertions, all-skipped targets, unsupported custom runners, and runtimes whose observations cannot be validated remain conservative rather than becoming `verified`.

## Compatibility effect

JSON status names, CLI flags, fail policies, and schema version remain unchanged. Qualification and observation fields are additive. Some prior `verified` outcomes become partial or unverified because their evidence was insufficient.

## Deferred work

AVA, Vitest, Jest, Mocha, Hereby, package and path-alias resolution, runtime coverage, and new language adapters remain separate goals.
