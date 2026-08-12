import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "../dist/analyze.js";
import { renderHtmlReport } from "../dist/report/html.js";
import { renderTerminalReport } from "../dist/report/terminal.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(projectRoot, "examples");
const scenarioOutputRoot = path.join(examplesRoot, "scenarios");
const fixedDate = "2026-08-12T00:00:00.000Z";

const scenarios = [
  {
    id: "mixed-evidence",
    fixture: path.join(projectRoot, "fixtures", "demo"),
    repository: "acme-checkout",
    title: "Mixed evidence",
    description: "A dependency-impact change has an explicitly executed related test; a Python retry change has no applicable verification.",
    expected: { status: "partially-verified", files: 2, counts: { verified: 1, unverified: 1 } },
    primary: true,
  },
  {
    id: "opaque-test-script",
    fixture: path.join(projectRoot, "fixtures", "scenarios", "opaque-test-script"),
    repository: "access-control",
    title: "Passing, but not observed",
    description: "The repository test command passes while excluding the related test. ProofDiff refuses to call the changed file verified.",
    expected: { status: "partially-verified", files: 1, counts: { "partially-verified": 1 } },
  },
  {
    id: "failing-check",
    fixture: path.join(projectRoot, "fixtures", "scenarios", "failing-check"),
    repository: "billing-service",
    title: "Verification failed",
    description: "A tax calculation regression is connected to a related test that executes and fails.",
    expected: { status: "verification-failed", files: 1, counts: { "verification-failed": 1 } },
  },
  {
    id: "unsupported-change",
    fixture: path.join(projectRoot, "fixtures", "scenarios", "unsupported-change"),
    repository: "policy-engine",
    title: "Unknown and unsupported",
    description: "A Rego policy change has no language adapter or discovered check, so the report stays explicitly unknown.",
    expected: { status: "unknown", files: 1, counts: { unknown: 1 } },
  },
];

function git(directory, args, env) {
  execFileSync("git", args, { cwd: directory, ...(env ? { env } : {}) });
}

async function generateScenario(scenario) {
  const work = await mkdtemp(path.join(os.tmpdir(), `proofdiff-${scenario.id}-`));
  try {
    await cp(path.join(scenario.fixture, "base"), work, { recursive: true });
    git(work, ["init", "-q"]);
    git(work, ["config", "user.email", "demo@example.invalid"]);
    git(work, ["config", "user.name", "ProofDiff Demo"]);
    git(work, ["add", "."]);
    git(work, ["commit", "-qm", "baseline"], { ...process.env, GIT_AUTHOR_DATE: fixedDate, GIT_COMMITTER_DATE: fixedDate });
    await cp(path.join(scenario.fixture, "after"), work, { recursive: true, force: true });

    const report = await analyzeRepository({ repo: work, runChecks: true, timeoutMs: 20_000, now: () => new Date(fixedDate) });
    report.repository.root = `/demo/${scenario.repository}`;
    report.repository.name = scenario.repository;
    if (report.summary.filesChanged !== scenario.expected.files || report.summary.overallStatus !== scenario.expected.status) {
      throw new Error(`${scenario.id}: expected ${scenario.expected.files} files and ${scenario.expected.status}, received ${report.summary.filesChanged} and ${report.summary.overallStatus}.`);
    }
    for (const [status, count] of Object.entries(scenario.expected.counts)) {
      if (report.summary.counts[status] !== count) throw new Error(`${scenario.id}: expected ${count} ${status} files, received ${report.summary.counts[status]}.`);
    }

    const html = renderHtmlReport(report);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const terminal = `${renderTerminalReport(report, { color: false, width: 100 }).trimStart()}\n`;
    const baseName = scenario.primary ? "demo-report" : path.join("scenarios", scenario.id);
    await writeFile(path.join(examplesRoot, `${baseName}.html`), html);
    await writeFile(path.join(examplesRoot, `${baseName}.json`), json);
    await writeFile(path.join(examplesRoot, scenario.primary ? "demo-terminal.txt" : `${baseName}.txt`), terminal);
    return { ...scenario, report, terminal, reportLink: `${baseName}.html` };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function gallery(results) {
  const statusLabel = { verified: "Verified", "partially-verified": "Partially verified", unverified: "Unverified", unknown: "Unknown", "verification-failed": "Verification failed" };
  const cards = results.map((result, index) => {
    const summary = result.report.summary;
    const counts = Object.entries(summary.counts).filter(([, count]) => count > 0).map(([status, count]) => `<span><b>${count}</b> ${escapeHtml(statusLabel[status])}</span>`).join("");
    const excerpt = result.terminal.split("\n").filter((line) => /^(?:VERIFIED|PARTIAL|UNVERIFIED|UNKNOWN|FAILED|\s{2}Evidence:|\s{2}Executed tests:)/.test(line)).slice(0, 4).join("\n");
    return `<article class="scenario ${escapeHtml(summary.overallStatus)}"><div class="number">0${index + 1}</div><div class="scenario-body"><div class="scenario-top"><span class="status">${escapeHtml(statusLabel[summary.overallStatus])}</span><span class="risk">highest risk ${escapeHtml(summary.highestRisk ?? "none")}</span></div><h2>${escapeHtml(result.title)}</h2><p>${escapeHtml(result.description)}</p><div class="counts">${counts}</div><pre>${escapeHtml(excerpt)}</pre><a href="${escapeHtml(result.reportLink)}">Open full evidence report <span>→</span></a></div></article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:"><title>ProofDiff · Truthful demo scenarios</title><style>
  :root{--bg:#07090d;--panel:#111720;--line:#293543;--text:#f1f5f9;--muted:#9ba9ba;--cyan:#6ce0ef;--green:#5ce0a1;--yellow:#f6cd70;--red:#ff7686;--purple:#bda5ff}*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:radial-gradient(circle at 10% 0,#113242,transparent 30%),radial-gradient(circle at 90% 0,#261b45,transparent 28%),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}main{width:min(1160px,calc(100% - 32px));margin:auto;padding:64px 0 80px}.eyebrow{color:var(--cyan);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(42px,7vw,76px);line-height:.98;letter-spacing:-.055em;max-width:950px;margin:18px 0;overflow-wrap:anywhere}header>p{font-size:19px;color:var(--muted);max-width:760px}.legend{display:flex;gap:9px;flex-wrap:wrap;margin:30px 0 44px}.legend span{padding:6px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px}.legend i{width:7px;height:7px;display:inline-block;border-radius:50%;margin-right:7px}.legend span:nth-child(1) i{background:var(--green)}.legend span:nth-child(2) i{background:var(--yellow)}.legend span:nth-child(3) i{background:var(--purple)}.legend span:nth-child(4) i{background:var(--muted)}.legend span:nth-child(5) i{background:var(--red)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;min-width:0}.scenario{display:grid;grid-template-columns:54px minmax(0,1fr);min-width:0;background:linear-gradient(145deg,#141b24e8,#0d1219e8);border:1px solid var(--line);border-radius:18px;overflow:hidden;min-height:380px}.number{padding:22px 14px;color:#607083;font:700 12px ui-monospace,monospace;border-right:1px solid var(--line)}.scenario-body{min-width:0;padding:22px}.scenario-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.status{font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:11px}.risk{color:var(--muted);font-size:11px}.scenario.partially-verified .status{color:var(--yellow)}.scenario.verification-failed .status{color:var(--red)}.scenario.unknown .status{color:var(--muted)}h2{font-size:25px;margin:14px 0 5px;letter-spacing:-.02em}.scenario p{color:var(--muted);min-height:70px}.counts{display:flex;gap:7px;flex-wrap:wrap}.counts span{padding:5px 8px;background:#ffffff08;border-radius:7px;font-size:11px;color:var(--muted)}.counts b{color:var(--text)}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;min-height:76px;margin:18px 0;background:#05070a;border:1px solid #202a36;border-radius:10px;padding:11px;color:#bdc9d6;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;overflow:hidden}.scenario a{color:var(--cyan);font-weight:700;text-decoration:none}.scenario a span{transition:.2s}.scenario a:hover span{margin-left:5px}footer{text-align:center;color:#68778a;font-size:12px;margin-top:38px}@media(max-width:780px){main{padding-top:36px}.grid{grid-template-columns:minmax(0,1fr)}.scenario{grid-template-columns:38px minmax(0,1fr);min-height:0}.number{padding:18px 10px}.scenario-body{padding:18px 16px}.scenario-top{align-items:flex-start;flex-direction:column;gap:2px}.scenario p{min-height:auto}h1{font-size:clamp(40px,13vw,58px)}header>p{font-size:17px}}@media print{body{background:#fff;color:#111}.scenario{background:#fff;break-inside:avoid}.scenario p,.risk,.legend span{color:#444}}
  </style></head><body><main><header><div class="eyebrow">ProofDiff · real product output</div><h1>Four changes. Five evidence states. No invented certainty.</h1><p>Every result below was generated from an actual Git diff and actual ProofDiff execution. Green evidence stays narrow; missing or failing evidence stays visible.</p><div class="legend"><span><i></i>Verified</span><span><i></i>Partially verified</span><span><i></i>Unverified</span><span><i></i>Unknown</span><span><i></i>Verification failed</span></div></header><section class="grid">${cards}</section><footer>Generated locally by ProofDiff · no fabricated results · ${fixedDate}</footer></main></body></html>`;
}

await mkdir(scenarioOutputRoot, { recursive: true });
const results = [];
for (const scenario of scenarios) results.push(await generateScenario(scenario));
await writeFile(path.join(examplesRoot, "demo-gallery.html"), gallery(results));
process.stdout.write(`Generated ${results.length} truthful scenarios: ${results.map((result) => `${result.id}=${result.report.summary.overallStatus}`).join(", ")}.\n`);
