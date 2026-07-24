"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  signHookdeckPayload,
  verifyHookdeckSignature,
} = require("../src/signature");

test("Hookdeck HMAC-SHA256 base64 signatures verify against raw bytes", () => {
  const body = Buffer.from('{"state":"building"}');
  const signature = signHookdeckPayload(body, "secret");

  assert.equal(verifyHookdeckSignature(body, signature, "secret"), true);
  assert.equal(
    verifyHookdeckSignature(body, signature, "different-secret"),
    false,
  );
  assert.equal(
    verifyHookdeckSignature(Buffer.from('{"state": "building"}'), signature, "secret"),
    false,
  );
});

test("missing or malformed signature inputs are rejected", () => {
  const body = Buffer.from("{}");

  assert.equal(verifyHookdeckSignature(body, undefined, "secret"), false);
  assert.equal(verifyHookdeckSignature(body, "short", "secret"), false);
  assert.equal(verifyHookdeckSignature("{}", "signature", "secret"), false);
});

