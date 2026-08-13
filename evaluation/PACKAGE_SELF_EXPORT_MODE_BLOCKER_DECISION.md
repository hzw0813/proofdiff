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

## OPTIONS

1. Keep accepting a missing mode at lower confidence. Rejected: confidence does not make a compiler-inconsistent relationship safe.
2. Infer TypeScript's implied resolution mode from `module` and every relevant default. Deferred: this widens compiler-option modeling and creates another precedence surface during a blocker fix.
3. Require an explicit export-aware `moduleResolution` before resolving package self-exports. Chosen: it is the smallest sound rule and preserves the pinned Zod gain because that package inherits explicit NodeNext resolution.

## CHOSEN RULE

Package self-export resolution requires an applicable, successfully parsed compiler configuration whose effective `moduleResolution` is explicitly Node16, Node18, Node20, NodeNext, or Bundler. A missing mode, missing config, unsupported mode, invalid config, or `resolvePackageJsonExports: false` creates no edge and produces a bounded diagnostic where applicable.

The selected export target still must satisfy all existing exact-key, condition, explicit-extension, precedence, package-boundary, containment, symlink, inventory, and expansion checks.

## UX AND ADOPTION EFFECT

Users no longer see a plausible package self-export relationship that their configured compiler does not establish. Repositories relying only on an implied export-aware mode may receive an actionable unknown until ProofDiff models that implication. This conservative miss is preferable to a misleading relationship and does not affect CLI or schema compatibility.

## SECURITY AND PERFORMANCE EFFECT

The change remains local, deterministic, bounded, and data-only. It executes no repository code and adds no network or dependency behavior. It rejects unsupported work earlier, so it does not increase candidate expansion.

## COMPATIBILITY AND DEFERRED WORK

Status names, schema version `1.0`, CLI flags, Action inputs, and runtime evidence semantics remain unchanged. Modeling `module`-implied resolution modes, plain-JavaScript Node self-reference semantics, package imports, export patterns, export arrays, and full TypeScript project ownership remains deferred.
