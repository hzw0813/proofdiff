# TypeScript `paths` probing blocker: soundness review findings

## Evaluation identity

- Product baseline: clean `main` at `9f59523f9c2bc7e513bf0f7379c6f5111c6846ae`.
- Original PR implementation candidate: `342ee543c06c7ad90e82e525fe8fee0afe8f4b98`.
- Independent-review blocker decision: [`TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md`](TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md).
- Clean corrected candidate evaluated here: `311158441acf8c1e9d7527d9ff912cc79fc5fcab`.
- Pull request: [#5](https://github.com/hzw0813/proofdiff/pull/5).

The preserved historical `results.json`, `controlled-results.json`, and their schemas remain unchanged. The corrected candidate observations replace only the separately named static-resolution candidate artifacts.

## User problem and reproduced failure

The original PR used one generic filename-probing list after TypeScript `paths` substitution. That could tell a reviewer that a test was statically related to changed code even when the repository's configured TypeScript resolver did not connect them.

Minimal repositories were checked against the pinned TypeScript 5.9.3 compiler with trace resolution and against the original ProofDiff candidate. The original candidate created false edges for:

- NodeNext ESM `@foo -> ./src/foo` when only `src/foo.ts` exists; TypeScript reports TS2307;
- `@foo -> ./src/foo.mjs` when only `src/foo.ts` exists; TypeScript accepts only the `.mts`/`.d.mts`/`.mjs` substitution family;
- a Bundler directory target whose `package.json` selects a different `types` file before `index.ts`;
- a non-relative `paths` target without `baseUrl`, which TypeScript rejects with TS5090.

These are false static relationships, so lower confidence would not make them safe.

## Corrected supported semantics

The candidate now separates path-key selection from bounded post-substitution lookup:

- `.js`, `.jsx`, `.mjs`, and `.cjs` targets use TypeScript's distinct documented extension-substitution families and ordering;
- extensionless file and directory lookup is accepted only for an explicitly configured `bundler`, `node10`, or `node` mode;
- Node16/NodeNext-family, Classic, missing, and unknown modes block extensionless lookup because ProofDiff does not know the import-versus-require resolution context;
- directory `package.json`, exact physical extensionless files, omitted MTS/CTS-family files, unsupported extensions, and non-default `moduleSuffixes` block fallback instead of being guessed around;
- without `baseUrl`, target strings must be explicitly relative;
- package self-export targets receive exact extension substitution only, never extensionless or directory probing.

Every accepted edge remains static-only and retains the configuration-backed resolution mechanism. Public schema `1.0`, status names, CLI flags, Action inputs, and runtime evidence semantics are unchanged.

## Adversarial regressions

The resolver suite now attacks both positive and negative boundaries:

- NodeNext ESM extensionless files and directories remain unresolved;
- NodeNext `.js -> .ts`, `.mjs -> .mts`, and `.cjs -> .cts` work, while `.mjs -> .ts` does not;
- Bundler and Node10 extensionless file/index lookup works;
- a missing resolution mode, invalid target anchoring, unsupported extension, omitted MTS/CTS extension, directory package metadata, and non-default module suffixes all fail closed;
- an explicit empty suffix list remains supported;
- package self-exports cannot acquire an extensionless edge;
- higher-precedence hidden or competing files still prevent a lower fallback edge;
- Windows normalization, containment, symlink, inheritance, package-boundary, and bound-exhaustion protections remain covered.

A sixteenth controlled evaluation case combines the two strongest counterexamples: NodeNext ESM extensionless lookup and an invalid `.mjs -> .ts` substitution. Both changed files remain `unknown`, neither gains the related test, neither gains execution evidence, and repository code is not executed.

## Controlled evaluation before and after

| Observation | Original PR candidate | Corrected candidate |
| --- | ---: | ---: |
| Existing controlled cases passed | 15/15 | 15/15 |
| New unsupported-probing negative case | absent | passed |
| Total corrected controls | 15 | 16/16 |

Existing positive aliases, package self-exports, qualified target passes, helpers, zero/filtered/skipped targets, genuine failures, mixed-batch attribution, unittest outcomes, opaque commands, and unsupported-language observations did not change.

## External corpus before and after

All ten pinned external cases were rerun static-only without dependency installation or `--run-checks`.

| Classification | `main` baseline artifacts | Original PR candidate | Corrected candidate |
| --- | ---: | ---: | ---: |
| Clearly expected found | 5 | 9 | 9 |
| Clearly expected missed | 4 | 0 | 0 |
| Ambiguous | 1 | 1 | 1 |

The Zod package self-export remains justified because its selected target names an explicit `.ts` file. The Vitest alias remains justified because its owning configuration explicitly uses Bundler resolution. All other semantic corpus observations are unchanged. Every assessment remains `unknown`, every check remains `not-run`, and every case records `repositoryCodeExecuted: false`.

Corrected single-host static-analysis times were 184–2,155 ms across the ten repositories. The 5,000-file TypeScript clear and cap-tail cases took 2,155 ms and 2,087 ms respectively. These are operational observations, not portable benchmarks; no material resolver expansion was added.

## User experience and trust effects

Before, a configuration-shaped import could produce a plausible but compiler-inconsistent relationship. After, supported relationships state the actual bounded lookup basis; unsupported resolution contexts remain actionable unknowns rather than invented edges. The default terminal and HTML reports continue to label the PR diff static-only, show related test-like paths where justified, and state that no repository code executed.

The change adds no network behavior, dependency installation, configuration execution, module loading, or repository-code execution. It reads the same bounded repository-local metadata and generally probes fewer candidates.

## Full validation

On macOS arm64 with Node 24.15.0:

- typecheck passed;
- 77/77 tests passed;
- coverage passed at 89.65% lines, 81.36% branches, and 92.52% functions;
- GitHub Action smoke passed for production-only install, static default, trusted checks, base diff, and HTML output;
- dogfood passed with one related test-file pass and all four executed checks passing;
- four truthful demo scenarios regenerated and passed;
- normal and scripts-disabled package dry-runs passed; the package contains only `dist`, README, LICENSE, and package metadata;
- preserved and candidate evaluation validation passed; the candidate has 10 external and 16 controlled observations;
- the full pinned external corpus passed its manifest, trust-boundary, and clean-candidate checks;
- terminal and self-contained HTML reports were inspected;
- generated-artifact, local-path, secret-signature, package-content, and `git diff --check` audits passed.

Hosted Linux/macOS/Windows and Node-version results are recorded on PR #5 after the corrected candidate is pushed.

## Remaining limits and next review target

The candidate deliberately misses valid Node16/NodeNext CommonJS extensionless aliases because the current import evidence does not preserve exact resolution mode. It also does not model directory package metadata, non-default module suffixes, arbitrary extensions, Classic extensionless lookup, package imports, workspace dependency linking, project references, or package-based `extends`.

The next action is independent adversarial review of PR #5, specifically looking for a remaining way to create a false static edge through post-substitution precedence. No unrelated semantic feature should begin before that review is accepted and the PR is merged by a maintainer.
