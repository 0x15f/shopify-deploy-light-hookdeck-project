"use strict";

const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const test = require("node:test");
const { createApp } = require("../src/app");
const { signHookdeckPayload } = require("../src/signature");

const silentLogger = {
  log() {},
  warn() {},
  error() {},
};

class FakeSerialManager extends EventEmitter {
  constructor({ connected = false, acceptWrites = true } = {}) {
    super();
    this.acceptWrites = acceptWrites;
    this.commands = [];
    this.status = {
      connected,
      path: connected ? "/dev/cu.usbmodem-test" : null,
      baudRate: 115200,
      queuedCommands: 0,
      reconnectAttempt: connected ? 0 : 2,
    };
  }

  send(command) {
    if (!this.acceptWrites) {
      return false;
    }

    this.commands.push(command);
    this.status.queuedCommands += 1;
    return true;
  }

  getStatus() {
    return { ...this.status };
  }
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("signed Hookdeck events are translated and queued while disconnected", async () => {
  const secret = "test-secret";
  const rawBody = Buffer.from(JSON.stringify({ state: "building" }));
  const serialManager = new FakeSerialManager();
  const app = createApp({
    serialManager,
    hookdeckSecret: secret,
    logger: silentLogger,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hookdeck-signature": signHookdeckPayload(rawBody, secret),
      },
      body: rawBody,
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK");
    assert.deepEqual(serialManager.commands, ["BUILDING"]);
  });
});

test("invalid Hookdeck signatures are rejected before parsing the event", async () => {
  const serialManager = new FakeSerialManager();
  const app = createApp({
    serialManager,
    hookdeckSecret: "test-secret",
    logger: silentLogger,
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hookdeck-signature": "not-the-signature",
      },
      body: JSON.stringify({ state: "success" }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(serialManager.commands, []);
  });
});

test("signature verification is optional when no secret is configured", async () => {
  const serialManager = new FakeSerialManager({ connected: true });
  const app = createApp({ serialManager, logger: silentLogger });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "OFF" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(serialManager.commands, ["OFF"]);
  });
});

test("malformed JSON and unknown states return client errors", async () => {
  const serialManager = new FakeSerialManager();
  const app = createApp({ serialManager, logger: silentLogger });

  await withServer(app, async (baseUrl) => {
    const malformedResponse = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformedResponse.status, 400);

    const unknownResponse = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "rainbow" }),
    });
    assert.equal(unknownResponse.status, 400);
    assert.deepEqual(serialManager.commands, []);
  });
});

test("a full serial queue returns 503 instead of acknowledging a dropped event", async () => {
  const serialManager = new FakeSerialManager({ acceptWrites: false });
  const app = createApp({ serialManager, logger: silentLogger });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/hookdeck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "failure" }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(serialManager.commands, []);
  });
});

test("dashboard controls and status expose queued and sent commands", async () => {
  const serialManager = new FakeSerialManager({ connected: true });
  const app = createApp({ serialManager, logger: silentLogger });

  await withServer(app, async (baseUrl) => {
    const commandResponse = await fetch(`${baseUrl}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "success" }),
    });
    assert.equal(commandResponse.status, 202);
    assert.deepEqual(await commandResponse.json(), {
      queued: true,
      command: "SUCCESS",
    });

    serialManager.emit("sent", "SUCCESS");
    serialManager.emit("response", "OK");

    const statusResponse = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusResponse.status, 200);
    assert.match(statusResponse.headers.get("cache-control"), /no-store/);
    assert.equal(statusResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(statusResponse.headers.get("x-frame-options"), "DENY");
    assert.equal(statusResponse.headers.get("x-powered-by"), null);

    const status = await statusResponse.json();
    assert.equal(status.serial.connected, true);
    assert.equal(status.lastDeploymentState, "success");
    assert.equal(status.lastCommandQueued, "SUCCESS");
    assert.equal(status.lastCommandSent, "SUCCESS");
    assert.equal(status.firmwareResponse, "OK");
  });
});
