# Deploy Light

Deploy Light turns deployment events into a physical status light without
putting networking logic on the microcontroller.

```text
GitHub Actions
      │  {"state":"building"}
      ▼
   Hookdeck
      │  HTTP or authenticated CLI tunnel
      ▼
Node.js daemon on macOS
      │  newline-delimited USB serial
      ▼
   ESP32-C3
      │  PWM
      ▼
 Logic MOSFET
      │
      ▼
 5 V LED sign
```

The Node daemon owns HTTP, Hookdeck verification, serial discovery, reconnects,
and command queuing. The ESP32 owns GPIO timing and animations. The firmware
does not know about GitHub, Hookdeck, HTTP, or JSON.

## Features

- Non-blocking ESP32 animation state machine based on `millis()`
- Immediate animation replacement when a serial command arrives
- Automatic `/dev/cu.usbmodem*` discovery and optional USB VID/PID matching
- Ordered, bounded in-memory command queue
- Automatic serial reconnect with exponential backoff
- Optional Hookdeck HMAC verification for direct HTTP delivery
- Local status dashboard and manual test controls
- macOS LaunchAgent examples for unattended operation
- No frontend toolchain and only three runtime dependencies

## Repository layout

```text
deploy-light/
├── .github/                 # CI and dependency updates
├── docs/
│   ├── hardware.md          # wiring, power, and troubleshooting
│   └── macos-autostart.md   # launchd setup
├── firmware/
│   └── deploy_light/
│       └── deploy_light.ino
├── server/
│   ├── public/              # dependency-free local dashboard
│   ├── scripts/             # optional Hookdeck launchd wrapper
│   ├── src/                 # Express and serial daemon
│   ├── test/                # Node test runner suites
│   ├── .env.example
│   └── package.json
├── CONTRIBUTING.md
├── LICENSE
└── SECURITY.md
```

## Hardware

The reference build uses:

- ESP32-C3 SuperMini
- 3.3 V-compatible logic MOSFET module
- 5 V LED sign
- USB data cable
- 5 V supply capable of powering the sign

The firmware defaults to **GPIO 7**. Typical low-side switching is:

| From | To |
| --- | --- |
| ESP32 GPIO 7 | MOSFET trigger/PWM |
| ESP32 GND | MOSFET logic ground and supply ground |
| 5 V positive | Sign positive |
| Sign negative | MOSFET switched/load negative |

Read [the hardware guide](docs/hardware.md) before applying power. MOSFET
terminal layouts vary, and an overloaded or shorted 5 V rail can make the
ESP32 disappear from USB even while its power LED remains illuminated.

## Firmware

### Upload with Arduino IDE

1. Install Arduino IDE and the Espressif ESP32 board package.
2. Open
   [`firmware/deploy_light/deploy_light.ino`](firmware/deploy_light/deploy_light.ino).
3. Select **ESP32C3 Dev Module** or the appropriate ESP32-C3 board profile.
4. Set **USB CDC On Boot** to **Enabled**.
5. Select the USB serial port and upload.

The first native-USB upload may require download mode: hold **BOOT**, tap
**RESET**, then release **BOOT**. See Espressif's
[USB CDC guide](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html#usb-cdc).

### Compile with Arduino CLI

Install the `esp32:esp32` core, then run:

```bash
arduino-cli compile \
  --fqbn 'esp32:esp32:esp32c3:CDCOnBoot=cdc' \
  firmware/deploy_light
```

Upload after stopping anything that owns the serial port:

```bash
arduino-cli upload \
  --fqbn 'esp32:esp32:esp32c3:CDCOnBoot=cdc' \
  --port /dev/cu.usbmodem2101 \
  firmware/deploy_light
```

Replace the example port with the path on your Mac. Arduino Serial Monitor and
the Node daemon cannot own the port while an upload is running.

### Serial protocol

The baud rate is `115200`. Send one ASCII command followed by `\n`:

| Command | Response | Behavior |
| --- | --- | --- |
| `BUILDING` | `OK` | Approximately 2-second breathing cycle until replaced |
| `SUCCESS` | `OK` | Three quick flashes, solid for 2 seconds, then idle |
| `FAILURE` | `OK` | Rapid flashing for 5 seconds, then idle |
| `OFF` | `OK` | Turn off immediately and return to idle |
| `PING` | `PONG` | Health check without changing the animation |
| Invalid input | `ERROR` | Reject input without changing the animation |

The firmware reads serial on every loop iteration and contains no animation
`delay()` calls. Its parser already tokenizes arguments, so commands such as
`BRIGHTNESS 180` and `FLASH 50 10` can be added without changing framing.

## Node daemon

### Requirements

- macOS
- Node.js 22 or newer
- A connected ESP32-C3 running the firmware

### Setup

```bash
cd server
cp .env.example .env
npm ci
npm test
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The dashboard shows:

- daemon and serial connection state
- selected device path and queue depth
- last deployment state
- last command sent
- latest firmware response
- manual `BUILDING`, `SUCCESS`, `FAILURE`, and `OFF` controls

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3000` | HTTP port |
| `SERIAL_PORT` | auto | Exact serial path; bypasses discovery when set |
| `SERIAL_BAUD` | `115200` | Serial baud rate |
| `SERIAL_VID` | unset | Optional four-digit USB vendor ID filter |
| `SERIAL_PID` | unset | Optional four-digit USB product ID filter |
| `HOOKDECK_SECRET` | unset | Enables Hookdeck HMAC verification |
| `SERIAL_RECONNECT_MIN_MS` | `1000` | Initial reconnect delay |
| `SERIAL_RECONNECT_MAX_MS` | `30000` | Maximum reconnect delay |
| `SERIAL_QUEUE_LIMIT` | `256` | Maximum retained commands |

Without an explicit `SERIAL_PORT`, the daemon selects the first sorted
`/dev/cu.usbmodem*` device. Setting `SERIAL_VID` and/or `SERIAL_PID` requires a
matching USB device instead. IDs are case-insensitive and accept `303a` or
`0x303A`.

Commands accepted while serial is unavailable remain in order in memory. The
daemon resumes writes after reconnection. The queue does not survive a daemon
process restart.

### HTTP API

| Method and path | Purpose |
| --- | --- |
| `POST /hookdeck` | Queue a state received from Hookdeck |
| `GET /api/status` | Return dashboard and serial status |
| `POST /api/command` | Queue a state from the local dashboard |
| `GET /` | Serve the local dashboard |

Both command endpoints accept:

```json
{
  "state": "building"
}
```

Valid states are `building`, `success`, `failure`, and `off`.

`POST /hookdeck` returns `200 OK` after the command is safely queued in memory.
It does not wait for a serial connection or firmware acknowledgement. A full
queue returns `503`, allowing Hookdeck to retry.

The dashboard and manual command endpoint have no login. Keep the default
localhost bind unless you add authentication and network access controls.

## Hookdeck

There is intentionally no GitHub-specific logic in the daemon. GitHub Actions
posts a state to a Hookdeck source; Hookdeck routes it to `/hookdeck`.

### Option A: Hookdeck CLI to localhost

This is the simplest arrangement for a personal always-on Mac:

```bash
hookdeck login
hookdeck listen 3000 deploy-light \
  --path /hookdeck \
  --output compact \
  --color off
```

Hookdeck creates or uses the `deploy-light` source and forwards its events
through the authenticated CLI session to `127.0.0.1:3000/hookdeck`.
`HOOKDECK_SECRET` can remain empty because the daemon is not exposed to the
network.

See [the macOS autostart guide](docs/macos-autostart.md) to run both processes
after login.

### Option B: Direct HTTP destination

To use a normal Hookdeck HTTP destination:

1. Expose only `POST /hookdeck` through a trusted HTTPS reverse proxy or tunnel.
2. Create a Hookdeck source and HTTP destination.
3. Connect the source to the destination.
4. Enable Hookdeck destination signing.
5. Put the destination signing secret in `.env` as `HOOKDECK_SECRET`.
6. Restart the daemon.

When configured, the daemon verifies `x-hookdeck-signature` as a base64
HMAC-SHA256 over the exact raw request body. Missing or invalid signatures
receive `401`.

Do not commit the source URL or signing secret. Put the source ingestion URL in
the application repository as the GitHub Actions secret
`HOOKDECK_DEPLOY_URL`.

## GitHub Actions example

Add the following steps around the real deployment command:

```yaml
- name: Signal building
  continue-on-error: true
  env:
    HOOKDECK_DEPLOY_URL: ${{ secrets.HOOKDECK_DEPLOY_URL }}
  run: |
    curl --fail-with-body --retry 3 --retry-all-errors \
      -H 'content-type: application/json' \
      -d '{"state":"building"}' \
      "$HOOKDECK_DEPLOY_URL"

- name: Deploy application
  id: deploy
  run: ./scripts/deploy.sh

- name: Signal success
  if: ${{ success() && steps.deploy.outcome == 'success' }}
  continue-on-error: true
  env:
    HOOKDECK_DEPLOY_URL: ${{ secrets.HOOKDECK_DEPLOY_URL }}
  run: |
    curl --fail-with-body --retry 3 --retry-all-errors \
      -H 'content-type: application/json' \
      -d '{"state":"success"}' \
      "$HOOKDECK_DEPLOY_URL"

- name: Signal failure
  if: ${{ failure() && steps.deploy.outcome == 'failure' }}
  continue-on-error: true
  env:
    HOOKDECK_DEPLOY_URL: ${{ secrets.HOOKDECK_DEPLOY_URL }}
  run: |
    curl --fail-with-body --retry 3 --retry-all-errors \
      -H 'content-type: application/json' \
      -d '{"state":"failure"}' \
      "$HOOKDECK_DEPLOY_URL"
```

Replace `./scripts/deploy.sh` with the application's deployment command.
Signaling uses `continue-on-error` so light availability cannot change the
deployment result.

## Troubleshooting

### The dashboard says disconnected

Check whether macOS sees the board:

```bash
ls /dev/cu.usbmodem*
```

- No matching path: reseat the USB data cable and disconnect the LED load.
- Path exists but the daemon cannot open it: close Arduino Serial Monitor and
  any other serial terminal.
- The path disappears when the light is connected: stop and inspect power,
  polarity, exposed wire strands, and current draw. See the
  [hardware guide](docs/hardware.md).

The daemon retries forever; reconnecting the board does not require a restart.

### Test without GitHub

Use the dashboard or post directly:

```bash
curl --fail-with-body \
  -H 'content-type: application/json' \
  -d '{"state":"building"}' \
  http://127.0.0.1:3000/hookdeck
```

This unsigned request works only when `HOOKDECK_SECRET` is empty.

## Development

```bash
cd server
npm test
npm run check
```

CI runs the server tests and compiles the firmware for
`esp32:esp32:esp32c3` with USB CDC enabled.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md). Please
report security issues according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
