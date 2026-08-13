# Package self-export mode blocker decision

## CURRENT STATE

PR #5 adds bounded package self-export resolution and currently accepts an absent `moduleResolution` as if package exports might be active. The corrected static-resolution candidate is otherwise evaluated at `311158441acf8c1e9d7527d9ff912cc79fc5fcab` against `main` at `9f59523f9c2bc7e513bf0f7379c6f5111c6846ae`.

## USER PROBLEM AND OBSERVED FAILURE

ProofDiff can say that a test is statically related to changed code through a package self-export even when the repository's TypeScript compiler does not resolve the import.

A minimal TypeScript 5.9.3 fixture contains:

- `package.json` with name `fixture` and `exports: "./src/index.js"`;
- `tsconfig.json` with no `module` or `moduleResolution` option;
- `src/index.ts`; and
- `test/test.ts` importing `fixture`.

`tsc --traceResolution` reports that the unspecified resolution kind defaults to Node10, does not consult the self-export, and ends with TS2307. The current ProofDiff resolver instead emits a high-confidence `package-self-export` edge from `test/test.ts` to `src/index.ts`.

The TypeScript module-resolution reference states that self-name imports through package exports are supported under Node16, NodeNext, and Bundler resolution, while Node10 does not support package exports or self-name imports. `resolvePackageJsonExports` defaults to false outside the export-aware modes.

## ROOT CAUSE

The resolver checks that an explicit `moduleResolution` is not unsupported, but treats a missing mode as supported. Missing configuration is not evidence that exports lookup is active; TypeScript derives a default from other compiler options, which ProofDiff does not currently model.

Independent adversarial review then reproduced two more false-edge paths in the same package self-export boundary:

- a leading versioned `types@>=5.0` condition is potentially active in TypeScript 5.9.3, but ProofDiff skips it and selects a later `default` target;
- a nearer ignored `package.json` changes the importing file's package identity, but inventory-only ownership skips it and applies an ancestor package's name and exports.
- a nearer `tsconfig.json` can explicitly exclude the importer from its project through `files`, while ProofDiff treats filesystem ancestry alone as project ownership and applies the wrong `paths` mapping.

In the first fixture, TypeScript resolves `types@>=5.0` to `src/actual.d.ts` while ProofDiff creates an edge to `src/wrong.js`. In the second, TypeScript reports the ancestor package self-name unresolved from the nested package while ProofDiff creates an edge to the ancestor package's `src/root.ts`. In the project-membership fixture, the invoked root config resolves `@value` to `src/actual.ts`; a nearer nested config lists only `nested/src/other.ts`, yet ProofDiff applies that config to `nested/test/consumer.test.ts` and creates an edge to `nested/src/wrong.ts`.

## OPTIONS

1. Keep accepting a missing mode at lower confidence. Rejected: confidence does not make a compiler-inconsistent relationship safe.
2. Infer TypeScript's implied resolution mode from `module` and every relevant default. Deferred: this widens compiler-option modeling and creates another precedence surface during a blocker fix.
3. Require an explicit export-aware `moduleResolution` before resolving package self-exports. Chosen: it is the smallest sound rule and preserves the pinned Zod gain because that package inherits explicit NodeNext resolution.

For the independent-review findings, fully evaluating version selectors or parsing ignored metadata would widen the resolver unnecessarily. The smallest sound rules are to treat every `types@...` key as potentially active and block a later branch, and to treat any nearer repository-local `package.json` outside the bounded Git inventory as an opaque package boundary.

For compiler project ownership, the resolver will honor bounded, repository-relative `files`, `include`, and `exclude` membership declarations on the nearest config. If the importer is not a proven member of that config, ProofDiff blocks instead of guessing which ancestor or referenced project was invoked.

## CHOSEN RULE

Package self-export resolution requires an applicable, successfully parsed compiler configuration whose effective `moduleResolution` is explicitly Node16, Node18, Node20, NodeNext, or Bundler. A missing mode, missing config, unsupported mode, invalid config, or `resolvePackageJsonExports: false` creates no edge and produces a bounded diagnostic where applicable.

Before selecting a conditional export, an unmodeled `types@...` condition blocks any later branch. Before choosing package ownership or validating a target boundary, each bounded ancestor path is checked for an existing `package.json` outside the Git inventory; encountering one blocks resolution without reading or executing it.

The nearest compiler configuration is applicable only when its supported project-membership declarations include the importer. Explicit `files` is exact; supported `include`/`exclude` patterns are bounded and repository-relative. An importer excluded from the nearest project does not fall through to an ancestor mapping because ProofDiff does not know which project invocation governs that file.

The independent re-review extended that invariant: project selectors inherit from their defining configuration unless individually overridden; explicit `files` and matched `include` entries form a union; `exclude` applies to included files; JavaScript-family importers require effective `allowJs: true`; and default membership excludes the effective `outDir` plus standard dependency directories. These paths and patterns retain the configuration that defined them. Unsupported or non-member importers fail closed.

The selected export target still must satisfy all existing exact-key, condition, explicit-extension, precedence, package-boundary, containment, symlink, inventory, and expansion checks.

## UX AND ADOPTION EFFECT

Users no longer see a plausible package self-export relationship that their configured compiler does not establish. Repositories relying only on an implied export-aware mode may receive an actionable unknown until ProofDiff models that implication. This conservative miss is preferable to a misleading relationship and does not affect CLI or schema compatibility.

## SECURITY AND PERFORMANCE EFFECT

The change remains local, deterministic, bounded, and data-only. It executes no repository code and adds no network or dependency behavior. Metadata existence checks are capped by the existing 32-level ancestor bound and cached by repository path. Project selectors are capped at 128 entries per field. Export candidate expansion does not increase.

## COMPATIBILITY AND DEFERRED WORK

Status names, schema version `1.0`, CLI flags, Action inputs, and runtime evidence semantics remain unchanged. Modeling `module`-implied resolution modes, plain-JavaScript Node self-reference semantics, package imports, export patterns, export arrays, and full TypeScript project ownership remains deferred.
