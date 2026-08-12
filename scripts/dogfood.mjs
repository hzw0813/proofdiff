import { execFileSync } from "node:child_process";
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

  if (report.summary.filesChanged !== 1 || report.summary.overallStatus !== "verified" || report.checks.some((check) => check.status !== "passed")) {
    throw new Error(`Dogfood invariant failed: ${report.summary.filesChanged} files, ${report.summary.overallStatus}, checks ${report.checks.map((check) => check.status).join(", ")}.`);
  }
  process.stdout.write(`Dogfood passed: ${report.assessments[0].file.path} was ${report.summary.overallStatus} by ${report.checks.length} checks.\n`);
} finally {
  await rm(target, { recursive: true, force: true });
}
