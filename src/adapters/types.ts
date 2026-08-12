import type { LanguageId, SourceAnalysis } from "../types.js";

export interface LanguageAdapter {
  id: LanguageId;
  extensions: readonly string[];
  analyze(file: string, source: string, root: string): Promise<SourceAnalysis>;
}
