import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}

test("runtime has no network or telemetry implementation", async () => {
  const violations: string[] = [];
  const networkImport = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram)["']/;
  const networkGlobal = /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/;
  for (const file of await sourceFiles(path.join(projectRoot, "src"))) {
    const source = await readFile(file, "utf8");
    if (networkImport.test(source) || networkGlobal.test(source)) violations.push(path.relative(projectRoot, file));
  }
  assert.deepEqual(violations, [], "Runtime source unexpectedly gained a network API");

  const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}).sort(), ["@babel/parser"]);
});
