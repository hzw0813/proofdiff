import { readFile } from "node:fs/promises";
import process from "node:process";

function fail(message) {
  process.stderr.write(`proofdiff: ${message}\n`);
  process.exitCode = 2;
}

async function main() {
  const explicitBase = process.env.PROOFDIFF_BASE ?? "";
  if (explicitBase.length > 0) {
    process.stdout.write(`${explicitBase}\n`);
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  if (eventName === "pull_request_target") {
    fail("will not auto-select a pull-request diff on pull_request_target because the default checkout normally points at the base repository revision. Use pull_request for untrusted changes, or explicitly check out the intended trusted revision and set the Action 'base' input.");
    return;
  }
  if (eventName !== "pull_request") {
    process.stdout.write("\n");
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    fail(`cannot auto-resolve the pull-request base because GITHUB_EVENT_PATH is unavailable. Set the Action 'base' input explicitly.`);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(eventPath, "utf8"));
  } catch {
    fail(`cannot auto-resolve the pull-request base because GITHUB_EVENT_PATH is unreadable or invalid JSON. Set the Action 'base' input explicitly.`);
    return;
  }

  const baseSha = payload?.pull_request?.base?.sha;
  if (typeof baseSha !== "string" || !/^[0-9a-fA-F]{40,64}$/.test(baseSha)) {
    fail(`cannot auto-resolve a trustworthy pull-request base commit SHA. Set the Action 'base' input explicitly.`);
    return;
  }

  process.stdout.write(`${baseSha.toLowerCase()}\n`);
}

await main();
