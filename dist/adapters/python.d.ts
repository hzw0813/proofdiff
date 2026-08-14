import { type ProcessOptions, type ProcessResult } from "../process.js";
import type { SourceAnalysis } from "../types.js";
import type { LanguageAdapter } from "./types.js";
type PythonProcessRunner = (command: string, args: string[], options: ProcessOptions) => Promise<ProcessResult>;
type PythonCandidate = {
    command: string;
    parser: string;
};
export declare function pythonInterpreterCandidates(platform?: NodeJS.Platform): PythonCandidate[];
export declare function analyzePythonSource(source: string, root: string, options?: {
    platform?: NodeJS.Platform;
    run?: PythonProcessRunner;
}): Promise<SourceAnalysis>;
export declare class PythonAdapter implements LanguageAdapter {
    readonly id: "python";
    readonly extensions: readonly [".py", ".pyi"];
    analyze(_file: string, source: string, root: string): Promise<SourceAnalysis>;
}
export {};
//# sourceMappingURL=python.d.ts.map