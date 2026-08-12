import type { SourceAnalysis } from "../types.js";
import type { LanguageAdapter } from "./types.js";
export declare function adapterFor(file: string): LanguageAdapter | null;
export declare function analyzeSource(file: string, source: string, root: string): Promise<SourceAnalysis>;
export type { LanguageAdapter } from "./types.js";
//# sourceMappingURL=index.d.ts.map