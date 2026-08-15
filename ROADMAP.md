# Roadmap

ProofDiff prioritizes correctness, trustworthiness, and security over feature count.

## Before 1.0

- Expand runtime coverage ingestion beyond the current LCOV support while keeping coverage a distinct, explicitly commit-bound evidence type; never infer coverage from test names.
- Expand bounded TypeScript path-alias and Python package-root resolution without silently guessing.
- Support check configuration with a reviewed, explicit allowlist format.
- Benchmark and stream analysis for repositories beyond the current 5,000-file cap.
- Add tested adapters for Go and Rust after gathering real repository requirements.

## Non-goals

- Mandatory LLMs, accounts, cloud storage, source upload, or telemetry.
- A numerical “safety percentage.”
- Treating a green test suite, import relationship, or risk score as proof of correctness.
- Automatically executing repository code during default analysis.

Roadmap items are direction, not promises. Release notes describe shipped behavior.
