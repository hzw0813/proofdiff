# Sensitive runner environment prefixes

ProofDiff v0.4.1 and later can preserve a bounded set of literal environment prefixes when it derives exact-target Jest or Vitest execution from a recognized root script. Preserving the repository script's environment keeps the targeted execution closer to the command the repository actually defines; it is not a sandbox or a safety boundary.

Some accepted environment variables can materially change process or child-process behavior. When a recognized targeted Jest/Vitest script propagates `PATH`, `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, or a `DYLD_*` variable, ProofDiff keeps the assignment but adds an explicit warning to the targeted check provenance. The warning records variable names only and does not copy their values into the provenance text.

This qualification does not weaken or strengthen evidence. Exact target identity, non-skipped passing observation, failure attribution, and the meaning of **Related test file passed** remain unchanged. `schemaVersion: "1.0"` remains unchanged.

`--run-checks` still executes trusted repository-defined code with the current operating-system permissions. Sensitive environment prefixes can affect code launched by the tests themselves, so users should review the repository script and execute checks only inside an environment appropriate for that repository's trust level.
