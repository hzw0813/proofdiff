#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(projectRoot, relative), "utf8"));
function candidateOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument !== "--candidate-external" && argument !== "--candidate-controlled") throw new Error(`Unknown argument: ${argument}`);
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument === "--candidate-external" ? "external" : "controlled"] = value;
    index += 1;
  }
  if ((options.external === undefined) !== (options.controlled === undefined)) throw new Error("Candidate validation requires both --candidate-external and --candidate-controlled");
  return options;
}
const candidates = candidateOptions(process.argv.slice(2));
const [manifest, resultsSchema, controlledSchema, results, controlled] = await Promise.all([
  readJson("evaluation/corpus.json"),
  readJson("evaluation/results.schema.json"),
  readJson("evaluation/controlled-results.schema.json"),
  readJson("evaluation/results.json"),
  readJson("evaluation/controlled-results.json"),
]);

function resolveReference(schema, reference) {
  assert.match(reference, /^#\//, `unsupported schema reference: ${reference}`);
  return reference.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => value?.[key], schema);
}

function valueHasType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validateAgainstSchema(value, rule, schema, location = "$") {
  if (rule.$ref) return validateAgainstSchema(value, resolveReference(schema, rule.$ref), schema, location);
  if (rule.oneOf) {
    const candidates = rule.oneOf.map((candidate) => validateAgainstSchema(value, candidate, schema, location));
    const matches = candidates.filter((errors) => errors.length === 0);
    return matches.length === 1 ? [] : [`${location}: expected exactly one oneOf branch to match, found ${matches.length}`];
  }

  const errors = [];
  if (rule.type && !valueHasType(value, rule.type)) {
    return [`${location}: expected ${rule.type}`];
  }
  if (Object.hasOwn(rule, "const") && !isDeepStrictEqual(value, rule.const)) errors.push(`${location}: const mismatch`);
  if (rule.enum && !rule.enum.some((candidate) => isDeepStrictEqual(value, candidate))) errors.push(`${location}: value is not in enum`);
  if (typeof value === "number") {
    if (rule.minimum !== undefined && value < rule.minimum) errors.push(`${location}: below minimum ${rule.minimum}`);
    if (rule.maximum !== undefined && value > rule.maximum) errors.push(`${location}: above maximum ${rule.maximum}`);
    if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) errors.push(`${location}: not above exclusiveMinimum ${rule.exclusiveMinimum}`);
  }
  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${location}: shorter than minLength ${rule.minLength}`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${location}: does not match ${rule.pattern}`);
    if (rule.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${location}: invalid date-time`);
  }
  if (Array.isArray(value) && rule.items) {
    value.forEach((item, index) => errors.push(...validateAgainstSchema(item, rule.items, schema, `${location}[${index}]`)));
  }
  if (valueHasType(value, "object")) {
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}: missing required property ${key}`);
    }
    const knownProperties = rule.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childLocation = `${location}.${key}`;
      if (knownProperties[key]) errors.push(...validateAgainstSchema(child, knownProperties[key], schema, childLocation));
      else if (rule.additionalProperties === false) errors.push(`${childLocation}: additional property is not allowed`);
      else if (valueHasType(rule.additionalProperties, "object")) errors.push(...validateAgainstSchema(child, rule.additionalProperties, schema, childLocation));
    }
  }
  return errors;
}

assert.equal(manifest.schemaVersion, "1.0");
for (const schema of [resultsSchema, controlledSchema]) {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.match(schema.$id, /^https:\/\/github\.com\/hzw0813\/proofdiff\//);
}
assert.equal(resultsSchema.$defs.case.properties.trust.properties.repositoryCodeExecuted.const, false);
assert.deepEqual(validateAgainstSchema(results, resultsSchema, resultsSchema), [], "evaluation/results.json must conform to results.schema.json");
assert.deepEqual(validateAgainstSchema(controlled, controlledSchema, controlledSchema), [], "evaluation/controlled-results.json must conform to controlled-results.schema.json");
assert.ok(validateAgainstSchema({ ...results, unexpected: true }, resultsSchema, resultsSchema).some((error) => error.includes("additional property")), "schema validator must reject unknown properties");
assert.ok(validateAgainstSchema({ ...controlled, generatedAt: "moving-clock" }, controlledSchema, controlledSchema).some((error) => error.includes("const mismatch")), "schema validator must enforce deterministic controlled metadata");
assert.equal(results.schemaVersion, "1.0");
assert.equal(controlled.schemaVersion, "1.0");
assert.equal(results.proofdiff.commit, manifest.proofdiffBaseline.commit);
assert.equal(results.proofdiff.version, manifest.proofdiffBaseline.version);
assert.equal(controlled.proofdiff.commit, manifest.proofdiffBaseline.commit);
assert.equal(controlled.proofdiff.version, manifest.proofdiffBaseline.version);
assert.doesNotThrow(() => new Date(results.generatedAt).toISOString());
assert.equal(controlled.generatedAt, "2000-01-01T00:00:00.000Z");

const repositoryById = new Map(manifest.repositories.map((repository) => [repository.id, repository]));
assert.equal(repositoryById.size, manifest.repositories.length, "repository ids must be unique");
const manifestCases = new Map(manifest.cases.map((item) => [item.id, item]));
assert.equal(manifestCases.size, manifest.cases.length, "case ids must be unique");
assert.deepEqual(results.cases.map((item) => item.id), manifest.cases.map((item) => item.id), "result order and coverage must match the manifest");

const partition = (whole, left, right) => {
  assert.deepEqual([...new Set([...left, ...right])].sort(), [...whole].sort());
  assert.deepEqual(left.filter((value) => right.includes(value)), []);
};

for (const result of results.cases) {
  const item = manifestCases.get(result.id);
  assert.ok(item, `unknown result case: ${result.id}`);
  const repository = repositoryById.get(item.repository);
  assert.ok(repository, `unknown repository for ${result.id}`);
  assert.equal(result.repository, repository.identity);
  assert.equal(result.commit, repository.commit);
  assert.equal(result.changeType, item.changeType);
  assert.equal(result.evaluationMode, "static-only");
  assert.equal(result.trust.repositoryCodeExecuted, false);
  assert.match(result.trust.statement, /No repository code was executed/);
  assert.equal(result.inventory.trackedFiles, repository.trackedFileCount);
  assert.equal(result.inventory.manifestTrackedFiles, repository.trackedFileCount);
  assert.ok(result.inventory.inventoryFiles <= 5_000);
  assert.equal(result.inventory.truncated, repository.trackedFileCount > 5_000);
  assert.equal(result.assessment.path, item.mutation.path);
  assert.equal(result.assessment.relatedTestShapes.filenamePattern + result.assessment.relatedTestShapes.directoryOnly, result.assessment.relatedTests.length);
  assert.equal(Object.values(result.structuralAnalysis.parserCounts).reduce((total, count) => total + count, 0), result.structuralAnalysis.analyzedFiles);
  assert.equal(Object.values(result.structuralAnalysis.confidenceCounts).reduce((total, count) => total + count, 0), result.structuralAnalysis.analyzedFiles);
  assert.equal(Object.values(result.structuralAnalysis.fallbackPathGroups).reduce((total, count) => total + count, 0), result.structuralAnalysis.parserFallbacks);
  assert.ok(result.structuralAnalysis.diagnosticSamples.length <= 12);
  assert.equal(result.relationship.groundTruthStrength, item.relationshipReview.strength);
  assert.deepEqual(result.relationship.expectedTests, [...item.relationshipReview.expectedTests].sort());
  partition(result.relationship.expectedTests, result.relationship.foundExpectedTests, result.relationship.missedExpectedTests);
  if (result.relationship.groundTruthStrength === "clear") {
    assert.equal(result.relationship.chainValidated, true);
    assert.equal(result.relationship.classification, result.relationship.missedExpectedTests.length === 0 ? "clearly-expected-found" : "clearly-expected-missed");
  } else {
    assert.equal(result.relationship.classification, "ambiguous");
  }
  assert.deepEqual(result.checks.expectedIds, [...item.expectedCheckIds].sort());
  partition(result.checks.expectedIds, result.checks.foundExpectedIds, result.checks.missedExpectedIds);
  assert.ok(result.checks.targetedDefinitions.length === 0 || result.checks.targetRunners.length > 0);
  assert.ok(result.reportNotes.every((note) => typeof note === "string" && note.length > 0));
}

const expectedControls = [
  "relative-targeted-pass",
  "typescript-alias-unresolved",
  "directory-support-file-targeted-pass",
  "opaque-passing-command",
  "targeted-verification-failure",
  "unsupported-ambiguous-file",
];
assert.deepEqual(controlled.cases.map((item) => item.id), expectedControls);
for (const item of controlled.cases) {
  assert.equal(item.verdict, "passed");
  assert.equal(typeof item.purpose, "string");
  assert.ok(item.purpose.length > 0);
  assert.equal(typeof item.observed.repositoryCodeExecuted, "boolean");
}

const serialized = JSON.stringify({ manifest, results, controlled });
for (const prefix of [os.homedir(), "/Users/", "C:\\Users\\", `${projectRoot}${path.sep}`]) {
  assert.equal(serialized.includes(prefix), false, `evaluation data contains a machine-specific path prefix: ${prefix}`);
}
assert.equal(/(?:ghp|github_pat|glpat|sk_live|sk_test|npm)_[A-Za-z0-9_-]{12,}/.test(serialized), false, "evaluation data contains a token-like secret");

const clear = results.cases.filter((item) => item.relationship.groundTruthStrength === "clear");
const found = clear.filter((item) => item.relationship.classification === "clearly-expected-found").length;
const missed = clear.length - found;
process.stdout.write(`Evaluation artifacts valid: ${results.cases.length} external cases (${found} clear found, ${missed} clear missed, ${results.cases.length - clear.length} ambiguous) and ${controlled.cases.length} controlled cases.\n`);

if (candidates.external && candidates.controlled) {
  const [candidateExternal, candidateControlled] = await Promise.all([
    JSON.parse(await readFile(path.resolve(candidates.external), "utf8")),
    JSON.parse(await readFile(path.resolve(candidates.controlled), "utf8")),
  ]);
  assert.deepEqual(validateAgainstSchema(candidateExternal, resultsSchema, resultsSchema), [], "candidate external results must conform to results.schema.json");
  assert.deepEqual(validateAgainstSchema(candidateControlled, controlledSchema, controlledSchema), [], "candidate controlled results must conform to controlled-results.schema.json");
  assert.equal(candidateExternal.proofdiff.commit, candidateControlled.proofdiff.commit);
  assert.notEqual(candidateExternal.proofdiff.commit, manifest.proofdiffBaseline.commit);
  assert.deepEqual(candidateExternal.cases.map((item) => item.id), manifest.cases.map((item) => item.id));
  assert.ok(candidateExternal.cases.every((item) => item.evaluationMode === "static-only" && item.trust.repositoryCodeExecuted === false));
  assert.ok(candidateExternal.cases.every((item) => item.assessment.status === "unknown"));
  const expectedCandidateControls = [
    "relative-targeted-pass",
    "typescript-alias-unresolved",
    "directory-support-file-targeted-pass",
    "root-test-js-qualified-pass",
    "explicit-custom-node-path",
    "opaque-passing-command",
    "targeted-verification-failure",
    "node-zero-test-target",
    "node-filtered-zero-target",
    "node-all-skipped-target",
    "unittest-positive-target",
    "unittest-zero-target",
    "mixed-batch-attribution",
    "unsupported-ambiguous-file",
  ];
  assert.deepEqual(candidateControlled.cases.map((item) => item.id), expectedCandidateControls);
  assert.ok(candidateControlled.cases.every((item) => item.verdict === "passed"));
  const candidateSerialized = JSON.stringify({ candidateExternal, candidateControlled });
  for (const prefix of [os.homedir(), "/Users/", "C:\\Users\\", `${projectRoot}${path.sep}`]) assert.equal(candidateSerialized.includes(prefix), false, `candidate evaluation contains a machine-specific path prefix: ${prefix}`);
  assert.equal(/(?:ghp|github_pat|glpat|sk_live|sk_test|npm)_[A-Za-z0-9_-]{12,}/.test(candidateSerialized), false, "candidate evaluation contains a token-like secret");
  process.stdout.write(`Candidate evaluation artifacts valid at ${candidateExternal.proofdiff.commit}: ${candidateExternal.cases.length} external and ${candidateControlled.cases.length} controlled cases.\n`);
}
