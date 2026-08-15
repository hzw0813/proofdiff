import { type StaticResolutionEvidence } from "./resolution.js";
import type { ChangedFile, SourceAnalysis, SymbolInfo } from "./types.js";
export interface RepositoryGraph {
    analyses: Map<string, SourceAnalysis>;
    dependencies: Map<string, Set<string>>;
    dependents: Map<string, Set<string>>;
    testLikeFiles: Set<string>;
    /** @deprecated Use testLikeFiles; this alias is retained for evaluation compatibility. */
    testFiles: Set<string>;
    staticResolutions: StaticResolutionEvidence[];
    diagnostics: string[];
}
export declare function buildRepositoryGraph(root: string, repositoryFiles: string[], changedFiles: ChangedFile[]): Promise<RepositoryGraph>;
export declare function impactedFiles(graph: RepositoryGraph, file: string, limit?: number): {
    files: string[];
    truncated: boolean;
};
export declare function hasExactCurrentLineHunks(file: ChangedFile): boolean;
export declare function symbolsChanged(file: ChangedFile, analysis: SourceAnalysis | undefined): SymbolInfo[];
//# sourceMappingURL=graph.d.ts.map