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
- parses Python source with `python -I -S` and `ast.parse`, without importing it;
- writes reports only to paths explicitly requested by the user;
- performs no network requests and sends no telemetry.

User-controlled revisions cannot begin with `-` or contain control/whitespace characters. ProofDiff's process launcher disables Node's shell mode. Git and parser operations are always started directly; on Windows, explicitly selected npm, pnpm, and Yarn checks use `cmd.exe` only to start the standard `.cmd` package-manager shim with fixed arguments. Package managers may then interpret their own configuration only within the documented boundaries. Filenames and report content are HTML-escaped; terminal control characters from untrusted report fields and check output are removed.

## Repository check execution

`--run-checks` crosses a trust boundary. Package scripts and tests are arbitrary programs with the operating-system permissions of the user running ProofDiff. ProofDiff:

- requires explicit opt-in;
- discovers only conventional test/typecheck/lint entry points;
- starts commands directly except for the fixed Windows package-manager shim bridge described above;
- supplies a minimal environment without inherited tokens or credentials;
- replaces `HOME`/`USERPROFILE` with the temporary directory;
- caps captured output and removes common secret patterns;
- enforces a timeout and terminates the descendant process tree with operating-system-native mechanisms.

These measures are defense in depth, **not a sandbox**. A command can still read accessible files, use the network, spawn processes, exploit installed tools, or persist outside the repository. Use a disposable VM/container with network and secrets removed when executing checks from untrusted contributions. On pull requests from forks, keep `run-checks: false` unless the code has been reviewed.

## Data handling

Reports contain repository paths, symbol names, relationships, check commands, and bounded check output. Treat reports as repository-sensitive artifacts. The HTML report is self-contained, loads no remote resources, and has a restrictive Content Security Policy, but anyone receiving it can read its contents.

No telemetry, analytics, update checks, remote APIs, or source-code uploads exist in ProofDiff.

## Vulnerability reporting

Please use GitHub's private security advisory flow for the eventual public repository. Do not open a public issue for a suspected vulnerability. Until a repository security contact is published, report privately to the project owner through the repository host.

Include affected versions, a minimal reproduction, impact, and any suggested mitigation. Avoid including real secrets or private source code.
