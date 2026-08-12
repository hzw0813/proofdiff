# Contributor automation guidance

- Read `ARCHITECTURE.md`, `SECURITY.md`, and `docs/verification-model.md` before changing evidence semantics or command execution.
- Preserve the no-execution default. Never add automatic repository command execution.
- Use argument-array process execution, never a shell, for Git and parser operations.
- Every heuristic must identify its confidence and limitations in reports.
- Run `npm run typecheck`, `npm test`, `npm run dogfood`, `npm run demo`, and `npm pack --dry-run` before release-oriented changes.
- Generated demo artifacts must come from `scripts/generate-demo.mjs`; do not hand-edit results.
