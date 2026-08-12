import path from "node:path";
import { JavaScriptAdapter } from "./javascript.js";
import { PythonAdapter } from "./python.js";
const adapters = [
    new JavaScriptAdapter("typescript"),
    new JavaScriptAdapter("javascript"),
    new PythonAdapter(),
];
export function adapterFor(file) {
    const extension = path.extname(file).toLowerCase();
    return adapters.find((adapter) => adapter.extensions.includes(extension)) ?? null;
}
export async function analyzeSource(file, source, root) {
    const adapter = adapterFor(file);
    if (!adapter) {
        return { language: "unknown", parser: "none", symbols: [], imports: [], calls: [], diagnostics: ["No language adapter is available for this file."], confidence: "low" };
    }
    return await adapter.analyze(file, source, root);
}
//# sourceMappingURL=index.js.map