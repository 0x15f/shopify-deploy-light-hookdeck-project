"use strict";

function parseInteger(env, name, fallback, minimum, maximum) {
  const rawValue = env[name];

  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return value;
}

function optionalString(value) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeUsbId(value) {
  const normalized = optionalString(value)?.replace(/^0x/i, "").toLowerCase();

  if (normalized && !/^[0-9a-f]{4}$/.test(normalized)) {
    throw new Error("USB VID/PID values must contain exactly four hex digits");
  }

  return normalized || null;
}

function loadConfig(env = process.env) {
  const config = {
    host: optionalString(env.HOST) || "127.0.0.1",
    port: parseInteger(env, "PORT", 3000, 1, 65535),
    serialPort: optionalString(env.SERIAL_PORT),
    serialBaud: parseInteger(env, "SERIAL_BAUD", 115200, 300, 4_000_000),
    serialVid: normalizeUsbId(env.SERIAL_VID),
    serialPid: normalizeUsbId(env.SERIAL_PID),
    hookdeckSecret: optionalString(env.HOOKDECK_SECRET),
    reconnectMinimumMs: parseInteger(
      env,
      "SERIAL_RECONNECT_MIN_MS",
      1_000,
      100,
      60_000,
    ),
    reconnectMaximumMs: parseInteger(
      env,
      "SERIAL_RECONNECT_MAX_MS",
      30_000,
      100,
      300_000,
    ),
    serialQueueLimit: parseInteger(
      env,
      "SERIAL_QUEUE_LIMIT",
      256,
      1,
      10_000,
    ),
  };

  if (config.reconnectMinimumMs > config.reconnectMaximumMs) {
    throw new Error(
      "SERIAL_RECONNECT_MIN_MS cannot exceed SERIAL_RECONNECT_MAX_MS",
    );
  }

  return config;
}

module.exports = {
  loadConfig,
  normalizeUsbId,
};
