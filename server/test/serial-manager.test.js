"use strict";

const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const test = require("node:test");
const { SerialManager, selectSerialPort } = require("../src/serial-manager");

const silentLogger = {
  log() {},
  warn() {},
  error() {},
};

class FakeSerialPort extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.isOpen = false;
    this.writes = [];
    FakeSerialPort.instances.push(this);
  }

  open(callback) {
    queueMicrotask(() => {
      this.isOpen = true;
      callback(null);
    });
  }

  write(value, callback) {
    this.writes.push(value);
    queueMicrotask(() => callback(null));
  }

  drain(callback) {
    queueMicrotask(() => callback(null));
  }

  close(callback = () => {}) {
    this.isOpen = false;
    queueMicrotask(() => {
      this.emit("close");
      callback(null);
    });
  }
}

test("serial discovery prefers configured VID/PID and falls back to usbmodem", () => {
  const ports = [
    {
      path: "/dev/cu.usbmodem-b",
      vendorId: "1234",
      productId: "5678",
    },
    {
      path: "/dev/cu.usbserial-a",
      vendorId: "303A",
      productId: "1001",
    },
    {
      path: "/dev/cu.usbmodem-a",
      vendorId: "9999",
      productId: "0001",
    },
  ];

  assert.equal(
    selectSerialPort(ports, { vendorId: "303a", productId: "1001" }).path,
    "/dev/cu.usbserial-a",
  );
  assert.equal(
    selectSerialPort(ports, { vendorId: "303a", productId: "9999" }),
    null,
  );
  assert.equal(selectSerialPort(ports).path, "/dev/cu.usbmodem-a");
});

test("macOS tty discovery paths are opened through their cu counterpart", () => {
  const selected = selectSerialPort([
    {
      path: "/dev/tty.usbmodem2101",
      manufacturer: "Espressif",
    },
  ]);

  assert.equal(selected.path, "/dev/cu.usbmodem2101");
});

test("commands queued before connection flush in order with newline framing", async () => {
  FakeSerialPort.instances = [];
  const manager = new SerialManager({
    requestedPath: "/dev/cu.usbmodem-test",
    logger: silentLogger,
    SerialPortClass: FakeSerialPort,
  });

  assert.equal(manager.send("BUILDING"), true);
  assert.equal(manager.send("SUCCESS"), true);
  assert.equal(manager.getStatus().queuedCommands, 2);

  manager.start();
  await once(manager, "connected");
  await once(manager, "sent");
  await once(manager, "sent");

  const fakePort = FakeSerialPort.instances[0];
  assert.deepEqual(fakePort.writes, ["BUILDING\n", "SUCCESS\n"]);
  assert.equal(manager.getStatus().queuedCommands, 0);

  await manager.stop();
});

test("queue capacity rejects commands that cannot be retained", () => {
  const manager = new SerialManager({
    requestedPath: "/dev/cu.usbmodem-test",
    queueLimit: 1,
    logger: silentLogger,
    SerialPortClass: FakeSerialPort,
  });

  assert.equal(manager.send("BUILDING"), true);
  assert.equal(manager.send("SUCCESS"), false);
  assert.equal(manager.getStatus().queuedCommands, 1);
});
