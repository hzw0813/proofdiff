import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
export async function runProcess(command, args, options) {
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxOutputBytes = options.maxOutputBytes ?? 256_000;
    return await new Promise((resolve) => {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
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
        const append = (current, chunk) => {
            const remaining = maxOutputBytes - stdout.length - stderr.length;
            if (remaining <= 0) {
                truncated = true;
                return current;
            }
            if (chunk.length > remaining)
                truncated = true;
            return Buffer.concat([current, chunk.subarray(0, remaining)]);
        };
        child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
        child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
        const finish = (exitCode, error) => {
            if (settled)
                return;
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
                try {
                    process.kill(-child.pid, "SIGTERM");
                }
                catch {
                    child.kill("SIGTERM");
                }
                setTimeout(() => {
                    if (!settled) {
                        try {
                            process.kill(-child.pid, "SIGKILL");
                        }
                        catch {
                            child.kill("SIGKILL");
                        }
                    }
                }, 1_000).unref();
            }
            else {
                child.kill("SIGTERM");
            }
        }, timeoutMs);
        timer.unref();
    });
}
export function safeExecutablePath() {
    return (process.env.PATH ?? "")
        .split(path.delimiter)
        .filter((entry) => entry.length > 0 && path.isAbsolute(entry))
        .join(path.delimiter);
}
export function constrainedCheckEnvironment() {
    const allowed = ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM"];
    const env = {};
    for (const key of allowed) {
        const value = key === "PATH" ? safeExecutablePath() : process.env[key];
        if (value !== undefined)
            env[key] = value;
    }
    env.CI = "true";
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";
    env.HOME = os.tmpdir();
    env.USERPROFILE = os.tmpdir();
    env.PROOFDIFF = "1";
    return env;
}
//# sourceMappingURL=process.js.map