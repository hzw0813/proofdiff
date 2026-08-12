# Release audit — 0.1.0 release candidate

Audit date: 2026-08-12 (Asia/Taipei)

This document records observed evidence, not a claim that unperformed external release steps passed.

## Verified locally

- A source-only fresh-clone simulation excluded `node_modules`, `dist`, `dist-test`, coverage, scratch, and outputs. It passed `npm ci`, the documented build/version quickstart, all 40 tests, and the production-only GitHub Action smoke test.
- Installation from the generated tarball succeeded in an empty package. Its `proofdiff` binary reported version `0.1.0`, analyzed a separate JavaScript repository, passed both the repository and explicitly targeted tests, associated `test/value.test.js` with `src/value.js`, and emitted terminal/JSON/HTML output.
- The complete 40-test suite passes locally on Node.js 22, 24, and 26, the non-EOL release lines supported on the audit date. It covers adapters, Git selection, integration, CLI, error paths, privacy/security boundaries, fixture repositories, reports, and end-to-end behavior. Test files are enumerated explicitly and checked against the compiled inventory rather than relying on shell glob expansion.
- Built-in test coverage reports 91.38% lines, 73.40% branches, and 92.34% functions across application and test-helper modules.
- A Python `unittest` repository received isolated-AST symbol analysis, a resolved test relationship, explicitly targeted execution evidence, and a qualified verified result.
- JavaScript/TypeScript and Python adapters retain line-numbered call sites. Reports show only call references intersecting changed lines and label them as name-only structural facts—not resolved targets or runtime execution.
- A regression fixture proves that a passing repository script which excludes the related failing test remains only partially verified. Static related-file presence and opaque repository-wide success cannot create a `Verified` result.
- Verification failure, timeout, output truncation, unknown, unverified, partial, and verified paths are tested. Failed checks cannot be presented as success and produce a nonzero default CLI status.
- Adversarial Git configuration attempting to execute a filesystem monitor, content filter, text converter, and external diff helper is suppressed by a regression test.
- Check execution removes inherited application secrets; redacts the repository root, uppercase/lowercase credential keys, authorization values, credential-bearing URLs, private keys, JWTs, and common provider tokens; limits output; and terminates timed-out descendant process trees. A separate regression proves runtime source has no network or telemetry implementation and only one runtime dependency.
- `npm audit --omit=dev` reports zero known runtime vulnerabilities.
- ProofDiff dogfooding maps a change in `src/evidence.ts` to `tests/analyze.test.ts`; repository test, targeted test, typecheck, and lint checks pass.
- Demo generation creates four asserted scenarios from temporary Git repositories and real ProofDiff runs: mixed evidence, a passing command that excludes a related test, targeted verification failure, and an unsupported Rego change. The generated statuses are partial, partial, failed, and unknown respectively.
- Browser QA covered the gallery and report at 1280 px and 390 px. Both had viewport width equal to document scroll width; the gallery rendered all four scenarios, call-name search selected the correct file, changed-call evidence expanded correctly, and self-contained pages made no missing-resource request. A mobile min-content overflow and a favicon 404 found during earlier QA remain fixed.
- Two independent `npm pack` runs from Git tree `1dc91b91a7e068423c97d8161adb4f65022f0bfc` produced byte-identical 54,675-byte tarballs with SHA-256 `2b21c3951e590f3127efceba208d51272a5e718e1d070f9d541a35b823020559`.
- The GitHub Action smoke test copies a source checkout without `node_modules`, installs production dependencies with lifecycle scripts disabled, verifies dev dependencies are absent, runs the static default and trusted-check paths against a two-commit fixture, and validates HTML output. It exposed and fixed an npm 11 incompatibility in the former `npm ci --prefix` installation path.
- GitHub Action, CI, release, Dependabot, and issue-template YAML parse successfully. Release automation checks tag/version agreement, tests, runs the Action smoke, packs once, checksums the artifact, creates or updates a GitHub Release with that exact artifact, and gates npm publication behind the protected `npm` environment.
- GitHub-hosted CI run [31573638505](https://github.com/hzw0813/proofdiff/actions/runs/31573638505) passed from commit `25e0069e87a4750852d296be46a9cb928571f622`. The full matrix ran `npm ci`, all 40 tests, and `npm pack --dry-run` on Ubuntu, macOS, and Windows with Node.js 22, 24, and 26. The source-tree Action smoke also passed.
- Hosted Windows failures exposed and drove fixes for Git's null device, `.cmd` package-manager launching, descendant process termination after timeouts, and same-size/same-timestamp fixture revalidation. The final Windows jobs pass all tests and package checks on every supported Node.js line.
- The published-repository Action smoke invoked `hzw0813/proofdiff@main`, created a deterministic working-tree change, generated a nonempty self-contained HTML report, verified the changed path, and uploaded the report. The downloaded artifact contains the expected `fixtures/demo/base/src/discount.js` assessment, restrictive Content Security Policy, static-only trust statement, and no observed runner or user path.
- GitHub externally reports `hzw0813/proofdiff` as public with `main` as its default branch, the intended description, MIT license detection, active CI and Release workflows, and remote `main` at the audited commit. The repository has no tags or GitHub Releases.
- README local links pass, and the hosted CI workflow target plus all three badge image URLs return HTTP 200. Package metadata resolves to `https://github.com/hzw0813/proofdiff`, its issues page, and its README.
- The npm registry returned `E404` for the exact `proofdiff` package name again during the final external audit. Availability is not a reservation and must be rechecked immediately before publication.

## Deliberately not claimed

- The tag-gated Release workflow has not executed. Its active hosted definition and control flow were inspected, but packaging from a version tag, GitHub Release creation, and npm trusted publication/provenance remain unperformed external steps.
- No version tag, GitHub Release, or npm package was created. Those are separate publication boundaries and require explicit authorization.
- The npm package name is not reserved merely because the registry currently returns `E404`.

These are the remaining publication gates. They do not justify weakening local evidence or fabricating a completed release.

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
