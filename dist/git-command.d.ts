import { type ProcessResult } from "./process.js";
export declare class GitError extends Error {
    name: string;
}
export declare function gitNullDevice(platform?: NodeJS.Platform): string;
interface GitOptions {
    maxOutputBytes?: number;
    stdin?: string;
}
/** All static Git reads share one boundary, including snapshot/workspace checks. */
export declare function runGit(root: string, args: string[], options?: GitOptions): Promise<ProcessResult>;
export {};
//# sourceMappingURL=git-command.d.ts.map