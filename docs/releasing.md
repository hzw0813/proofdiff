# Release process

1. Confirm the changelog and version agree.
2. From a clean clone, run `npm ci`, `npm test`, `npm run test:action`, `npm run demo`, and `npm pack --dry-run`.
3. Inspect `examples/demo-report.html` and regenerate its screenshot.
4. Create and push an annotated `vX.Y.Z` tag.
5. Run the **Release** workflow manually with `publish_npm: false`; verify the GitHub Release, package artifact, and checksum.
6. After the owner explicitly approves registry publication and the protected `npm` environment, rerun with `publish_npm: true`.

The workflow verifies that the tag matches `package.json`, runs the complete test suite and Action smoke test, packs once, emits a SHA-256 checksum, creates or updates the GitHub Release with those exact artifacts, and publishes that same tarball when approved. npm trusted publishing/OIDC should be configured; no long-lived npm token is required.

Package registry publication and GitHub Release creation are external actions and must not be performed autonomously.
