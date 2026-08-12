import type { Confidence } from "./types.js";
export interface StaticResolutionEvidence {
    importer: string;
    specifier: string;
    mechanism: "typescript-paths" | "package-self-export";
    metadataPath: string;
    matchedKey: string;
    target: string;
    confidence: Confidence;
    detail: string;
    limitation: string;
}
export interface StaticModuleResolution {
    target: string;
    evidence: StaticResolutionEvidence;
}
export declare function javascriptModuleCandidates(baseInput: string): string[];
export declare class BoundedStaticModuleResolver {
    private readonly root;
    private readonly available;
    private readonly diagnostics;
    readonly evidence: StaticResolutionEvidence[];
    private readonly repositoryFiles;
    private readonly configPaths;
    private readonly packagePaths;
    private readonly configCache;
    private readonly packageCache;
    private readonly configOwnerCache;
    private readonly packageOwnerCache;
    private readonly targetSafetyCache;
    private readonly evidenceKeys;
    private readonly diagnosticKeys;
    private loadedConfigs;
    private loadedPackages;
    private nonRelativeImports;
    private diagnosticCount;
    private diagnosticLimitReported;
    constructor(root: string, repositoryFiles: string[], available: Set<string>, diagnostics: string[]);
    resolve(importer: string, specifier: string): Promise<StaticModuleResolution | null>;
    private record;
    private note;
    private readMetadata;
    private targetIsInside;
    private hiddenFileExists;
    private hiddenPrecedenceCandidate;
    private nearestMetadataPath;
    private applicableConfig;
    private loadConfig;
    private rejectConfig;
    private resolveExtends;
    private parsePaths;
    private matchCompilerPath;
    private resolveCompilerPath;
    private loadPackage;
    private exportEntry;
    private selectConditionTarget;
    private resolvePackageSelfReference;
}
//# sourceMappingURL=resolution.d.ts.map