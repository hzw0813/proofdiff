# GitHub Action PR Auto-Base Decision

Status: implementation candidate; merge requires hosted CI and adversarial review.

## Problem

The composite GitHub Action accepts an optional `base` input. When that input is omitted, it currently falls back to ProofDiff's CLI working-tree mode. A normal `actions/checkout` step leaves a clean working tree, so a first-time pull-request workflow that omits `base` can analyze zero changed files even though the PR contains changes.

The documented workflow avoids this by explicitly passing `${{ github.event.pull_request.base.sha }}`, but the Action default remains a footgun and creates avoidable copy/paste friction.

## Decision

For GitHub `pull_request` and `pull_request_target` events only, when the user does not supply `base`, resolve the exact pull-request base commit SHA from `GITHUB_EVENT_PATH` and pass it to ProofDiff as `--base`.

Rules:

1. An explicit Action `base` input always wins.
2. PR auto-resolution accepts only a bounded hexadecimal commit id from `pull_request.base.sha`.
3. If a PR event lacks a trustworthy base SHA, fail with an actionable error instead of silently falling back to a clean working-tree diff.
4. Non-PR events preserve the historical behavior: omitted `base` means working-tree mode.
5. The resolver only parses GitHub event JSON. It does not execute repository code, call the network, mutate the checkout, or request additional permissions.
6. CLI semantics are unchanged.

## Why this outranks coverage ingestion

The current product already makes evidence boundaries actionable. The highest-value remaining first-run bottleneck is now getting the intended change into the Action analysis at all. Fixing a zero-diff default on the primary PR-native surface is lower risk, lower friction, and more broadly useful than adding stronger-but-harder-to-proven coverage evidence first.

Coverage provenance remains a later candidate because stale or mismatched artifacts can create false-strength claims unless freshness, commit identity, path mapping, partial coverage, and source-map provenance are all handled conservatively.

## Compatibility

Existing workflows that pass `base` are unchanged. Existing non-PR workflows that omit `base` are unchanged. The behavioral change is limited to omitted `base` on PR-family events, where the Action now selects the PR base rather than an empty working-tree diff.

## Validation plan

- resolver tests for explicit override, PR auto-resolution, malformed/missing PR metadata, malicious-looking SHA input, and non-PR fallback;
- source Action smoke with a simulated PR event and a real committed fixture diff;
- full test matrix and `npm pack --dry-run`;
- adversarial review focused on event-data trust, shell injection, compatibility, and false diff selection.
