"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig, normalizeUsbId } = require("../src/config");

test("configuration uses production-safe defaults", () => {
  const config = loadConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.serialPort, null);
  assert.equal(config.serialBaud, 115200);
  assert.equal(config.hookdeckSecret, null);
  assert.equal(config.reconnectMinimumMs, 1000);
  assert.equal(config.reconnectMaximumMs, 30000);
});

test("configuration parses explicit values and USB identifiers", () => {
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "8080",
    SERIAL_PORT: " /dev/cu.usbmodem2101 ",
    SERIAL_BAUD: "230400",
    SERIAL_VID: "0x303A",
    SERIAL_PID: "1001",
    HOOKDECK_SECRET: " secret ",
  });

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
  assert.equal(config.serialPort, "/dev/cu.usbmodem2101");
  assert.equal(config.serialBaud, 230400);
  assert.equal(config.serialVid, "303a");
  assert.equal(config.serialPid, "1001");
  assert.equal(config.hookdeckSecret, "secret");
});

test("invalid integer and USB settings fail fast", () => {
  assert.throws(() => loadConfig({ PORT: "zero" }), /PORT must be an integer/);
  assert.throws(
    () =>
      loadConfig({
        SERIAL_RECONNECT_MIN_MS: "2000",
        SERIAL_RECONNECT_MAX_MS: "1000",
      }),
    /cannot exceed/,
  );
  assert.throws(() => normalizeUsbId("303"), /four hex digits/);
  assert.throws(() => normalizeUsbId("zzzz"), /four hex digits/);
});
