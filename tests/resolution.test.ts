import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { analyzeRepository } from "../src/analyze.js";
import { listRepositoryFiles } from "../src/git.js";
import { buildRepositoryGraph, impactedFiles, type RepositoryGraph } from "../src/graph.js";
import { initializeRepository, writeFiles } from "./helpers.js";

async function fixtureGraph(context: TestContext, files: Record<string, string>): Promise<{ root: string; graph: RepositoryGraph }> {
  const root = await initializeRepository(files);
  context.after(() => rm(root, { recursive: true, force: true }));
  const inventory = await listRepositoryFiles(root);
  return { root, graph: await buildRepositoryGraph(root, inventory.files, []) };
}

function hasEdge(graph: RepositoryGraph, importer: string, target: string): boolean {
  return graph.dependencies.get(importer)?.has(target) ?? false;
}

test("compiler paths resolve exact, wildcard, inherited, baseUrl, ordered fallback, and mode-supported probes", async (context) => {
  const { graph } = await fixtureGraph(context, {
    "tsconfig.json": `{
      // Inheritance and trailing commas are normal tsconfig syntax.
      "extends": ".\\\\config\\\\tsconfig.base",
      "compilerOptions": { "strict": true, },
    }`,
    "config/tsconfig.base.json": `{
      "compilerOptions": {
        "moduleResolution": "Bundler",
        "baseUrl": "..",
        "paths": {
          "@exact": ["missing/exact", "src/exact.ts"],
          "@lib/*": ["src/lib/*"],
          "@js/*": ["src/js/*.js"],
          "@index/*": ["src/index/*"],
        },
      },
    }`,
    "src/exact.ts": "export const exact = true;\n",
    "src/lib/value.ts": "export const value = true;\n",
    "src/js/value.ts": "export const value = true;\n",
    "src/index/value/index.ts": "export const value = true;\n",
    "test/consumer.test.ts": [
      "import '@exact'",
      "import '@lib/value'",
      "import '@js/value'",
      "import '@index/value'",
      "",
    ].join("\n"),
  });

  for (const target of ["src/exact.ts", "src/lib/value.ts", "src/js/value.ts", "src/index/value/index.ts"]) {
    assert.equal(hasEdge(graph, "test/consumer.test.ts", target), true, target);
  }
  assert.deepEqual(graph.staticResolutions.map((item) => [item.specifier, item.mechanism, item.metadataPath, item.matchedKey, item.target]), [
    ["@exact", "typescript-paths", "config/tsconfig.base.json", "@exact", "src/exact.ts"],
    ["@lib/value", "typescript-paths", "config/tsconfig.base.json", "@lib/*", "src/lib/value.ts"],
    ["@js/value", "typescript-paths", "config/tsconfig.base.json", "@js/*", "src/js/value.ts"],
    ["@index/value", "typescript-paths", "config/tsconfig.base.json", "@index/*", "src/index/value/index.ts"],
  ]);
  assert.ok(graph.staticResolutions.every((item) => /does not establish runtime resolution/.test(item.limitation)));
});

test("compiler paths follow supported post-substitution module resolution semantics", async (context) => {
  const nodeNextEsm = await fixtureGraph(context, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      paths: { "@file": ["./src/file"], "@directory": ["./src/directory"] },
    } }),
    "src/file.ts": "export {}\n",
    "src/directory/index.ts": "export {}\n",
    "test/consumer.test.ts": "import '@file'; import '@directory';\n",
  });
  assert.equal(nodeNextEsm.graph.staticResolutions.length, 0);
  assert.match(nodeNextEsm.graph.diagnostics.join("\n"), /extensionless paths target.*NodeNext/i);

  const explicitExtensions = await fixtureGraph(context, {
    "package.json": JSON.stringify({ type: "module" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      paths: {
        "@js": ["./src/js.js"],
        "@mjs-wrong": ["./src/mjs-wrong.mjs"],
        "@mjs": ["./src/mjs.mjs"],
        "@cjs": ["./src/cjs.cjs"],
      },
    } }),
    "src/js.ts": "export {}\n",
    "src/js.js": "export {}\n",
    "src/mjs-wrong.ts": "export {}\n",
    "src/mjs.mts": "export {}\n",
    "src/cjs.cts": "export {}\n",
    "test/consumer.test.ts": "import '@js'; import '@mjs-wrong'; import '@mjs'; import '@cjs';\n",
  });
  assert.deepEqual(explicitExtensions.graph.staticResolutions.map((item) => [item.specifier, item.target]), [
    ["@js", "src/js.ts"],
    ["@mjs", "src/mjs.mts"],
    ["@cjs", "src/cjs.cts"],
  ]);
  assert.equal(hasEdge(explicitExtensions.graph, "test/consumer.test.ts", "src/js.js"), false);
  assert.equal(hasEdge(explicitExtensions.graph, "test/consumer.test.ts", "src/mjs-wrong.ts"), false);

  for (const moduleResolution of ["Bundler", "Node10"] as const) {
    const supported = await fixtureGraph(context, {
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        module: moduleResolution === "Bundler" ? "ESNext" : "CommonJS",
        moduleResolution,
        paths: { "@file": ["./src/file"], "@directory": ["./src/directory"] },
      } }),
      "src/file.ts": "export {}\n",
      "src/directory/index.ts": "export {}\n",
      "test/consumer.test.ts": "import '@file'; import '@directory';\n",
    });
    assert.deepEqual(supported.graph.staticResolutions.map((item) => item.target), ["src/file.ts", "src/directory/index.ts"], moduleResolution);
  }
});

test("compiler paths fail closed on unsupported post-substitution precedence", async (context) => {
  const cases: Array<{ name: string; files: Record<string, string>; diagnostic: RegExp; forbidden: string }> = [
    {
      name: "missing module resolution",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value": ["./src/value"] } } }),
        "src/value.ts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /extensionless paths target.*explicit moduleResolution/i,
      forbidden: "src/value.ts",
    },
    {
      name: "non-relative target without baseUrl",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["src/value"] } } }),
        "src/value.ts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /must begin with \.\/ or \.\.\//,
      forbidden: "src/value.ts",
    },
    {
      name: "directory package metadata",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/value", "./src/fallback.ts"] } } }),
        "src/value/package.json": JSON.stringify({ types: "./types.d.ts" }),
        "src/value/types.d.ts": "export declare const value: number;\n",
        "src/value/index.ts": "export {}\n",
        "src/fallback.ts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /directory package metadata.*outside the supported subset/i,
      forbidden: "src/value/index.ts",
    },
    {
      name: "non-default module suffixes",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", moduleSuffixes: [".native", ""], paths: { "@value": ["./src/value.js"] } } }),
        "src/value.ts": "export {}\n",
        "src/value.native.ts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /moduleSuffixes.*unsupported/i,
      forbidden: "src/value.ts",
    },
    {
      name: "omitted mts extension",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/value"] } } }),
        "src/value.mts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /matched paths targets did not resolve|did not resolve/i,
      forbidden: "src/value.mts",
    },
    {
      name: "unsupported explicit extension preempts fallback",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/value.vue", "./src/fallback.ts"] } } }),
        "src/value.vue.ts": "export {}\n",
        "src/fallback.ts": "export {}\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /unsupported explicit extension/i,
      forbidden: "src/fallback.ts",
    },
  ];

  for (const item of cases) {
    const { graph } = await fixtureGraph(context, item.files);
    assert.equal(graph.staticResolutions.length, 0, item.name);
    assert.equal(hasEdge(graph, "test/c.test.ts", item.forbidden), false, item.name);
    assert.match(graph.diagnostics.join("\n"), item.diagnostic, item.name);
  }

  const exportWithoutExtension = await fixtureGraph(context, {
    "package.json": JSON.stringify({ name: "fixture", exports: { "./value": "./src/value" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler" } }),
    "src/value.ts": "export {}\n",
    "test/c.test.ts": "import 'fixture/value';\n",
  });
  assert.equal(exportWithoutExtension.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(exportWithoutExtension.graph, "test/c.test.ts", "src/value.ts"), false);
  assert.match(exportWithoutExtension.graph.diagnostics.join("\n"), /explicit supported extension/i);

  const explicitDefaultSuffix = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "node", moduleSuffixes: [""], paths: { "@value": ["./src/value"] } } }),
    "src/value.ts": "export {}\n",
    "test/c.test.ts": "import '@value';\n",
  });
  assert.equal(hasEdge(explicitDefaultSuffix.graph, "test/c.test.ts", "src/value.ts"), true);
});

test("compiler paths use exact and longest-prefix precedence without changing relative imports", async (context) => {
  const { graph } = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: {
      "@app/*": ["./src/general/*"],
      "@app/special/*": ["./src/special/*"],
      "@app/special/value": ["./src/exact.ts"],
    } } }),
    "src/exact.ts": "export const value = 1;\n",
    "src/general/value.ts": "export const value = 1;\n",
    "src/special/value.ts": "export const value = 1;\n",
    "src/relative.ts": "export const relative = 1;\n",
    "test/consumer.test.ts": "import '@app/special/value'; import '../src/relative.js';\n",
  });
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/exact.ts"), true);
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/special/value.ts"), false);
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/general/value.ts"), false);
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/relative.ts"), true);
  assert.equal(graph.staticResolutions.length, 1);
});

test("compiler paths fail closed on malformed, cyclic, unsupported, escaping, ambiguous, and excessive configuration", async (context) => {
  const cases: Array<{
    name: string;
    files: Record<string, string>;
    diagnostic: RegExp;
  }> = [
    {
      name: "malformed",
      files: { "tsconfig.json": "{ compilerOptions: {} }", "src/value.ts": "export {};\n", "test/c.test.ts": "import '@value';\n" },
      diagnostic: /malformed compiler configuration/,
    },
    {
      name: "cycle",
      files: {
        "tsconfig.json": JSON.stringify({ extends: "./config/a.json" }),
        "config/a.json": JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { paths: { "@value": ["../src/value.ts"] } } }),
        "src/value.ts": "export {};\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /extends cycle/,
    },
    {
      name: "unsupported wildcard",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value/**": ["src/**"] } } }),
        "src/value.ts": "export {};\n",
        "test/c.test.ts": "import '@value/x';\n",
      },
      diagnostic: /unsupported paths key/,
    },
    {
      name: "repository escape",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value": ["../outside.ts"] } } }),
        "src/value.ts": "export {};\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /escapes the repository/,
    },
    {
      name: "ambiguous equal prefix",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value/*x": ["./src/a.ts"], "@value/*": ["./src/b.ts"] } } }),
        "src/a.ts": "export {};\n",
        "src/b.ts": "export {};\n",
        "test/c.test.ts": "import '@value/x';\n",
      },
      diagnostic: /equally specific wildcard mappings/,
    },
    {
      name: "candidate expansion",
      files: {
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./missing/a", "./missing/b", "./missing/c", "./missing/d", "./missing/e", "./missing/f", "./missing/g", "./src/value"] } } }),
        "src/value.ts": "export {};\n",
        "test/c.test.ts": "import '@value';\n",
      },
      diagnostic: /candidate expansion exceeded 64/,
    },
  ];

  for (const item of cases) {
    const { graph } = await fixtureGraph(context, item.files);
    assert.equal(graph.staticResolutions.length, 0, item.name);
    assert.equal(hasEdge(graph, "test/c.test.ts", "src/value.ts"), false, item.name);
    assert.match(graph.diagnostics.join("\n"), item.diagnostic, item.name);
  }
});

test("compiler paths reject missing evidence, preserve case, normalize Windows targets, and bound inheritance", async (context) => {
  const noConfig = await fixtureGraph(context, {
    "src/value.ts": "export {};\n",
    "@looks/value.ts": "export {};\n",
    "test/c.test.ts": "import '@looks/value';\n",
  });
  assert.equal(noConfig.graph.staticResolutions.length, 0);

  const excludedFromNearestProject = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", baseUrl: ".", paths: { "@value": ["src/actual.ts"] } }, include: ["nested/test/**/*.ts", "src/**/*.ts"] }),
    "src/actual.ts": "export const value = true;\n",
    "nested/tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", baseUrl: ".", paths: { "@value": ["src/wrong.ts"] } }, files: ["src/other.ts"] }),
    "nested/src/wrong.ts": "export const value = false;\n",
    "nested/src/other.ts": "export {};\n",
    "nested/test/consumer.test.ts": "import { value } from '@value'; void value;\n",
  });
  assert.equal(excludedFromNearestProject.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(excludedFromNearestProject.graph, "nested/test/consumer.test.ts", "nested/src/wrong.ts"), false);
  assert.equal(hasEdge(excludedFromNearestProject.graph, "nested/test/consumer.test.ts", "src/actual.ts"), false);
  assert.match(excludedFromNearestProject.graph.diagnostics.join("\n"), /does not include the importer.*ancestor project selection is outside the supported subset/i);

  const inheritedProjectMembership = await fixtureGraph(context, {
    "config/base.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", baseUrl: "../nested", paths: { "@value": ["src/wrong.ts"] } }, include: ["src/**/*.ts"] }),
    "nested/tsconfig.json": JSON.stringify({ extends: "../config/base.json" }),
    "nested/src/wrong.ts": "export const value = false;\n",
    "nested/test/consumer.test.ts": "import { value } from '@value'; void value;\n",
  });
  assert.equal(inheritedProjectMembership.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(inheritedProjectMembership.graph, "nested/test/consumer.test.ts", "nested/src/wrong.ts"), false);

  const javascriptWithoutAllowJs = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/value.ts"] } }, include: ["**/*"] }),
    "src/value.ts": "export const value = true;\n",
    "test/consumer.js": "import { value } from '@value'; void value;\n",
  });
  assert.equal(javascriptWithoutAllowJs.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(javascriptWithoutAllowJs.graph, "test/consumer.js", "src/value.ts"), false);

  const defaultOutputExclusion = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/value.ts"] }, outDir: "dist" } }),
    "src/value.ts": "export const value = true;\n",
    "dist/test/consumer.test.ts": "import { value } from '@value'; void value;\n",
  });
  assert.equal(defaultOutputExclusion.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(defaultOutputExclusion.graph, "dist/test/consumer.test.ts", "src/value.ts"), false);

  const missingAndBaseUrlOnly = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "@missing": ["missing.ts"] } } }),
    "src/looks-bare.ts": "export {};\n",
    "test/c.test.ts": "import 'looks-bare'; import '@missing';\n",
  });
  assert.equal(missingAndBaseUrlOnly.graph.staticResolutions.length, 0);

  const baseUrlPreemptsPackageSelf = await fixtureGraph(context, {
    "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/exported.ts" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
    "src/exported.ts": "export {};\n",
    "src/fixture/feature.ts": "export {};\n",
    "test/c.test.ts": "import 'fixture/feature';\n",
  });
  assert.equal(baseUrlPreemptsPackageSelf.graph.staticResolutions.length, 0);
  assert.equal(hasEdge(baseUrlPreemptsPackageSelf.graph, "test/c.test.ts", "src/exported.ts"), false);
  assert.match(baseUrlPreemptsPackageSelf.graph.diagnostics.join("\n"), /standalone baseUrl precedence/);

  const windows = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": [".\\src\\value"] } } }),
    "src/value.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  });
  assert.equal(hasEdge(windows.graph, "test/c.test.ts", "src/value.ts"), true);

  const wrongCase = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./src/Value"] } } }),
    "src/value.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  });
  assert.equal(wrongCase.graph.staticResolutions.length, 0);

  const explicitExtensionNearMiss = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value": ["./src/value.ts"] } } }),
    "src/value.ts/index.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  });
  assert.equal(explicitExtensionNearMiss.graph.staticResolutions.length, 0);

  const nodeModulesTarget = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@value": ["./node_modules/value/index.ts"] } } }),
    "node_modules/value/index.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  });
  assert.equal(nodeModulesTarget.graph.staticResolutions.length, 0);
  assert.match(nodeModulesTarget.graph.diagnostics.join("\n"), /enters node_modules/);

  const chainFiles: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ extends: "./config/1.json" }),
    "src/value.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  };
  for (let index = 1; index <= 9; index += 1) {
    chainFiles[`config/${index}.json`] = index === 9
      ? JSON.stringify({ compilerOptions: { paths: { "@value": ["../src/value.ts"] } } })
      : JSON.stringify({ extends: `./${index + 1}.json` });
  }
  const excessive = await fixtureGraph(context, chainFiles);
  assert.equal(excessive.graph.staticResolutions.length, 0);
  assert.match(excessive.graph.diagnostics.join("\n"), /inheritance exceeded depth 8/);
});

test("hidden higher-precedence files prevent fallback edges", async (context) => {
  const aliasRoot = await initializeRepository({
    ".gitignore": "dist/\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", paths: { "@value": ["./dist/value", "./src/value"] } } }),
    "src/value.ts": "export {};\n",
    "test/c.test.ts": "import '@value';\n",
  });
  context.after(() => rm(aliasRoot, { recursive: true, force: true }));
  await writeFiles(aliasRoot, { "dist/value.ts": "export {};\n" });
  const aliasInventory = await listRepositoryFiles(aliasRoot);
  const aliasGraph = await buildRepositoryGraph(aliasRoot, aliasInventory.files, []);
  assert.equal(aliasGraph.staticResolutions.length, 0);
  assert.match(aliasGraph.diagnostics.join("\n"), /higher-precedence candidate dist\/value\.ts exists outside the bounded Git inventory/);

  const packageRoot = await initializeRepository({
    ".gitignore": "src/*.ts\n",
    "package.json": JSON.stringify({ name: "fixture", exports: { "./value": "./src/value.js" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "NodeNext" } }),
    "src/value.js": "export {};\n",
    "test/c.test.ts": "import 'fixture/value';\n",
  });
  context.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFiles(packageRoot, { "src/value.ts": "export {};\n" });
  const packageInventory = await listRepositoryFiles(packageRoot);
  const packageGraph = await buildRepositoryGraph(packageRoot, packageInventory.files, []);
  assert.equal(packageGraph.staticResolutions.length, 0);
  assert.match(packageGraph.diagnostics.join("\n"), /higher-precedence package self-export candidate src\/value\.ts/);

  const hiddenPackageRoot = await initializeRepository({
    ".gitignore": "nested/package.json\n",
    "package.json": JSON.stringify({ name: "root-package", type: "module", exports: ".\/src\/root.js" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } }),
    "src/root.ts": "export const root = true;\n",
    "nested/test/consumer.test.ts": "import { root } from 'root-package'; void root;\n",
  });
  context.after(() => rm(hiddenPackageRoot, { recursive: true, force: true }));
  await writeFiles(hiddenPackageRoot, { "nested/package.json": JSON.stringify({ name: "nested-package", type: "module" }) });
  const hiddenPackageInventory = await listRepositoryFiles(hiddenPackageRoot);
  const hiddenPackageGraph = await buildRepositoryGraph(hiddenPackageRoot, hiddenPackageInventory.files, []);
  assert.equal(hiddenPackageGraph.staticResolutions.length, 0);
  assert.equal(hasEdge(hiddenPackageGraph, "nested/test/consumer.test.ts", "src/root.ts"), false);
  assert.match(hiddenPackageGraph.diagnostics.join("\n"), /nearer package\.json.*outside the bounded Git inventory/i);
});

test("package self-exports resolve exact root/subpaths and explicit nested source conditions", async (context) => {
  const { graph } = await fixtureGraph(context, {
    "package.json": JSON.stringify({
      name: "fixture",
      type: "module",
      exports: {
        ".": "./src/index.js",
        "./feature": {
          "@fixture/source": { default: "./src/feature.ts" },
          types: "./dist/feature.d.ts",
          import: "./dist/feature.js",
        },
      },
    }),
    "tsconfig.json": `{
      "compilerOptions": {
        "moduleResolution": "NodeNext",
        "customConditions": ["@fixture/source"],
      },
    }`,
    "src/index.ts": "export * from './feature.js';\n",
    "src/feature.ts": "export const feature = true;\n",
    "test/consumer.test.ts": "import 'fixture'; import 'fixture/feature';\n",
  });
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/index.ts"), true);
  assert.equal(hasEdge(graph, "test/consumer.test.ts", "src/feature.ts"), true);
  assert.deepEqual(graph.staticResolutions.map((item) => [item.specifier, item.mechanism, item.metadataPath, item.matchedKey, item.target]), [
    ["fixture", "package-self-export", "package.json", ".", "src/index.ts"],
    ["fixture/feature", "package-self-export", "package.json", "./feature", "src/feature.ts"],
  ]);
  assert.match(graph.staticResolutions[1]?.detail ?? "", /@fixture\/source → default/);
});

test("package self-exports fail closed on ambiguous shapes, malformed identity, traversal, and non-self imports", async (context) => {
  const cases: Array<{ name: string; files: Record<string, string>; importer?: string; target?: string }> = [
    {
      name: "built-in condition can preempt source",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": { import: "./dist/feature.js", "@source": "./src/feature.ts" } } }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "nodenext", customConditions: ["@source"] } }),
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
    {
      name: "array fallback",
      files: { "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": ["./src/feature.ts"] } }), "src/feature.ts": "export {};\n", "test/c.test.ts": "import 'fixture/feature';\n" },
    },
    {
      name: "wildcard export",
      files: { "package.json": JSON.stringify({ name: "fixture", exports: { "./*": "./src/*.ts" } }), "src/feature.ts": "export {};\n", "test/c.test.ts": "import 'fixture/feature';\n" },
    },
    {
      name: "missing package name",
      files: { "package.json": JSON.stringify({ exports: { "./feature": "./src/feature.ts" } }), "src/feature.ts": "export {};\n", "test/c.test.ts": "import 'fixture/feature';\n" },
    },
    {
      name: "malformed package metadata",
      files: { "package.json": "{ name: 'fixture' }", "src/feature.ts": "export {};\n", "test/c.test.ts": "import 'fixture/feature';\n" },
    },
    {
      name: "external same-looking package",
      files: { "package.json": JSON.stringify({ name: "app", exports: { "./feature": "./src/feature.ts" } }), "src/feature.ts": "export {};\n", "test/c.test.ts": "import 'fixture/feature';\n" },
    },
    {
      name: "package escape",
      files: {
        "package.json": JSON.stringify({ name: "root" }),
        "packages/fixture/package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./../shared/feature.ts" } }),
        "packages/shared/feature.ts": "export {};\n",
        "packages/fixture/test/c.test.ts": "import 'fixture/feature';\n",
      },
      importer: "packages/fixture/test/c.test.ts",
      target: "packages/shared/feature.ts",
    },
    {
      name: "nested package target",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./nested/src/feature.ts" } }),
        "nested/package.json": JSON.stringify({ name: "nested" }),
        "nested/src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
      target: "nested/src/feature.ts",
    },
    {
      name: "explicit extension near miss",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/feature.ts" } }),
        "src/feature.ts/index.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
      target: "src/feature.ts/index.ts",
    },
    {
      name: "exports explicitly disabled",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/feature.ts" } }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "nodenext", resolvePackageJsonExports: false } }),
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
    {
      name: "versioned types condition can preempt default",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": { "types@>=5.0": "./src/actual.d.ts", default: "./src/feature.ts" } } }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "nodenext" } }),
        "src/actual.d.ts": "export declare const actual: true;\n",
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
    {
      name: "missing export-aware module resolution",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/feature.js" } }),
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
    {
      name: "unsupported compiler mode",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/feature.ts" } }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "node10" } }),
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
    {
      name: "invalid compiler config cannot be bypassed",
      files: {
        "package.json": JSON.stringify({ name: "fixture", exports: { "./feature": "./src/feature.ts" } }),
        "tsconfig.json": "{ compilerOptions: { moduleResolution: 'nodenext' } }",
        "src/feature.ts": "export {};\n",
        "test/c.test.ts": "import 'fixture/feature';\n",
      },
    },
  ];

  for (const item of cases) {
    const { graph } = await fixtureGraph(context, item.files);
    const importer = item.importer ?? "test/c.test.ts";
    const target = item.target ?? "src/feature.ts";
    assert.equal(graph.staticResolutions.length, 0, item.name);
    assert.equal(hasEdge(graph, importer, target), false, item.name);
  }
});

test("nearest package ownership isolates monorepo self-references", async (context) => {
  const { graph } = await fixtureGraph(context, {
    "package.json": JSON.stringify({ name: "root-app", exports: { "./feature": "./src/feature.ts" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "NodeNext" } }),
    "src/feature.ts": "export {};\n",
    "packages/child/package.json": JSON.stringify({ name: "child", exports: { "./feature": "./src/feature.ts" } }),
    "packages/child/src/feature.ts": "export {};\n",
    "packages/child/test/consumer.test.ts": "import 'child/feature'; import 'root-app/feature';\n",
  });
  assert.equal(hasEdge(graph, "packages/child/test/consumer.test.ts", "packages/child/src/feature.ts"), true);
  assert.equal(hasEdge(graph, "packages/child/test/consumer.test.ts", "src/feature.ts"), false);
  assert.deepEqual(graph.staticResolutions.map((item) => item.specifier), ["child/feature"]);
});

test("resolved aliases and self-exports create only static transitive relationships", async (context) => {
  const alias = await fixtureGraph(context, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@app/value": ["./src/barrel.ts"] } } }),
    "src/value.ts": "export const value = 1;\n",
    "src/barrel.ts": "export { value } from './value.js';\n",
    "test/value.test.ts": "import { value } from '@app/value'; void value;\n",
  });
  assert.deepEqual(impactedFiles(alias.graph, "src/value.ts").files, ["src/barrel.ts", "test/value.test.ts"]);

  const self = await fixtureGraph(context, {
    "package.json": JSON.stringify({ name: "fixture", exports: { "./value": "./src/barrel.ts" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "NodeNext" } }),
    "src/value.ts": "export const value = 1;\n",
    "src/barrel.ts": "export { value } from './value.js';\n",
    "test/value.test.ts": "import { value } from 'fixture/value'; void value;\n",
  });
  assert.deepEqual(impactedFiles(self.graph, "src/value.ts").files, ["src/barrel.ts", "test/value.test.ts"]);

  await writeFiles(alias.root, { "src/value.ts": "export const value = 2;\n" });
  const report = await analyzeRepository({ repo: alias.root });
  assert.equal(report.assessments[0]?.status, "unknown");
  assert.deepEqual(report.assessments[0]?.relatedTests, ["test/value.test.ts"]);
  assert.deepEqual(report.assessments[0]?.executedTests, []);
  assert.equal(report.trust.repositoryCodeExecuted, false);
});

test("new static edges do not qualify helpers or strengthen zero-test runtime evidence", async (context) => {
  const helperRoot = await initializeRepository({
    "package.json": JSON.stringify({ name: "helper-boundary", type: "module", scripts: { test: "node --test" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true, paths: { "#value": ["./src/value.js"] } } }),
    "src/value.js": "export const value = 1;\n",
    "tests/fixtures/helper.js": "import { value } from '#value'; export const fixture = value;\n",
  });
  context.after(() => rm(helperRoot, { recursive: true, force: true }));
  await writeFiles(helperRoot, { "src/value.js": "export const value = 2;\n" });
  const helperReport = await analyzeRepository({ repo: helperRoot, runChecks: true, timeoutMs: 20_000 });
  assert.deepEqual(helperReport.assessments[0]?.relatedTests, ["tests/fixtures/helper.js"]);
  assert.deepEqual(helperReport.assessments[0]?.executedTests, []);
  assert.ok(!helperReport.checks.some((check) => check.id.endsWith(":targeted")));

  const zeroRoot = await initializeRepository({
    "package.json": JSON.stringify({ name: "zero-boundary", type: "module", exports: { "./value": "./src/value.js" }, scripts: { test: "node --test" } }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { allowJs: true, moduleResolution: "NodeNext" } }),
    "src/value.js": "export const value = 1;\n",
    "test/empty.test.js": "import { value } from 'zero-boundary/value'; export const observed = value;\n",
  });
  context.after(() => rm(zeroRoot, { recursive: true, force: true }));
  await writeFiles(zeroRoot, { "src/value.js": "export const value = 2;\n" });
  const zeroReport = await analyzeRepository({ repo: zeroRoot, runChecks: true, timeoutMs: 20_000 });
  const zeroAssessment = zeroReport.assessments[0];
  assert.deepEqual(zeroAssessment?.relatedTests, ["test/empty.test.js"]);
  assert.deepEqual(zeroAssessment?.executedTests, []);
  assert.notEqual(zeroAssessment?.status, "verified");
  assert.equal(zeroReport.checks.find((check) => check.id.endsWith(":targeted"))?.targetObservations?.[0]?.outcome, "zero-tests");
});
