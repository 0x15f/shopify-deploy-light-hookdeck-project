"use strict";

const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const { createApp } = require("./app");
const { loadConfig } = require("./config");
const { SerialManager } = require("./serial-manager");

let config;

try {
  config = loadConfig();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exitCode = 1;
  return;
}

const serialManager = new SerialManager({
  requestedPath: config.serialPort,
  baudRate: config.serialBaud,
  vendorId: config.serialVid,
  productId: config.serialPid,
  reconnectMinimumMs: config.reconnectMinimumMs,
  reconnectMaximumMs: config.reconnectMaximumMs,
  queueLimit: config.serialQueueLimit,
});

const app = createApp({
  serialManager,
  hookdeckSecret: config.hookdeckSecret,
});

if (!config.hookdeckSecret) {
  console.warn(
    "HOOKDECK_SECRET is not set; webhook signature verification is disabled",
  );
}

serialManager.start();

const httpServer = app.listen(config.port, config.host, () => {
  console.log(`Listening on http://${config.host}:${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);

  const forceExitTimer = setTimeout(() => {
    console.error("Shutdown timed out");
    process.exit(1);
  }, 5_000);
  forceExitTimer.unref();

  await new Promise((resolve) => httpServer.close(resolve));
  await serialManager.stop();
  clearTimeout(forceExitTimer);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      console.error(`Shutdown failed: ${error.message}`);
      process.exitCode = 1;
    });
  });
}
