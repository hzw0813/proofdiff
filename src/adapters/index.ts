import path from "node:path";
import type { SourceAnalysis } from "../types.js";
import { JavaScriptAdapter } from "./javascript.js";
import { PythonAdapter } from "./python.js";
import type { LanguageAdapter } from "./types.js";

const adapters: LanguageAdapter[] = [
  new JavaScriptAdapter("typescript"),
  new JavaScriptAdapter("javascript"),
  new PythonAdapter(),
];

export function adapterFor(file: string): LanguageAdapter | null {
  const extension = path.extname(file).toLowerCase();
  return adapters.find((adapter) => adapter.extensions.includes(extension)) ?? null;
}

export async function analyzeSource(file: string, source: string, root: string): Promise<SourceAnalysis> {
  const adapter = adapterFor(file);
  if (!adapter) {
    return { language: "unknown", parser: "none", symbols: [], imports: [], calls: [], diagnostics: ["No language adapter is available for this file."], confidence: "low" };
  }
  return await adapter.analyze(file, source, root);
}

export type { LanguageAdapter } from "./types.js";
