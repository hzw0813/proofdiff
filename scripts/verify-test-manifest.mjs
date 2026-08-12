import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const command = manifest.scripts?.test;
assert.equal(typeof command, "string", "package.json is missing its test script");
const invocation = command.match(/(?:^|&& )node --test (.+)$/)?.[1]?.trim().split(/\s+/);
assert.ok(invocation?.includes("--test-concurrency=1"), "The test suite must run serially because its integration tests launch competing Git, Python, and Node subprocesses");
const explicit = invocation?.filter((argument) => !argument.startsWith("--")).sort();
assert.ok(explicit?.length, "The test script must end with an explicit cross-platform node --test file list");

const compiled = (await readdir(path.join(projectRoot, "dist-test", "tests")))
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => `dist-test/tests/${file}`);
assert.deepEqual(explicit, compiled, "The explicit node --test list is stale; include every compiled *.test.js file");
