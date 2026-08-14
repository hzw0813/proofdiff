import type { DiffSelection } from "./types.js";
/**
 * ProofDiff's graph, metadata discovery, and check execution currently read the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is the same snapshot the diff targets.
 */
export declare function assertSelectionWorkspaceAligned(root: string, selection: DiffSelection): Promise<void>;
//# sourceMappingURL=selection-workspace.d.ts.map