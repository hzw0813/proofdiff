# Architecture

ProofDiff is a single-process, local-first Node.js application. The pipeline is intentionally linear so every report claim can be traced to its source.

```text
Git selection → changed files/hunks → language adapters → local import graph
      ↓                                      ↓
check discovery → target qualification → per-target observation
                                             ↓
                               evidence aggregation → risk + reports
```

## Modules

- `src/git.ts` uses `git` argument arrays without a shell. It validates revisions, parses NUL-delimited paths, includes untracked files for the default selection, and extracts zero-context hunk ranges. Read commands suppress hooks, filesystem monitors, external diff/text conversion, and configured content drivers.
- `src/adapters/` contains the small `LanguageAdapter` boundary. JavaScript/TypeScript use `@babel/parser`. Python sends source text to `python -I -S` and the standard `ast` module; it does not import repository modules. Built-in adapters retain line-numbered call sites so reports can show structural call references that intersect changed lines.
- `src/graph.ts` resolves only local, statically identifiable imports. It builds reverse dependencies for impact estimates and broad test-like relationship discovery. Test-like path heuristics do not establish runnable identity.
- `src/checks.ts` discovers a deliberately narrow set of conventional root checks. It independently qualifies impacted paths from Node, pytest, or unittest rules/configuration, retains the qualification basis, and constructs explicit invocations. Owned runner observers write exact per-target counts to a separate bounded control pipe; malformed or unmatched records are rejected. Execution is impossible unless the API caller opts in or the CLI receives `--run-checks`.
- `src/process.ts` starts commands without a shell, bounds stdout/stderr and the observer control pipe separately, enforces timeouts, and terminates process trees.
- `src/evidence.ts` applies the documented status model and calculates a transparent review-priority score. Evidence items include their source, confidence, and limitations.
- `src/report/` renders terminal and self-contained HTML reports from the same typed report object.
- `src/analyze.ts` orchestrates the pipeline and exposes the public API.

## Design decisions

### Local static relationships, not runtime coverage

Import reachability is useful for locating likely tests and dependents, but dynamic loading, dependency injection, reflection, aliases, subprocesses, and framework conventions can escape it. ProofDiff calls this an estimate and never labels it coverage.

Call sites are name-only parser facts, not a resolved interprocedural call graph. ProofDiff reports them only when their source line intersects the diff and states that target resolution and runtime execution are not implied.

### Explicit execution boundary

Test files are programs. Package scripts are shell programs. Automatically running them while merely inspecting an unknown repository would violate ProofDiff's trust model. Static analysis is the safe default; `--run-checks` is explicit consent. Output caps, timeouts, process-group termination, environment minimization, and redaction reduce risk but are not sandboxing.

### Relationship, identity, and observation stay separate

A path under `tests/` can be a fixture or setup module, and a successful runner process can execute zero tests. ProofDiff therefore keeps three reviewable layers: static test-like relationship, runner-qualified target identity, and runner-native per-target observation. Only a positive non-skipped observation for the exact qualified path can strengthen evidence. In a batch, observations are joined by normalized target identity so one file's tests cannot lend evidence to another.

### Small adapter interface

An adapter identifies symbols, imports, calls, diagnostics, and its confidence. Repository traversal, evidence, reporting, and Git behavior remain language-independent. This is enough for the current three languages without predicting every future parser's needs.

### No database or hosted service

Every report is derived during one run and can be serialized as JSON or HTML. There is no telemetry, source upload, cache daemon, or hidden state.

## Data flow and limits

- Files larger than 1 MB and binary files are not parsed.
- At most 5,000 repository files are structurally analyzed per run.
- Reverse-impact traversal is capped at 250 files per changed file.
- Check stdout/stderr defaults to 256 KB, runner observations are separately capped at 64 KB, and check duration defaults to 120 seconds.
- Limits are reported rather than silently treated as successful analysis.

The machine-readable contract is `AnalysisReport` in `src/types.ts`; `schemaVersion` changes when that contract becomes incompatible.

Truthful demo generation and its asserted scenarios are documented in `docs/demo-scenarios.md`.
