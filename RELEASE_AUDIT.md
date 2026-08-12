# Release audit — v0.1.0

Audit date: 2026-08-12 (Asia/Taipei)

This document records observed evidence for the published GitHub and npm releases.

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
- GitHub Action, CI, release, Dependabot, and issue-template YAML parse successfully. Release automation accepts an explicit existing annotated version tag, checks out and validates that tag against the package version, tests, runs the Action smoke, packs once, checksums the artifact, and creates or updates a GitHub Release with that exact artifact. Release commands use the explicit GitHub repository coordinate so the artifact-only release job does not depend on a checked-out Git directory, and npm publication remains gated behind the protected `npm` environment.
- GitHub-hosted CI run [31573638505](https://github.com/hzw0813/proofdiff/actions/runs/31573638505) passed from commit `25e0069e87a4750852d296be46a9cb928571f622`. The full matrix ran `npm ci`, all 40 tests, and `npm pack --dry-run` on Ubuntu, macOS, and Windows with Node.js 22, 24, and 26. The source-tree Action smoke also passed.
- Hosted Windows failures exposed and drove fixes for Git's null device, `.cmd` package-manager launching, descendant process termination after timeouts, and same-size/same-timestamp fixture revalidation. The final Windows jobs pass all tests and package checks on every supported Node.js line.
- The published-repository Action smoke invoked `hzw0813/proofdiff@main`, created a deterministic working-tree change, generated a nonempty self-contained HTML report, verified the changed path, and uploaded the report. The downloaded artifact contains the expected `fixtures/demo/base/src/discount.js` assessment, restrictive Content Security Policy, static-only trust statement, and no observed runner or user path.
- GitHub externally reports `hzw0813/proofdiff` as public with `main` as its default branch, the intended description, MIT license detection, active CI and Release workflows, and the annotated `v0.1.0` tag peeled to release commit `d632a3d0f41e9f20d18bcb7c48150d02c4fed84e`.
- README local links pass, and the hosted CI workflow target plus all three badge image URLs return HTTP 200. Package metadata resolves to `https://github.com/hzw0813/proofdiff`, its issues page, and its README.
- The npm registry returned `E404` for the exact `proofdiff` package name again after GitHub release publication. This confirms only that no npm package was observed; availability is not a reservation.

## Verified on GitHub for v0.1.0

- Release workflow run [31574696070](https://github.com/hzw0813/proofdiff/actions/runs/31574696070) checked out the tag, verified tag/version agreement, passed all 40 tests and the production Action smoke, packed once, produced `SHA256SUMS`, and uploaded the `proofdiff-v0.1.0` workflow artifact. Its npm publication job was skipped because `publish_npm=false`.
- The workflow's release job exposed a missing repository-context argument: it had downloaded artifacts without checking out Git, while `gh release` attempted repository discovery from the working directory. The release commands now pass `--repo "$GITHUB_REPOSITORY"` explicitly. The failed workflow is retained as evidence and is not described as successful.
- Repaired Release workflow run [31575475433](https://github.com/hzw0813/proofdiff/actions/runs/31575475433) ran from `main` with the explicit existing `v0.1.0` tag and `publish_npm=false`. It validated that the annotated tag resolved to the checked-out package version, passed tests and the Action smoke, reproduced the package and checksum, and successfully updated the public GitHub Release. Its npm job was skipped.
- The public [ProofDiff v0.1.0 GitHub Release](https://github.com/hzw0813/proofdiff/releases/tag/v0.1.0) was created from the exact downloaded workflow artifact after its checksum matched the reproducible local package. GitHub reports it as published, non-draft, and non-prerelease, with the intended annotated tag.
- Anonymous downloads of `proofdiff-0.1.0.tgz` and `SHA256SUMS` succeeded. The public package is 54,675 bytes with SHA-256 `2b21c3951e590f3127efceba208d51272a5e718e1d070f9d541a35b823020559`; its bytes match the workflow artifact, its embedded metadata identifies `proofdiff` version `0.1.0`, and an isolated installation reports version `0.1.0`.
- Release notes describe only implemented and verified capabilities, link the exact release commit, and link the published npm package.

## Verified on npm for v0.1.0

- Release workflow run [31578507988](https://github.com/hzw0813/proofdiff/actions/runs/31578507988) checked out and validated the immutable `v0.1.0` tag, passed all 40 tests and the production Action smoke, reproduced the audited tarball and checksum, and published that exact artifact to npm.
- The public [proofdiff@0.1.0 package](https://www.npmjs.com/package/proofdiff/v/0.1.0) reports the expected name, version, description, MIT license, Node.js 22+ requirement, executable, dependency, and `hzw0813/proofdiff` repository metadata.
- The registry tarball has 67 files, a 233,807-byte unpacked size, SHA-1 `baf67396770eab13da26d14610ded2e1be31bb31`, and SHA-512 integrity `sha512-2mBraOYNhfaTn+wWHwUT2m1ox0bWfTgy1AyjHbq1ayyh9gVT0c4A33fYPfTrzRIwJHZVdjVcJF91QaPDbcEeDQ==`. Its downloaded bytes match the GitHub Release asset and retain SHA-256 `2b21c3951e590f3127efceba208d51272a5e718e1d070f9d541a35b823020559`.
- npm exposes a SLSA v1 provenance attestation linking the package to the public repository, Release workflow file, hosted run, and Sigstore transparency log. The provenance identifies `cedc454ad2090339fb4d3ca0ea9adccefcb9fbf0` as the workflow-dispatch source commit; the workflow separately checks out and verifies the package source at tagged commit `d632a3d0f41e9f20d18bcb7c48150d02c4fed84e`.
- A clean registry installation added only ProofDiff and its runtime dependency tree, `proofdiff --version` returned `0.1.0`, and `npm audit signatures` verified registry signatures and attestations. The installed CLI analyzed a separate changed JavaScript repository, executed both discovered tests, associated the changed function with its related test, and reported a low-risk verified result.
- npm trusted publishing is restricted to `hzw0813/proofdiff`, workflow `release.yml`, environment `npm`, and `npm publish` permission. The package requires 2FA and disallows bypass-2FA tokens. The one-day token required to create the previously nonexistent package was deleted from npm after use, its GitHub Actions secret was deleted, and the final workflow contains no token reference.

## Deliberately not claimed

- Publication does not establish adoption, usage, performance, or ecosystem standing.
- Provenance identifies the build workflow and source context; it is not a claim that every possible supply-chain risk is eliminated.

npm publication is complete. Future registry publication remains restricted to the repository Release workflow and npm trusted publishing.

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
