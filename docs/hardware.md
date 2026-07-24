# Hardware guide

## Reference hardware

- ESP32-C3 SuperMini
- 3.3 V-compatible logic MOSFET module
- 5 V LED sign
- USB data cable
- 5 V supply sized for the sign's measured current

The firmware drives `GPIO 4` with PWM. Change `LIGHT_PIN` in the sketch when
using another output.

## Low-side switching

The MOSFET belongs in the sign's negative return path:

```text
5 V positive ───────────────────────────── LED sign positive
LED sign negative ──────────────────────── MOSFET load/output negative
5 V ground ───────┬─────────────────────── MOSFET input/source ground
                  └─────────────────────── ESP32 GND
ESP32 GPIO 4 ───────────────────────────── MOSFET trigger/PWM
```

Some modules expose both positive and negative input/output terminals. On those
modules, positive normally passes straight through while the MOSFET switches
the negative side. Always follow the PCB silkscreen.

For a ZX-5L-style module labeled like the reference hardware:

| Module terminal | Connection |
| --- | --- |
| `VIN+` | 5 V supply positive |
| `VIN-` | 5 V supply ground and ESP32 ground |
| `OUT+` | Sign positive |
| `OUT-` | Sign negative |
| `TRIG/PWM` | ESP32 GPIO 4 |
| `GND` beside trigger | ESP32 ground |

## Power

An ESP32 board's `5V` pin may expose USB VBUS, but that does not guarantee the
board, cable, host port, or PCB traces can safely carry a particular sign's
current. Measure the load and stay within every component's rating.

The safest arrangement powers the ESP32 from the Mac for USB data and powers
the sign from a separate regulated 5 V supply. Join the grounds only. If one
supply powers both loads, split the 5 V rail before the ESP32 rather than
routing the sign current through the development board.

Never connect an external 5 V source to the ESP32's 5 V pin while USB is
connected unless the board explicitly supports that power arrangement.

## Wiring checklist

1. Disconnect all power before moving wires.
2. Verify `VIN+`, `VIN-`, `OUT+`, and `OUT-` from the silkscreen.
3. Trim stranded wire so no bare copper remains outside a terminal.
4. Confirm supply ground, MOSFET ground, and ESP32 ground are common.
5. Confirm the trigger is on GPIO 4, not `3.3V`, `5V`, or a USB data pin.
6. Check resistance between 5 V and ground for an obvious short before power-up.
7. Power the ESP32 and MOSFET without the sign first.
8. Add the sign only after USB serial remains stable.

If `/dev/cu.usbmodem*` disappears when the sign is connected, stop testing.
That symptom indicates a short, reversed polarity, excessive voltage drop, or
an overloaded USB supply; it is not a firmware or daemon failure.
