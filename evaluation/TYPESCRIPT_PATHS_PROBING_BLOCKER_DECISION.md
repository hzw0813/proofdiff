# TypeScript `paths` post-substitution probing blocker decision

## CURRENT STATE

PR #5 at `9e06a40257fc71285699bc38f16494ee1b562948` adds bounded TypeScript `paths` and package self-export resolution on top of `main` at `9f59523f9c2bc7e513bf0f7379c6f5111c6846ae`. Its path-key matching, configuration inheritance, path anchoring, containment, and static/runtime evidence separation are independent of this decision.

After a `paths` target is substituted, however, `configuredModuleCandidates()` currently applies one generic list containing TypeScript, JavaScript, MTS/CTS, and directory `index.*` probes. It does this without consulting `moduleResolution` or the lookup context. The same helper is also used after package self-export selection.

## OBSERVED FAILURE

ProofDiff can create repository dependency edges that TypeScript does not resolve:

- under `moduleResolution: "NodeNext"`, an ESM import mapped from `@foo` to `./src/foo` resolves in ProofDiff to `src/foo.ts`, although Node ESM lookup and TypeScript reject the extensionless path;
- a target `./src/foo.mjs` resolves in ProofDiff to `src/foo.ts`, although TypeScript substitutes `.mjs` only with `.mts` and `.d.mts` before trying `.mjs`;
- under `moduleResolution: "Bundler"`, a mapping to `./src/foo` resolves in ProofDiff to `src/foo/index.ts` even when `src/foo/package.json` selects a different `types` target that takes precedence;
- without an effective `baseUrl`, ProofDiff accepts non-relative target values such as `src/foo`, while TypeScript 5.9 rejects the configuration with TS5090.

These are false static relationships, not merely conservative misses.

## REPRODUCTION

Minimal fixtures were run through the repository's pinned TypeScript 5.9.3 compiler with `--traceResolution` and through the current ProofDiff graph builder.

TypeScript observations:

- NodeNext + package `type: "module"` + `@foo: ["./src/foo"]` + `src/foo.ts`: unresolved with TS2307.
- NodeNext + package `type: "commonjs"` using the same files: resolves to `src/foo.ts`.
- NodeNext ESM + `@foo: ["./src/foo.js"]`: resolves to `src/foo.ts`.
- NodeNext ESM + `@foo: ["./src/foo.mjs"]` + only `src/foo.ts`: unresolved; changing the file to `src/foo.mts` resolves.
- Bundler and Node10 extensionless file and directory lookups resolve; an extensionless `.mts` target does not.
- Bundler directory lookup with `package.json` `types: "./types.d.ts"` resolves `types.d.ts`, not `index.ts`.
- Omitting `baseUrl` while using `paths: { "@foo": ["src/foo"] }` produces TS5090.

The current ProofDiff candidate created edges to `src/foo.ts`, `src/foo.ts`, and `src/foo/index.ts` in the first, fourth, and directory-precedence counterexamples respectively.

The results agree with the official TypeScript module-resolution reference: `paths` substitution is followed by relative-path lookup under the configured `moduleResolution`; Node16/NodeNext allow extensionless and directory lookup for `require` but not `import`; Bundler and Node10 allow both; `.mjs` and `.cjs` have distinct substitution families; and directory `package.json` metadata precedes `index.js` lookup.

## ROOT CAUSE

Specifier-to-`paths` matching and post-substitution module lookup were collapsed into a filename search. The generic candidate list encoded neither TypeScript's extension-substitution table nor the resolution-mode/context gate for extensionless and directory lookup. It also treated directory `index` probing as independent of higher-precedence package metadata.

## USER IMPACT

A false edge can associate a test with changed code that the configured compiler or runtime would not connect. Even though PR #5 correctly keeps that edge static-only, the relationship can still mislead review and may feed later target selection. This is merge-blocking under ProofDiff's false-positive boundary.

## WHAT IS KNOWN

- The applicable bounded compiler configuration and its inherited `moduleResolution` value when explicitly present.
- The exact importer, matched `paths` key, ordered target array, substituted repository path, bounded Git inventory, and repository filesystem containment.
- The extension written in the substituted target.
- TypeScript's documented extension-substitution families.
- Bundler and Node10 support extensionless paths and directory modules in all their modeled lookup contexts.

## WHAT IS UNKNOWN

- For Node16/NodeNext-family modes, the exact import-versus-require resolution mode for every observation. The current import model distinguishes dynamic imports but conflates static ESM imports, exports, `require()`, and TypeScript import-require syntax.
- Compiler options supplied outside repository configuration.
- Directory-module `package.json` `types`, `typings`, `main`, and `typesVersions` semantics in the path resolver.
- Custom `moduleSuffixes` precedence.
- Arbitrary-extension and non-source asset resolution.

## OPTIONS CONSIDERED

1. Keep broad probing and label the edge lower confidence. Rejected: confidence labels do not make a false relationship safe.
2. Infer NodeNext import/require mode from filename and package `type`. Rejected for this fix: syntax-specific resolution mode and dynamic import behavior would still require widening the import evidence model.
3. Require every mapping target to name an exact TypeScript source file. Sound but unnecessarily loses common, explicitly configured Bundler aliases such as the pinned Vitest case.
4. Implement a bounded, mode-specific subset: exact extension substitution in every mode; extensionless file/index lookup only for explicit Bundler or Node10; reject contexts and precedence features not modeled. Chosen as the smallest design that preserves the demonstrated real-world mapping without guessing NodeNext context.

## CHOSEN DESIGN

- Preserve existing exact/wildcard key matching, longest-prefix precedence, target ordering, inheritance, base path, and bounds.
- Without an effective `baseUrl`, require each target value to begin with `./` or `../`, matching valid TypeScript configuration. With `baseUrl`, retain base-relative values.
- For explicitly extended targets, implement TypeScript's documented substitution families and order:
  - `.js` → `.ts`, `.tsx`, `.d.ts`, `.js`, `.jsx`;
  - `.jsx` → `.tsx`, `.d.ts`, `.jsx`;
  - `.mjs` → `.mts`, `.d.mts`, `.mjs`;
  - `.cjs` → `.cts`, `.d.cts`, `.cjs`;
  - recognized TypeScript extensions resolve only to the exact target.
- For extensionless targets, allow file and `index` probing only when `moduleResolution` is explicitly `bundler`, `node10`, or its `node` alias. Probe only the `.js` substitution family; never infer omitted `.mts`/`.cts` extensions.
- In Node16, Node18, Node20, NodeNext, Classic, missing, or unknown modes, an extensionless matched target blocks the resolution rather than falling through to another mechanism or target.
- If an extensionless candidate reaches directory lookup and `<target>/package.json` exists, block rather than guessing around `types`, `typings`, `main`, or `typesVersions` precedence.
- Reject non-default `moduleSuffixes` because its precedence is not modeled. Explicit `[""]` is equivalent to the supported default.
- Package self-export targets use only the explicit extension-substitution table; they never receive extensionless or directory probing.
- Reaching an unsupported target extension or ambiguous lookup creates no edge and produces a bounded diagnostic.

## FALSE-POSITIVE RISK

The supported modes and extension table are configuration-backed and directly checked against TypeScript. Higher-precedence ignored/truncated files remain fail-closed. Directory package metadata, exact extensionless physical files, non-default suffixes, unsupported modes, and unknown extensions block fallback so an apparently available lower candidate cannot create an edge.

Residual risk is concentrated in the deliberately retained explicit-extension subset and will be attacked with competing-extension, hidden-precedence, Windows normalization, symlink, inheritance, and package-boundary fixtures.

## FALSE-NEGATIVE RISK

ProofDiff will conservatively miss valid Node16/NodeNext CommonJS extensionless aliases, even where a `.cts` importer makes the mode apparent. It will also miss directory aliases with package metadata, Classic extensionless resolution, non-default module suffixes, arbitrary extensions, and valid configuration supplied only through CLI flags or tools.

These misses are preferable to inventing import/require context or partially modeling directory packages.

## SECURITY EFFECT

The change remains data-only and repository-local. It does not invoke TypeScript during normal analysis, execute configuration, load repository modules, install dependencies, or add network behavior. It adds only bounded string classification and existing repository-file checks.

## PERFORMANCE EFFECT

Candidate expansion becomes smaller: at most five file and five index candidates for an extensionless supported lookup, or five candidates for an explicit `.js` target. One bounded `package.json` existence check is added only after extensionless file lookup reaches directory resolution. Existing per-import, metadata, and diagnostic limits remain.

## COMPATIBILITY EFFECT

Public schema `1.0`, statuses, CLI flags, Action inputs, and runtime evidence semantics do not change. Some existing static relationships created from invalid, ambiguous, Node ESM extensionless, incorrect MJS/CJS substitution, or directory-metadata lookups disappear. This is an intentional correction from false positive to unresolved.

Controlled fixtures that intend a positive extensionless alias must declare a supported `moduleResolution`; fixtures without `baseUrl` must use valid relative target strings.

## DEFERRED WORK

Exact Node16/NodeNext import-versus-require modeling, Classic lookup, `moduleSuffixes`, directory package metadata, arbitrary extensions, package imports, workspace dependencies, project references, package-based `extends`, standalone `baseUrl`, relative-import mode correction, and new runners remain outside this blocker fix.
