import { constants } from "node:fs";
import { access, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
export const SOURCE_EXTENSIONS = new Set([
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".pyi",
]);
export function compareCodeUnits(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
export async function pathExists(value) {
    try {
        await access(value, constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
export async function readUtf8File(file, limitBytes = 1_000_000) {
    try {
        const info = await stat(file);
        if (!info.isFile() || info.size > limitBytes)
            return null;
        const content = await readFile(file);
        if (content.includes(0))
            return null;
        return content.toString("utf8");
    }
    catch {
        return null;
    }
}
export async function isLikelyBinaryFile(file) {
    let handle;
    try {
        handle = await open(file, "r");
        const buffer = Buffer.alloc(8_192);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).includes(0);
    }
    catch {
        return false;
    }
    finally {
        await handle?.close();
    }
}
export function normalizeRepoPath(value) {
    return value.split(path.sep).join("/").replace(/^\.\//, "");
}
export function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}
export async function resolveRepositoryPath(value) {
    const resolved = await realpath(path.resolve(value));
    if (!(await stat(resolved)).isDirectory())
        throw new Error(`Not a directory: ${value}`);
    return resolved;
}
export function languageForPath(file) {
    const extension = path.extname(file).toLowerCase();
    if ([".ts", ".tsx", ".mts", ".cts"].includes(extension))
        return "typescript";
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension))
        return "javascript";
    if ([".py", ".pyi"].includes(extension))
        return "python";
    return "unknown";
}
export function isTestLikePath(file) {
    const normalized = `/${normalizeRepoPath(file).toLowerCase()}`;
    return (/\/(?:tests?|__tests__|unittests?)\//.test(normalized) ||
        /(?:^|\/)(?:test|test_[^/]+|test-[^/]+|[^/]+-(?:test|spec)|[^/]+_(?:test|spec)|[^/]+\.(?:test|spec))\.(?:[cm]?[jt]sx?|pyi?)$/.test(normalized));
}
/** @deprecated Test-like path heuristics are not runnable-target identity. */
export const isTestFile = isTestLikePath;
export function unique(items) {
    return [...new Set(items)];
}
export function plural(count, singular, pluralForm = `${singular}s`) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
export function sanitizeControlCharacters(value) {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
export function stableSort(items, compare) {
    return items.map((value, index) => ({ value, index })).sort((a, b) => compare(a.value, b.value) || a.index - b.index).map(({ value }) => value);
}
//# sourceMappingURL=util.js.map