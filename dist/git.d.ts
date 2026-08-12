import type { ChangedFile, DiffSelection, RepositoryInfo } from "./types.js";
export declare class GitError extends Error {
    name: string;
}
export declare function gitNullDevice(platform?: NodeJS.Platform): string;
export declare function findRepository(value: string): Promise<string>;
export declare function selectDiff(root: string, options: {
    base?: string;
    range?: string;
    staged?: boolean;
}): Promise<{
    selection: DiffSelection;
    args: string[];
}>;
export declare function changedFiles(root: string, diffArgs: string[], includeUntracked: boolean): Promise<ChangedFile[]>;
export declare function listRepositoryFiles(root: string, limit?: number): Promise<{
    files: string[];
    truncated: boolean;
}>;
export declare function repositoryInfo(root: string): Promise<RepositoryInfo>;
//# sourceMappingURL=git.d.ts.map