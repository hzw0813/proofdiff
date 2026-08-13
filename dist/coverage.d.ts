import type { ChangedFile, CoverageArtifactSummary, CoverageFileEvidence, DiffSelection, FileAssessment } from "./types.js";
export declare class CoverageError extends Error {
    name: string;
}
export declare function loadCoverageEvidence(root: string, selection: DiffSelection, coverageFile: string, coverageCommit: string, changedFiles: ChangedFile[]): Promise<{
    summary: CoverageArtifactSummary;
    byPath: Map<string, CoverageFileEvidence>;
}>;
export declare function attachCoverageEvidence(item: FileAssessment, coverage: CoverageFileEvidence | undefined): FileAssessment;
//# sourceMappingURL=coverage.d.ts.map