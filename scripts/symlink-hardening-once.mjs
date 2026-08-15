import { readFile, writeFile } from "node:fs/promises";

async function replaceExactly(file, from, to) {
  const source = await readFile(file, "utf8");
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one marker, found ${count}`);
  await writeFile(file, source.replace(from, to));
}

async function appendBefore(file, marker, block) {
  const source = await readFile(file, "utf8");
  const count = source.split(marker).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one insertion marker, found ${count}`);
  await writeFile(file, source.replace(marker, `${block}\n${marker}`));
}

await replaceExactly(
  "src/checks.ts",
  'import { pathExists, readUtf8File, sanitizeControlCharacters, unique } from "./util.js";',
  'import { isRegularFileNoFollow, pathExists, readUtf8File, sanitizeControlCharacters, unique } from "./util.js";',
);
await replaceExactly(
  "src/checks.ts",
  'if (!checks.some((check) => check.kind === "typecheck") && await pathExists(path.join(root, "tsconfig.json")) && await pathExists(localTsc)) {',
  'if (!checks.some((check) => check.kind === "typecheck") && await isRegularFileNoFollow(path.join(root, "tsconfig.json")) && await pathExists(localTsc)) {',
);
await replaceExactly(
  "src/checks.ts",
  'const hasPythonProject = await pathExists(path.join(root, "pyproject.toml"));',
  'const hasPythonProject = await isRegularFileNoFollow(path.join(root, "pyproject.toml"));',
);
await replaceExactly(
  "src/checks.ts",
  'if (qualification && await pathExists(path.join(root, qualification.runnerPath))) qualifiedCandidates.push(qualification);',
  'if (qualification && await isRegularFileNoFollow(path.join(root, qualification.runnerPath))) qualifiedCandidates.push(qualification);',
);

await replaceExactly(
  "src/js-runners.ts",
  'import { isTestLikePath, pathExists, readUtf8File, unique } from "./util.js";',
  'import { isRegularFileNoFollow, isTestLikePath, pathExists, readUtf8File, unique } from "./util.js";',
);
await replaceExactly(
  "src/js-runners.ts",
  'if (qualification && await pathExists(path.join(root, qualification.runnerPath))) qualified.push(qualification);',
  'if (qualification && await isRegularFileNoFollow(path.join(root, qualification.runnerPath))) qualified.push(qualification);',
);

await replaceExactly(
  "tests/checks.test.ts",
  'import assert from "node:assert/strict";\nimport { rm } from "node:fs/promises";\nimport test from "node:test";',
  'import assert from "node:assert/strict";\nimport { rm, symlink, writeFile } from "node:fs/promises";\nimport path from "node:path";\nimport test from "node:test";',
);

const checksBlock = `test("symbolic-link repository metadata cannot enable check discovery", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({ "node_modules/typescript/bin/tsc": "console.log('fixture');\\n" });
  const outside = path.join(path.dirname(root), \`${'${path.basename(root)}'}-tsconfig.json\`);
  context.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { force: true })]));
  await writeFile(outside, '{"compilerOptions":{}}\\n');
  await symlink(outside, path.join(root, "tsconfig.json"));
  const { checks } = await discoverChecks(root);
  assert.equal(checks.some((check) => check.id === "js:typecheck:tsc"), false);
});

test("targeted execution rejects symbolic-link test paths", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "real.js": "export const value = true;\\n",
  });
  context.after(() => rm(root, { recursive: true, force: true }));
  await symlink("real.js", path.join(root, "value.test.js"));
  const { checks } = await discoverChecks(root);
  const targeted = await targetedTestChecks(root, checks, ["value.test.js"]);
  assert.deepEqual(targeted.checks, []);
});
`;
await appendBefore(
  "tests/checks.test.ts",
  'test("unsupported Node test options keep targeted execution disabled", async (context) => {',
  checksBlock,
);

await replaceExactly(
  "tests/git.test.ts",
  'import { rm } from "node:fs/promises";',
  'import { rm, symlink, writeFile } from "node:fs/promises";',
);
await replaceExactly(
  "tests/git.test.ts",
  'import { pathExists } from "../src/util.js";',
  'import { pathExists, readUtf8File } from "../src/util.js";',
);

const gitBlock = `test("working-tree untracked symbolic links are not dereferenced", { skip: process.platform === "win32" }, async (context) => {
  const root = await initializeRepository({ "tracked.txt": "baseline\\n" });
  const outside = path.join(path.dirname(root), \`${'${path.basename(root)}'}-outside.js\`);
  context.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { force: true })]));
  await writeFile(outside, "export const outside = 1;\\nexport const leaked = 2;\\n");
  await symlink(outside, path.join(root, "leak.js"));
  const { args } = await selectDiff(root, {});
  const files = await changedFiles(root, args, true);
  const leak = files.find((file) => file.path === "leak.js");
  assert.equal(leak?.additions, 0);
  assert.equal(await readUtf8File(path.join(root, "leak.js")), null);
});
`;
await appendBefore(
  "tests/git.test.ts",
  'test("findRepository accepts a nested directory", async (context) => {',
  gitBlock,
);

console.log("Applied symlink hardening source and regression updates.");
