#include <Arduino.h>
#include <math.h>
#include <string.h>

namespace {

constexpr uint8_t LIGHT_PIN = 7;
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t PWM_FREQUENCY_HZ = 5000;
constexpr uint8_t PWM_RESOLUTION_BITS = 8;
constexpr uint8_t PWM_OFF = 0;
constexpr uint8_t PWM_FULL = 255;

constexpr uint32_t BUILDING_PERIOD_MS = 2000;
constexpr uint32_t SUCCESS_FLASH_STEP_MS = 100;
constexpr uint32_t SUCCESS_FLASH_SEQUENCE_MS = 600;
constexpr uint32_t SUCCESS_SOLID_MS = 2000;
constexpr uint32_t FAILURE_FLASH_STEP_MS = 100;
constexpr uint32_t FAILURE_DURATION_MS = 5000;

constexpr size_t MAX_COMMAND_LENGTH = 95;
constexpr uint8_t MAX_ARGUMENTS = 8;

enum class State : uint8_t {
  IDLE,
  BUILDING,
  SUCCESS,
  FAILURE,
};

struct ParsedCommand {
  char *name;
  char *arguments[MAX_ARGUMENTS];
  uint8_t argumentCount;
};

State currentState = State::IDLE;
uint32_t stateStartedAt = 0;
uint8_t currentDuty = PWM_OFF;
bool pwmAttached = false;

char serialBuffer[MAX_COMMAND_LENGTH + 1];
size_t serialLength = 0;
bool serialOverflow = false;

void setLight(uint8_t duty) {
  if (duty == currentDuty) {
    return;
  }

  currentDuty = duty;

  if (pwmAttached) {
    ledcWrite(LIGHT_PIN, duty);
    return;
  }

  digitalWrite(LIGHT_PIN, duty > PWM_OFF ? HIGH : LOW);
}

void enterState(State nextState, uint32_t now) {
  currentState = nextState;
  stateStartedAt = now;

  // Every transition takes ownership of the output immediately.
  switch (nextState) {
    case State::BUILDING:
      setLight(6);
      break;
    case State::SUCCESS:
    case State::FAILURE:
      setLight(PWM_FULL);
      break;
    case State::IDLE:
      setLight(PWM_OFF);
      break;
  }
}

bool parseCommand(char *line, ParsedCommand &command) {
  command = {nullptr, {nullptr}, 0};
  char *savePointer = nullptr;
  char *token = strtok_r(line, " \t", &savePointer);

  if (token == nullptr) {
    return false;
  }

  command.name = token;

  while ((token = strtok_r(nullptr, " \t", &savePointer)) != nullptr) {
    if (command.argumentCount >= MAX_ARGUMENTS) {
      return false;
    }

    command.arguments[command.argumentCount++] = token;
  }

  return true;
}

bool hasNoArguments(const ParsedCommand &command) {
  return command.argumentCount == 0;
}

void handleCommand(char *line, uint32_t now) {
  ParsedCommand command;

  if (!parseCommand(line, command)) {
    Serial.println("ERROR");
    return;
  }

  if (strcmp(command.name, "PING") == 0 && hasNoArguments(command)) {
    Serial.println("PONG");
    return;
  }

  if (strcmp(command.name, "OFF") == 0 && hasNoArguments(command)) {
    enterState(State::IDLE, now);
    Serial.println("OK");
    return;
  }

  if (strcmp(command.name, "BUILDING") == 0 && hasNoArguments(command)) {
    enterState(State::BUILDING, now);
    Serial.println("OK");
    return;
  }

  if (strcmp(command.name, "SUCCESS") == 0 && hasNoArguments(command)) {
    enterState(State::SUCCESS, now);
    Serial.println("OK");
    return;
  }

  if (strcmp(command.name, "FAILURE") == 0 && hasNoArguments(command)) {
    enterState(State::FAILURE, now);
    Serial.println("OK");
    return;
  }

  Serial.println("ERROR");
}

void readSerial(uint32_t now) {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());

    if (incoming == '\r') {
      continue;
    }

    if (incoming == '\n') {
      if (serialOverflow) {
        Serial.println("ERROR");
      } else {
        serialBuffer[serialLength] = '\0';
        handleCommand(serialBuffer, now);
      }

      serialLength = 0;
      serialOverflow = false;
      continue;
    }

    if (serialOverflow) {
      continue;
    }

    if (incoming < 0x20 || incoming > 0x7e) {
      serialOverflow = true;
      continue;
    }

    if (serialLength >= MAX_COMMAND_LENGTH) {
      serialOverflow = true;
      continue;
    }

    serialBuffer[serialLength++] = incoming;
  }
}

void updateBuilding(uint32_t elapsed) {
  const uint32_t phaseMs = elapsed % BUILDING_PERIOD_MS;
  const float phase =
      static_cast<float>(phaseMs) / static_cast<float>(BUILDING_PERIOD_MS);
  const float wave = 0.5f - 0.5f * cosf(phase * TWO_PI);
  const float perceptualWave = wave * wave;
  const uint8_t duty =
      static_cast<uint8_t>(6.0f + perceptualWave * (PWM_FULL - 6));
  setLight(duty);
}

void updateSuccess(uint32_t elapsed, uint32_t now) {
  const uint32_t totalDuration =
      SUCCESS_FLASH_SEQUENCE_MS + SUCCESS_SOLID_MS;

  if (elapsed >= totalDuration) {
    enterState(State::IDLE, now);
    return;
  }

  if (elapsed < SUCCESS_FLASH_SEQUENCE_MS) {
    const bool isOn = (elapsed / SUCCESS_FLASH_STEP_MS) % 2 == 0;
    setLight(isOn ? PWM_FULL : PWM_OFF);
    return;
  }

  setLight(PWM_FULL);
}

void updateFailure(uint32_t elapsed, uint32_t now) {
  if (elapsed >= FAILURE_DURATION_MS) {
    enterState(State::IDLE, now);
    return;
  }

  const bool isOn = (elapsed / FAILURE_FLASH_STEP_MS) % 2 == 0;
  setLight(isOn ? PWM_FULL : PWM_OFF);
}

void updateAnimation(uint32_t now) {
  // Unsigned subtraction remains correct when millis() rolls over.
  const uint32_t elapsed = now - stateStartedAt;

  switch (currentState) {
    case State::BUILDING:
      updateBuilding(elapsed);
      break;
    case State::SUCCESS:
      updateSuccess(elapsed, now);
      break;
    case State::FAILURE:
      updateFailure(elapsed, now);
      break;
    case State::IDLE:
      setLight(PWM_OFF);
      break;
  }
}

}  // namespace

void setup() {
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(LIGHT_PIN, LOW);
  pwmAttached =
      ledcAttach(LIGHT_PIN, PWM_FREQUENCY_HZ, PWM_RESOLUTION_BITS);

  if (pwmAttached) {
    ledcWrite(LIGHT_PIN, PWM_OFF);
  }

  Serial.begin(SERIAL_BAUD);
  stateStartedAt = millis();
}

void loop() {
  const uint32_t now = millis();
  readSerial(now);
  updateAnimation(now);
}
