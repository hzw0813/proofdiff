import assert from "node:assert/strict";
import test from "node:test";
import { totalFor } from "../src/checkout.js";

test("gold customers receive the documented discount", () => {
  assert.equal(totalFor({ subtotal: 100, tier: "gold" }), 80);
});

test("unknown tiers pay the full subtotal", () => {
  assert.equal(totalFor({ subtotal: 100, tier: "guest" }), 100);
});
