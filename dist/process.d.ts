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
export declare function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult>;
export declare function safeExecutablePath(): string;
export declare function constrainedCheckEnvironment(): NodeJS.ProcessEnv;
//# sourceMappingURL=process.d.ts.map