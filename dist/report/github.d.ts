import type { AnalysisReport } from "../types.js";
export interface GithubSummaryOptions {
    htmlPath?: string;
    maxFiles?: number;
    maxPathsPerFile?: number;
}
export declare function renderGithubSummary(report: AnalysisReport, options?: GithubSummaryOptions): string;
//# sourceMappingURL=github.d.ts.map