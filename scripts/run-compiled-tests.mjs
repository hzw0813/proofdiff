import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(projectRoot, "dist-test", "tests");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--coverage");
if (unknown.length > 0) throw new Error(`Unknown test-runner option: ${unknown.join(", ")}`);

const testFiles = (await readdir(testRoot))
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => path.join(testRoot, file));
if (testFiles.length === 0) throw new Error(`No compiled tests found in ${testRoot}`);

const coverage = process.argv.includes("--coverage");
const child = spawn(process.execPath, ["--test", ...(coverage ? ["--experimental-test-coverage"] : []), ...testFiles], {
  cwd: projectRoot,
  shell: false,
  stdio: "inherit",
});

child.on("error", (error) => {
  process.stderr.write(`Could not start Node's test runner: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  if (signal) process.stderr.write(`Node's test runner stopped after signal ${signal}.\n`);
  process.exitCode = code ?? 1;
});
