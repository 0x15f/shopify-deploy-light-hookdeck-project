"use strict";

const { EventEmitter } = require("node:events");
const { SerialPort } = require("serialport");
const { normalizeCommand } = require("./protocol");

const MAC_USB_MODEM_PATTERN = /^\/dev\/cu\.usbmodem/i;

function normalizePortId(value) {
  return value?.replace(/^0x/i, "").toLowerCase() || null;
}

function normalizeMacSerialPath(path) {
  return path.replace(/^\/dev\/tty\./, "/dev/cu.");
}

function selectSerialPort(ports, { vendorId = null, productId = null } = {}) {
  const sortedPorts = [...ports]
    .filter((port) => typeof port.path === "string")
    .map((port) => ({
      ...port,
      path: normalizeMacSerialPath(port.path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (vendorId || productId) {
    return (
      sortedPorts.find((port) => {
        const vendorMatches =
          !vendorId ||
          normalizePortId(port.vendorId) === vendorId.toLowerCase();
        const productMatches =
          !productId ||
          normalizePortId(port.productId) === productId.toLowerCase();
        return vendorMatches && productMatches;
      }) || null
    );
  }

  return (
    sortedPorts.find((port) => MAC_USB_MODEM_PATTERN.test(port.path)) || null
  );
}

class SerialManager extends EventEmitter {
  constructor({
    requestedPath = null,
    baudRate = 115200,
    vendorId = null,
    productId = null,
    reconnectMinimumMs = 1_000,
    reconnectMaximumMs = 30_000,
    queueLimit = 256,
    logger = console,
    SerialPortClass = SerialPort,
    listPorts = () => SerialPort.list(),
  } = {}) {
    super();
    this.requestedPath = requestedPath;
    this.baudRate = baudRate;
    this.vendorId = vendorId;
    this.productId = productId;
    this.reconnectMinimumMs = reconnectMinimumMs;
    this.reconnectMaximumMs = reconnectMaximumMs;
    this.queueLimit = queueLimit;
    this.logger = logger;
    this.SerialPortClass = SerialPortClass;
    this.listPorts = listPorts;

    this.port = null;
    this.connectedPath = null;
    this.queue = [];
    this.writing = false;
    this.receiveBuffer = "";
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    void this.#connect();
  }

  async stop() {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const port = this.port;
    this.port = null;
    this.connectedPath = null;
    this.writing = false;

    if (!port?.isOpen) {
      return;
    }

    await new Promise((resolve) => {
      port.close(() => resolve());
    });
  }

  send(command) {
    const normalized = normalizeCommand(command);

    if (this.queue.length >= this.queueLimit) {
      this.logger.error(
        `Serial queue is full; rejected ${normalized} (${this.queueLimit} pending)`,
      );
      return false;
    }

    this.queue.push(normalized);
    this.emit("queue", this.queue.length);
    this.#flush();
    return true;
  }

  getStatus() {
    return {
      connected: Boolean(this.port?.isOpen && this.connectedPath),
      path: this.connectedPath,
      baudRate: this.baudRate,
      queuedCommands: this.queue.length,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  async #resolvePath() {
    if (this.requestedPath) {
      return this.requestedPath;
    }

    const ports = await this.listPorts();
    return selectSerialPort(ports, {
      vendorId: this.vendorId,
      productId: this.productId,
    })?.path;
  }

  async #connect() {
    if (this.stopped || this.port) {
      return;
    }

    let path;

    try {
      path = await this.#resolvePath();
    } catch (error) {
      this.logger.error(`Unable to list serial devices: ${error.message}`);
      this.#scheduleReconnect("device discovery failed");
      return;
    }

    if (!path) {
      this.#scheduleReconnect("device not found");
      return;
    }

    let port;

    try {
      port = new this.SerialPortClass({
        path,
        baudRate: this.baudRate,
        autoOpen: false,
      });
    } catch (error) {
      this.logger.error(`Unable to create serial connection: ${error.message}`);
      this.#scheduleReconnect("connection setup failed");
      return;
    }

    this.port = port;
    this.receiveBuffer = "";

    port.on("data", (chunk) => this.#handleData(port, chunk));
    port.on("close", () => this.#handleClose(port));
    port.on("error", (error) => this.#handleError(port, error));

    port.open((error) => {
      if (error) {
        if (this.port === port) {
          this.port = null;
          this.writing = false;
        }

        port.removeAllListeners();
        this.logger.error(`Serial connection failed (${path}): ${error.message}`);
        this.#scheduleReconnect("open failed");
        return;
      }

      if (this.stopped || this.port !== port) {
        port.close(() => {});
        return;
      }

      this.connectedPath = path;
      this.reconnectAttempt = 0;
      this.logger.log(`Connected to serial: ${path}`);
      this.emit("connected", { path, baudRate: this.baudRate });
      this.#flush();
    });
  }

  #handleData(port, chunk) {
    if (this.port !== port) {
      return;
    }

    this.receiveBuffer += chunk.toString("utf8");

    if (this.receiveBuffer.length > 1_024) {
      this.receiveBuffer = this.receiveBuffer.slice(-1_024);
    }

    const lines = this.receiveBuffer.split("\n");
    this.receiveBuffer = lines.pop();

    for (const line of lines) {
      const response = line.replace(/\r$/, "").trim();

      if (response) {
        this.logger.log(`Firmware: ${response}`);
        this.emit("response", response);
      }
    }
  }

  #handleError(port, error) {
    if (this.port !== port) {
      return;
    }

    this.logger.error(`Serial error: ${error.message}`);

    if (port.isOpen) {
      port.close((closeError) => {
        if (closeError) {
          this.logger.error(`Serial close failed: ${closeError.message}`);
          this.#handleClose(port);
        }
      });
    } else {
      this.#handleClose(port);
    }
  }

  #handleClose(port) {
    if (this.port !== port) {
      return;
    }

    const previousPath = this.connectedPath;
    this.port = null;
    this.connectedPath = null;
    this.writing = false;
    port.removeAllListeners();

    if (previousPath) {
      this.logger.log(`Serial disconnected: ${previousPath}`);
      this.emit("disconnected", { path: previousPath });
    }

    this.#scheduleReconnect("disconnected");
  }

  #scheduleReconnect(reason) {
    if (this.stopped || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    const exponent = Math.min(this.reconnectAttempt - 1, 10);
    const delay = Math.min(
      this.reconnectMinimumMs * 2 ** exponent,
      this.reconnectMaximumMs,
    );

    this.logger.log(
      `Serial reconnect attempt ${this.reconnectAttempt} in ${delay}ms (${reason})`,
    );

    this.emit("reconnecting", { attempt: this.reconnectAttempt, delay, reason });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.#connect();
    }, delay);
  }

  #flush() {
    const port = this.port;

    if (
      this.stopped ||
      this.writing ||
      !port?.isOpen ||
      this.queue.length === 0
    ) {
      return;
    }

    const command = this.queue[0];
    this.writing = true;

    port.write(`${command}\n`, (writeError) => {
      if (writeError) {
        this.writing = false;
        this.logger.error(`Serial write failed: ${writeError.message}`);
        this.#handleError(port, writeError);
        return;
      }

      port.drain((drainError) => {
        this.writing = false;

        if (drainError) {
          this.logger.error(`Serial drain failed: ${drainError.message}`);
          this.#handleError(port, drainError);
          return;
        }

        if (this.port !== port || !port.isOpen) {
          return;
        }

        this.queue.shift();
        this.logger.log(`Sent ${command}`);
        this.emit("sent", command);
        this.emit("queue", this.queue.length);
        queueMicrotask(() => this.#flush());
      });
    });
  }
}

module.exports = {
  SerialManager,
  selectSerialPort,
};
