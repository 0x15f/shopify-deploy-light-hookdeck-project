"use strict";

const STATE_COMMANDS = Object.freeze({
  building: "BUILDING",
  success: "SUCCESS",
  failure: "FAILURE",
  off: "OFF",
});

function commandForState(state) {
  if (typeof state !== "string") {
    return null;
  }

  return STATE_COMMANDS[state.trim().toLowerCase()] || null;
}

function normalizeCommand(command) {
  if (typeof command !== "string") {
    throw new TypeError("Serial command must be a string");
  }

  const normalized = command.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 95 ||
    /[\r\n\0]/.test(normalized)
  ) {
    throw new Error("Serial command is empty, too long, or contains a delimiter");
  }

  return normalized;
}

module.exports = {
  STATE_COMMANDS,
  commandForState,
  normalizeCommand,
};

