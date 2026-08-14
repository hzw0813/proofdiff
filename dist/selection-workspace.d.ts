import type { DiffSelection } from "./types.js";
/**
 * Graph analysis, check discovery, and exact-target execution currently use the checked-out filesystem.
 * Immutable diff modes therefore fail closed unless that filesystem is aligned with the selected target,
 * and ignored files that the discovery layer would otherwise inspect are absent.
 */
export declare function assertSelectionWorkspaceAligned(root: string, selection: DiffSelection): Promise<void>;
//# sourceMappingURL=selection-workspace.d.ts.map