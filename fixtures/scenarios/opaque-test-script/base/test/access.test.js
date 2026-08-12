import assert from "node:assert/strict";
import test from "node:test";
import { canDelete } from "../src/access.js";

test("editors cannot delete records", () => {
  assert.equal(canDelete("editor"), false);
});
