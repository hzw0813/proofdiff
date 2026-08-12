import assert from "node:assert/strict";
import test from "node:test";
import { taxFor } from "../src/tax.js";

test("applies the configured twenty-percent tax", () => {
  assert.equal(taxFor(100), 20);
});
