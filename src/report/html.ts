import type { AnalysisReport, FileAssessment, VerificationStatus } from "../types.js";
import { escapeHtml } from "../util.js";

const statusLabels: Record<VerificationStatus, string> = {
  verified: "Related test file passed",
  "partially-verified": "Partially verified",
  unverified: "Unverified",
  unknown: "Unknown",
  "verification-failed": "Verification failed",
};

const statusScope: Record<VerificationStatus, string> = {
  verified: "Observed: a statically related test file was explicitly supplied to a recognized runner and the invocation passed. Not observed: changed-symbol or changed-line execution.",
  "partially-verified": "Some applicable evidence passed, but no statically related test-file execution was observed.",
  unverified: "Checks ran, but supplied no applicable successful evidence for this file.",
  unknown: "No applicable verification command ran for this file.",
  "verification-failed": "An applicable verification command failed, errored, or timed out.",
};

function e(value: unknown): string { return escapeHtml(String(value)); }

function icon(status: VerificationStatus): string {
  if (status === "verified") return "✓";
  if (status === "partially-verified") return "◐";
  if (status === "verification-failed") return "×";
  if (status === "unverified") return "!";
  return "?";
}

function assessmentCard(item: FileAssessment): string {
  const symbolMarkup = item.changedSymbols.length
    ? item.changedSymbols.map((symbol) => `<span class="chip">${e(symbol.kind)} · ${e(symbol.name)}</span>`).join("")
    : `<span class="muted">No changed symbol identified</span>`;
  const evidence = item.evidence.length
    ? item.evidence.map((entry) => `<li class="evidence ${e(entry.kind)}"><span>${e(entry.label)}</span><p>${e(entry.detail)}</p><small>${e(entry.confidence)} confidence · ${e(entry.kind.replaceAll("-", " "))}</small></li>`).join("")
    : `<li class="empty">No verification evidence was observed.</li>`;
  const limitations = item.limitations.length
    ? `<div class="limitations"><h4>Limits</h4><ul>${item.limitations.map((value) => `<li>${e(value)}</li>`).join("")}</ul></div>`
    : "";
  const executed = item.testExecutions.length
    ? `<div><h4>Targeted test outcomes <span class="count">${item.testExecutions.length}</span></h4><ul class="paths execution-paths">${item.testExecutions.map((execution) => `<li class="${e(execution.status)}"><b>${e(execution.status)}</b> ${e(execution.path)}</li>`).join("")}</ul></div>`
    : `<div><h4>Targeted test outcomes</h4><p class="muted">None observed. Related-file presence alone cannot produce “Related test file passed.”</p></div>`;
  const related = item.relatedTests.length
    ? `<div><h4>Statically related tests <span class="count">${item.relatedTests.length}</span></h4><ul class="paths">${item.relatedTests.map((value) => `<li>${e(value)}</li>`).join("")}</ul></div>`
    : `<div><h4>Statically related tests</h4><p class="muted">None found through resolved static imports.</p></div>`;
  const impacted = item.impactedFiles.length
    ? `<div><h4>Estimated impact <span class="count">${item.impactedFiles.length}</span></h4><ul class="paths">${item.impactedFiles.slice(0, 20).map((value) => `<li>${e(value)}</li>`).join("")}${item.impactedFiles.length > 20 ? `<li>+ ${item.impactedFiles.length - 20} more</li>` : ""}</ul></div>`
    : `<div><h4>Estimated impact</h4><p class="muted">No dependent files resolved.</p></div>`;
  const calls = item.changedCalls.length
    ? `<div><h4>Calls in changed lines <span class="count">${item.changedCalls.length}</span></h4><ul class="paths">${item.changedCalls.map((site) => `<li>${e(site.name)} <span class="muted">line ${site.line} · ${e(site.confidence)} confidence</span></li>`).join("")}</ul><p class="muted">Name-only structural references; targets are not resolved and runtime execution is not implied.</p></div>`
    : `<div><h4>Calls in changed lines</h4><p class="muted">No parser-observed call site intersects the changed lines.</p></div>`;
  const search = [item.file.path, ...item.changedSymbols.map((symbol) => symbol.name), ...item.changedCalls.map((site) => site.name), ...item.relatedTests].join(" ").toLowerCase();
  return `<article class="file-card" data-status="${e(item.status)}" data-risk="${e(item.risk)}" data-search="${e(search)}">
    <div class="file-head">
      <span class="status-icon ${e(item.status)}" aria-hidden="true">${icon(item.status)}</span>
      <div class="file-title"><h3>${e(item.file.path)}</h3><p>${e(item.file.change)} · <span class="add">+${item.file.additions}</span> <span class="del">−${item.file.deletions}</span> · ${e(item.file.language)}</p></div>
      <div class="file-badges"><span class="status ${e(item.status)}">${e(statusLabels[item.status])}</span><span class="risk ${e(item.risk)}">${e(item.risk)} risk · ${item.riskScore}</span></div>
    </div>
    <div class="symbols">${symbolMarkup}</div>
    <p class="file-scope">${e(statusScope[item.status])}</p>
    <details>
      <summary>Inspect evidence and reasoning</summary>
      <div class="detail-grid">
        <div class="wide"><h4>Evidence</h4><ul class="evidence-list">${evidence}</ul></div>
        <div><h4>Why review this</h4><ul>${item.reasons.length ? item.reasons.map((value) => `<li>${e(value)}</li>`).join("") : "<li>No additional risk factors identified.</li>"}</ul></div>
        ${executed}${related}${calls}${impacted}${limitations}
      </div>
    </details>
  </article>`;
}

export function renderHtmlReport(report: AnalysisReport): string {
  const countTiles = (["verified", "partially-verified", "unverified", "unknown", "verification-failed"] as const)
    .map((status) => `<button class="metric" data-filter-status="${status}"><span class="dot ${status}"></span><strong>${report.summary.counts[status]}</strong><small>${e(statusLabels[status])}</small></button>`).join("");
  const checkRows = report.checks.length
    ? report.checks.map((check) => `<details class="check"><summary><span class="check-status ${e(check.status)}">${e(check.status)}</span><strong>${e(check.label)}</strong><span>${check.durationMs ? `${check.durationMs} ms` : e(check.origin)}</span></summary><div><p>${e(check.explanation)} ${e(check.origin)}.</p><code>${e([check.command, ...check.args].join(" "))}</code>${check.output ? `<pre>${e(check.output)}${check.outputTruncated ? "\n[output truncated]" : ""}</pre>` : ""}</div></details>`).join("")
    : `<p class="empty-state">No supported checks were discovered.</p>`;
  const noteMarkup = report.notes.length ? `<section class="notes panel"><h2>Analysis notes</h2><ul>${report.notes.map((note) => `<li>${e(note)}</li>`).join("")}</ul></section>` : "";
  const cards = report.assessments.length ? report.assessments.map(assessmentCard).join("") : `<div class="empty-state panel">No changed files matched ${e(report.selection.description)}.</div>`;
  const title = `${report.repository.name} · ProofDiff`;
  const overviewScope = report.summary.overallStatus === "partially-verified" && report.summary.counts["partially-verified"] !== report.summary.filesChanged
    ? "Evidence strength differs across changed files. Inspect each file before drawing a conclusion."
    : statusScope[report.summary.overallStatus];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <link rel="icon" href="data:">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">
  <title>${e(title)}</title>
  <style>
    :root{--bg:#080b10;--surface:#11161e;--surface2:#171e28;--line:#293341;--text:#edf2f7;--muted:#9ba9ba;--cyan:#68d9ed;--green:#56d69b;--yellow:#f3c969;--red:#ff7585;--purple:#bda2ff;--shadow:0 18px 50px #0007;color-scheme:dark}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,#123140 0,transparent 35%),radial-gradient(circle at 90% 0,#251d43 0,transparent 32%),var(--bg);color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.13;background-image:linear-gradient(#fff1 1px,transparent 1px),linear-gradient(90deg,#fff1 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,#000,transparent 65%)}
    main{position:relative;width:min(1180px,calc(100% - 32px));margin:auto;padding:56px 0 80px}.eyebrow{color:var(--cyan);font-weight:750;letter-spacing:.12em;text-transform:uppercase;font-size:12px}h1{font-size:clamp(38px,7vw,72px);line-height:.95;margin:18px 0;letter-spacing:-.055em;max-width:900px}h1 em{color:var(--muted);font-style:normal;font-weight:500}.lede{font-size:19px;color:var(--muted);max-width:760px;margin:0}.meta{display:flex;gap:18px;flex-wrap:wrap;margin:28px 0;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}.meta span{border-left:2px solid var(--line);padding-left:10px}.panel,.file-card{background:linear-gradient(145deg,#151b24e8,#0e131ae8);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);backdrop-filter:blur(14px)}
    .overview{margin:34px 0;padding:24px;display:grid;grid-template-columns:1.25fr 1fr;gap:22px}.overall{display:flex;align-items:center;gap:18px}.overall .status-icon{width:64px;height:64px;font-size:32px}.overall h2{font-size:25px;margin:0}.overall p{margin:3px 0;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.metric{appearance:none;text-align:left;border:1px solid var(--line);color:var(--text);background:#ffffff04;border-radius:12px;padding:12px;cursor:pointer;transition:.2s}.metric:hover,.metric.active{transform:translateY(-2px);border-color:var(--cyan)}.metric strong,.metric small{display:block}.metric strong{font-size:24px}.metric small{font-size:10px;color:var(--muted);line-height:1.25}.dot{width:7px;height:7px;border-radius:50%;display:block;margin-bottom:10px}.dot.verified{background:var(--green)}.dot.partially-verified{background:var(--yellow)}.dot.unverified{background:var(--purple)}.dot.unknown{background:var(--muted)}.dot.verification-failed{background:var(--red)}
    .trust{display:flex;gap:14px;align-items:flex-start;padding:18px 22px;margin-bottom:32px;border:1px solid #68d9ed44;background:#68d9ed0c;border-radius:14px}.trust b{color:var(--cyan);white-space:nowrap}.trust p{margin:0;color:var(--muted)}.section-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:38px 0 14px}.section-head h2,.panel h2{margin:0;font-size:24px}.section-head p{color:var(--muted);margin:3px 0}.controls{display:flex;gap:8px;flex-wrap:wrap}.controls input,.controls select{background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:9px 11px;min-width:135px}.controls input{min-width:230px}
    .file-list{display:grid;gap:12px}.file-card{padding:20px;box-shadow:none}.file-card[hidden]{display:none}.file-head{display:flex;align-items:center;gap:15px}.status-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;font-size:20px;font-weight:850;flex:none}.status-icon.verified{color:var(--green);background:#56d69b18;border:1px solid #56d69b55}.status-icon.partially-verified{color:var(--yellow);background:#f3c96918;border:1px solid #f3c96955}.status-icon.verification-failed{color:var(--red);background:#ff758518;border:1px solid #ff758555}.status-icon.unverified{color:var(--purple);background:#bda2ff18;border:1px solid #bda2ff55}.status-icon.unknown{color:var(--muted);background:#9ba9ba18;border:1px solid #9ba9ba55}.file-title{min-width:0;flex:1}.file-title h3{font:650 16px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;margin:0;overflow-wrap:anywhere}.file-title p{margin:3px 0 0;color:var(--muted);font-size:12px}.add{color:var(--green)}.del{color:var(--red)}.file-badges{display:flex;gap:7px;align-items:center}.status,.risk,.chip,.count,.check-status{border-radius:999px;padding:4px 9px;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.035em}.status.verified{color:var(--green);background:#56d69b18}.status.partially-verified{color:var(--yellow);background:#f3c96918}.status.verification-failed{color:var(--red);background:#ff758518}.status.unverified{color:var(--purple);background:#bda2ff18}.status.unknown{color:var(--muted);background:#9ba9ba18}.risk{color:var(--muted);border:1px solid var(--line)}.risk.high,.risk.critical{color:var(--red);border-color:#ff758555}.risk.medium{color:var(--yellow);border-color:#f3c96955}.risk.low{color:var(--green);border-color:#56d69b55}.symbols{margin:14px 0 0 57px;display:flex;gap:6px;flex-wrap:wrap}.chip{background:#ffffff08;color:#bdc7d4;text-transform:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:500}.file-scope{margin:10px 0 0 57px;color:var(--muted);font-size:12px;max-width:850px}
    details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}.file-card>details>summary{margin:16px 0 0 57px;color:var(--cyan);font-size:13px}.file-card>details>summary:after{content:" ↓"}.file-card>details[open]>summary:after{content:" ↑"}.detail-grid{border-top:1px solid var(--line);padding-top:18px;margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:20px}.detail-grid .wide{grid-column:1/-1}h4{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#c9d3df}.detail-grid ul,.notes ul{padding-left:19px;margin:0;color:var(--muted)}.paths{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.execution-paths{list-style:none;padding-left:0!important}.execution-paths b{display:inline-block;min-width:72px;text-transform:uppercase;font-size:10px}.execution-paths .passed{color:var(--green)}.execution-paths .failed,.execution-paths .error,.execution-paths .timed-out{color:var(--red)}.count{background:#ffffff0c;padding:2px 6px;color:var(--muted)}.evidence-list{list-style:none;padding:0!important;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}.evidence{border:1px solid var(--line);border-left:3px solid var(--cyan);border-radius:10px;padding:11px}.evidence.failing-check{border-left-color:var(--red)}.evidence.passing-check,.evidence.executed-test{border-left-color:var(--green)}.evidence.inference,.evidence.limitation{border-left-color:var(--yellow)}.evidence span{font-weight:700;color:var(--text)}.evidence p{margin:4px 0;color:var(--muted);font-size:13px}.evidence small{color:#748398}.muted{color:var(--muted)}
    .checks,.notes{padding:22px;margin-top:14px}.check{border-top:1px solid var(--line)}.check:first-of-type{margin-top:14px}.check summary{display:grid;grid-template-columns:100px 1fr auto;gap:12px;align-items:center;padding:14px 0}.check summary>span:last-child{color:var(--muted);font-size:12px}.check>div{padding:0 0 18px 112px;color:var(--muted)}.check code{color:var(--cyan);overflow-wrap:anywhere}.check pre{white-space:pre-wrap;max-height:280px;overflow:auto;background:#05070a;border:1px solid var(--line);border-radius:9px;padding:12px;color:#c9d3df}.check-status{width:max-content}.check-status.passed{color:var(--green);background:#56d69b18}.check-status.failed,.check-status.error,.check-status.timed-out{color:var(--red);background:#ff758518}.check-status.not-run{color:var(--muted);background:#9ba9ba18}.notes li{margin:.35em 0}.empty-state{color:var(--muted);padding:28px}.method{max-width:790px;margin:42px auto 0;text-align:center;color:var(--muted);font-size:13px}.method strong{color:var(--text)}footer{text-align:center;margin-top:36px;color:#657384;font-size:12px}
    @media(max-width:820px){main{padding-top:32px}.overview{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(3,1fr)}.section-head{align-items:stretch;flex-direction:column}.controls input{min-width:0;flex:1}.file-head{align-items:flex-start;flex-wrap:wrap}.file-badges{width:100%;margin-left:57px}.detail-grid{grid-template-columns:1fr}.detail-grid .wide{grid-column:auto}.check summary{grid-template-columns:90px 1fr}.check summary>span:last-child{display:none}.check>div{padding-left:0}}
    @media(max-width:520px){main{width:min(100% - 24px,1180px)}h1{font-size:42px}.overview{padding:18px}.overall{align-items:flex-start}.metrics{grid-template-columns:repeat(2,1fr)}.trust{flex-direction:column;gap:5px}.trust b{white-space:normal}.controls{display:grid;grid-template-columns:1fr 1fr}.controls input{grid-column:1/-1}.file-card{padding:16px}.file-badges,.symbols,.file-scope,.file-card>details>summary{margin-left:0}.status,.risk{font-size:10px}}
    @media print{body{background:white;color:#111}body:before,.controls{display:none}.panel,.file-card{background:white;border-color:#bbb;box-shadow:none;break-inside:avoid}.muted,.file-title p,.detail-grid ul,.trust p{color:#444}details{display:block}details>*{display:block!important}.status,.risk{border:1px solid #aaa}.method,footer{color:#444}}
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">ProofDiff · evidence report</div>
    <h1>What evidence exists <em>for this change?</em></h1>
    <p class="lede">A local, evidence-based view of changed code, related tests, deterministic checks, and the places that still need human judgment.</p>
    <div class="meta"><span>${e(report.repository.name)}</span><span>${e(report.selection.description)}</span><span>${e(report.generatedAt)}</span>${report.repository.head ? `<span>${e(report.repository.head)}</span>` : ""}</div>
  </header>
  <section class="overview panel">
    <div class="overall"><span class="status-icon ${e(report.summary.overallStatus)}">${icon(report.summary.overallStatus)}</span><div><h2>${e(statusLabels[report.summary.overallStatus])}</h2><p>${report.summary.filesChanged} changed files · ${report.summary.symbolsChanged} changed symbols · highest risk ${e(report.summary.highestRisk ?? "none")}</p><p>${e(overviewScope)}</p></div></div>
    <div class="metrics">${countTiles}</div>
  </section>
  <aside class="trust"><b>${report.trust.repositoryCodeExecuted ? "Repository code ran" : "Static-only run"}</b><p>${e(report.trust.statement)}</p></aside>
  <section>
    <div class="section-head"><div><h2>Change review queue</h2><p>Highest-risk files appear first. Expand a file to audit each claim.</p></div><div class="controls"><input id="search" type="search" placeholder="Search files or symbols" aria-label="Search files or symbols"><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option>${Object.entries(statusLabels).map(([value,label]) => `<option value="${e(value)}">${e(label)}</option>`).join("")}</select><select id="risk-filter" aria-label="Filter by risk"><option value="">All risks</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select></div></div>
    <div class="file-list" id="file-list">${cards}</div>
  </section>
  <section><div class="section-head"><div><h2>Verification checks</h2><p>Commands, outcomes, and bounded output from this run.</p></div></div><div class="checks panel">${checkRows}</div></section>
${noteMarkup ? `  ${noteMarkup}\n` : ""}  <p class="method"><strong>How to read this:</strong> The JSON status <code>verified</code> is displayed as “Related test file passed.” It records a successful targeted test-file invocation—not changed-symbol or changed-line execution, mathematical proof, or a guarantee of safety. Inference and limitations are labeled separately.</p>
  <footer>Generated locally by ProofDiff ${e(report.proofdiffVersion)} · no telemetry · schema ${e(report.schemaVersion)}</footer>
</main>
<script>
  (() => {
    const search = document.querySelector('#search');
    const status = document.querySelector('#status-filter');
    const risk = document.querySelector('#risk-filter');
    const cards = [...document.querySelectorAll('.file-card')];
    function apply() {
      const query = search.value.trim().toLowerCase();
      for (const card of cards) card.hidden = !!((query && !card.dataset.search.includes(query)) || (status.value && card.dataset.status !== status.value) || (risk.value && card.dataset.risk !== risk.value));
    }
    search.addEventListener('input', apply); status.addEventListener('change', apply); risk.addEventListener('change', apply);
    for (const tile of document.querySelectorAll('[data-filter-status]')) tile.addEventListener('click', () => { const next = status.value === tile.dataset.filterStatus ? '' : tile.dataset.filterStatus; status.value = next; apply(); });
  })();
</script>
</body>
</html>`;
}
