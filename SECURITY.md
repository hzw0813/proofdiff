# Security policy

## Supported versions

Security fixes are applied to the latest released minor version. ProofDiff is currently pre-1.0.

## Threat model

Assume the target repository, its filenames, source text, Git history, manifests, tests, tools, and command output are malicious.

The `.git` directory itself is a separate trust boundary. Git's own documentation warns that an attacker-supplied Git directory can cause commands to execute configuration and hooks. Analyze a clone/worktree created by your trusted Git installation; do not unpack an untrusted `.git` directory and treat it as inert data.

ProofDiff's safe default performs these local operations:

- invokes the system `git` executable with fixed options and argument arrays, a minimal environment, external diff/text conversion disabled, filesystem monitoring and hooks disabled, system/global config ignored, and locally named content/diff drivers overridden;
- reads Git-listed files inside the selected repository;
- parses JavaScript/TypeScript as data with Babel;
- parses bounded repository-owned `tsconfig.json` JSONC and `package.json` JSON as data for a narrow static-resolution subset, rejecting metadata symlinks, traversal, `node_modules`, unsupported/ambiguous mappings, and targets outside the repository or owning package;
- parses Python source with `python -I -S` and `ast.parse`, without importing it;
- writes reports only to paths explicitly requested by the user;
- performs no network requests and sends no telemetry.

User-controlled revisions cannot begin with `-` or contain control/whitespace characters. ProofDiff's process launcher disables Node's shell mode. Git and parser operations are always started directly; on Windows, explicitly selected npm, pnpm, and Yarn checks use `cmd.exe` only to start the standard `.cmd` package-manager shim with fixed arguments. Package managers may then interpret their own configuration only within the documented boundaries. Filenames and report content are HTML-escaped; terminal control characters from untrusted report fields and check output are removed. GitHub job summaries HTML-escape repository-controlled paths, project analysis notes into fixed source-free categories (malformed/non-applicable compiler configuration, unsupported/ambiguous local resolution, unavailable source analysis, and explicit bounds), and omit source text, parser excerpts, symbols, commands, check output, observer payloads, and absolute repository paths. Malformed `package.json` produces a fixed parse note rather than copying the parser's source excerpt. Unclassified diagnostics are represented only by a count and cause the summary to recommend inspecting static limitations before runtime evidence. The Action writes only to GitHub's per-step summary file and does not require a write-capable token or call the GitHub API.

## Repository check execution

`--run-checks` crosses a trust boundary. Package scripts and tests are arbitrary programs with the operating-system permissions of the user running ProofDiff. ProofDiff:

- requires explicit opt-in;
- discovers only conventional test/typecheck/lint entry points;
- starts commands directly except for the fixed Windows package-manager shim bridge described above;
- supplies a minimal environment without inherited tokens or credentials;
- replaces `HOME`/`USERPROFILE` with the temporary directory;
- caps captured output and removes common secret patterns;
- uses fixed, repository-file-free Node/pytest/unittest observer code and a separate 64 KB control pipe for structured per-target counts;
- enforces a timeout and terminates the descendant process tree with operating-system-native mechanisms.

Runner qualification is static and data-only. pytest configuration reads are bounded and support only the filename fields ProofDiff needs; configuration code and plugins are not executed during static analysis. When checks are explicitly enabled, runner execution can still load repository tests, pytest plugins, import hooks, and other arbitrary code. Observer records are accepted only when their schema, runner identity, exact normalized targets, counts, and completeness match; truncated, malformed, duplicate, missing, and unmatched data is discarded rather than trusted.

These measures are defense in depth, **not a sandbox**. A command can still read accessible files, use the network, spawn processes, exploit installed tools, or persist outside the repository. Use a disposable VM/container with network and secrets removed when executing checks from untrusted contributions. On pull requests from forks, keep `run-checks: false` unless the code has been reviewed.

## Data handling

Terminal, JSON, and HTML reports can contain repository paths, symbol names, relationships, target-qualification reasons, per-target counts, check commands, and bounded check output. Owned inline observer source is abbreviated in the HTML command display but remains present in machine-readable JSON for reproducibility. Treat reports as repository-sensitive artifacts. The HTML report is self-contained, loads no remote resources, and has a restrictive Content Security Policy, but anyone receiving it can read its contents. The shorter GitHub job summary still contains changed and test-target paths; users with access to the workflow run can read them.

No telemetry, analytics, update checks, remote APIs, or source-code uploads exist in ProofDiff.

Static module resolution does not execute configuration or repository code. It does not invoke TypeScript, Node resolution, a bundler, package manager, lifecycle script, or installed dependency. Compiler inheritance and project membership are limited to bounded repository-relative data; a hidden nearer config, excluded importer, unsupported selector, JavaScript importer without `allowJs`, or output-directory file creates no edge. Post-`paths` probing is mode-gated and bounded: explicit extension substitution follows fixed TypeScript families, extensionless file/index lookup requires explicit Bundler or Node10 configuration, and unmodeled NodeNext context, directory package metadata, suffix precedence, or extensions create no edge. Package identity requires an inventory-visible nearest physical boundary and explicit export-aware compiler mode; hidden package metadata and potentially active unmodeled conditions fail closed. Successful non-relative edges remain relationship evidence rather than execution evidence.

## Vulnerability reporting

Please use this repository's [private vulnerability reporting form](https://github.com/hzw0813/proofdiff/security/advisories/new) for suspected vulnerabilities. Do not open a public issue.

Include affected versions, a minimal reproduction, impact, and any suggested mitigation. Avoid including real secrets or private source code.
