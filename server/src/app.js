"use strict";

const path = require("node:path");
const express = require("express");
const { commandForState } = require("./protocol");
const { verifyHookdeckSignature } = require("./signature");

function createRuntimeState() {
  return {
    lastDeploymentState: null,
    lastDeploymentAt: null,
    lastCommandQueued: null,
    lastCommandQueuedAt: null,
    lastCommandSent: null,
    lastCommandSentAt: null,
    firmwareResponse: null,
    firmwareResponseAt: null,
  };
}

function createApp({
  serialManager,
  hookdeckSecret = null,
  logger = console,
  publicDirectory = path.join(__dirname, "..", "public"),
  clock = () => new Date(),
} = {}) {
  if (!serialManager) {
    throw new Error("createApp requires a serial manager");
  }

  const app = express();
  const runtimeState = createRuntimeState();

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; connect-src 'self'; " +
        "form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; " +
        "script-src 'self'; style-src 'self'",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    next();
  });

  serialManager.on?.("sent", (command) => {
    runtimeState.lastCommandSent = command;
    runtimeState.lastCommandSentAt = clock().toISOString();
  });

  serialManager.on?.("response", (response) => {
    runtimeState.firmwareResponse = response;
    runtimeState.firmwareResponseAt = clock().toISOString();
  });

  function queueState(state, source) {
    const normalizedState =
      typeof state === "string" ? state.trim().toLowerCase() : state;
    const command = commandForState(normalizedState);

    if (!command) {
      return {
        ok: false,
        status: 400,
        message: "state must be building, success, failure, or off",
      };
    }

    const queued = serialManager.send(command);

    if (!queued) {
      return {
        ok: false,
        status: 503,
        message: "serial command queue is full",
      };
    }

    const timestamp = clock().toISOString();
    runtimeState.lastDeploymentState = normalizedState;
    runtimeState.lastDeploymentAt = timestamp;
    runtimeState.lastCommandQueued = command;
    runtimeState.lastCommandQueuedAt = timestamp;

    logger.log(`State: ${normalizedState}`);

    if (!serialManager.getStatus().connected) {
      logger.log(`Queued ${command} while serial is disconnected`);
    }

    return { ok: true, command, source };
  }

  app.post(
    "/hookdeck",
    express.raw({
      type: ["application/json", "application/*+json"],
      limit: "16kb",
    }),
    (request, response) => {
      logger.log("Webhook received");

      if (!Buffer.isBuffer(request.body)) {
        response
          .status(415)
          .json({ error: "Content-Type must be application/json" });
        return;
      }

      if (
        hookdeckSecret &&
        !verifyHookdeckSignature(
          request.body,
          request.get("x-hookdeck-signature"),
          hookdeckSecret,
        )
      ) {
        logger.warn("Rejected webhook with invalid Hookdeck signature");
        response.status(401).json({ error: "invalid Hookdeck signature" });
        return;
      }

      let payload;

      try {
        payload = JSON.parse(request.body.toString("utf8"));
      } catch {
        response.status(400).json({ error: "invalid JSON body" });
        return;
      }

      const result = queueState(payload?.state, "hookdeck");

      if (!result.ok) {
        response.status(result.status).json({ error: result.message });
        return;
      }

      response.status(200).type("text/plain").send("OK");
    },
  );

  app.use(express.json({ limit: "16kb" }));

  app.get("/api/status", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json({
      serial: serialManager.getStatus(),
      ...runtimeState,
    });
  });

  app.post("/api/command", (request, response) => {
    const result = queueState(request.body?.state, "dashboard");

    if (!result.ok) {
      response.status(result.status).json({ error: result.message });
      return;
    }

    response.status(202).json({
      queued: true,
      command: result.command,
    });
  });

  app.use(express.static(publicDirectory, { extensions: ["html"] }));

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && error.status === 400) {
      response.status(400).json({ error: "invalid JSON body" });
      return;
    }

    logger.error(error);
    response.status(500).json({ error: "internal server error" });
  });

  return app;
}

module.exports = {
  createApp,
};
