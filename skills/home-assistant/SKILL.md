---
name: home-assistant
description: Control and query a Home Assistant smart home over its REST API — list entity states, check device status, and call services to control lights, switches, locks, thermostats, media players, covers, and other devices. Includes secure setup of the long-lived access token.
compatibility: "Designed for Vellum personal assistants. Requires Bun for the CLI scripts and network access to the user's Home Assistant instance."
metadata:
  icon: assets/icon.svg
  emoji: "🏠"
  vellum:
    category: "integration"
    display-name: "Home Assistant"
    user-invocable: true
---

Control and query the user's Home Assistant smart home (lights, switches, locks, thermostats, media, sensors) via the Home Assistant REST API. All operations go through two CLI scripts in `scripts/` that return JSON:

- **Success**: `{ "ok": true, "data": ... }`
- **Failure**: `{ "ok": false, "error": "..." }` (exit 1)
- **User-cancelled confirmation**: `{ "ok": false, "cancelled": true }` (exit 0)

## Script Reference

| Command | Description |
| ------- | ----------- |
| `ha-list.ts states [entity-id] [--domain <d>]` | List all entity states, optionally filtered by entity ID/glob (`light.*`) or domain |
| `ha-list.ts entity <entity-id>` | Get a single entity's state and attributes |
| `ha-list.ts services [--domain <d>]` | List available services grouped by domain |
| `ha-list.ts domains` | List integration domains that expose services |
| `ha-list.ts info` | Connectivity + instance version/config check |
| `ha-control.ts call <domain> <service> [--data <json>] [--target <json>] [--entity-id <id>] [--confirm]` | Call a Home Assistant service (device action) |

Examples:

```bash
# Read state
bun run scripts/ha-list.ts states
bun run scripts/ha-list.ts states "light.*"
bun run scripts/ha-list.ts entity light.living_room
bun run scripts/ha-list.ts info

# Control devices
bun run scripts/ha-control.ts call light turn_on --entity-id light.living_room
bun run scripts/ha-control.ts call light turn_on --data '{"brightness":128}' --target '{"entity_id":"light.living_room"}'
bun run scripts/ha-control.ts call media_player volume_set --entity-id media_player.living_room --data '{"volume_level":0.5}'

# High-risk actions MUST pass --confirm
bun run scripts/ha-control.ts call lock unlock --entity-id lock.front_door --confirm
```

## Configuration Resolution

The scripts resolve connection settings in this order (first hit wins):

| Setting | Sources |
| ------- | ------- |
| Base URL | `--base-url` flag → `HA_BASE_URL` env var → `assistant config get integrations.homeassistant.base_url` → assistant vault credential `homeassistant`/`base_url` |
| Token | `--token` flag → `HA_TOKEN` env var → assistant vault credential `homeassistant`/`token` |

If neither is set, the script prints a setup hint and exits 1. The scripts
are portable outside Vellum: `HA_BASE_URL` + `HA_TOKEN` environment
variables work with plain Bun.

## One-Time Setup

Check connectivity first: `bun run scripts/ha-list.ts info`. If the scripts
report a missing URL or token, run setup:

1. **Get the URL and token from the user** (never pasted into chat for the token):
   - Base URL: ask the user for their Home Assistant address (typically
     `http://homeassistant.local:8123`, or `http://<lan-ip>:8123`). This is
     **not a secret** — collect it conversationally and store it with:

     ```bash
     assistant config set integrations.homeassistant.base_url http://homeassistant.local:8123
     ```

   - Token: the user creates a **long-lived access token** in Home Assistant
     (profile icon → Security → Long-lived access tokens → Create Token),
     then pastes it into a secure prompt (the value never enters the chat):

     ```bash
     assistant credentials prompt --service homeassistant --field token \
       --label "Home Assistant Access Token" \
       --placeholder "eyJhbGciOi..." \
       --description "Long-lived access token created in Home Assistant under your profile → Security. Used to read device states and call services."
     ```

     **Exit code handling:** `0` = token stored; `130` = the user dismissed
     the prompt — a valid choice, nothing was stored. Ask whether they want
     to try again. Any other non-zero exit is a real error.

2. **Verify** with `bun run scripts/ha-list.ts info` — it should print the
   instance version and `"connected": true`.

## Safety Rules

Controlling devices acts on the real world. Follow these rules:

- **Always tell the user what you're about to control** before calling a service, and report the result afterwards.
- **High-risk domains require `--confirm`**: `lock` (lock/unlock), `garage_door`, `valve` (water/gas), and any `open_cover`/`open` service that moves a physical barrier (doors, gates, windows). The script then gates on an explicit `assistant ui confirm` dialog.
- **Never run destructive or irreversible services without confirmation** (e.g. `homeassistant.restart`, `script`/`automation` reloads mid-operation, turning off security systems).
- **Reversible comfort controls** (lights, media, climate) still deserve a brief heads-up, but don't require the confirmation dialog unless the user asked for a blanket policy.
- When the user asks about device state ("is the garage door open?"), prefer read-only `ha-list.ts` commands.
- If a script fails with an auth error (HTTP 401), the token was likely revoked — walk the user through re-creating it (setup above), don't retry blindly.

## Limitations

- REST only — no WebSocket, no event subscriptions. For standing monitors, poll `ha-list.ts states` on a schedule.
- Long-lived tokens have full access to the instance; they are only sent to the configured base URL over the user's network.
