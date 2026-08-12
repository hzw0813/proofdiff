# Release audit — 0.1.0 release candidate

Audit date: 2026-08-12 (Asia/Taipei)

This document records observed evidence, not a claim that unperformed external release steps passed.

## Verified locally

- A source-only fresh-clone simulation excluded `node_modules`, `dist`, `dist-test`, coverage, scratch, and outputs. It passed `npm ci`, the documented build/version quickstart, all 39 tests, and the production-only GitHub Action smoke test.
- Installation from the generated tarball succeeded in an empty package. Its `proofdiff` binary reported version `0.1.0`, analyzed a separate JavaScript repository, passed both the repository and explicitly targeted tests, associated `test/value.test.js` with `src/value.js`, and emitted terminal/JSON/HTML output.
- The complete 39-test suite passes on Node.js 22, 24, and 26, the non-EOL release lines supported on the audit date. It covers adapters, Git selection, integration, CLI, error paths, privacy/security boundaries, fixture repositories, reports, and end-to-end behavior. Test files are enumerated explicitly and checked against the compiled inventory rather than relying on shell glob expansion.
- Built-in test coverage reports 91.35% lines, 74.01% branches, and 92.23% functions across application and test-helper modules.
- A Python `unittest` repository received isolated-AST symbol analysis, a resolved test relationship, explicitly targeted execution evidence, and a qualified verified result.
- JavaScript/TypeScript and Python adapters retain line-numbered call sites. Reports show only call references intersecting changed lines and label them as name-only structural facts—not resolved targets or runtime execution.
- A regression fixture proves that a passing repository script which excludes the related failing test remains only partially verified. Static related-file presence and opaque repository-wide success cannot create a `Verified` result.
- Verification failure, timeout, output truncation, unknown, unverified, partial, and verified paths are tested. Failed checks cannot be presented as success and produce a nonzero default CLI status.
- Adversarial Git configuration attempting to execute a filesystem monitor, content filter, text converter, and external diff helper is suppressed by a regression test.
- Check execution removes inherited application secrets; redacts the repository root, uppercase/lowercase credential keys, authorization values, credential-bearing URLs, private keys, JWTs, and common provider tokens; limits output; and terminates timed-out process groups. A separate regression proves runtime source has no network or telemetry implementation and only one runtime dependency.
- `npm audit --omit=dev` reports zero known runtime vulnerabilities.
- ProofDiff dogfooding maps a change in `src/evidence.ts` to `tests/analyze.test.ts`; repository test, targeted test, typecheck, and lint checks pass.
- Demo generation creates four asserted scenarios from temporary Git repositories and real ProofDiff runs: mixed evidence, a passing command that excludes a related test, targeted verification failure, and an unsupported Rego change. The generated statuses are partial, partial, failed, and unknown respectively.
- Browser QA covered the gallery and report at 1280 px and 390 px. Both had viewport width equal to document scroll width; the gallery rendered all four scenarios, call-name search selected the correct file, changed-call evidence expanded correctly, and self-contained pages made no missing-resource request. A mobile min-content overflow and a favicon 404 found during earlier QA remain fixed.
- Two independent `npm pack` runs produced byte-identical 54,178-byte tarballs with SHA-256 `6d7e4526ccb97931a3b00534a42b87b979168601efb70bcc1883c6459f3147ff`.
- The GitHub Action smoke test copies a source checkout without `node_modules`, installs production dependencies with lifecycle scripts disabled, verifies dev dependencies are absent, runs the static default and trusted-check paths against a two-commit fixture, and validates HTML output. It exposed and fixed an npm 11 incompatibility in the former `npm ci --prefix` installation path.
- GitHub Action, CI, release, Dependabot, and issue-template YAML parse successfully. Release automation checks tag/version agreement, tests, runs the Action smoke, packs once, checksums the artifact, creates or updates a GitHub Release with that exact artifact, and gates npm publication behind the protected `npm` environment.
- The npm registry returned `E404` for the exact `proofdiff` package name during this audit. Availability is not a reservation and must be rechecked immediately before publication.

## Deliberately not claimed

- GitHub-hosted Linux/macOS/Windows jobs have not yet run for this candidate. The public repository is `hzw0813/proofdiff`; hosted results will be added only after they are observed.
- The GitHub Action and release workflow have not yet executed on GitHub. Tag creation, GitHub Release creation, npm publication, and provenance verification remain separate publication boundaries.
- Windows behavior is covered by CI design and portability choices but was not executed on this macOS host.

These are the remaining external release gates. They do not justify weakening local evidence or fabricating a completed release.

## Reproduce the local audit

```bash
npm ci
npm run typecheck
npm test
npm run test:action
npm run test:coverage
npm run dogfood
npm run demo
npm pack --dry-run
```

Then pack twice and compare SHA-256 hashes, install one tarball into an empty directory, run `proofdiff --version`, and analyze a disposable changed repository with `--run-checks`.
