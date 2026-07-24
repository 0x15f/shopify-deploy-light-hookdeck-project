# Contributing

Thanks for helping improve Deploy Light. Small, focused pull requests are the
easiest to review.

## Development setup

The server requires Node.js 22 or newer:

```bash
cd server
cp .env.example .env
npm ci
npm test
npm run check
```

The firmware targets an ESP32-C3 with the Espressif Arduino core. With
`arduino-cli` and the `esp32:esp32` core installed, compile it with:

```bash
arduino-cli compile \
  --fqbn 'esp32:esp32:esp32c3:CDCOnBoot=cdc' \
  firmware/deploy_light
```

## Pull requests

- Keep networking and JSON handling in the Node daemon.
- Keep GPIO, timing, and animations in the firmware.
- Do not add blocking `delay()` loops to firmware animations.
- Preserve newline-delimited serial framing and immediate state replacement.
- Add or update tests for server behavior.
- Run the server tests, JavaScript checks, and firmware compile before opening
  a pull request.
- Never commit `.env`, API keys, Hookdeck credentials, device-specific launchd
  files, or generated firmware binaries.

Hardware changes should include the board, GPIO, MOSFET, supply voltage, and
measured load current used for testing.
