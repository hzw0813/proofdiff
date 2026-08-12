# Contributing

Thanks for helping make change verification more trustworthy.

## Setup

Prerequisites: Git, Node.js 22+, npm, and optionally Python 3.9+.

```bash
npm ci
npm test
npm run demo
```

Before submitting a change, run:

```bash
npm run typecheck
npm test
npm run test:action
npm run dogfood
npm pack --dry-run
```

## Expectations

- Add observable-behavior tests for fixes and features.
- Preserve the static-only default and never turn inference into a proof claim.
- Label confidence and limitations when adding heuristics.
- Avoid dependencies unless their value exceeds their installation, security, and maintenance cost.
- Update documentation and the changelog when user-visible behavior changes.
- Never put real tokens, private repository content, or personal data in fixtures.

## Adding a language adapter

Implement `LanguageAdapter` from `src/adapters/types.ts`, register it in `src/adapters/index.ts`, and add parser, graph-resolution, malformed-input, and end-to-end tests. An adapter must return diagnostics and reduced confidence when it cannot parse safely. Unsupported syntax must degrade gracefully.

## Pull requests

Keep changes focused. Describe the user-visible problem, the evidence supporting the solution, and the verification you ran. Security-sensitive changes should include an adversarial test. By contributing, you agree that your contribution is licensed under MIT.
