# Home Assistant REST API — Cheat Sheet

Auth on every request: `Authorization: Bearer <long-lived-access-token>`
(`Content-Type: application/json` for POST bodies). Base URL is typically
`http://<host>:8123` (e.g. `http://homeassistant.local:8123`, `http://192.168.1.50:8123`).

## Endpoints used by the scripts

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/` | Liveness check. Returns `{"message": "API running."}` |
| GET | `/api/config` | Instance info: `version`, `state`, `unit_system`, `time_zone`, `components` |
| GET | `/api/states` | Array of all entity states |
| GET | `/api/states/<entity_id>` | Single entity state |
| POST | `/api/services/<domain>/<service>` | Call a service (device action) |
| GET | `/api/services` | Map of `domain → {service: {name, description}}` |

Entity state object:

```json
{
  "entity_id": "light.living_room",
  "state": "on",
  "attributes": { "brightness": 128, "friendly_name": "Living Room", "supported_color_modes": ["brightness"] },
  "last_changed": "2026-09-04T12:00:00.000000+00:00",
  "last_updated": "2026-09-04T12:00:00.000000+00:00"
}
```

Service call body: service data fields at the top level, with `target`
(optional) selecting entities. `entity_id` may also appear at the top level
(legacy form).

```json
{ "entity_id": "light.living_room", "brightness": 128 }
{ "target": { "area_id": "living_room" }, "transition": 2 }
```

## Other useful endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/history/period/<timestamp>` | State history (defaults to last day). `?filter_entity_id=` and `?minimal_response` supported |
| GET | `/api/logbook/<timestamp>` | Recent events (human-readable change log) |
| GET | `/api/events` | Event bus stream (SSE) |
| GET | `/api/error_log` | Server error log (admin token required) |
| POST | `/api/template` | Render a template. Body: `{"template": "{{ states('sensor.kitchen_temp') }}"}` |
| GET | `/api/calendars`, `/api/calendars/<id>` | Calendar entities and events |
| GET | `/api/config/entity_registry`, `/api/config/device_registry` | Registries (admin) |
| POST | `/api/config/core/check_config` | Validate configuration (admin) |
| POST | `/api/states/<entity_id>` | Manually set an entity's state (dev/testing) |
| GET/PUT | `/api/websocket` | WebSocket API (streaming, events, higher throughput — not used by these scripts) |

## Common service domains

| Domain | Examples | Notes |
| ------ | -------- | ----- |
| `light` | `turn_on`, `turn_off`, `toggle`, `set_brightness` | data: `brightness` (0–255), `rgb_color`, `transition` |
| `switch` | `turn_on`, `turn_off`, `toggle` | |
| `climate` | `set_temperature`, `set_hvac_mode`, `turn_on/off` | data: `temperature`, `hvac_mode` |
| `cover` | `open_cover`, `close_cover`, `set_cover_position` | **high-risk** — physical movement |
| `lock` | `lock`, `unlock`, `open` | **high-risk** — doors/locks |
| `garage_door` | `open`, `close` | **high-risk** |
| `valve` | `open_valve`, `close_valve` | **high-risk** — water/gas |
| `media_player` | `play_media`, `volume_set`, `media_play_pause` | data: `media_content_id`, `media_content_type` |
| `scene` | `turn_on` | |
| `script` | `turn_on`, `reload` | |
| `automation` | `trigger`, `turn_on/off` | |
| `notify` | `notify` | data: `message`, `title`, `target` |

## Long-lived access token

Create in the Home Assistant UI: **profile icon → Security → Long-lived
access tokens → Create Token**. Copy the value immediately — it is shown
only once. It never expires unless revoked, so treat it like a password and
store it in the assistant vault (see SKILL.md setup), never in chat.
