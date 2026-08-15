import { readFile, writeFile } from "node:fs/promises";

const VERSION = "0.5.3";
const PREVIOUS = "0.5.2";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.version !== PREVIOUS) throw new Error(`package.json version was ${pkg.version}, expected ${PREVIOUS}`);
pkg.version = VERSION;
await writeFile("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (lock.version !== PREVIOUS || lock.packages?.[""]?.version !== PREVIOUS) throw new Error("package-lock.json version markers did not match 0.5.2");
lock.version = VERSION;
lock.packages[""].version = VERSION;
await writeFile("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

const analyzePath = "src/analyze.ts";
let analyze = await readFile(analyzePath, "utf8");
const versionMarker = `export const VERSION = "${PREVIOUS}";`;
if (analyze.split(versionMarker).length - 1 !== 1) throw new Error("src/analyze.ts version marker mismatch");
analyze = analyze.replace(versionMarker, `export const VERSION = "${VERSION}";`);
await writeFile(analyzePath, analyze);

const changelogPath = "CHANGELOG.md";
let changelog = await readFile(changelogPath, "utf8");
const marker = "## [Unreleased]\n\n";
if (changelog.split(marker).length - 1 !== 1) throw new Error("CHANGELOG Unreleased marker mismatch");
const section = `## [0.5.3] - 2026-08-15\n\n### Fixed\n\n- Refused to dereference symbolic-link repository source/config/test paths during static reads and exact-target qualification. Working-tree untracked symlinks no longer cause ProofDiff to read their targets, symlinked repository metadata cannot enable checks by existence alone, and symlinked test paths cannot produce exact per-target evidence. Dependency/package-manager environment paths and explicitly supplied external data artifacts keep their existing separate trust rules.\n\n### Changed\n\n- JSON \`schemaVersion: "1.0"\` and the human meaning of \`verified\` remain unchanged: **Related test file passed**. This patch strengthens filesystem/snapshot boundaries and does not claim changed-symbol execution, changed-line execution, assertion relevance, coverage completeness, or correctness.\n\n`;
changelog = changelog.replace(marker, `${marker}${section}`);
await writeFile(changelogPath, changelog);

console.log(`Prepared ProofDiff ${VERSION} metadata.`);
