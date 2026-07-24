# Run automatically on macOS

Deploy Light uses two optional user LaunchAgents:

1. The Node daemon.
2. A Hookdeck CLI listener when Hookdeck is the route into localhost.

LaunchAgents run after the user logs in. They do not run at the macOS login
screen.

## Prepare the server

```bash
cd /absolute/path/to/deploy-light/server
cp .env.example .env
npm ci --omit=dev
command -v node
```

Edit `.env` before continuing. Keep `HOST=127.0.0.1` when using the Hookdeck
CLI listener.

## Node daemon

Copy `server/com.deploy-light.server.plist.example` to
`~/Library/LaunchAgents/com.deploy-light.server.plist`. Replace:

- `/ABSOLUTE/PATH/TO/node` with the result of `command -v node`.
- `/ABSOLUTE/PATH/deploy-light` with the repository's absolute path.

Validate and load it:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.deploy-light.server.plist"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.deploy-light.server.plist"
```

Inspect it and follow logs:

```bash
launchctl print "gui/$(id -u)/com.deploy-light.server"
tail -f /tmp/deploy-light.stdout.log /tmp/deploy-light.stderr.log
```

## Hookdeck CLI listener

Install and authenticate the Hookdeck CLI, then prove the foreground command
works before automating it:

```bash
hookdeck login
hookdeck listen 3000 deploy-light \
  --path /hookdeck \
  --output compact \
  --color off
```

The source alias (`deploy-light`) must match the source created in the active
Hookdeck project.

Some Hookdeck CLI releases query terminal capabilities even in compact mode.
The included `server/scripts/hookdeck-listen.exp` wrapper answers those queries
when no terminal exists.

Copy `server/com.deploy-light.hookdeck.plist.example` to
`~/Library/LaunchAgents/com.deploy-light.hookdeck.plist`, then replace:

- `/Users/YOU`
- `/ABSOLUTE/PATH/TO/hookdeck`
- `/ABSOLUTE/PATH/deploy-light`
- `HOOKDECK_SOURCE` when using a different source alias

Validate and load it:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.deploy-light.hookdeck.plist"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.deploy-light.hookdeck.plist"
```

If macOS privacy controls prevent a LaunchAgent from reading a repository under
`Documents`, copy the Expect script to
`~/Library/Application Support/Deploy Light/` and update the plist path.

## Reload or remove

After changing a plist, boot it out and bootstrap it again:

```bash
launchctl bootout "gui/$(id -u)/com.deploy-light.server"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.deploy-light.server.plist"
```

Repeat with `com.deploy-light.hookdeck` for the CLI listener. Removing a
LaunchAgent requires booting it out and deleting its copied plist; it does not
remove the repository or firmware.
