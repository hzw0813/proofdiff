export declare const SOURCE_EXTENSIONS: Set<string>;
export declare function pathExists(value: string): Promise<boolean>;
export declare function readUtf8File(file: string, limitBytes?: number): Promise<string | null>;
export declare function isLikelyBinaryFile(file: string): Promise<boolean>;
export declare function normalizeRepoPath(value: string): string;
export declare function isInside(root: string, candidate: string): boolean;
export declare function resolveRepositoryPath(value: string): Promise<string>;
export declare function languageForPath(file: string): import("./types.js").LanguageId;
export declare function isTestFile(file: string): boolean;
export declare function unique<T>(items: Iterable<T>): T[];
export declare function plural(count: number, singular: string, pluralForm?: string): string;
export declare function clamp(value: number, min: number, max: number): number;
export declare function escapeHtml(value: string): string;
export declare function sanitizeControlCharacters(value: string): string;
export declare function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[];
//# sourceMappingURL=util.d.ts.map