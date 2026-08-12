import type { CheckDefinition, CheckResult } from "./types.js";
export declare function packageManagerInvocation(command: string, args: string[], platform?: NodeJS.Platform): {
    command: string;
    args: string[];
};
export declare function discoverChecks(root: string): Promise<{
    checks: CheckDefinition[];
    notes: string[];
}>;
export declare function targetedTestChecks(root: string, definitions: CheckDefinition[], relatedTests: string[], limit?: number): Promise<{
    checks: CheckDefinition[];
    truncated: boolean;
}>;
export declare function runChecks(root: string, definitions: CheckDefinition[], options: {
    selected?: string[];
    timeoutMs: number;
    maxOutputBytes: number;
}): Promise<CheckResult[]>;
export declare function notRunResults(definitions: CheckDefinition[]): CheckResult[];
//# sourceMappingURL=checks.d.ts.map