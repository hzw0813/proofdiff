import type { DiffSelection } from "./types.js";
export interface TestMapSnapshotBinding {
    matched: boolean;
    target: string;
    detail: string;
}
export declare function bindTestMapToSelectionSnapshot(root: string, selection: DiffSelection, repositoryPath: string, worktreeFile: string): Promise<TestMapSnapshotBinding>;
//# sourceMappingURL=test-map-binding.d.ts.map