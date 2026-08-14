import type { CheckDefinition } from "./types.js";
export declare function targetedJsFrameworkChecks(root: string, definitions: CheckDefinition[], impactedPaths: string[], limit?: number): Promise<{
    checks: CheckDefinition[];
    truncated: boolean;
}>;
//# sourceMappingURL=js-runners.d.ts.map