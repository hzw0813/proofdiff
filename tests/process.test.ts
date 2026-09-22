import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runProcess } from "../src/process.js";
import { temporaryDirectory } from "./helpers.js";

for (const inheritedOutput of [false, true]) {
  test(`timeout kills a TERM-resistant descendant after its parent exits (inherited output: ${inheritedOutput})`, { skip: process.platform === "win32" }, async (context) => {
    const root = await temporaryDirectory();
    let descendantPid: number | undefined;
    context.after(async () => {
      if (descendantPid !== undefined) {
        try { process.kill(descendantPid, "SIGKILL"); } catch { /* Already terminated. */ }
      }
      await rm(root, { recursive: true, force: true });
    });
    const descendant = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      let ticks = 0;
      setInterval(() => fs.writeFileSync('heartbeat', String(++ticks)), 20);
      fs.writeFileSync('pid', String(process.pid));
      process.send('ready');
    `;
    const parent = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {
        stdio: ['ignore', ${inheritedOutput ? "'inherit', 'inherit'" : "'ignore', 'ignore'"}, 'ipc']
      });
      child.on('message', () => console.log('ready'));
      setInterval(() => {}, 1000);
    `;
    const result = await runProcess(process.execPath, ["-e", parent], { cwd: root, timeoutMs: 2_500 });
    descendantPid = Number(await readFile(path.join(root, "pid"), "utf8"));
    assert.equal(result.stdout.trim(), "ready", "descendant must install its TERM handler before timeout");
    assert.equal(result.timedOut, true);
    assert.ok(result.durationMs < 6_000, `timeout took ${result.durationMs} ms`);
    // Allow any in-flight write to finish; a surviving descendant continues ticking.
    await delay(100);
    const stopped = await readFile(path.join(root, "heartbeat"), "utf8");
    await delay(150);
    assert.equal(await readFile(path.join(root, "heartbeat"), "utf8"), stopped);
  });
}

test("an early stdin close reports an input error without crashing ProofDiff", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.exit(0)"], {
    cwd: process.cwd(), stdin: "x".repeat(1_000_000), timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.error ?? "", /stdin/i);
});

test("a failed spawn with pending stdin returns a process error", async () => {
  const result = await runProcess("proofdiff-nonexistent-command", [], {
    cwd: process.cwd(), stdin: "x".repeat(1_000_000), timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, null);
  assert.match(result.error ?? "", /ENOENT/);
});

test("a child that consumes all stdin retains its successful result", async () => {
  const result = await runProcess(process.execPath, ["-e", "let n=0;process.stdin.on('data',b=>n+=b.length);process.stdin.on('end',()=>console.log(n));"], {
    cwd: process.cwd(), stdin: "x".repeat(1_000_000), timeoutMs: 5_000,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "1000000");
  assert.equal(result.error, undefined);
});
