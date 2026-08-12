#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(projectRoot, "evaluation", "corpus.json");

function parseArgs(argv) {
  const options = { cases: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (["--cache", "--proofdiff-root", "--output", "--case"].includes(argument)) {
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--case") options.cases.push(value);
      else options[argument.slice(2).replace("-root", "Root")] = value;
      index += 1;
      continue;
    }
    if (argument === "--help") return "help";
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.cache) throw new Error("--cache is required; use an explicit scratch directory dedicated to external clones");
  if (!options.proofdiffRoot) throw new Error("--proofdiff-root is required; pass a clean worktree for the candidate commit");
  return options;
}

function usage() {
  return `Usage: node scripts/evaluation/run-external.mjs \\
  --cache <scratch-directory> \\
  --proofdiff-root <clean-proofdiff-worktree> \\
  [--output evaluation/results.json] [--case <case-id> ...]

The command acquires pinned public repositories and performs static analysis only.
It never installs dependencies or passes --run-checks.
`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = options.inherit ? "" : `\n${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`${command} ${args.join(" ")} failed with status ${String(result.status)}${detail}`);
  }
  return options.inherit ? "" : result.stdout;
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

function safeScratchRoot(value) {
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root || resolved === projectRoot || !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("--cache must be an explicit child of this workspace, such as work/evaluation-corpus");
  }
  return resolved;
}

function normalizeRemote(value) {
  return value.trim().replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
}

async function acquireRepository(repository, cacheRoot) {
  const destination = path.join(cacheRoot, repository.id);
  if (!(await exists(path.join(destination, ".git")))) {
    if (await exists(destination)) throw new Error(`Refusing to reuse non-Git destination: ${destination}`);
    await mkdir(destination, { recursive: true });
    run("git", ["init", "-q"], { cwd: destination });
    run("git", ["remote", "add", "origin", repository.url], { cwd: destination });
  }
  const actualRemote = normalizeRemote(run("git", ["remote", "get-url", "origin"], { cwd: destination }));
  if (actualRemote !== normalizeRemote(repository.url)) {
    throw new Error(`Remote mismatch for ${repository.id}: ${actualRemote}`);
  }
  run("git", ["fetch", "--quiet", "--depth=1", "--filter=blob:none", "origin", repository.commit], { cwd: destination });
  run("git", ["checkout", "--quiet", "--detach", "--force", repository.commit], { cwd: destination });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: destination }).trim();
  if (head !== repository.commit) throw new Error(`Pinned commit mismatch for ${repository.id}: ${head}`);
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: destination }).trim();
  if (status) throw new Error(`External clone is not clean before evaluation: ${repository.id}\n${status}`);
  return destination;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

async function validateChain(root, review) {
  for (const edge of review.chain) {
    const from = path.join(root, edge.from);
    const to = path.join(root, edge.to);
    if (!(await exists(from)) || !(await exists(to))) return false;
    const source = await readFile(from, "utf8");
    if (!source.includes(edge.specifier)) return false;
  }
  return true;
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function pathGroup(file) {
  const parts = file.split("/");
  return parts.length > 2 ? parts.slice(0, 3).join("/") : file;
}

function hasTestFilename(file) {
  return /(?:^|\/)(?:test|test_[^/]+|test-[^/]+|[^/]+-(?:test|spec)|[^/]+_(?:test|spec)|[^/]+\.(?:test|spec))\.(?:[cm]?[jt]sx?|pyi?)$/i.test(file);
}

function assertManifest(manifest) {
  if (manifest.schemaVersion !== "1.0") throw new Error("Unsupported corpus schemaVersion");
  if (!/^[0-9a-f]{40}$/.test(manifest.proofdiffBaseline?.commit ?? "")) throw new Error("Invalid baseline commit");
  const repositoryIds = new Set();
  for (const repository of manifest.repositories ?? []) {
    if (repositoryIds.has(repository.id)) throw new Error(`Duplicate repository id: ${repository.id}`);
    repositoryIds.add(repository.id);
    if (!/^[0-9a-f]{40}$/.test(repository.commit)) throw new Error(`Invalid commit for ${repository.id}`);
    if (!Number.isInteger(repository.trackedFileCount) || !Number.isInteger(repository.sourceFileCount)) throw new Error(`Invalid file counts for ${repository.id}`);
  }
  const caseIds = new Set();
  for (const item of manifest.cases ?? []) {
    if (caseIds.has(item.id)) throw new Error(`Duplicate case id: ${item.id}`);
    caseIds.add(item.id);
    if (!repositoryIds.has(item.repository)) throw new Error(`Unknown repository ${item.repository} in ${item.id}`);
    if (item.mutation?.operation !== "append" || !item.mutation.path || typeof item.mutation.content !== "string") throw new Error(`Invalid mutation in ${item.id}`);
    if (!["clear", "ambiguous"].includes(item.relationshipReview?.strength)) throw new Error(`Invalid relationship strength in ${item.id}`);
    if (!Array.isArray(item.expectedCheckIds)) throw new Error(`Missing expectedCheckIds in ${item.id}`);
  }
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed === "help") {
  process.stdout.write(usage());
  process.exit(0);
}

const cacheRoot = safeScratchRoot(parsed.cache);
const proofdiffRoot = path.resolve(parsed.proofdiffRoot);
const outputPath = path.resolve(parsed.output ?? path.join(projectRoot, "evaluation", "results.candidate.json"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assertManifest(manifest);
await mkdir(cacheRoot, { recursive: true });

const candidateCommit = run("git", ["rev-parse", "HEAD"], { cwd: proofdiffRoot }).trim();
if (!/^[0-9a-f]{40}$/.test(candidateCommit)) throw new Error("Could not resolve candidate ProofDiff commit");
const candidateStatus = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: proofdiffRoot }).trim();
if (candidateStatus) throw new Error(`ProofDiff candidate worktree must be clean:\n${candidateStatus}`);

const analyzeModule = await import(pathToFileURL(path.join(proofdiffRoot, "dist", "analyze.js")).href);
const gitModule = await import(pathToFileURL(path.join(proofdiffRoot, "dist", "git.js")).href);
const graphModule = await import(pathToFileURL(path.join(proofdiffRoot, "dist", "graph.js")).href);
const utilModule = await import(pathToFileURL(path.join(proofdiffRoot, "dist", "util.js")).href);

const selectedIds = new Set(parsed.cases);
for (const id of selectedIds) {
  if (!manifest.cases.some((item) => item.id === id)) throw new Error(`Unknown case id: ${id}`);
}
const selectedCases = selectedIds.size === 0 ? manifest.cases : manifest.cases.filter((item) => selectedIds.has(item.id));
const repositoryById = new Map(manifest.repositories.map((repository) => [repository.id, repository]));
const results = [];

for (const item of selectedCases) {
  const repository = repositoryById.get(item.repository);
  process.stdout.write(`Evaluating ${item.id} (${repository.identity}@${repository.commit.slice(0, 12)})\n`);
  const root = await acquireRepository(repository, cacheRoot);
  const mutationTarget = path.join(root, item.mutation.path);
  if (!(await exists(mutationTarget))) throw new Error(`Mutation target is missing for ${item.id}: ${item.mutation.path}`);
  try {
    await appendFile(mutationTarget, item.mutation.content, "utf8");
    const changedPaths = run("git", ["diff", "--name-only"], { cwd: root }).trim().split("\n").filter(Boolean);
    if (changedPaths.length !== 1 || changedPaths[0] !== item.mutation.path) {
      throw new Error(`Mutation scope mismatch for ${item.id}: ${changedPaths.join(", ")}`);
    }

    const started = performance.now();
    const report = await analyzeModule.analyzeRepository({
      repo: root,
      runChecks: false,
      now: () => new Date("2000-01-01T00:00:00.000Z"),
    });
    const durationMs = Math.round(performance.now() - started);
    if (report.trust.repositoryCodeExecuted !== false || report.checks.some((check) => check.status !== "not-run")) {
      throw new Error(`Static-only trust invariant failed for ${item.id}`);
    }
    const assessment = report.assessments.find((candidate) => candidate.file.path === item.mutation.path);
    if (!assessment) throw new Error(`No changed-file assessment for ${item.id}`);

    const inventory = await gitModule.listRepositoryFiles(root);
    const graph = await graphModule.buildRepositoryGraph(root, inventory.files, report.assessments.map((candidate) => candidate.file));
    const trackedFiles = run("git", ["ls-files"], { cwd: root }).split("\n").filter(Boolean).length;
    if (trackedFiles !== repository.trackedFileCount) {
      throw new Error(`Tracked-file count drift for ${repository.id}: manifest ${repository.trackedFileCount}, observed ${trackedFiles}`);
    }
    const sourceCandidates = inventory.files.filter((file) => utilModule.SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const analysisEntries = [...graph.analyses.entries()];
    const analyses = analysisEntries.map(([, analysis]) => analysis);
    const parserFallbacks = analyses.filter((analysis) => /fallback/i.test(analysis.parser)).length;
    const fallbackPathGroups = Object.fromEntries(
      Object.entries(analysisEntries
        .filter(([, analysis]) => /fallback/i.test(analysis.parser))
        .reduce((counts, [file]) => ({ ...counts, [pathGroup(file)]: (counts[pathGroup(file)] ?? 0) + 1 }), {}))
        .sort(([, left], [, right]) => right - left),
    );
    const diagnosticCount = graph.diagnostics.length + analyses.reduce((total, analysis) => total + analysis.diagnostics.length, 0);
    const diagnosticSamples = [
      ...graph.diagnostics,
      ...analysisEntries.flatMap(([file, analysis]) => analysis.diagnostics.map((diagnostic) => `${file}: ${diagnostic}`)),
    ].slice(0, 12).map((diagnostic) => diagnostic.slice(0, 500));
    const changedFileAnalysis = graph.analyses.get(item.mutation.path);
    const resolvedDependencyEdges = [...graph.dependencies.values()].reduce((total, dependencies) => total + dependencies.size, 0);
    const staticImportObservations = analyses.reduce((total, analysis) => total + analysis.imports.length, 0);

    const expectedTests = sorted(item.relationshipReview.expectedTests);
    const foundExpectedTests = expectedTests.filter((test) => assessment.relatedTests.includes(test));
    const missedExpectedTests = expectedTests.filter((test) => !assessment.relatedTests.includes(test));
    const relationshipClassification = item.relationshipReview.strength === "ambiguous"
      ? "ambiguous"
      : missedExpectedTests.length === 0 ? "clearly-expected-found" : "clearly-expected-missed";
    const chainValidated = await validateChain(root, item.relationshipReview);
    if (item.relationshipReview.strength === "clear" && !chainValidated) throw new Error(`Ground-truth chain no longer validates for ${item.id}`);

    const discoveredIds = sorted(report.discoveredChecks.map((check) => check.id));
    const expectedIds = sorted(item.expectedCheckIds);
    const foundExpectedIds = expectedIds.filter((id) => discoveredIds.includes(id));
    const missedExpectedIds = expectedIds.filter((id) => !discoveredIds.includes(id));
    const targetRunners = sorted(report.discoveredChecks.flatMap((check) => check.targetRunner ? [check.targetRunner] : []));
    const targetedDefinitions = sorted(report.discoveredChecks.filter((check) => (check.targetFiles?.length ?? 0) > 0).map((check) => check.id));

    results.push({
      id: item.id,
      repository: repository.identity,
      commit: repository.commit,
      changeType: item.changeType,
      evaluationMode: "static-only",
      durationMs,
      inventory: {
        trackedFiles,
        manifestTrackedFiles: repository.trackedFileCount,
        inventoryFiles: inventory.files.length,
        supportedSourceCandidates: sourceCandidates.length,
        truncated: inventory.truncated,
      },
      structuralAnalysis: {
        analyzedFiles: analyses.length,
        parserCounts: countBy(analyses, "parser"),
        confidenceCounts: countBy(analyses, "confidence"),
        parserFallbacks,
        fallbackPathGroups,
        diagnosticCount,
        diagnosticSamples,
        changedFileParser: changedFileAnalysis ? {
          parser: changedFileAnalysis.parser,
          confidence: changedFileAnalysis.confidence,
          diagnostics: changedFileAnalysis.diagnostics,
        } : null,
        resolvedDependencyEdges,
        staticImportObservations,
        testFilesClassified: graph.testFiles.size,
      },
      assessment: {
        path: assessment.file.path,
        language: assessment.file.language,
        status: assessment.status,
        changedSymbols: assessment.changedSymbols.map((symbol) => symbol.name),
        relatedTests: assessment.relatedTests,
        relatedTestShapes: {
          filenamePattern: assessment.relatedTests.filter(hasTestFilename).length,
          directoryOnly: assessment.relatedTests.filter((test) => !hasTestFilename(test)).length,
        },
        impactedFileCount: assessment.impactedFiles.length,
        limitations: assessment.limitations,
      },
      relationship: {
        groundTruthStrength: item.relationshipReview.strength,
        expectedTests,
        foundExpectedTests,
        missedExpectedTests,
        classification: relationshipClassification,
        chainValidated,
      },
      checks: {
        expectedIds,
        discoveredIds,
        foundExpectedIds,
        missedExpectedIds,
        targetRunners,
        targetedDefinitions,
      },
      reportNotes: report.notes,
      trust: report.trust,
    });
    process.stdout.write(`  ${relationshipClassification}; ${discoveredIds.length} checks; ${durationMs} ms\n`);
  } finally {
    run("git", ["checkout", "--quiet", "--detach", "--force", repository.commit], { cwd: root });
  }
}

const cpus = os.cpus();
const output = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  proofdiff: { commit: candidateCommit, version: analyzeModule.VERSION },
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
  },
  cases: results,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
for (const localPath of [cacheRoot, proofdiffRoot, projectRoot, os.homedir()]) {
  if (localPath.length > 1 && serialized.includes(localPath)) throw new Error(`Result contains a local absolute path: ${localPath}`);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, "utf8");
process.stdout.write(`Wrote ${results.length} static-only observations to ${path.relative(projectRoot, outputPath)}\n`);
