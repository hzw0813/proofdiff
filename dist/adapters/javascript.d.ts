import type { SourceAnalysis } from "../types.js";
import type { LanguageAdapter } from "./types.js";
export declare class JavaScriptAdapter implements LanguageAdapter {
    readonly id: "typescript" | "javascript";
    readonly extensions: readonly string[];
    constructor(language: "typescript" | "javascript");
    analyze(file: string, source: string, _root: string): Promise<SourceAnalysis>;
}
//# sourceMappingURL=javascript.d.ts.map