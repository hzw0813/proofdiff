import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "../dist/analyze.js";
import { renderGithubSummary } from "../dist/report/github.js";
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
    description: "A qualified related JavaScript target produces a passing test observation; a Python retry change has no applicable verification.",
    expected: { status: "partially-verified", files: 2, counts: { verified: 1, unverified: 1 } },
    primary: true,
  },
  {
    id: "opaque-test-script",
    fixture: path.join(projectRoot, "fixtures", "scenarios", "opaque-test-script"),
    repository: "access-control",
    title: "Passing, but not observed",
    description: "The repository test command passes while excluding the related test. ProofDiff keeps the changed file only partially verified.",
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
    const githubSummary = renderGithubSummary(report, { htmlPath: `${path.basename(baseName)}.html` });
    await writeFile(path.join(examplesRoot, `${baseName}.html`), html);
    await writeFile(path.join(examplesRoot, `${baseName}.json`), json);
    await writeFile(path.join(examplesRoot, scenario.primary ? "demo-terminal.txt" : `${baseName}.txt`), terminal);
    await writeFile(path.join(examplesRoot, scenario.primary ? "demo-github-summary.md" : `${baseName}.github.md`), githubSummary);
    return { ...scenario, report, terminal, reportLink: `${baseName}.html` };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function gallery(results) {
  const statusLabel = { verified: "Related test file passed", "partially-verified": "Partially verified", unverified: "Unverified", unknown: "Unknown", "verification-failed": "Verification failed" };
  const hero = results.find((result) => result.id === "opaque-test-script");
  const heroAssessment = hero?.report.assessments[0];
  const heroCheck = hero?.report.checks.find((check) => check.status === "passed");
  const heroEvidence = heroAssessment?.evidence.find((evidence) => evidence.kind === "passing-check");
  const heroRelatedTest = heroAssessment?.relatedTests[0];
  if (!hero || !heroAssessment || !heroCheck || !heroEvidence || !heroRelatedTest || hero.report.summary.counts.verified !== 0 || heroAssessment.status !== "partially-verified") {
    throw new Error("The landing hero requires the asserted opaque-test-script passing-but-partial evidence.");
  }
  const cards = results.map((result, index) => {
    const summary = result.report.summary;
    const counts = Object.entries(summary.counts).filter(([, count]) => count > 0).map(([status, count]) => `<span><b>${count}</b> ${escapeHtml(statusLabel[status])}</span>`).join("");
    const excerpt = result.terminal.split("\n").filter((line) => /^(?:RELATED TEST FILE PASSED|PARTIAL|UNVERIFIED|UNKNOWN|FAILED|\s{2}Evidence:|\s{2}Executed tests:)/.test(line)).slice(0, 4).join("\n");
    return `<article class="scenario ${escapeHtml(summary.overallStatus)}"><div class="number">0${index + 1}</div><div class="scenario-body"><div class="scenario-top"><span class="status">${escapeHtml(statusLabel[summary.overallStatus])}</span><span class="risk">highest risk ${escapeHtml(summary.highestRisk ?? "none")}</span></div><h2>${escapeHtml(result.title)}</h2><p>${escapeHtml(result.description)}</p><div class="counts">${counts}</div><pre>${escapeHtml(excerpt)}</pre><a href="${escapeHtml(result.reportLink)}">Open full evidence report <span>→</span></a></div></article>`;
  }).join("");
  const heroLinkStyle = ".hero-link code{font:inherit}.hero-link+.hero-link{margin-left:20px}@media(max-width:420px){.hero-link+.hero-link{display:block;margin-left:0;margin-top:10px}}";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="A real ProofDiff demo showing which statically related paths became qualified targets with passing test observations—and which did not."><link rel="icon" href="data:"><title>ProofDiff · Which related targets produced tests?</title><style>
  ${heroLinkStyle}
  :root{--bg:#07090d;--panel:#111720;--panel2:#151d27;--line:#293543;--text:#f1f5f9;--muted:#9ba9ba;--cyan:#6ce0ef;--green:#5ce0a1;--yellow:#f6cd70;--red:#ff7686;--purple:#bda5ff;--shadow:0 24px 70px #0008}*{box-sizing:border-box}html{scroll-behavior:smooth}html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:radial-gradient(circle at 9% 0,#113242,transparent 28%),radial-gradient(circle at 92% 0,#261b45,transparent 26%),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}.topbar{width:min(1160px,calc(100% - 32px));margin:auto;padding:24px 0;display:flex;justify-content:space-between;align-items:center;gap:18px}.brand{color:var(--text);font-size:15px;font-weight:850;letter-spacing:.16em;text-decoration:none}.live-label{color:var(--muted);font-size:12px}.live-label i{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--green);box-shadow:0 0 14px #5ce0a188}.eyebrow{color:var(--cyan);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero{width:min(1160px,calc(100% - 32px));margin:auto;padding:24px 0 56px;display:grid;grid-template-columns:minmax(0,1.04fr) minmax(420px,.96fr);gap:28px 52px;align-items:center}.hero-copy h1{font-size:clamp(48px,6vw,76px);line-height:.98;letter-spacing:-.055em;margin:18px 0 22px;max-width:700px}.hero-copy h1 span{display:block;color:var(--muted);font-weight:520}.hero-copy h1 em{font-style:normal;color:var(--cyan)}.lede{font-size:clamp(18px,2vw,22px);line-height:1.45;color:#c6d0dc;max-width:640px;margin:0}.hero-link{display:inline-block;margin-top:27px;color:var(--cyan);font-weight:750;text-decoration:none}.hero-link:hover{text-decoration:underline}.truth-card{min-width:0;background:linear-gradient(145deg,#161e29f2,#0d131bf2);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:var(--shadow)}.case-label{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font:700 11px ui-monospace,SFMono-Regular,monospace;text-transform:uppercase;letter-spacing:.06em}.equation{display:grid;grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr);gap:10px;align-items:stretch;margin:20px 0}.signal{min-width:0;border:1px solid var(--line);border-radius:14px;padding:16px;background:#070b10}.signal-top{display:flex;align-items:center;gap:8px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.signal.pass .signal-top{color:var(--green)}.signal.partial .signal-top{color:var(--yellow)}.signal strong{display:block;color:var(--text);font:750 15px ui-monospace,SFMono-Regular,monospace;margin:12px 0 5px;overflow-wrap:anywhere}.signal small{display:block;color:var(--muted);line-height:1.4}.not-equal{display:grid;place-items:center;color:var(--text);font-size:38px;font-weight:300}.equation-caption{text-align:center;font-size:12px;font-weight:780;letter-spacing:.03em;color:#dfe6ee}.reason{margin:18px 0 0;padding:15px;border-left:2px solid var(--yellow);background:#f6cd7009;color:var(--muted);font-size:13px}.reason code{color:var(--text);font:inherit;font-weight:700}.truth-card>a{display:inline-block;margin-top:16px;color:var(--cyan);font-size:13px;font-weight:750;text-decoration:none}.cta{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px 42px;align-items:center;background:linear-gradient(100deg,#112630,#131927);border:1px solid #6ce0ef44;border-radius:20px;padding:22px 26px}.cta-label{color:var(--muted);font-size:12px;font-weight:750}.cta-command{display:block;margin-top:5px;color:var(--text);font:750 clamp(21px,3vw,30px) ui-monospace,SFMono-Regular,monospace}.cta-note{color:var(--muted);font-size:13px;max-width:530px}.cta-note strong{color:var(--text)}.privacy{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.privacy span{padding:5px 9px;border:1px solid var(--line);border-radius:999px;color:#b8c4d2;font-size:11px}.gallery-wrap{border-top:1px solid var(--line);background:#07090db8}.gallery{width:min(1160px,calc(100% - 32px));margin:auto;padding:76px 0 80px}.gallery-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.65fr);gap:32px;align-items:end}.gallery h2{font-size:clamp(38px,5vw,62px);line-height:1;letter-spacing:-.045em;max-width:800px;margin:16px 0 0}.gallery-head p{color:var(--muted);font-size:17px;margin:0}.legend{display:flex;gap:9px;flex-wrap:wrap;margin:30px 0 40px}.legend span{padding:6px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px}.legend i{width:7px;height:7px;display:inline-block;border-radius:50%;margin-right:7px}.legend span:nth-child(1) i{background:var(--green)}.legend span:nth-child(2) i{background:var(--yellow)}.legend span:nth-child(3) i{background:var(--purple)}.legend span:nth-child(4) i{background:var(--muted)}.legend span:nth-child(5) i{background:var(--red)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;min-width:0}.scenario{display:grid;grid-template-columns:54px minmax(0,1fr);min-width:0;background:linear-gradient(145deg,#141b24e8,#0d1219e8);border:1px solid var(--line);border-radius:18px;overflow:hidden;min-height:380px}.number{padding:22px 14px;color:#607083;font:700 12px ui-monospace,monospace;border-right:1px solid var(--line)}.scenario-body{min-width:0;padding:22px}.scenario-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.status{font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:11px}.risk{color:var(--muted);font-size:11px}.scenario.partially-verified .status{color:var(--yellow)}.scenario.verification-failed .status{color:var(--red)}.scenario.unknown .status{color:var(--muted)}.scenario h2{font-size:25px;line-height:1.2;margin:14px 0 5px;letter-spacing:-.02em}.scenario p{color:var(--muted);min-height:70px}.counts{display:flex;gap:7px;flex-wrap:wrap}.counts span{padding:5px 8px;background:#ffffff08;border-radius:7px;font-size:11px;color:var(--muted)}.counts b{color:var(--text)}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;min-height:76px;margin:18px 0;background:#05070a;border:1px solid #202a36;border-radius:10px;padding:11px;color:#bdc9d6;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;overflow:hidden}.scenario a{color:var(--cyan);font-weight:700;text-decoration:none}.scenario a span{transition:.2s}.scenario a:hover span{margin-left:5px}footer{text-align:center;color:#68778a;font-size:12px;margin-top:38px}@media(max-width:900px){.hero{grid-template-columns:1fr;gap:34px;padding-top:34px}.truth-card{max-width:none}.cta{grid-template-columns:1fr}.cta-note{max-width:none}.gallery-head{grid-template-columns:1fr}}@media(max-width:620px){.topbar{padding:18px 0}.live-label{font-size:10px}.hero{padding:24px 0 54px;gap:28px}.hero-copy h1{font-size:clamp(41px,12vw,58px);margin-top:13px}.lede{font-size:17px}.truth-card{padding:16px;border-radius:17px}.case-label{align-items:flex-start;flex-direction:column;gap:2px}.equation{grid-template-columns:1fr;margin-bottom:14px}.not-equal{height:38px}.signal{padding:14px}.equation-caption{font-size:11px}.cta{padding:18px}.cta-command{font-size:21px;overflow-wrap:anywhere}.gallery{padding:56px 0}.gallery h2{font-size:40px}.grid{grid-template-columns:minmax(0,1fr)}.scenario{grid-template-columns:38px minmax(0,1fr);min-height:0}.number{padding:18px 10px}.scenario-body{padding:18px 16px}.scenario-top{align-items:flex-start;flex-direction:column;gap:2px}.scenario p{min-height:auto}}@media print{body{background:#fff;color:#111}.truth-card,.cta,.scenario{background:#fff;break-inside:avoid}.scenario p,.risk,.legend span,.cta-note,.reason{color:#444}}
  </style></head><body><header class="topbar"><a class="brand" href="https://github.com/hzw0813/proofdiff">PROOFDIFF</a><span class="live-label"><i></i>Live demo · real product output</span></header><main><section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><div class="eyebrow">Deterministic change evidence</div><h1 id="hero-title"><span>Your tests passed.</span>Which related targets <em>produced tests?</em></h1><p class="lede">ProofDiff maps changes to statically related test-like paths, qualifies exact runner targets, and shows which paths produced non-skipped tests.</p><div><a class="hero-link" href="https://github.com/hzw0813/proofdiff#try-it-in-seconds">Try locally · <code>npx proofdiff</code> →</a><a class="hero-link" href="#scenarios">See real scenarios ↓</a></div></div><article class="truth-card" aria-label="Real passing but partially verified ProofDiff scenario"><div class="case-label"><span>Real scenario · ${escapeHtml(hero.repository)}</span><span>${escapeHtml(hero.report.summary.filesChanged)} changed file</span></div><div class="equation"><div class="signal pass"><div class="signal-top">✓ Test command passed</div><strong>${escapeHtml(heroCheck.label)}</strong><small>${escapeHtml(heroEvidence.detail.split(", but")[0])}.</small></div><div class="not-equal" aria-label="does not equal">≠</div><div class="signal partial"><div class="signal-top">◐ ${escapeHtml(statusLabel[heroAssessment.status])}</div><strong>${escapeHtml(heroAssessment.file.path)}</strong><small>${escapeHtml(hero.report.summary.counts.verified)} qualified target passes · ${escapeHtml(hero.report.summary.counts["partially-verified"])} partial</small></div></div><div class="equation-caption">Test command passed ≠ a related target produced tests</div><p class="reason"><code>${escapeHtml(heroRelatedTest)}</code> is statically related, but ProofDiff did not observe a passing test for that exact target.</p><a href="${escapeHtml(hero.reportLink)}">Inspect the real evidence report →</a></article><aside class="cta"><div><div class="cta-label">Try it on your own repository</div><code class="cta-command">npx proofdiff</code></div><p class="cta-note"><strong>Runs locally.</strong> This hosted demo never receives, uploads, or analyzes your repository.</p><div class="privacy"><span>No LLM</span><span>No upload</span><span>No account</span><span>No telemetry</span></div></aside></section><section class="gallery-wrap" id="scenarios"><div class="gallery"><header class="gallery-head"><div><div class="eyebrow">Four real changes · five evidence states</div><h2>No invented certainty.</h2></div><p>Every result below comes from an actual Git diff and actual ProofDiff execution. Passing, zero-test, missing, unsupported, and failing evidence all stay visible.</p></header><div class="legend"><span><i></i>Related test file passed</span><span><i></i>Partially verified</span><span><i></i>Unverified</span><span><i></i>Unknown</span><span><i></i>Verification failed</span></div><section class="grid" aria-label="Truthful ProofDiff demo scenarios">${cards}</section><footer>Generated locally by ProofDiff · no fabricated results · ${fixedDate}</footer></div></section></main></body></html>`;
}

await mkdir(scenarioOutputRoot, { recursive: true });
const results = [];
for (const scenario of scenarios) results.push(await generateScenario(scenario));
await writeFile(path.join(examplesRoot, "demo-gallery.html"), gallery(results));
process.stdout.write(`Generated ${results.length} truthful scenarios: ${results.map((result) => `${result.id}=${result.report.summary.overallStatus}`).join(", ")}.\n`);

if (process.argv.includes("--launch-assets")) {
  const assetPython = process.env.PROOFDIFF_ASSET_PYTHON ?? "python3";
  execFileSync(assetPython, [path.join(projectRoot, "scripts", "generate-launch-assets.py")], { cwd: projectRoot, stdio: "inherit" });
}
