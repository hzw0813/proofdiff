import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "../src/process.js";

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
