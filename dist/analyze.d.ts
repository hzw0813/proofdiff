import type { AnalysisReport, AnalyzeOptions } from "./types.js";
export declare const VERSION = "0.5.3";
export interface AnalyzeRepositoryOptions extends AnalyzeOptions {
    testMap?: string;
}
export declare function analyzeRepository(options: AnalyzeRepositoryOptions): Promise<AnalysisReport>;
//# sourceMappingURL=analyze.d.ts.map