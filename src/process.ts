import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

export interface ProcessOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}

export async function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256_000;
  return await new Promise((resolve) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
      const remaining = maxOutputBytes - stdout.length - stderr.length;
      if (remaining <= 0) {
        truncated = true;
        return current;
      }
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };

    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        durationMs: Date.now() - started,
        truncated,
        ...(error === undefined ? {} : { error }),
      });
    };

    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        setTimeout(() => {
          if (!settled) {
            try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          }
        }, 1_000).unref();
      } else {
        child.kill("SIGTERM");
      }
    }, timeoutMs);
    timer.unref();
  });
}

export function safeExecutablePath(): string {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0 && path.isAbsolute(entry))
    .join(path.delimiter);
}

export function constrainedCheckEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = key === "PATH" ? safeExecutablePath() : process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "true";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";
  env.HOME = os.tmpdir();
  env.USERPROFILE = os.tmpdir();
  env.PROOFDIFF = "1";
  return env;
}
