import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import type { Confidence } from "./types.js";
import { isInside, normalizeRepoPath, readUtf8File, unique } from "./util.js";

const MAX_ANCESTOR_DEPTH = 32;
const MAX_CONFIG_FILES = 64;
const MAX_PACKAGE_FILES = 256;
const MAX_METADATA_BYTES = 256_000;
const MAX_CONFIG_EXTENDS_DEPTH = 8;
const MAX_PATH_MAPPINGS = 128;
const MAX_PATH_TARGETS = 8;
const MAX_CUSTOM_CONDITIONS = 32;
const MAX_PROJECT_PATTERNS = 128;
const MAX_CANDIDATES_PER_IMPORT = 64;
const MAX_EXPORT_CONDITION_DEPTH = 8;
const MAX_EXPORT_BRANCHES = 64;
const MAX_RESOLUTION_DIAGNOSTICS = 100;
const MAX_NON_RELATIVE_IMPORTS = 50_000;
const MAX_RESOLUTION_EVIDENCE = 10_000;

const JAVASCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const EXTENSIONLESS_PATH_MODULE_RESOLUTIONS = new Set(["bundler", "node", "node10"]);
const OMITTED_EXPLICIT_EXTENSIONS = [".mts", ".cts", ".mjs", ".cjs"];
const POTENTIALLY_ACTIVE_BUILTIN_CONDITIONS = new Set(["types", "node-addons", "node", "import", "require", "module-sync"]);
const PACKAGE_EXPORT_MODULE_RESOLUTIONS = new Set(["node16", "node18", "node20", "nodenext", "bundler"]);

export interface StaticResolutionEvidence {
  importer: string;
  specifier: string;
  mechanism: "typescript-paths" | "package-self-export";
  metadataPath: string;
  matchedKey: string;
  target: string;
  confidence: Confidence;
  detail: string;
  limitation: string;
}

export interface StaticModuleResolution {
  target: string;
  evidence: StaticResolutionEvidence;
}

interface CompilerPathMappings {
  entries: Map<string, string[]>;
  origin: string;
}

interface CompilerConfig {
  configPath: string;
  paths?: CompilerPathMappings;
  baseUrl?: { path: string; origin: string };
  customConditions?: string[];
  moduleResolution?: string;
  resolvePackageJsonExports?: boolean;
  projectFiles?: Set<string>;
  projectIncludes?: ProjectPattern[];
  projectExcludes?: ProjectPattern[];
}

interface ProjectPattern {
  expression: RegExp;
}

interface PackageMetadata {
  packagePath: string;
  directory: string;
  name?: string;
  exports?: unknown;
}

interface ConditionSelection {
  target: string;
  conditions: string[];
}

interface ConditionState {
  branches: number;
}

interface PathMatch {
  key: string;
  capture: string | null;
  targets: string[];
}

type PathResolutionAttempt =
  | { kind: "resolved"; resolution: StaticModuleResolution }
  | { kind: "not-applicable" | "not-found" }
  | { kind: "blocked"; reason: string; diagnosticKey?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRepositoryPath(value: string): boolean {
  return value !== ".." && !value.startsWith("../") && !value.startsWith("/") && !/^[A-Za-z]:\//.test(value);
}

function normalizeConfiguredPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function projectPattern(configPath: string, value: string): ProjectPattern | null {
  const normalized = normalizeConfiguredPath(value).replace(/^\.\//, "");
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.includes("${") || /[\[\]{}]/.test(normalized)) return null;
  const anchored = path.posix.normalize(path.posix.join(path.posix.dirname(configPath), normalized));
  if (!isRepositoryPath(anchored)) return null;
  let expression = "^";
  for (let index = 0; index < anchored.length; index += 1) {
    const character = anchored[index]!;
    if (character === "*" && anchored[index + 1] === "*") {
      if (anchored[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += escapeRegularExpression(character);
  }
  if (!/[?*]/.test(anchored) && path.posix.extname(anchored) === "") expression += "(?:/.*)?";
  expression += "$";
  return { expression: new RegExp(expression) };
}

function joinRepositoryPath(base: string, relative: string): string | null {
  const normalized = normalizeConfiguredPath(relative);
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const joined = normalizeRepoPath(path.posix.normalize(path.posix.join(base, normalized)));
  return isRepositoryPath(joined) ? joined : null;
}

function isWithin(directory: string, target: string): boolean {
  return directory === "" || target === directory || target.startsWith(`${directory}/`);
}

export function javascriptModuleCandidates(baseInput: string): string[] {
  const base = normalizeRepoPath(path.posix.normalize(baseInput));
  if (!isRepositoryPath(base)) return [];
  const candidates = [base];
  if (/\.m?js$|\.cjs$/.test(base)) {
    candidates.push(base.replace(/\.(?:mjs|cjs|js)$/, ".ts"), base.replace(/\.(?:mjs|cjs|js)$/, ".tsx"));
  }
  for (const extension of JAVASCRIPT_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of JAVASCRIPT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  return unique(candidates);
}

function explicitConfiguredModuleCandidates(base: string): string[] | null {
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -3);
    return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, base, `${stem}.jsx`];
  }
  if (base.endsWith(".jsx")) {
    const stem = base.slice(0, -4);
    return [`${stem}.tsx`, `${stem}.d.ts`, base];
  }
  if (base.endsWith(".mjs")) {
    const stem = base.slice(0, -4);
    return [`${stem}.mts`, `${stem}.d.mts`, base];
  }
  if (base.endsWith(".cjs")) {
    const stem = base.slice(0, -4);
    return [`${stem}.cts`, `${stem}.d.cts`, base];
  }
  if ([".ts", ".tsx", ".mts", ".cts"].some((extension) => base.endsWith(extension))) return [base];
  return null;
}

function extensionlessConfiguredModuleCandidates(base: string): { files: string[]; indexes: string[] } {
  const substitutions = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];
  return {
    files: substitutions.map((extension) => `${base}${extension}`),
    indexes: substitutions.map((extension) => `${base}/index${extension}`),
  };
}

function parseJsonc(source: string): unknown {
  const input = source.replace(/^\uFEFF/, "");
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    const next = input[index + 1];
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutComments += character;
      continue;
    }
    if (character === "/" && next === "/") {
      withoutComments += "  ";
      index += 2;
      while (index < input.length && input[index] !== "\n" && input[index] !== "\r") {
        withoutComments += " ";
        index += 1;
      }
      if (index < input.length) withoutComments += input[index];
      continue;
    }
    if (character === "/" && next === "*") {
      withoutComments += "  ";
      index += 2;
      let closed = false;
      while (index < input.length) {
        const current = input[index]!;
        const following = input[index + 1];
        if (current === "*" && following === "/") {
          withoutComments += "  ";
          index += 1;
          closed = true;
          break;
        }
        withoutComments += current === "\n" || current === "\r" ? current : " ";
        index += 1;
      }
      if (!closed) throw new Error("unterminated block comment");
      continue;
    }
    withoutComments += character;
  }

  let normalized = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index]!;
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      normalized += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(withoutComments[lookahead] ?? "")) lookahead += 1;
      if (withoutComments[lookahead] === "}" || withoutComments[lookahead] === "]") {
        normalized += " ";
        continue;
      }
    }
    normalized += character;
  }
  return JSON.parse(normalized) as unknown;
}

function validPackageName(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || /\s/.test(value)) return false;
  if (value.startsWith("@")) return /^@[^/.][^/]*\/[^/.][^/]*$/.test(value);
  return !value.startsWith(".") && !value.includes("/");
}

export class BoundedStaticModuleResolver {
  readonly evidence: StaticResolutionEvidence[] = [];
  private readonly repositoryFiles: Set<string>;
  private readonly configPaths: Set<string>;
  private readonly packagePaths: Set<string>;
  private readonly configCache = new Map<string, CompilerConfig | null>();
  private readonly packageCache = new Map<string, PackageMetadata | null>();
  private readonly configOwnerCache = new Map<string, string | null>();
  private readonly packageOwnerCache = new Map<string, string | null>();
  private readonly targetSafetyCache = new Map<string, boolean>();
  private readonly fileExistenceCache = new Map<string, boolean>();
  private readonly evidenceKeys = new Set<string>();
  private readonly diagnosticKeys = new Set<string>();
  private loadedConfigs = 0;
  private loadedPackages = 0;
  private nonRelativeImports = 0;
  private diagnosticCount = 0;
  private diagnosticLimitReported = false;

  constructor(
    private readonly root: string,
    repositoryFiles: string[],
    private readonly available: Set<string>,
    private readonly diagnostics: string[],
  ) {
    this.repositoryFiles = new Set(repositoryFiles);
    this.configPaths = new Set(repositoryFiles.filter((file) => path.posix.basename(file) === "tsconfig.json"));
    this.packagePaths = new Set(repositoryFiles.filter((file) => path.posix.basename(file) === "package.json"));
  }

  async resolve(importer: string, specifier: string): Promise<StaticModuleResolution | null> {
    this.nonRelativeImports += 1;
    if (this.nonRelativeImports > MAX_NON_RELATIVE_IMPORTS) {
      this.note(`Static non-relative import resolution stopped at ${MAX_NON_RELATIVE_IMPORTS} observations.`, "non-relative-import-limit");
      return null;
    }
    const compilerAttempt = await this.resolveCompilerPath(importer, specifier);
    if (compilerAttempt.kind === "resolved") return this.record(compilerAttempt.resolution);
    if (compilerAttempt.kind === "blocked") {
      this.note(`${importer}: did not resolve ${JSON.stringify(specifier)} through compiler paths: ${compilerAttempt.reason}`, compilerAttempt.diagnosticKey);
      return null;
    }
    const packageResolution = await this.resolvePackageSelfReference(importer, specifier);
    return packageResolution ? this.record(packageResolution) : null;
  }

  private record(resolution: StaticModuleResolution): StaticModuleResolution | null {
    const key = `${resolution.evidence.importer}\0${resolution.evidence.specifier}\0${resolution.target}`;
    if (!this.evidenceKeys.has(key)) {
      if (this.evidence.length >= MAX_RESOLUTION_EVIDENCE) {
        this.note(`Static non-relative resolution evidence stopped at ${MAX_RESOLUTION_EVIDENCE} entries; additional edges were not created.`, "resolution-evidence-limit");
        return null;
      }
      this.evidenceKeys.add(key);
      this.evidence.push(resolution.evidence);
    }
    return resolution;
  }

  private note(message: string, key = message): void {
    if (this.diagnosticCount >= MAX_RESOLUTION_DIAGNOSTICS) {
      if (!this.diagnosticLimitReported) {
        this.diagnostics.push(`Static module-resolution diagnostics stopped at ${MAX_RESOLUTION_DIAGNOSTICS} entries.`);
        this.diagnosticLimitReported = true;
      }
      return;
    }
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    this.diagnostics.push(message);
    this.diagnosticCount += 1;
  }

  private async readMetadata(metadataPath: string, label: string): Promise<string | null> {
    const expected = path.resolve(this.root, metadataPath);
    try {
      const actual = await realpath(expected);
      if (actual !== expected || !isInside(path.resolve(this.root), actual)) {
        this.note(`${metadataPath}: ${label} symlinks outside its repository-owned path and was rejected.`);
        return null;
      }
    } catch {
      this.note(`${metadataPath}: ${label} could not be resolved to a repository-owned file.`);
      return null;
    }
    return await readUtf8File(expected, MAX_METADATA_BYTES);
  }

  private async targetIsInside(target: string, directory = ""): Promise<boolean> {
    const key = `${directory}\0${target}`;
    const cached = this.targetSafetyCache.get(key);
    if (cached !== undefined) return cached;
    const repositoryRoot = path.resolve(this.root);
    const expected = path.resolve(repositoryRoot, target);
    try {
      const actual = await realpath(expected);
      const boundary = path.resolve(repositoryRoot, directory);
      const safe = isInside(repositoryRoot, actual) && isInside(boundary, actual);
      this.targetSafetyCache.set(key, safe);
      return safe;
    } catch {
      this.targetSafetyCache.set(key, false);
      return false;
    }
  }

  private async hiddenFileExists(candidate: string): Promise<boolean> {
    const cached = this.fileExistenceCache.get(candidate);
    if (cached !== undefined) return cached;
    try {
      const exists = (await stat(path.resolve(this.root, candidate))).isFile();
      this.fileExistenceCache.set(candidate, exists);
      return exists;
    } catch {
      this.fileExistenceCache.set(candidate, false);
      return false;
    }
  }

  private async hiddenPrecedenceCandidate(candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
      if (!this.available.has(candidate) && await this.hiddenFileExists(candidate)) return candidate;
    }
    return null;
  }

  private async nearestMetadataPath(importer: string, filename: "tsconfig.json" | "package.json"): Promise<string | null> {
    const candidates = filename === "tsconfig.json" ? this.configPaths : this.packagePaths;
    const cache = filename === "tsconfig.json" ? this.configOwnerCache : this.packageOwnerCache;
    const importerDirectory = path.posix.dirname(importer);
    if (cache.has(importerDirectory)) return cache.get(importerDirectory) ?? null;
    let directory = importerDirectory;
    for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH; depth += 1) {
      const candidate = directory === "." ? filename : `${directory}/${filename}`;
      if (candidates.has(candidate)) {
        cache.set(importerDirectory, candidate);
        return candidate;
      }
      if (await this.hiddenFileExists(candidate)) {
        this.note(`${importer}: nearer ${filename} at ${candidate} exists outside the bounded Git inventory; metadata ownership was left unresolved.`, `${filename}:hidden-owner:${candidate}`);
        cache.set(importerDirectory, null);
        return null;
      }
      if (directory === ".") {
        cache.set(importerDirectory, null);
        return null;
      }
      directory = path.posix.dirname(directory);
    }
    this.note(`${importer}: metadata ancestor traversal stopped at ${MAX_ANCESTOR_DEPTH} directories.`);
    cache.set(importerDirectory, null);
    return null;
  }

  private async applicableConfig(importer: string): Promise<CompilerConfig | null> {
    const configPath = await this.nearestMetadataPath(importer, "tsconfig.json");
    if (!configPath) return null;
    const config = await this.loadConfig(configPath, []);
    if (config && !this.configIncludesImporter(config, importer)) {
      this.note(`${importer}: nearest compiler configuration ${configPath} does not include the importer; ancestor project selection is outside the supported subset.`, `${configPath}:importer-not-in-project:${importer}`);
      return null;
    }
    return config;
  }

  private async loadConfig(configPath: string, stack: string[]): Promise<CompilerConfig | null> {
    if (this.configCache.has(configPath)) return this.configCache.get(configPath) ?? null;
    if (stack.includes(configPath)) {
      this.note(`${configPath}: compiler configuration extends cycle was rejected.`);
      this.configCache.set(configPath, null);
      return null;
    }
    if (stack.length >= MAX_CONFIG_EXTENDS_DEPTH) {
      this.note(`${configPath}: compiler configuration inheritance exceeded depth ${MAX_CONFIG_EXTENDS_DEPTH}.`);
      this.configCache.set(configPath, null);
      return null;
    }
    if (this.loadedConfigs >= MAX_CONFIG_FILES) {
      this.note(`${configPath}: compiler configuration loading stopped at ${MAX_CONFIG_FILES} files.`);
      this.configCache.set(configPath, null);
      return null;
    }
    this.loadedConfigs += 1;
    const source = await this.readMetadata(configPath, "compiler configuration");
    if (source === null) {
      this.note(`${configPath}: compiler configuration was unreadable, binary, or larger than ${MAX_METADATA_BYTES} bytes.`);
      this.configCache.set(configPath, null);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = parseJsonc(source);
    } catch (error) {
      this.note(`${configPath}: malformed compiler configuration was rejected (${error instanceof Error ? error.message : String(error)}).`);
      this.configCache.set(configPath, null);
      return null;
    }
    if (!isRecord(parsed)) {
      this.note(`${configPath}: compiler configuration root must be an object.`);
      this.configCache.set(configPath, null);
      return null;
    }

    let parent: CompilerConfig | null = null;
    if (Object.hasOwn(parsed, "extends")) {
      if (typeof parsed.extends !== "string") {
        this.note(`${configPath}: only a single repository-relative string extends value is supported.`);
        this.configCache.set(configPath, null);
        return null;
      }
      const parentPath = this.resolveExtends(configPath, parsed.extends);
      if (parentPath === null) {
        this.note(`${configPath}: extends target ${JSON.stringify(parsed.extends)} is unsupported, missing, or outside the repository.`);
        this.configCache.set(configPath, null);
        return null;
      }
      parent = await this.loadConfig(parentPath, [...stack, configPath]);
      if (parent === null) {
        this.configCache.set(configPath, null);
        return null;
      }
    }

    const compilerOptions = parsed.compilerOptions;
    if (compilerOptions !== undefined && !isRecord(compilerOptions)) {
      this.note(`${configPath}: compilerOptions must be an object.`);
      this.configCache.set(configPath, null);
      return null;
    }
    const options = compilerOptions as Record<string, unknown> | undefined;
    const config: CompilerConfig = {
      configPath,
      ...(parent?.paths === undefined ? {} : { paths: parent.paths }),
      ...(parent?.baseUrl === undefined ? {} : { baseUrl: parent.baseUrl }),
      ...(parent?.customConditions === undefined ? {} : { customConditions: [...parent.customConditions] }),
      ...(parent?.moduleResolution === undefined ? {} : { moduleResolution: parent.moduleResolution }),
      ...(parent?.resolvePackageJsonExports === undefined ? {} : { resolvePackageJsonExports: parent.resolvePackageJsonExports }),
    };

    if (Object.hasOwn(parsed, "files")) {
      if (!Array.isArray(parsed.files) || parsed.files.length > MAX_PROJECT_PATTERNS || !parsed.files.every((file) => typeof file === "string" && file.length > 0 && !/[?*\[\]{}]/.test(file))) {
        return this.rejectConfig(configPath, `files must contain at most ${MAX_PROJECT_PATTERNS} explicit relative paths`);
      }
      const projectFiles = new Set<string>();
      for (const file of parsed.files as string[]) {
        const resolved = joinRepositoryPath(path.posix.dirname(configPath), file);
        if (resolved === null) return this.rejectConfig(configPath, `files entry ${JSON.stringify(file)} must remain inside the repository`);
        projectFiles.add(resolved);
      }
      config.projectFiles = projectFiles;
    }
    for (const field of ["include", "exclude"] as const) {
      if (!Object.hasOwn(parsed, field)) continue;
      const values = parsed[field];
      if (!Array.isArray(values) || values.length > MAX_PROJECT_PATTERNS || !values.every((value) => typeof value === "string" && value.length > 0)) {
        return this.rejectConfig(configPath, `${field} must contain at most ${MAX_PROJECT_PATTERNS} non-empty patterns`);
      }
      const patterns: ProjectPattern[] = [];
      for (const value of values as string[]) {
        const pattern = projectPattern(configPath, value);
        if (pattern === null) return this.rejectConfig(configPath, `unsupported ${field} pattern ${JSON.stringify(value)}`);
        patterns.push(pattern);
      }
      if (field === "include") config.projectIncludes = patterns;
      else config.projectExcludes = patterns;
    }

    if (options && Object.hasOwn(options, "baseUrl")) {
      if (typeof options.baseUrl !== "string") return this.rejectConfig(configPath, "baseUrl must be a string");
      if (options.baseUrl.includes("${")) return this.rejectConfig(configPath, "baseUrl template variables are unsupported");
      const resolved = joinRepositoryPath(path.posix.dirname(configPath), options.baseUrl);
      if (resolved === null) return this.rejectConfig(configPath, "baseUrl must remain inside the repository");
      config.baseUrl = { path: resolved === "." ? "" : resolved, origin: configPath };
    }
    if (options && Object.hasOwn(options, "paths")) {
      const paths = this.parsePaths(configPath, options.paths);
      if (paths === null) {
        this.configCache.set(configPath, null);
        return null;
      }
      config.paths = paths;
    }
    if (options && Object.hasOwn(options, "customConditions")) {
      if (!Array.isArray(options.customConditions) || options.customConditions.length > MAX_CUSTOM_CONDITIONS || !options.customConditions.every((condition) => typeof condition === "string" && condition.length > 0)) {
        return this.rejectConfig(configPath, `customConditions must contain at most ${MAX_CUSTOM_CONDITIONS} non-empty strings`);
      }
      config.customConditions = unique(options.customConditions as string[]);
    }
    if (options && Object.hasOwn(options, "moduleResolution")) {
      if (typeof options.moduleResolution !== "string") return this.rejectConfig(configPath, "moduleResolution must be a string");
      config.moduleResolution = options.moduleResolution.toLowerCase();
    }
    if (options && Object.hasOwn(options, "moduleSuffixes")) {
      if (!Array.isArray(options.moduleSuffixes) || !options.moduleSuffixes.every((suffix) => typeof suffix === "string")) {
        return this.rejectConfig(configPath, "moduleSuffixes must be a string array");
      }
      if (options.moduleSuffixes.length !== 1 || options.moduleSuffixes[0] !== "") {
        return this.rejectConfig(configPath, "non-default moduleSuffixes precedence is unsupported");
      }
    }
    if (options && Object.hasOwn(options, "resolvePackageJsonExports")) {
      if (typeof options.resolvePackageJsonExports !== "boolean") return this.rejectConfig(configPath, "resolvePackageJsonExports must be boolean");
      config.resolvePackageJsonExports = options.resolvePackageJsonExports;
    }
    this.configCache.set(configPath, config);
    return config;
  }

  private rejectConfig(configPath: string, reason: string): null {
    this.note(`${configPath}: unsupported compiler configuration was rejected (${reason}).`);
    this.configCache.set(configPath, null);
    return null;
  }

  private configIncludesImporter(config: CompilerConfig, importer: string): boolean {
    if (config.projectFiles) return config.projectFiles.has(importer);
    if (config.projectIncludes && !config.projectIncludes.some((pattern) => pattern.expression.test(importer))) return false;
    if (config.projectExcludes?.some((pattern) => pattern.expression.test(importer))) return false;
    return true;
  }

  private resolveExtends(configPath: string, value: string): string | null {
    const normalized = normalizeConfiguredPath(value);
    if (!normalized.startsWith("./") && !normalized.startsWith("../")) return null;
    const joined = joinRepositoryPath(path.posix.dirname(configPath), normalized);
    if (joined === null || joined.split("/").includes("node_modules") || joined.includes("${")) return null;
    const candidates = joined.endsWith(".json") ? [joined] : [`${joined}.json`];
    return candidates.find((candidate) => this.repositoryFiles.has(candidate)) ?? null;
  }

  private parsePaths(configPath: string, value: unknown): CompilerPathMappings | null {
    if (!isRecord(value)) return this.rejectConfig(configPath, "paths must be an object");
    const rawEntries = Object.entries(value);
    if (rawEntries.length > MAX_PATH_MAPPINGS) return this.rejectConfig(configPath, `paths exceeds ${MAX_PATH_MAPPINGS} mappings`);
    const entries = new Map<string, string[]>();
    for (const [key, targets] of rawEntries) {
      const keyWildcards = key.split("*").length - 1;
      if (key.length === 0 || key.startsWith(".") || keyWildcards > 1) return this.rejectConfig(configPath, `unsupported paths key ${JSON.stringify(key)}`);
      if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_PATH_TARGETS || !targets.every((target) => typeof target === "string" && target.length > 0)) {
        return this.rejectConfig(configPath, `paths key ${JSON.stringify(key)} must contain 1-${MAX_PATH_TARGETS} string targets`);
      }
      for (const target of targets as string[]) {
        const targetWildcards = target.split("*").length - 1;
        if (target.includes("${") || targetWildcards > 1 || (targetWildcards === 1 && keyWildcards === 0)) return this.rejectConfig(configPath, `unsupported wildcard or template target for ${JSON.stringify(key)}`);
      }
      entries.set(key, [...targets] as string[]);
    }
    return { entries, origin: configPath };
  }

  private matchCompilerPath(paths: CompilerPathMappings, specifier: string): PathMatch | "ambiguous" | null {
    const exact = paths.entries.get(specifier);
    if (exact) return { key: specifier, capture: null, targets: exact };
    const matches: Array<PathMatch & { prefixLength: number }> = [];
    for (const [key, targets] of paths.entries) {
      const wildcard = key.indexOf("*");
      if (wildcard === -1) continue;
      const prefix = key.slice(0, wildcard);
      const suffix = key.slice(wildcard + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
      matches.push({ key, capture: specifier.slice(prefix.length, specifier.length - suffix.length), targets, prefixLength: prefix.length });
    }
    if (matches.length === 0) return null;
    matches.sort((left, right) => right.prefixLength - left.prefixLength || left.key.localeCompare(right.key));
    if (matches[1]?.prefixLength === matches[0]?.prefixLength) return "ambiguous";
    return matches[0]!;
  }

  private async resolveCompilerPath(importer: string, specifier: string): Promise<PathResolutionAttempt> {
    const config = await this.applicableConfig(importer);
    if (!config?.paths) {
      return config?.baseUrl
        ? { kind: "blocked", reason: "standalone baseUrl precedence is outside the supported subset", diagnosticKey: `${config.configPath}:baseUrl-precedence` }
        : { kind: "not-applicable" };
    }
    const paths = config.paths;
    const match = this.matchCompilerPath(paths, specifier);
    if (match === null) {
      return config.baseUrl
        ? { kind: "blocked", reason: "standalone baseUrl precedence is outside the supported subset", diagnosticKey: `${config.configPath}:baseUrl-precedence` }
        : { kind: "not-applicable" };
    }
    if (match === "ambiguous") return { kind: "blocked", reason: "multiple equally specific wildcard mappings matched" };
    const base = config.baseUrl?.path ?? path.posix.dirname(paths.origin);
    let candidateCount = 0;
    const priorCandidates: string[] = [];
    let unsupportedOmittedExtension: string | null = null;

    const attemptCandidates = async (candidates: string[]): Promise<
      | { kind: "resolved"; target: string }
      | { kind: "missing" }
      | { kind: "blocked"; reason: string }
    > => {
      candidateCount += candidates.length;
      if (candidateCount > MAX_CANDIDATES_PER_IMPORT) return { kind: "blocked", reason: `candidate expansion exceeded ${MAX_CANDIDATES_PER_IMPORT}` };
      const targetIndex = candidates.findIndex((candidate) => this.available.has(candidate));
      if (targetIndex === -1) {
        priorCandidates.push(...candidates);
        return { kind: "missing" };
      }
      const target = candidates[targetIndex]!;
      const hidden = await this.hiddenPrecedenceCandidate([...priorCandidates, ...candidates.slice(0, targetIndex)]);
      if (hidden) return { kind: "blocked", reason: `higher-precedence candidate ${hidden} exists outside the bounded Git inventory` };
      if (!(await this.targetIsInside(target))) return { kind: "blocked", reason: `mapped target ${target} resolves outside the repository through a symlink` };
      return { kind: "resolved", target };
    };

    const resolvedAttempt = (target: string, lookup: string): PathResolutionAttempt => ({
      kind: "resolved",
      resolution: {
        target,
        evidence: {
          importer,
          specifier,
          mechanism: "typescript-paths",
          metadataPath: paths.origin,
          matchedKey: match.key,
          target,
          confidence: "high",
          detail: `${config.configPath}${config.configPath === paths.origin ? "" : ` inherits ${paths.origin}, which`} maps ${JSON.stringify(match.key)} to the repository-local target ${target}${config.baseUrl ? ` using baseUrl from ${config.baseUrl.origin}` : ""} through ${lookup}.`,
          limitation: "Static compiler-configuration evidence only; it does not establish runtime resolution, runnable-test identity, or execution.",
        },
      },
    });

    for (const targetPattern of match.targets) {
      const normalizedPattern = normalizeConfiguredPath(targetPattern);
      if (!config.baseUrl && !normalizedPattern.startsWith("./") && !normalizedPattern.startsWith("../")) {
        return { kind: "blocked", reason: `paths target ${JSON.stringify(targetPattern)} must begin with ./ or ../ when baseUrl is not set` };
      }
      const substituted = match.capture === null ? targetPattern : targetPattern.replace("*", match.capture);
      const mapped = joinRepositoryPath(base === "." ? "" : base, substituted);
      if (mapped === null) return { kind: "blocked", reason: `mapped target ${JSON.stringify(substituted)} escapes the repository` };
      if (mapped.split("/").includes("node_modules")) return { kind: "blocked", reason: "mapped target enters node_modules, which is outside the supported repository-local subset" };

      if (path.posix.extname(mapped) !== "") {
        const candidates = explicitConfiguredModuleCandidates(mapped);
        if (candidates === null) return { kind: "blocked", reason: `mapped target ${mapped} has an unsupported explicit extension` };
        const attempt = await attemptCandidates(candidates);
        if (attempt.kind === "blocked") return attempt;
        if (attempt.kind === "resolved") return resolvedAttempt(attempt.target, "documented explicit-extension substitution");
        continue;
      }

      if (!config.moduleResolution || !EXTENSIONLESS_PATH_MODULE_RESOLUTIONS.has(config.moduleResolution)) {
        const configuredMode = config.moduleResolution ? JSON.stringify(config.moduleResolution) : "no explicit moduleResolution";
        return { kind: "blocked", reason: `extensionless paths target ${mapped} is unresolved under ${configuredMode}; only explicit Bundler or Node10 extensionless lookup is supported` };
      }
      if (await this.hiddenFileExists(mapped)) {
        return { kind: "blocked", reason: `exact extensionless target ${mapped} exists, but extensionless physical-file loading is outside the supported source subset` };
      }

      const candidates = extensionlessConfiguredModuleCandidates(mapped);
      const fileAttempt = await attemptCandidates(candidates.files);
      if (fileAttempt.kind === "blocked") return fileAttempt;
      if (fileAttempt.kind === "resolved") return resolvedAttempt(fileAttempt.target, `${config.moduleResolution} extensionless file lookup`);

      for (const extension of OMITTED_EXPLICIT_EXTENSIONS) {
        const unsupported = `${mapped}${extension}`;
        if (await this.hiddenFileExists(unsupported)) {
          unsupportedOmittedExtension ??= unsupported;
          break;
        }
      }
      if (await this.hiddenFileExists(`${mapped}/package.json`)) {
        return { kind: "blocked", reason: `directory package metadata at ${mapped}/package.json has higher precedence than index lookup and is outside the supported subset` };
      }

      const indexAttempt = await attemptCandidates(candidates.indexes);
      if (indexAttempt.kind === "blocked") return indexAttempt;
      if (indexAttempt.kind === "resolved") return resolvedAttempt(indexAttempt.target, `${config.moduleResolution} directory index lookup`);
      for (const extension of OMITTED_EXPLICIT_EXTENSIONS) {
        const unsupported = `${mapped}/index${extension}`;
        if (await this.hiddenFileExists(unsupported)) {
          unsupportedOmittedExtension ??= unsupported;
          break;
        }
      }
    }
    if (unsupportedOmittedExtension) {
      return { kind: "blocked", reason: `matched paths targets did not resolve because TypeScript does not infer the omitted extension for ${unsupportedOmittedExtension}` };
    }
    return config.baseUrl
      ? { kind: "blocked", reason: "the matched paths targets were missing and standalone baseUrl fallback is outside the supported subset", diagnosticKey: `${config.configPath}:baseUrl-fallback:${match.key}` }
      : { kind: "not-found" };
  }

  private async loadPackage(packagePath: string): Promise<PackageMetadata | null> {
    if (this.packageCache.has(packagePath)) return this.packageCache.get(packagePath) ?? null;
    if (this.loadedPackages >= MAX_PACKAGE_FILES) {
      this.note(`${packagePath}: package metadata loading stopped at ${MAX_PACKAGE_FILES} files.`);
      this.packageCache.set(packagePath, null);
      return null;
    }
    this.loadedPackages += 1;
    const source = await this.readMetadata(packagePath, "package metadata");
    if (source === null) {
      this.note(`${packagePath}: package metadata was unreadable, binary, or larger than ${MAX_METADATA_BYTES} bytes.`);
      this.packageCache.set(packagePath, null);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (error) {
      this.note(`${packagePath}: malformed package metadata was rejected (${error instanceof Error ? error.message : String(error)}).`);
      this.packageCache.set(packagePath, null);
      return null;
    }
    if (!isRecord(parsed)) {
      this.note(`${packagePath}: package metadata root must be an object.`);
      this.packageCache.set(packagePath, null);
      return null;
    }
    const name = typeof parsed.name === "string" && validPackageName(parsed.name) ? parsed.name : undefined;
    const metadata: PackageMetadata = {
      packagePath,
      directory: path.posix.dirname(packagePath) === "." ? "" : path.posix.dirname(packagePath),
      ...(name === undefined ? {} : { name }),
      ...(Object.hasOwn(parsed, "exports") ? { exports: parsed.exports } : {}),
    };
    this.packageCache.set(packagePath, metadata);
    return metadata;
  }

  private exportEntry(exportsValue: unknown, exportKey: string): { value: unknown; matchedKey: string } | "unsupported" | null {
    if (!isRecord(exportsValue)) return exportKey === "." ? { value: exportsValue, matchedKey: "." } : null;
    const keys = Object.keys(exportsValue);
    const subpathKeys = keys.filter((key) => key.startsWith("."));
    if (subpathKeys.length === 0) return exportKey === "." ? { value: exportsValue, matchedKey: "." } : null;
    if (subpathKeys.length !== keys.length) return "unsupported";
    if (Object.hasOwn(exportsValue, exportKey)) return { value: exportsValue[exportKey], matchedKey: exportKey };
    if (subpathKeys.some((key) => key.includes("*"))) return "unsupported";
    return null;
  }

  private selectConditionTarget(value: unknown, activeConditions: Set<string>, state: ConditionState, depth = 0): ConditionSelection | "unsupported" | null {
    if (typeof value === "string") return { target: value, conditions: [] };
    if (!isRecord(value) || depth >= MAX_EXPORT_CONDITION_DEPTH) return "unsupported";
    const keys = Object.keys(value);
    if (keys.some((key) => key.startsWith("."))) return "unsupported";
    for (const condition of keys) {
      state.branches += 1;
      if (state.branches > MAX_EXPORT_BRANCHES) return "unsupported";
      if (condition === "default" || activeConditions.has(condition)) {
        const selected = this.selectConditionTarget(value[condition], activeConditions, state, depth + 1);
        if (selected === "unsupported" || selected === null) return selected;
        return { target: selected.target, conditions: [condition, ...selected.conditions] };
      }
      if (POTENTIALLY_ACTIVE_BUILTIN_CONDITIONS.has(condition) || condition.startsWith("types@")) return "unsupported";
    }
    return null;
  }

  private async resolvePackageSelfReference(importer: string, specifier: string): Promise<StaticModuleResolution | null> {
    const packagePath = await this.nearestMetadataPath(importer, "package.json");
    if (!packagePath) return null;
    const metadata = await this.loadPackage(packagePath);
    if (!metadata?.name || metadata.exports === undefined) return null;
    if (specifier !== metadata.name && !specifier.startsWith(`${metadata.name}/`)) return null;
    const subpath = specifier === metadata.name ? "." : `./${specifier.slice(metadata.name.length + 1)}`;
    const entry = this.exportEntry(metadata.exports, subpath);
    if (entry === null) return null;
    if (entry === "unsupported") {
      this.note(`${importer}: package self-reference ${JSON.stringify(specifier)} uses an unsupported or ambiguous exports shape in ${packagePath}.`, `${packagePath}:exports-shape:${subpath}`);
      return null;
    }

    const configPath = await this.nearestMetadataPath(importer, "tsconfig.json");
    const config = configPath ? await this.loadConfig(configPath, []) : null;
    if (configPath && config === null) return null;
    if (config && !this.configIncludesImporter(config, importer)) {
      this.note(`${importer}: nearest compiler configuration ${configPath} does not include the importer; package self-reference resolution was left unresolved.`, `${configPath}:importer-not-in-project:${importer}`);
      return null;
    }
    if (!config?.moduleResolution) {
      this.note(`${importer}: package self-reference ${JSON.stringify(specifier)} was left unresolved because no explicit export-aware moduleResolution is available.`, `${configPath ?? packagePath}:missing-export-module-resolution`);
      return null;
    }
    if (config.resolvePackageJsonExports === false) {
      this.note(`${importer}: package self-reference ${JSON.stringify(specifier)} was left unresolved because ${config.configPath} disables package.json exports.`, `${config.configPath}:exports-disabled`);
      return null;
    }
    if (!PACKAGE_EXPORT_MODULE_RESOLUTIONS.has(config.moduleResolution)) {
      this.note(`${importer}: package self-reference ${JSON.stringify(specifier)} was left unresolved under unsupported moduleResolution ${JSON.stringify(config.moduleResolution)}.`, `${config.configPath}:unsupported-module-resolution`);
      return null;
    }
    const activeConditions = new Set(config.customConditions ?? []);
    const selected = this.selectConditionTarget(entry.value, activeConditions, { branches: 0 });
    if (selected === null) return null;
    if (selected === "unsupported") {
      this.note(`${importer}: package self-reference ${JSON.stringify(specifier)} has no safely selectable supported export branch in ${packagePath}.`, `${packagePath}:unsupported-export-conditions:${subpath}`);
      return null;
    }
    if (!selected.target.startsWith("./") || selected.target.includes("\\")) {
      this.note(`${packagePath}: package self-export target ${JSON.stringify(selected.target)} is not a supported relative package target.`);
      return null;
    }
    const rawSegments = selected.target.slice(2).split("/");
    if (rawSegments.some((segment) => segment === "" || segment === "." || segment === ".." || segment === "node_modules")) {
      this.note(`${packagePath}: package self-export target ${JSON.stringify(selected.target)} crosses an unsupported package segment.`);
      return null;
    }
    const mapped = joinRepositoryPath(metadata.directory, selected.target);
    if (mapped === null || !isWithin(metadata.directory, mapped)) {
      this.note(`${packagePath}: package self-export target ${JSON.stringify(selected.target)} escapes its owning package.`);
      return null;
    }
    const candidates = explicitConfiguredModuleCandidates(mapped);
    if (candidates === null) {
      this.note(`${packagePath}: package self-export target ${JSON.stringify(selected.target)} does not name an explicit supported extension.`);
      return null;
    }
    if (candidates.length > MAX_CANDIDATES_PER_IMPORT) {
      this.note(`${packagePath}: package self-export candidate expansion exceeded ${MAX_CANDIDATES_PER_IMPORT}.`);
      return null;
    }
    const targetIndex = candidates.findIndex((candidate) => this.available.has(candidate));
    if (targetIndex === -1) return null;
    const target = candidates[targetIndex]!;
    const hidden = await this.hiddenPrecedenceCandidate(candidates.slice(0, targetIndex));
    if (hidden) {
      this.note(`${packagePath}: higher-precedence package self-export candidate ${hidden} exists outside the bounded Git inventory.`);
      return null;
    }
    const targetOwner = await this.nearestMetadataPath(target, "package.json");
    if (targetOwner !== packagePath) {
      this.note(`${packagePath}: package self-export target ${target} crosses the nested package boundary at ${targetOwner ?? "repository root"}.`);
      return null;
    }
    if (!(await this.targetIsInside(target, metadata.directory))) {
      this.note(`${packagePath}: package self-export target ${target} resolves outside its owning package through a symlink.`);
      return null;
    }
    const conditionDetail = selected.conditions.length > 0 ? ` through conditions ${selected.conditions.join(" → ")}${config ? ` selected from ${config.configPath}` : ""}` : "";
    return {
      target,
      evidence: {
        importer,
        specifier,
        mechanism: "package-self-export",
        metadataPath: packagePath,
        matchedKey: entry.matchedKey,
        target,
        confidence: "high",
        detail: `${packagePath} names the importing package ${JSON.stringify(metadata.name)} and maps ${entry.matchedKey}${conditionDetail} to ${target}.`,
        limitation: "Static package-self-reference evidence only; it does not establish runtime resolution, runnable-test identity, or execution.",
      },
    };
  }
}
