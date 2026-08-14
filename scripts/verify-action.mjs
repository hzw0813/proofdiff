import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedRoots = new Set([".git", "coverage", "dist-test", "node_modules", "outputs", "work"]);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cleanNpmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_")));

async function run(command, args, cwd, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code === (options.expectedCode ?? 0)) resolve(result);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "proofdiff-action-smoke-"));
const actionRoot = path.join(temporaryRoot, "action");
const fixtureRoot = path.join(temporaryRoot, "repository");
const outputRoot = path.join(temporaryRoot, "reports");

try {
  await mkdir(actionRoot, { recursive: true });
  for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
    if (excludedRoots.has(entry.name)) continue;
    await cp(path.join(projectRoot, entry.name), path.join(actionRoot, entry.name), { recursive: true });
  }

  const copiedPackage = JSON.parse(await readFile(path.join(actionRoot, "package.json"), "utf8"));
  const copiedLock = JSON.parse(await readFile(path.join(actionRoot, "package-lock.json"), "utf8"));
  assert.equal(copiedPackage.name, "proofdiff");
  assert.equal(copiedLock.packages?.[""]?.name, "proofdiff");

  const actionDefinition = await readFile(path.join(actionRoot, "action.yml"), "utf8");
  assert.match(actionDefinition, /uses: actions\/setup-node@v7/);
  assert.match(actionDefinition, /node-version: 24/);
  assert.match(actionDefinition, /package-manager-cache: "false"/);
  assert.match(actionDefinition, /working-directory: \$\{\{ github\.action_path \}\}/);
  assert.match(actionDefinition, /run: npm ci --ignore-scripts --omit=dev/);
  assert.match(actionDefinition, /auto-resolves the exact PR base SHA/);
  assert.match(actionDefinition, /pull_request_target, which fails closed/);
  assert.match(actionDefinition, /resolve-action-base\.mjs/);
  assert.match(actionDefinition, /job-summary:/);
  assert.match(actionDefinition, /default: "true"/);
  assert.match(actionDefinition, /test-map:/);
  assert.match(actionDefinition, /PROOFDIFF_TEST_MAP: \$\{\{ inputs\['test-map'\] \}\}/);
  assert.match(actionDefinition, /args\+=\(--test-map "\$PROOFDIFF_TEST_MAP"\)/);
  assert.match(actionDefinition, /coverage-lcov:/);
  assert.match(actionDefinition, /coverage-commit:/);
  assert.match(actionDefinition, /PROOFDIFF_COVERAGE_LCOV: \$\{\{ inputs\['coverage-lcov'\] \}\}/);
  assert.match(actionDefinition, /PROOFDIFF_COVERAGE_COMMIT: \$\{\{ inputs\['coverage-commit'\] \}\}/);
  assert.match(actionDefinition, /args\+=\(--coverage-lcov "\$PROOFDIFF_COVERAGE_LCOV" --coverage-commit "\$PROOFDIFF_COVERAGE_COMMIT"\)/);
  assert.match(actionDefinition, /--github-summary "\$GITHUB_STEP_SUMMARY"/);
  assert.match(actionDefinition, /node "\$GITHUB_ACTION_PATH\/dist\/cli\.js" "\$\{args\[@\]\}"/);

  await run(npmCommand, ["ci", "--ignore-scripts", "--omit=dev"], actionRoot, { env: cleanNpmEnvironment });
  assert.equal(await exists(path.join(actionRoot, "node_modules", "@babel", "parser")), true, "runtime parser dependency was not installed");
  assert.equal(await exists(path.join(actionRoot, "node_modules", "typescript")), false, "Action installation unexpectedly included dev dependencies");

  await cp(path.join(projectRoot, "fixtures", "demo", "base"), fixtureRoot, { recursive: true });
  await run("git", ["init", "-q"], fixtureRoot);
  await run("git", ["config", "user.email", "action-smoke@example.invalid"], fixtureRoot);
  await run("git", ["config", "user.name", "ProofDiff Action Smoke"], fixtureRoot);
  await run("git", ["add", "."], fixtureRoot);
  await run("git", ["commit", "-qm", "baseline"], fixtureRoot);
  const base = (await run("git", ["rev-parse", "HEAD"], fixtureRoot)).stdout.trim();
  await cp(path.join(projectRoot, "fixtures", "demo", "after"), fixtureRoot, { recursive: true, force: true });
  await run("git", ["add", "."], fixtureRoot);
  await run("git", ["commit", "-qm", "change"], fixtureRoot);
  const head = (await run("git", ["rev-parse", "HEAD"], fixtureRoot)).stdout.trim();
  await mkdir(outputRoot, { recursive: true });

  const resolver = path.join(actionRoot, "scripts", "resolve-action-base.mjs");
  const prEvent = path.join(temporaryRoot, "pull-request-event.json");
  await writeFile(prEvent, `${JSON.stringify({ pull_request: { base: { sha: base } } })}\n`, "utf8");
  const autoResolved = await run(process.execPath, [resolver], fixtureRoot, {
    env: { ...process.env, PROOFDIFF_BASE: "", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: prEvent },
  });
  assert.equal(autoResolved.stdout.trim(), base);

  const explicitResolved = await run(process.execPath, [resolver], fixtureRoot, {
    env: { ...process.env, PROOFDIFF_BASE: base, GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: path.join(temporaryRoot, "missing-event.json") },
  });
  assert.equal(explicitResolved.stdout.trim(), base, "explicit base must win without reading event metadata");

  const pushResolved = await run(process.execPath, [resolver], fixtureRoot, {
    env: { ...process.env, PROOFDIFF_BASE: "", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: path.join(temporaryRoot, "missing-event.json") },
  });
  assert.equal(pushResolved.stdout.trim(), "", "non-PR events must preserve working-tree fallback");

  const pullRequestTarget = await run(process.execPath, [resolver], fixtureRoot, {
    expectedCode: 2,
    env: { ...process.env, PROOFDIFF_BASE: "", GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: prEvent },
  });
  assert.match(pullRequestTarget.stderr, /will not auto-select a pull-request diff on pull_request_target/);
  assert.match(pullRequestTarget.stderr, /Use pull_request for untrusted changes/);

  const missingBaseEvent = path.join(temporaryRoot, "missing-base-event.json");
  await writeFile(missingBaseEvent, `${JSON.stringify({ pull_request: { base: {} } } })}\n`, "utf8");
  const missingBase = await run(process.execPath, [resolver], fixtureRoot, {
    expectedCode: 2,
    env: { ...process.env, PROOFDIFF_BASE: "", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: missingBaseEvent },
  });
  assert.match(missingBase.stderr, /cannot auto-resolve a trustworthy pull-request base commit SHA/);
  assert.match(missingBase.stderr, /Set the Action 'base' input explicitly/);

  const hostileEvent = path.join(temporaryRoot, "hostile-event.json");
  await writeFile(hostileEvent, `${JSON.stringify({ pull_request: { base: { sha: "--help\n$(touch-pwned)" } } })}\n`, "utf8");
  const hostileBase = await run(process.execPath, [resolver], fixtureRoot, {
    expectedCode: 2,
    env: { ...process.env, PROOFDIFF_BASE: "", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: hostileEvent },
  });
  assert.match(hostileBase.stderr, /cannot auto-resolve a trustworthy pull-request base commit SHA/);
  assert.equal(await exists(path.join(fixtureRoot, "touch-pwned")), false);

  const cli = path.join(actionRoot, "dist", "cli.js");
  const staticHtml = path.join(outputRoot, "static.html");
  const staticSummary = path.join(outputRoot, "static-summary.md");
  const staticRun = await run(process.execPath, [cli, "--repo", fixtureRoot, "--base", autoResolved.stdout.trim(), "--fail-on", "failed", "--no-color", "--html", staticHtml, "--github-summary", staticSummary], fixtureRoot);
  assert.match(staticRun.stdout, /UNKNOWN/);
  assert.match(staticRun.stdout, /No repository code was executed/);
  assert.match(await readFile(staticHtml, "utf8"), /Content-Security-Policy/);
  const staticSummaryContent = await readFile(staticSummary, "utf8");
  assert.match(staticSummaryContent, /^## ProofDiff · Change Evidence/);
  assert.match(staticSummaryContent, /\*\*Run mode:\*\* Static only\. No repository code was executed/);
  assert.match(staticSummaryContent, /services\/email\.py/);
  assert.match(staticSummaryContent, /Static relationship only: <code>test\/checkout\.test\.js<\/code>/);
  assert.doesNotMatch(staticSummaryContent, new RegExp(fixtureRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const coverageFile = path.join(outputRoot, "lcov.info");
  await writeFile(coverageFile, "TN:\nSF:src/discount.js\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n", "utf8");
  const coverageRun = await run(process.execPath, [cli, "--repo", fixtureRoot, "--base", base, "--coverage-lcov", coverageFile, "--coverage-commit", head, "--fail-on", "failed", "--no-color"], fixtureRoot);
  assert.match(coverageRun.stdout, /Coverage input: ACCEPTED/);
  assert.match(coverageRun.stdout, /3\/3 changed lines reported with hits by the supplied artifact/);
  assert.match(coverageRun.stdout, /ProofDiff did not execute code to produce it/);
  assert.doesNotMatch(coverageRun.stdout, /changed lines recorded as executed|line-execution evidence/);

  const trustedHtml = path.join(outputRoot, "trusted.html");
  const trustedSummary = path.join(outputRoot, "trusted-summary.md");
  const trustedRun = await run(process.execPath, [cli, "--repo", fixtureRoot, "--base", base, "--run-checks", "--fail-on", "failed", "--no-color", "--html", trustedHtml, "--github-summary", trustedSummary], fixtureRoot);
  assert.match(trustedRun.stdout, /PARTIAL/);
  assert.match(trustedRun.stdout, /Executed tests: test\/checkout\.test\.js/);
  assert.match(trustedRun.stdout, /Repository-defined checks were executed because --run-checks was explicitly supplied/);
  assert.match(await readFile(trustedHtml, "utf8"), /Targeted test outcomes/);
  const trustedSummaryContent = await readFile(trustedSummary, "utf8");
  assert.match(trustedSummaryContent, /\*\*Run mode:\*\* Repository-defined checks ran with explicit consent/);
  assert.match(trustedSummaryContent, /Observed passing target: <code>test\/checkout\.test\.js<\/code>/);
  assert.match(trustedSummaryContent, /does not show that changed code ran or that behavior is correct/);

  process.stdout.write("GitHub Action smoke passed: production-only install, safe PR base auto-resolution, static default, test-map wiring, declared-commit-matched coverage input, trusted checks, base diff, HTML output, and bounded job summaries.\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
