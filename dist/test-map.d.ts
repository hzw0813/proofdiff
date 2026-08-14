export declare class TestMapError extends Error {
    name: string;
}
export interface LoadedTestMap {
    artifact: string;
    bySource: Map<string, string[]>;
    relationships: number;
    testPaths: number;
}
export declare function testMapRepositoryPath(root: string, file: string): Promise<string | null>;
export declare function loadTestMap(root: string, file: string, repositoryFiles: string[], selectedSourcePaths?: string[]): Promise<LoadedTestMap>;
//# sourceMappingURL=test-map.d.ts.map