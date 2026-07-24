"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

function signHookdeckPayload(rawBody, secret) {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function verifyHookdeckSignature(rawBody, signature, secret) {
  if (
    !Buffer.isBuffer(rawBody) ||
    typeof signature !== "string" ||
    typeof secret !== "string" ||
    secret.length === 0
  ) {
    return false;
  }

  const expected = Buffer.from(signHookdeckPayload(rawBody, secret), "utf8");
  const received = Buffer.from(signature, "utf8");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

module.exports = {
  signHookdeckPayload,
  verifyHookdeckSignature,
};

