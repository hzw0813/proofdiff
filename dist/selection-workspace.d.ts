import type { DiffSelection } from "./types.js";
export interface SelectionWorkspaceOptions {
    allowedDataArtifacts?: string[];
    repositoryCodeWillExecute?: boolean;
}
/**
 * Graph analysis, check discovery, and exact-target execution currently use the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is aligned with the selected target.
 * Explicit data artifacts are exempt only from the generic untracked/ignored gate when their own path cannot
 * double as repository metadata or a Python test consumed by discovery; their separate provenance checks still apply.
 */
export declare function assertSelectionWorkspaceAligned(root: string, selection: DiffSelection, options?: SelectionWorkspaceOptions): Promise<void>;
//# sourceMappingURL=selection-workspace.d.ts.map