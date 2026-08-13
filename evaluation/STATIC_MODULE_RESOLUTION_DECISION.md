# Bounded static module resolution decision

> **PR review amendment:** The original design below reused broad generic extension/index probing after `paths` substitution. TypeScript 5.9.3 counterexamples showed that this was unsound for NodeNext ESM, MJS/CJS substitution families, and directory package precedence. [`TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md`](TYPESCRIPT_PATHS_PROBING_BLOCKER_DECISION.md) records the reproduction and the narrower replacement semantics.

## CURRENT INVARIANT

ProofDiff's import graph contains only repository-local paths that it can identify statically. A graph edge may establish a test-like relationship, but it does not establish runnable-test identity or runtime execution. The `verified` status still requires independent runner qualification, explicit target supply, a positive per-target observation, process success, and no relevant failure.

The implementation baseline is clean `main` at `9f59523f9c2bc7e513bf0f7379c6f5111c6846ae`. Its typecheck and 65-test suite pass. Its pinned static-only evaluation reproduces both cases below as `clearly-expected-missed`, with external repository execution disabled.

## OBSERVED MISS

- In pinned Zod, `packages/zod/src/v3/tests/string.test.ts` imports `zod/v3`. The nearest owning `packages/zod/package.json` names the package `zod` and maps exact export `./v3` to a conditional `@zod/source` target, `./src/v3/index.ts`. The owning `packages/zod/tsconfig.json` activates that custom condition. The remaining relative chain reaches `packages/zod/src/v3/types.ts`, but the first bare specifier produces no edge.
- In pinned Vitest, `test/unit/test/error.test.ts` imports `@vitest/utils/error`. Its nearest `test/tsconfig.json` extends `../tsconfig.base.json`, which maps the single-wildcard key `@vitest/utils/*` to `./packages/utils/src/*`. The mapped file is `packages/utils/src/error.ts`, but the bare specifier produces no edge.

## ROOT CAUSE

`candidatesForJavaScript()` immediately returns no candidates for every non-relative specifier. Graph construction has no bounded, data-only model of applicable compiler configuration, package ownership, package names, or package exports. Consequently, strong repository metadata is discarded at the same point as unsupported third-party package resolution.

## WHAT PROOFDIFF CURRENTLY KNOWS

- The bounded Git inventory and the repository-local source paths available to the graph.
- Each analyzed importer's repository path, language, and literal import specifiers.
- Existing deterministic relative extension substitution and index-file probing.
- Static reverse reachability and the separately enforced runner-qualification/runtime-observation boundary.

## WHAT IT DOES NOT KNOW

- A complete TypeScript project graph, command-line compiler options, project references, or package-installed `extends` configurations.
- General Node, npm, package-manager, bundler, or `node_modules` resolution.
- Which runtime conditions are active when repository metadata does not state a source condition that is safe to select.
- Whether an unsupported, malformed, cyclic, excessive, or out-of-repository mapping would resolve under a full compiler or runtime.
- Runtime coverage, changed-symbol execution, or runnable-test identity from a static edge.

## OPTIONS CONSIDERED

1. Treat selected bare-specifier prefixes or matching repository directories as aliases. Rejected because it invents configuration and would turn coincidental names into false edges.
2. Invoke TypeScript, Node, a package manager, or a repository bundler to resolve imports. Rejected because it crosses the static trust boundary, depends on installed code, and is not deterministic across hosts.
3. Implement a complete TypeScript and Node resolver. Rejected as unnecessarily broad and likely to obscure unsupported semantics.
4. Parse only explicit, repository-owned metadata and support a narrow subset with fixed traversal and expansion limits. Chosen because both misses have strong, reviewable evidence and unsupported cases can remain unresolved.

## CHOSEN BOUNDED DESIGN

Resolution keeps relative imports unchanged and adds two higher-evidence bare-specifier mechanisms, in TypeScript precedence order:

1. **Compiler `paths`:** choose the nearest ancestor `tsconfig.json` from the bounded Git inventory; read JSON-with-comments and trailing commas as data; follow only repository-relative string `extends`; merge compiler options base-first; and support exact keys plus one `*` in a key and target. Exact keys win, otherwise the matching pattern with the longest literal prefix wins. Ordered target arrays are fallbacks. Targets are relative to the effective `baseUrl` when present, otherwise to the configuration file that defined `paths`. Later PR-review amendments require hidden-metadata and bounded project-membership checks before treating that nearest config as applicable, and replace generic post-substitution probing with mode-specific bounded lookup. Standalone `baseUrl` imports are not added.
2. **Package self-exports:** choose the nearest ancestor `package.json` from the bounded Git inventory, stopping package ownership at a nested package boundary. Later PR-review amendments also block hidden nearer package metadata and require an explicit export-aware compiler mode. Require the import to equal that package's declared `name` or a subpath of it, require `exports`, and support exact export keys. Accept direct `./` targets and nested conditional objects only when condition order and an explicitly active compiler `customConditions` value (or an unambiguous `default`) justify one branch. The target must remain inside both the owning package and repository. Export wildcards, arrays, versioned conditions, and unmodeled built-in runtime-condition choices remain unresolved.

Both mechanisms are pre-indexed or cached; neither searches the repository per import. The implementation limits primary compiler configurations, package metadata files, metadata size, inheritance depth, path keys and targets, per-import candidate expansion, conditional depth/branches, ancestor traversal, and emitted diagnostics. Reaching a bound, encountering ambiguity, or seeing unsupported syntax produces no edge. Successful non-relative edges retain internal evidence naming the importer, specifier, mechanism, metadata file, matched key, target, confidence, and limitation. Stable report schema `1.0` is unchanged.

This subset follows the official TypeScript rules that `paths` values are relative to `baseUrl` or their defining config, patterns contain one wildcard, longest-prefix patterns win, target arrays are ordered fallbacks, inherited relative paths retain their origin, cycles are invalid, and `customConditions` participate in package-export matching. It also follows Node's rule that package self-reference requires the current package's own name and `exports`. See [TypeScript module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference), [TypeScript `extends`](https://www.typescriptlang.org/tsconfig/extends.html), [TypeScript `customConditions`](https://www.typescriptlang.org/tsconfig/customConditions.html), and [Node package self-reference](https://nodejs.org/api/packages.html#self-referencing-a-package-using-its-name).

## FALSE-POSITIVE TRADEOFF

A false dependency edge could incorrectly associate a test with changed code, so uncertain cases fail closed. A similarly named directory, external package, non-owning workspace package, unmatched export, unsupported wildcard, unknown condition choice, malformed config, escaping path, or exhausted bound cannot create an edge. Ordered fallbacks and condition objects are followed only where the supported metadata semantics determine one result.

## FALSE-NEGATIVE TRADEOFF

ProofDiff will still miss relationships that require package-based or array `extends`, project references, standalone `baseUrl`, export wildcards or arrays, runtime-only conditions, package imports, workspace dependency linking, `node_modules`, custom bundler plugins, or more than the fixed limits. It may also remain unresolved when a full resolver could disambiguate metadata ProofDiff deliberately does not model.

## SECURITY / TRUST EFFECT

The change reads bounded repository-owned JSON/JSONC only. It does not execute configuration, import repository modules, install dependencies, invoke a compiler/resolver/runner, follow targets outside the repository or owning package, or create files in the analyzed repository. External evaluation remains static-only with `repositoryCodeExecuted: false`. A resolved edge remains static relationship evidence and cannot directly populate `executedTests` or qualify a runner target.

## DEFERRED WORK

General npm/Node resolution, arbitrary `node_modules`, package imports, workspace dependency resolution, package-export patterns and arrays, package-installed or multiple `extends`, project references, standalone `baseUrl`, full compiler mode/condition semantics, bundler aliases/plugins, new runners (including Vitest, AVA, Jest, Mocha, and Hereby), Node native TypeScript default-test qualification, coverage, changed-symbol execution, Python expansion, and new languages remain out of scope.
