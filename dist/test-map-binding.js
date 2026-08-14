import path from "node:path";
import { readFile } from "node:fs/promises";
import { diffTargetCommit, gitNullDevice } from "./git.js";
import { runProcess, safeExecutablePath } from "./process.js";
const MAX_BINDING_BYTES = 256 * 1024;
function gitEnvironment() {
    const env = {
        PATH: safeExecutablePath(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: gitNullDevice(),
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
    };
    for (const key of ["SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP"]) {
        if (process.env[key] !== undefined)
            env[key] = process.env[key];
    }
    return env;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const record = value;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function parseBoundedJson(value) {
    if (Buffer.byteLength(value, "utf8") > MAX_BINDING_BYTES)
        return null;
    try {
        return canonicalJson(JSON.parse(value));
    }
    catch {
        return null;
    }
}
async function snapshotBlob(root, object) {
    const result = await runProcess("git", ["--no-pager", "cat-file", "blob", object], {
        cwd: root,
        timeoutMs: 30_000,
        maxOutputBytes: MAX_BINDING_BYTES + 1,
        env: gitEnvironment(),
    });
    if (result.exitCode !== 0 || result.truncated)
        return null;
    return result.stdout;
}
export async function bindTestMapToSelectionSnapshot(root, selection, repositoryPath, worktreeFile) {
    if (selection.mode === "working-tree") {
        return { matched: true, target: "working-tree", detail: "Mutable working-tree selection; no immutable snapshot binding was required." };
    }
    const targetCommit = selection.mode === "staged" ? null : await diffTargetCommit(root, selection);
    const target = selection.mode === "staged" ? "index" : targetCommit;
    if (target === null) {
        return { matched: false, target: selection.mode, detail: "ProofDiff could not resolve the selected immutable target snapshot." };
    }
    const object = selection.mode === "staged" ? `:${repositoryPath}` : `${target}:${repositoryPath}`;
    const snapshot = await snapshotBlob(root, object);
    if (snapshot === null) {
        return { matched: false, target, detail: `The repository-local test map is not a readable JSON blob in the selected ${target === "index" ? "index" : "target commit"} snapshot.` };
    }
    const currentFile = path.isAbsolute(worktreeFile) ? worktreeFile : path.resolve(root, worktreeFile);
    let current;
    try {
        current = await readFile(currentFile, "utf8");
    }
    catch {
        return { matched: false, target, detail: "The current test map could not be read for immutable snapshot binding." };
    }
    const currentCanonical = parseBoundedJson(current);
    const snapshotCanonical = parseBoundedJson(snapshot);
    if (currentCanonical === null || snapshotCanonical === null) {
        return { matched: false, target, detail: "The current or selected-snapshot test map is malformed or exceeds the bounded map size." };
    }
    if (currentCanonical !== snapshotCanonical) {
        return { matched: false, target, detail: `The current test-map declarations do not match the selected ${target === "index" ? "index" : "target commit"} snapshot.` };
    }
    return { matched: true, target, detail: `The repository-local test-map declarations match the selected ${target === "index" ? "index" : "target commit"} snapshot.` };
}
//# sourceMappingURL=test-map-binding.js.map