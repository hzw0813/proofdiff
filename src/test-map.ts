import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isTestLikePath, normalizeRepoPath, SOURCE_EXTENSIONS } from "./util.js";

const MAX_TEST_MAP_BYTES = 256 * 1024;
const MAX_RELATIONSHIPS = 1_000;
const MAX_TESTS_PER_RELATIONSHIP = 100;
const MAX_TOTAL_TESTS = 5_000;

export class TestMapError extends Error {
  override name = "TestMapError";
}

export interface LoadedTestMap {
  artifact: string;
  bySource: Map<string, string[]>;
  relationships: number;
  testPaths: number;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new TestMapError(`${label} contains unsupported field${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.`);
}

export async function testMapRepositoryPath(root: string, file: string): Promise<string | null> {
  const lexical = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
  let absolute = lexical;
  try {
    absolute = await realpath(lexical);
  } catch {
    // Preserve the lexical path so loadTestMap can produce the primary missing-file error.
  }
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return normalizeRepoPath(relative);
}

function normalizeDeclaredPath(root: string, value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TestMapError(`${label} must be a non-empty repository-relative path.`);
  if (/[\u0000-\u001F\u007F]/.test(value) || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new TestMapError(`${label} must be a safe repository-relative path.`);
  }
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TestMapError(`${label} must stay inside the repository.`);
  }
  return normalizeRepoPath(relative);
}

export async function loadTestMap(
  root: string,
  file: string,
  repositoryFiles: string[],
  selectedSourcePaths: string[] = [],
): Promise<LoadedTestMap> {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch {
    throw new TestMapError(`Test map does not exist: ${file}`);
  }
  if (metadata.isSymbolicLink()) throw new TestMapError(`Test map must not be a symbolic link: ${file}`);
  if (!metadata.isFile()) throw new TestMapError(`Test map is not a file: ${file}`);
  if (metadata.size > MAX_TEST_MAP_BYTES) throw new TestMapError(`Test map exceeds the ${MAX_TEST_MAP_BYTES / 1024} KB limit.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolute, "utf8"));
  } catch {
    throw new TestMapError("Test map is not valid JSON.");
  }
  if (!plainObject(parsed)) throw new TestMapError("Test map root must be an object.");
  exactKeys(parsed, ["version", "relationships"], "Test map root");
  if (parsed.version !== 1) throw new TestMapError("Test map version must be 1.");
  if (!Array.isArray(parsed.relationships)) throw new TestMapError("Test map relationships must be an array.");
  if (parsed.relationships.length > MAX_RELATIONSHIPS) throw new TestMapError(`Test map exceeds the ${MAX_RELATIONSHIPS} relationship limit.`);

  const visible = new Set(repositoryFiles.map(normalizeRepoPath));
  const selectableSources = new Set([...visible, ...selectedSourcePaths.map(normalizeRepoPath)]);
  const bySource = new Map<string, string[]>();
  let testPaths = 0;

  for (let index = 0; index < parsed.relationships.length; index += 1) {
    const relationship = parsed.relationships[index];
    const label = `relationships[${index}]`;
    if (!plainObject(relationship)) throw new TestMapError(`${label} must be an object.`);
    exactKeys(relationship, ["source", "tests"], label);
    const source = normalizeDeclaredPath(root, relationship.source, `${label}.source`);
    if (!selectableSources.has(source)) throw new TestMapError(`${label} references a source path that is neither Git-visible nor selected as changed: ${source}`);
    if (bySource.has(source)) throw new TestMapError(`Test map declares source more than once: ${source}`);
    if (!Array.isArray(relationship.tests) || relationship.tests.length === 0) throw new TestMapError(`${label}.tests must be a non-empty array.`);
    if (relationship.tests.length > MAX_TESTS_PER_RELATIONSHIP) throw new TestMapError(`${label}.tests exceeds the ${MAX_TESTS_PER_RELATIONSHIP} path limit.`);

    const tests: string[] = [];
    const seen = new Set<string>();
    for (let testIndex = 0; testIndex < relationship.tests.length; testIndex += 1) {
      const testPath = normalizeDeclaredPath(root, relationship.tests[testIndex], `${label}.tests[${testIndex}]`);
      if (testPath === source) throw new TestMapError(`${label} cannot declare a source as its own related test.`);
      if (seen.has(testPath)) throw new TestMapError(`${label} declares the same test path more than once: ${testPath}`);
      if (!visible.has(testPath)) throw new TestMapError(`${label} references a test path that is not Git-visible in the repository: ${testPath}`);
      if (!SOURCE_EXTENSIONS.has(path.extname(testPath).toLowerCase()) || !isTestLikePath(testPath)) {
        throw new TestMapError(`${label} references a path that is not a supported test-like source file: ${testPath}`);
      }
      seen.add(testPath);
      tests.push(testPath);
      testPaths += 1;
      if (testPaths > MAX_TOTAL_TESTS) throw new TestMapError(`Test map exceeds the ${MAX_TOTAL_TESTS} total test-path limit.`);
    }
    bySource.set(source, tests.sort());
  }

  return {
    artifact: path.basename(file),
    bySource,
    relationships: bySource.size,
    testPaths,
  };
}
