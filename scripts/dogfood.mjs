import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "../dist/analyze.js";
import { renderHtmlReport } from "../dist/report/html.js";
import { renderTerminalReport } from "../dist/report/terminal.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(projectRoot, "work");
const target = await mkdtemp(path.join(os.tmpdir(), "proofdiff-dogfood-"));
const exclusions = new Set([".git", "node_modules", "work", "outputs"]);

try {
  await cp(projectRoot, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(projectRoot, source);
      if (relative === "") return true;
      const first = relative.split(path.sep)[0];
      return first !== undefined && !exclusions.has(first) && !relative.endsWith(".tgz");
    },
  });
  await symlink(path.join(projectRoot, "node_modules"), path.join(target, "node_modules"), "dir");
  const evidencePath = path.join(target, "src", "evidence.ts");
  const currentEvidence = await readFile(evidencePath, "utf8");
  const baselineEvidence = currentEvidence.replace('score += 70; reasons.push("An applicable verification check failed.");', 'score += 65; reasons.push("An applicable verification check failed.");');
  if (baselineEvidence === currentEvidence) throw new Error("Dogfood baseline marker was not found.");
  await writeFile(evidencePath, baselineEvidence);

  execFileSync("git", ["init", "-q"], { cwd: target });
  execFileSync("git", ["config", "user.email", "dogfood@example.invalid"], { cwd: target });
  execFileSync("git", ["config", "user.name", "ProofDiff Dogfood"], { cwd: target });
  execFileSync("git", ["add", "."], { cwd: target });
  execFileSync("git", ["commit", "-qm", "dogfood baseline"], { cwd: target });
  await writeFile(evidencePath, currentEvidence);

  const report = await analyzeRepository({ repo: target, runChecks: true, timeoutMs: 120_000 });
  report.repository.root = "/dogfood/proofdiff";
  report.repository.name = "proofdiff";
  await mkdir(scratchRoot, { recursive: true });
  await writeFile(path.join(scratchRoot, "dogfood-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(scratchRoot, "dogfood-report.html"), renderHtmlReport(report));
  await writeFile(path.join(scratchRoot, "dogfood-terminal.txt"), `${renderTerminalReport(report, { color: false, width: 100 }).trimStart()}\n`);

  assert.equal(report.summary.filesChanged, 1);
  assert.equal(report.assessments[0]?.file.path, "src/evidence.ts");
  assert.equal(report.summary.overallStatus, "partially-verified", "Filename-based compiled mappings must not verify TypeScript source identity");
  assert.deepEqual(report.assessments[0]?.executedTests, []);
  assert.deepEqual(report.checks.map((check) => check.id).sort(), ["js:lint:lint", "js:test:test", "js:test:test:targeted", "js:typecheck:typecheck"]);
  assert.ok(report.checks.every((check) => check.status === "passed"), "Every discovered check must pass");
  const targeted = report.checks.find((check) => check.id === "js:test:test:targeted");
  assert.ok(targeted?.targetQualifications?.length, "Dogfood must qualify related compiled targets");
  assert.ok(targeted.targetQualifications.every((target) => target.basis === "compiled-source-map" && target.confidence === "medium"));
  const observations = targeted.targetObservations ?? [];
  assert.deepEqual(observations.map((item) => item.path).sort(), targeted.targetQualifications.map((item) => item.path).sort());
  assert.ok(observations.every((item) => item.outcome === "passed" && item.testsObserved > 0), "Each compiled target must have a positive passing observation");
  process.stdout.write(`Dogfood passed: all ${report.checks.length} checks passed and ${observations.length} compiled targets had positive observations; TypeScript source evidence correctly remained partially verified.\n`);
} finally {
  await rm(target, { recursive: true, force: true });
}
