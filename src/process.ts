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
    let childExited = false;
    let childExitCode: number | null = null;
    let windowsTerminationComplete = false;
    let windowsTerminationError: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    let terminationFallback: NodeJS.Timeout | undefined;

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
      if (timer !== undefined) clearTimeout(timer);
      if (terminationFallback !== undefined) clearTimeout(terminationFallback);
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

    const closeChildStreams = (): void => {
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };

    const finishWindowsTimeoutIfComplete = (): void => {
      if (!timedOut || process.platform !== "win32" || !windowsTerminationComplete || !childExited) return;
      closeChildStreams();
      finish(childExitCode, windowsTerminationError);
    };

    child.on("error", (error) => {
      if (timedOut && process.platform === "win32") {
        windowsTerminationError ??= error.message;
      } else {
        finish(null, error.message);
      }
    });
    child.on("exit", (code) => {
      childExited = true;
      childExitCode = code;
      finishWindowsTimeoutIfComplete();
    });
    child.on("close", (code) => {
      if (timedOut && process.platform === "win32") {
        childExited = true;
        childExitCode = code;
        finishWindowsTimeoutIfComplete();
      } else {
        finish(code);
      }
    });

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }

    const forceTimedOutFinish = (error?: string): void => {
      if (settled) return;
      closeChildStreams();
      child.unref();
      finish(null, error);
    };

    const scheduleForcedFinish = (error?: string, delayMs = 1_000): void => {
      if (settled) return;
      if (terminationFallback !== undefined) clearTimeout(terminationFallback);
      terminationFallback = setTimeout(() => forceTimedOutFinish(error), delayMs);
    };

    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined && process.platform === "win32") {
        let terminatorFinished = false;
        const terminator = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
          env: options.env ?? process.env,
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
        const completeTermination = (error?: string): void => {
          if (terminatorFinished) return;
          terminatorFinished = true;
          if (terminationFallback !== undefined) clearTimeout(terminationFallback);
          if (error !== undefined) windowsTerminationError = error;
          windowsTerminationComplete = true;
          child.kill();
          finishWindowsTimeoutIfComplete();
          if (!settled) scheduleForcedFinish(windowsTerminationError, 2_000);
        };
        terminator.once("error", (error) => {
          completeTermination(`Could not terminate the timed-out process tree: ${error.message}`);
        });
        terminator.once("close", (code) => {
          const error = code === 0
            ? undefined
            : code === null
              ? "Could not terminate the timed-out process tree: taskkill did not report success."
              : `Could not terminate the timed-out process tree: taskkill exited with code ${String(code)}.`;
          completeTermination(error);
        });
        terminationFallback = setTimeout(() => {
          terminator.kill();
          completeTermination("Timed-out process-tree termination did not complete promptly.");
        }, 2_000);
      } else if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
        terminationFallback = setTimeout(() => {
          if (!settled) {
            try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
            forceTimedOutFinish();
          }
        }, 1_000);
      } else {
        child.kill("SIGTERM");
        terminationFallback = setTimeout(() => forceTimedOutFinish(), 1_000);
      }
    }, timeoutMs);
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
