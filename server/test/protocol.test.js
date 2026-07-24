"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { commandForState, normalizeCommand } = require("../src/protocol");

test("deployment states map to firmware commands", () => {
  assert.equal(commandForState("building"), "BUILDING");
  assert.equal(commandForState(" SUCCESS "), "SUCCESS");
  assert.equal(commandForState("Failure"), "FAILURE");
  assert.equal(commandForState("off"), "OFF");
});

test("unknown or non-string states are rejected", () => {
  assert.equal(commandForState("pulse"), null);
  assert.equal(commandForState(undefined), null);
  assert.equal(commandForState(42), null);
});

test("future argument-bearing commands pass serial framing validation", () => {
  assert.equal(normalizeCommand("BRIGHTNESS 180"), "BRIGHTNESS 180");
  assert.equal(normalizeCommand("FLASH 50 10"), "FLASH 50 10");
  assert.throws(() => normalizeCommand("OFF\nFAILURE"), /delimiter/);
  assert.throws(() => normalizeCommand(""), /empty/);
});

