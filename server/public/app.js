"use strict";

const elements = {
  daemonStatus: document.querySelector("#daemon-status"),
  daemonLabel: document.querySelector("#daemon-label"),
  connectionLight: document.querySelector("#connection-light"),
  connectionLabel: document.querySelector("#connection-label"),
  devicePath: document.querySelector("#device-path"),
  queueValue: document.querySelector("#queue-value"),
  deploymentState: document.querySelector("#deployment-state"),
  deploymentTime: document.querySelector("#deployment-time"),
  commandSent: document.querySelector("#command-sent"),
  commandTime: document.querySelector("#command-time"),
  firmwareResponse: document.querySelector("#firmware-response"),
  responseTime: document.querySelector("#response-time"),
  feedback: document.querySelector("#feedback"),
};

const commandButtons = [...document.querySelectorAll("[data-state]")];
let feedbackTimer;
let refreshing = false;

function formatTime(timestamp, fallback) {
  if (!timestamp) {
    return fallback;
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.valueOf())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function setDaemonStatus(online) {
  elements.daemonStatus.classList.toggle("online", online);
  elements.daemonStatus.classList.toggle("offline", !online);
  elements.daemonLabel.textContent = online ? "Daemon online" : "Daemon offline";
}

function renderStatus(status) {
  setDaemonStatus(true);

  const connected = Boolean(status.serial?.connected);
  elements.connectionLight.className = `connection-light ${
    connected ? "connected" : "disconnected"
  }`;
  elements.connectionLabel.textContent = connected
    ? "ESP32 connected"
    : "ESP32 disconnected";
  elements.devicePath.textContent =
    status.serial?.path ||
    `Searching · retry ${status.serial?.reconnectAttempt ?? 0}`;
  elements.queueValue.textContent = String(status.serial?.queuedCommands ?? 0);
  elements.deploymentState.textContent = status.lastDeploymentState || "—";
  elements.deploymentTime.textContent = formatTime(
    status.lastDeploymentAt,
    "No event received",
  );
  elements.commandSent.textContent = status.lastCommandSent || "—";
  elements.commandTime.textContent = formatTime(
    status.lastCommandSentAt,
    "Nothing sent yet",
  );
  elements.firmwareResponse.textContent = status.firmwareResponse || "—";
  elements.responseTime.textContent = formatTime(
    status.firmwareResponseAt,
    "No response yet",
  );
}

async function refreshStatus() {
  if (refreshing) {
    return;
  }

  refreshing = true;

  try {
    const response = await fetch("/api/status", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`status request failed (${response.status})`);
    }

    renderStatus(await response.json());
  } catch {
    setDaemonStatus(false);
    elements.connectionLight.className = "connection-light disconnected";
    elements.connectionLabel.textContent = "Status unavailable";
    elements.devicePath.textContent = "Could not reach the local daemon";
  } finally {
    refreshing = false;
  }
}

function showFeedback(message, isError = false) {
  clearTimeout(feedbackTimer);
  elements.feedback.textContent = message;
  elements.feedback.classList.toggle("error", isError);
  feedbackTimer = setTimeout(() => {
    elements.feedback.textContent = "";
    elements.feedback.classList.remove("error");
  }, 4_000);
}

async function sendState(state, button) {
  button.disabled = true;

  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `request failed (${response.status})`);
    }

    showFeedback(`${result.command} queued`);
    await refreshStatus();
  } catch (error) {
    showFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

for (const button of commandButtons) {
  button.addEventListener("click", () => {
    void sendState(button.dataset.state, button);
  });
}

void refreshStatus();
setInterval(() => void refreshStatus(), 1_000);
