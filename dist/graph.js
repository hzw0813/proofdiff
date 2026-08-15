import path from "node:path";
import { analyzeSource } from "./adapters/index.js";
import { BoundedStaticModuleResolver, javascriptModuleCandidates } from "./resolution.js";
import { compareCodeUnits, isTestLikePath, normalizeRepoPath, readUtf8File, SOURCE_EXTENSIONS, unique } from "./util.js";
function candidatesForJavaScript(importer, source) {
    if (!source.startsWith("."))
        return [];
    const base = normalizeRepoPath(path.posix.normalize(path.posix.join(path.posix.dirname(importer), source)));
    return javascriptModuleCandidates(base);
}
function candidatesForPython(importer, source, names) {
    const leading = source.match(/^\.+/)?.[0].length ?? 0;
    const moduleName = source.slice(leading).replaceAll(".", "/");
    let baseDirectory = leading > 0 ? path.posix.dirname(importer) : "";
    for (let count = 1; count < leading; count += 1)
        baseDirectory = path.posix.dirname(baseDirectory);
    const modulePath = normalizeRepoPath(path.posix.join(baseDirectory, moduleName));
    const bases = [modulePath];
    if (leading === 0)
        bases.push(path.posix.join("src", moduleName));
    for (const name of names) {
        if (name !== "*")
            bases.push(path.posix.join(modulePath, name));
    }
    return unique(bases.flatMap((base) => [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`]));
}
export async function buildRepositoryGraph(root, repositoryFiles, changedFiles) {
    const sourceFiles = repositoryFiles.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const available = new Set([...sourceFiles, ...changedFiles.map((file) => file.path)]);
    const analyses = new Map();
    const dependencies = new Map();
    const dependents = new Map();
    const diagnostics = [];
    const resolver = new BoundedStaticModuleResolver(root, repositoryFiles, available, diagnostics);
    const concurrency = 16;
    for (let offset = 0; offset < sourceFiles.length; offset += concurrency) {
        const batch = sourceFiles.slice(offset, offset + concurrency);
        await Promise.all(batch.map(async (file) => {
            const source = await readUtf8File(path.join(root, file));
            if (source === null) {
                diagnostics.push(`Skipped ${file}: unreadable, binary, or larger than 1 MB.`);
                return;
            }
            analyses.set(file, await analyzeSource(file, source, root));
        }));
    }
    for (const [file, analysis] of [...analyses.entries()].sort(([left], [right]) => compareCodeUnits(left, right))) {
        const targets = new Set();
        for (const imported of analysis.imports) {
            const target = analysis.language === "python"
                ? candidatesForPython(file, imported.source, imported.names).find((candidate) => available.has(candidate)) ?? null
                : imported.source.startsWith(".")
                    ? candidatesForJavaScript(file, imported.source).find((candidate) => available.has(candidate)) ?? null
                    : (await resolver.resolve(file, imported.source))?.target ?? null;
            if (target)
                targets.add(target);
        }
        dependencies.set(file, targets);
        for (const target of targets) {
            const reverse = dependents.get(target) ?? new Set();
            reverse.add(file);
            dependents.set(target, reverse);
        }
    }
    const testLikeFiles = new Set(sourceFiles.filter(isTestLikePath));
    return { analyses, dependencies, dependents, testLikeFiles, testFiles: testLikeFiles, staticResolutions: resolver.evidence, diagnostics };
}
export function impactedFiles(graph, file, limit = 250) {
    const visited = new Set([file]);
    const queue = [file];
    let truncated = false;
    while (queue.length > 0) {
        const current = queue.shift();
        for (const dependent of graph.dependents.get(current) ?? []) {
            if (visited.has(dependent))
                continue;
            if (visited.size >= limit + 1) {
                truncated = true;
                continue;
            }
            visited.add(dependent);
            queue.push(dependent);
        }
    }
    visited.delete(file);
    return { files: [...visited].sort(), truncated };
}
function overlaps(a, b) {
    return a.start <= b.end && b.start <= a.end;
}
export function hasExactCurrentLineHunks(file) {
    if (!Number.isSafeInteger(file.additions) || file.additions < 0)
        return false;
    let currentLines = 0;
    for (const hunk of file.hunks) {
        const { start, end } = hunk.newRange;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)
            return false;
        const span = end - start + 1;
        if (!Number.isSafeInteger(span) || span > file.additions - currentLines)
            return false;
        currentLines += span;
    }
    return currentLines === file.additions;
}
export function symbolsChanged(file, analysis) {
    if (file.change === "deleted") {
        return file.deletedSymbolHints.map((name) => ({ name, kind: "function", range: { start: 1, end: 1 }, exported: false, confidence: "low" }));
    }
    if (!analysis || file.binary)
        return [];
    if (!hasExactCurrentLineHunks(file))
        return [];
    const changed = analysis.symbols.filter((symbol) => file.hunks.some((hunk) => overlaps(symbol.range, hunk.newRange)));
    if (changed.length > 0) {
        return changed.filter((candidate) => !changed.some((other) => other !== candidate &&
            other.range.start >= candidate.range.start &&
            other.range.end <= candidate.range.end &&
            (other.range.start > candidate.range.start || other.range.end < candidate.range.end) &&
            file.hunks.some((hunk) => overlaps(other.range, hunk.newRange))));
    }
    if (file.hunks.length > 0) {
        const start = Math.min(...file.hunks.map((hunk) => hunk.newRange.start));
        const end = Math.max(...file.hunks.map((hunk) => hunk.newRange.end));
        return [{ name: "(module scope)", kind: "module", range: { start, end }, exported: false, confidence: analysis.confidence }];
    }
    return [];
}
//# sourceMappingURL=graph.js.map