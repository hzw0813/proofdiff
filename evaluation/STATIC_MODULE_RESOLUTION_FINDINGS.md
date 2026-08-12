# Bounded static module resolution: before and after

## Evaluation identity

- Required implementation baseline: clean `main` at `9f59523f9c2bc7e513bf0f7379c6f5111c6846ae`.
- Decision-record commit: `043f4aa0a889cdc37dacadee8b3161096c75308b`.
- Clean implementation candidate evaluated here: `342ee543c06c7ad90e82e525fe8fee0afe8f4b98`.
- Prior clean evidence-boundary candidate used for the direct comparison: `37cccdfdfa89d7fb12c969a5ba364e16782b5eb4` in `results.candidate.json` and `controlled-results.candidate.json`.
- Decision record: [`STATIC_MODULE_RESOLUTION_DECISION.md`](STATIC_MODULE_RESOLUTION_DECISION.md).

Historical artifacts and schemas were not overwritten. The module-resolution candidate is stored separately in `static-resolution-results.candidate.json` and `static-resolution-controlled-results.candidate.json`.

## Reproduced misses and resolver stop point

Before implementation, the exact two-case pinned run classified both cases `clearly-expected-missed`:

- Zod's `packages/zod/src/v3/tests/string.test.ts` imports `zod/v3`. The owning `packages/zod/package.json` names `zod`, exports exact subpath `./v3`, and its owning compiler config activates `@zod/source`, but every JavaScript/TypeScript bare specifier was discarded before candidate generation.
- Vitest's `test/unit/test/error.test.ts` imports `@vitest/utils/error`. The nearest `test/tsconfig.json` inherits root `tsconfig.base.json`, whose single-wildcard `@vitest/utils/*` mapping points to `./packages/utils/src/*`, but the same bare-specifier guard discarded it.

The implementation does not recognize repository names or corpus paths. It adds two bounded data models: compiler `paths` and package self-exports.

## Exact implemented semantics

### Compiler paths

- The nearest Git-inventory ancestor `tsconfig.json` owns the importer.
- JSON-with-comments, block/line comments, trailing commas, and Windows separators are accepted deliberately.
- One repository-relative string `extends` chain is merged base-first; relative option paths retain the configuration that defined them.
- Exact keys win. Otherwise a key may contain one `*`, and the match with the longest literal prefix wins. Equal-prefix ambiguity creates no edge.
- Each target may contain at most one corresponding `*`; target arrays are tried in order as fallbacks.
- Targets are anchored at effective `baseUrl` when present, otherwise at the config that defined `paths`. Standalone `baseUrl` resolution is unsupported and blocks lower-precedence package-self resolution rather than being skipped.
- Existing extension substitution, including `.js` to TypeScript source, and extensionless index probing are reused. Explicitly extended targets do not receive impossible index probing.

### Package self-exports

- The nearest Git-inventory ancestor `package.json` owns the importer and defines the package boundary.
- The import must equal that package's exact declared `name` or a subpath below it, and the package must declare `exports`.
- Root or exact subpath keys are supported. Export patterns and arrays are unsupported.
- Direct `./` targets are supported. Conditional objects preserve declaration order and select only an explicitly active compiler `customConditions` branch or an unambiguous `default`. A skipped potentially active built-in condition such as `types`, `import`, `require`, or `node` makes the choice unsupported.
- `moduleResolution` must be absent or one of the export-aware modes; explicit `resolvePackageJsonExports: false` disables the edge.
- Targets must remain inside both the repository and owning package and cannot cross a nested package boundary.

Successful non-relative edges retain internal evidence for importer, original specifier, mechanism, config/package file, matched key, target, confidence, explanation, and the static-only limitation. Public report schema `1.0` is unchanged.

## False-positive protections and bounds

The skeptical pass asked, “Can this new resolver create a false static dependency edge?” It found and fixed these issues before evaluation:

- explicit-extension targets had inherited directory/index probing;
- unsupported standalone `baseUrl` could have been skipped before a lower-precedence package self-export;
- an invalid nearest compiler config could have been bypassed by package metadata;
- a higher-priority ignored or inventory-truncated file could have been hidden while a lower-priority tracked fallback created an edge.

Additional guards reject malformed metadata, inheritance cycles, excessive depth/counts, unsupported wildcard shapes, equally specific patterns, missing targets, path traversal, `${configDir}`, tracked `node_modules`, metadata symlinks, target symlink escapes, external packages with similar names, nested-package crossings, unknown condition choices, and disabled/unsupported export modes. Relative imports remain unchanged.

Fixed bounds are: 5,000 Git-inventory files; 256 KB per metadata file; 64 compiler configs; 256 package files; 32 ancestor levels; 8 inheritance levels; 128 path keys; 8 targets per key; 32 custom conditions; 64 candidates per import; 8 condition levels; 64 visited condition branches; 50,000 non-relative import observations; 10,000 retained resolution records; and 100 emitted resolution diagnostics. A reached bound creates no new edge.

## Runtime-evidence separation

Both new controlled static cases are `unknown`, include the related test, have empty `executedTests`, and report `repositoryCodeExecuted: false`. Existing helper and zero-test controls remain non-verified, while genuine qualified/observed target controls remain unchanged. Alias or export resolution never calls target qualification and cannot directly add runtime observations.

## External corpus before and after

All ten immutable cases were rerun without dependency installation or `--run-checks`.

| Classification | Prior candidate | Module-resolution candidate |
| --- | ---: | ---: |
| Clearly expected found | 7 | 9 |
| Clearly expected missed | 2 | 0 |
| Ambiguous | 1 | 1 |

Material changes:

- `zod-package-self-export`: missed → found, using `packages/zod/package.json`, exact key `./v3`, condition `@zod/source` selected from `packages/zod/tsconfig.json`, and target `packages/zod/src/v3/index.ts`. Static-only wall time was 499 ms on this host (prior candidate: 508 ms).
- `vitest-ts-path-alias`: missed → found, using `test/tsconfig.json` → `tsconfig.base.json`, key `@vitest/utils/*`, and target `packages/utils/src/error.ts`. Static-only wall time was 1,085 ms (prior candidate: 1,031 ms).
- Existing seven clear successes did not regress.
- `typescript-cap-tail` remains ambiguous. Its 5,000-file static-only wall time was 2,133 ms (prior candidate: 2,049 ms); the paired clear TypeScript case was 2,153 ms (prior: 2,250 ms). These single-host figures are operational observations, not portable benchmarks.

Every external assessment remains `unknown`, every check is `not-run`, and every case records `repositoryCodeExecuted: false`.

## Controlled evaluation

All 15 controls passed. The two added cases establish positive static relationships for compiler aliases and package self-exports without runtime evidence. The retained cases cover conventional related target passes, directory helpers, root/custom Node identity, opaque commands, genuine failures, Node zero/filtered/skipped targets, positive/zero unittest targets, exact mixed-batch attribution, and an unsupported language.

## Compatibility and remaining misses

- Status names, CLI flags, fail policies, and `schemaVersion: "1.0"` are unchanged.
- Internal graph metadata is additive and does not change the serialized `AnalysisReport` contract.
- No clear external relationship miss remains in this ten-case corpus. The TypeScript cap-tail case remains honestly ambiguous.
- Package/array `extends`, project references, standalone `baseUrl`, `${configDir}`, export patterns/arrays, package imports, workspace dependency linking, third-party/`node_modules` resolution, full Node/TypeScript semantics, bundler plugins, and new runners remain unsupported.

## Next single engineering priority

Improve bounded structural-analysis scale beyond the first 5,000 Git-inventory files while preserving deterministic ordering and fail-closed precedence. The remaining corpus uncertainty is the TypeScript cap-tail case; runner expansion would add execution breadth but would not address that static-analysis blind spot.
