import type { SourceAnalysis } from "../types.js";
import type { LanguageAdapter } from "./types.js";
export declare class PythonAdapter implements LanguageAdapter {
    readonly id: "python";
    readonly extensions: readonly [".py", ".pyi"];
    analyze(_file: string, source: string, root: string): Promise<SourceAnalysis>;
}
//# sourceMappingURL=python.d.ts.map