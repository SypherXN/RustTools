# RustTools Features

Self-hosted Rust companion for your team — Rust+ device control, live web dashboard, and Discord bot. One host pairs with Rust+; teammates use Discord roles and the shared web UI.

---

## Platform & access

- **Self-hosted API** — Node.js backend on your VM (or local dev); SQLite database with auto migrations on startup
- **Web dashboard** — React SPA (GitHub Pages or same-origin deploy)
- **Discord OAuth login** — persistent sessions; cross-origin auth for GitHub Pages (cookies + WebSocket tokens)
- **Role-based permissions** — three tiers mapped from Discord roles:
  - **View** — read dashboard, map, team, storage
  - **Switch** — control devices, send team chat, run switch commands
  - **Admin** — settings, automations, audit log, data reset, notification config
- **Multi-server support** — pair multiple Rust servers; activate one at a time
- **Demo mode** — try the UI without a live Rust+ connection (`?demo=1`)
- **Live updates** — WebSocket pushes team, devices (including smart switch ON/OFF), storage, alarms, map events, camera frames, and chat to open tabs
- **PWA-ready** — web app manifest + service worker for installable mobile/desktop experience
- **API rate limiting** — configurable per-IP limit (default 600 req/min via `API_RATE_LIMIT_MAX`); `/health` is exempt

---

## Rust+ integration & pairing

- **FCM server pairing** — register via `fcm-register`, or upload `fcm-config.json` in **Settings → Admin** (listener restarts automatically)
- **In-game Rust+ account link** — Settings flow to pair your Steam/Rust+ identity with the host
- **Smart device pairing** — wire-tool pair switches, alarms, and storage monitors; synced to the dashboard
- **Rust+ WebSocket** — live entity subscriptions with reconnect and backoff
- **Rust+ read caching** — TTL cache and in-flight dedup on map/team/info/markers/time requests to reduce Facepunch rate limits
- **FCM credential expiry** — admin banner when config is missing, expired, or within 14 days of the ~90-day refresh window; full status (registered/expiry/days left) always shown in **Settings → Admin**
- **Granular data reset** — admin panel to clear cache, pairing, overlays, or other scopes without full wipe

---

## Web dashboard

| Page | What you get |
|------|----------------|
| **Dashboard** | Server info, population, wipe countdown, in-game time, Deep Sea status, world event summary |
| **Devices** | Paired switches, alarms, monitors; **ON/OFF badges**; **On** / **Off** / **Toggle** controls (explicit state); per-device settings |
| **Automations** | IFTTT-style rules, switch groups, device library, server base location + proximity radius |
| **Cameras** | Live CCTV / auto-turret view, PTZ controls, saved camera bookmarks (on by default; set `VITE_LIVE_CAMERAS=false` to hide) |
| **Storage** | All storage monitors, contents, upkeep/decay, cross-monitor item search |
| **Map** | 2D and 3D map, server base zone, team, monuments, markers, vending search, event dock, procgen overlays, drawings, pins |
| **Team** | Roster, online/AFK/dead status, positions, death/connection logs, **live scrollable team chat** |
| **Audit** | Admin action log (device toggles, settings changes, etc.) |
| **Settings** | Rust+ link, notifications (tabbed), procgen `.map` upload, legacy automations, FCM upload (admin) |

---

## Smart devices

### Smart switches

- Toggle on/off from web UI, Discord, or in-game chat
- **Devices page controls** — **On** and **Off** set the switch to that state; **Toggle** flips the current value (same for switch groups)
- **Live state on Devices page** — each switch shows an **ON** / **OFF** / **Unknown** badge (read from Rust+ via `getEntityInfo`)
- **In-game toggles push to the web UI** — Rust+ `entityChanged` broadcasts update open dashboard tabs over WebSocket (requires Rust+ connected and the device paired/subscribed)
- **Per-device chat commands** — custom `!alias` for toggle, on, off, **status**
- **Timed actions** — `!alias on 60s` auto-reverts after a delay
- **Auto modes** — on at night, on at day, always on/off, on when any teammate online, proximity-based
- **Switch groups** — control multiple switches together; group-level chat aliases
- **Quick group toggle** — name-based group on Devices page

### Smart alarms

- Raid alerts from FCM → Discord, team chat, web push, browser siren
- **Per-alarm settings** — custom broadcast message, `@everyone` override
- **Escalation** — optional SMS (Twilio) and email (SendGrid) after Discord
- **Last triggered timestamp** stored per alarm

### Storage monitors

- Live contents and capacity from Rust+
- **TC decay monitoring** — proactive Discord/team chat warnings at configurable hour thresholds
- **Discord embeds** on storage change with inline recycle button
- **`!upkeepdetail`** — all linked TCs with decay time, upkeep slots, and ~24h resource projection
- Storage snapshot history written to DB (UI for timeline/diff not yet built)

---

## Automations

Rule builder with triggers, optional conditions, and actions — saved per server with reusable templates.

### Triggers

- Smart alarm triggered
- Storage monitor changed
- TC upkeep below threshold
- Teammate came online / whole team went offline
- Team base presence change (near/away from base point, configurable circular radius)
- Time of day (day/night)
- **Schedule window** — local time ranges (e.g. 18:00–06:00), including overnight windows
- Interval (every N minutes)

### Conditions

- Switch is on/off
- Any/all teammates online or offline
- TC upkeep below hours
- It is day / night
- Team near or away from a point (server base, map pin, or custom coordinates)
- **Proximity radius** — circular distance in **world meters** (0–10,000 m); per-rule override or inherit server default

### Actions

- Set or toggle a switch
- Toggle a switch group
- Send team chat message
- Send Discord message

### Server base & proximity

- **Server base location** — shared default point for proximity rules (per active server, admin-only to edit)
- **Set on the map** — **Map → Set server base** (or **Automations → Pick on map**): click the map, name the base, set radius in meters
- **Link a map pin** — open a pin’s detail panel → **Set as server base**, or choose a pin on the Automations page
- **Manual coordinates** — world X/Y on **Automations → Server base location**
- **Configurable radius** — `radiusMeters` in world units (default **150 m**); editable on Automations, per rule, when placing base on the map, and in the map layers panel (admin)
- **Circular distance** — proximity uses Euclidean world distance (not grid-cell Chebyshev); map overlay shows an accurate circle on 2D and 3D
- **Per-rule override** — triggers/conditions that use “Server base” inherit the server default radius until you set their own **Radius (m)** field

### Other automation features

- **Night lights schedule template** — one-click rule draft for evening light windows
- **Device library** — nested folders of switches and saved CCTV bookmarks for rule building
- **Rule templates** — save and reuse rule definitions per server

### Live cameras (Cameras page)

- Subscribe to monument CCTV IDs (e.g. `DOME1`, `OILRIG1L1`) or player-placed PTZ / auto-turret names from the Computer Station
- Stylized idle / connecting placeholder; live PNG frames over WebSocket once subscribed
- Direction pad for PTZ; fire button for controllable auto turrets
- **Requires** server owner to run `cctvrender.enabled true` in the server console (off on most public servers)
- Only one remote viewer at a time per camera (same as in-game Rust+)

### Legacy automations (Settings)

Per-server config (env vars seed defaults for new servers):

- **Night lights** — turn on configured switches at night
- **Team-offline SAM** — flip a SAM site switch when everyone goes offline
- **Map event alerts** — team chat and/or Discord for cargo, heli, chinook, vendor, oil, bradley, convoy

---

## Map & world intelligence

### Rust+ live map (2D)

- **Server map** — image from Rust+ with grid overlay and zoom controls (fit-to-map floor)
- **Team positions** — live teammate markers with detail panel; cluster picker when markers overlap
- **Monuments** — labels on map; **CCTV codes** per monument in detail panel
- **Map markers** — vending machines, crates, events from Rust+
- **Smart map follow** — track a teammate or world event from the detail panel / event dock until you pan away (2D and 3D)
- **Event dock** — track cargo, heli, chinook, vendor, bradley, convoy on the map
- **Collaborative drawings** — server-persisted pen strokes (Switch permission to draw)
- **Team pins** — notes, labels, optional screenshot upload; edit in side detail panel; can be linked as the server automation base
- **Server base zone** — blue circular overlay when the **Server base** layer is enabled (2D and 3D); **Focus base** in the layers panel
- **Set server base** (admin) — toolbar button or `/map?setBase=1`; click map to place, configure label and radius before saving
- **Vending search** — find items across all shops; filter by currency, price range, deal % vs median; item icons in results
- **Connect string** — copy `client.connect ip:port` from Settings/Dashboard
- **Map seed, salt, name, size** — displayed from Rust+ server info
- **Live refresh** — team and markers update via WebSocket; periodic live poll with staggered Rust+ reads to avoid rate limits

### Procgen map (`.map` upload)

Upload the server’s procgen `.map` file in **Settings → Server & Map** to unlock terrain-derived layers (not available from Rust+ alone):

- **Where to get the file** — Rust client cache after joining the server, or in-game F1 → `Download map file`
- **Building-blocked zones** — overlay for no-build areas
- **Resource heatmaps** — ores, stones, sulfur
- **Roads and rail paths** — extracted path network
- **Caves and icebergs** — prefab markers from map data
- **Parse status** — seed/world-size match warnings vs active server
- **3D map view** — terrain mesh, water, procgen overlays, team/markers/paths, **server base zone** (requires uploaded `.map`)

### 3D map

- Toggle **2D / 3D** on the Map page when procgen data is ready
- **Server base** — same circular proximity zone and center marker as 2D (toggle **Server base** layer)
- Orbit/pan/zoom camera with view persisted across updates
- Click-to-select markers with the same cluster detail panel as 2D
- Zoom-to-selection when picking a marker; smooth tracking for followed teammates and dock events
- Render-on-demand and split static/dynamic scene for smoother panning with live data

---

## Events & timers

### World event tracking

Automated spawn/despawn alerts to Discord and optional team chat (grid + coordinates):

- Cargo ship (with path trail and egress countdown)
- Patrol helicopter (trail, downed detection, time-since stats)
- Chinook
- Traveling vendor
- Bradley APC
- Convoy
- Oil rig triggers (small/large) with locked crate unlock countdown and reminders

### Deep Sea

- Open/close phase detection from map markers and monuments
- Dashboard card, Discord alerts, `/deepsea`, `!deepsea` / `!ds`

### Configurable timers (Settings → Event Timers)

- Cargo egress duration
- Oil rig crate unlock offset and reminder intervals
- Oil rig proximity detection radius

### On-demand event queries (team chat & Discord slash commands)

In-game: `!cargo` · `!heli` · `!chinook` · `!vendor` · `!bradley` · `!convoy` · `!large` · `!small` · `!events`

Discord: matching slash commands (`/cargo`, `/events`, etc.) — see [Discord bot](#discord-bot) below.

---

## Team & social

- **Live roster** — online, AFK, dead, alive; grid position when available
- **Team chat (web)** — send and receive on the Team page; feed has a **fixed height and scrolls** as messages accumulate
- **Instant send feedback** — messages you post from the web UI (or Discord `/chat`) appear immediately via WebSocket, without refreshing
- **Team chat mirror** — in-game messages mirrored to Discord team-chat channel
- **Web → in-game** — Team page or Discord `/chat`; outbound text is prefixed with sender name in-game (`[DiscordUser] message`)
- **Death log** — recent deaths with grid and timestamp on Team page
- **Connection log** — join/disconnect history (Discord + web; no `!connections` command)
- **Promote leader** — web UI or `!leader` in team chat when RustTools holds current leader
- **`!send`** — route an in-game message to a specific Discord user via DM
- **Roster commands** — `!online` · `!offline` · `!afk` · `!alive`
- **Bot mute** — admins: `!mute` / `!unmute` or Settings → Team Chat Bot
- **Command anti-spam** — configurable delay between bot command executions

---

## Notifications & alerts

| Alert type | Channels |
|------------|----------|
| Smart alarm (raid) | Discord, team chat, web push, browser siren, SMS/email escalation |
| TC decay | Discord, team chat, optional `@everyone` |
| Deep Sea open/close | Discord, team chat |
| Map events | Discord, team chat (per-type filter) |
| Storage changes | Discord embed with recycle action |

### Smart alarm delivery options (Settings)

- Discord channel (via `/channel set purpose:alarms` or env)
- In-game team chat
- `@everyone` on Discord (global default + per-alarm override)
- Web push (PWA background notifications; requires VAPID keys)
- Browser siren when tab is open
- SMS and email escalation lists (Twilio + SendGrid on API)

### Web push setup

- Subscribe from Settings → Smart Alarm → Enable push notifications
- Requires `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` on the API

---

## Discord bot

Slash commands (role-gated same as web permissions). Responses use **Discord embeds** for readable output (team roster, world events, switch results, storage, etc.).

| Command | Description |
|---------|-------------|
| `/help` | Command reference (embed with grouped fields) |
| `/status` | API and Rust+ connection health |
| `/devices` | List paired smart devices (grouped by type) |
| `/switch` | Set on, off, or toggle a switch by name or entity ID |
| `/alias` | Run a configured switch chat alias (on/off/toggle/**status**, optional timed revert) |
| `/alarm` | List smart alarms |
| `/storage` | Show a storage monitor's contents (formatted, not raw JSON) |
| `/team` | Team roster with online status and grid |
| `/time` | In-game time and day/night phase |
| `/deepsea` | Deep Sea status and countdown |
| `/chat` | Send a message to in-game team chat |
| `/send` | DM a linked Discord teammate |
| `/map` | Post the current server map image |
| `/online` `/offline` `/afk` `/alive` | Roster filters (same as in-game `!` commands) |
| `/leader` | Promote yourself to team leader |
| `/cargo` `/heli` `/chinook` `/vendor` `/bradley` `/convoy` `/large` `/small` `/events` | World event status |
| `/upkeep` | Tool cupboard upkeep report |
| `/mute` `/unmute` | Mute/unmute RustTools bot in team chat (admin) |
| `/pair` | FCM pairing status |
| `/link` | Start Rust+ account linking |
| `/channel show\|set\|clear` | Bind channels to notification purposes (admin) |
| `/blacklist add\|remove\|list` | Block Discord or Steam users from bot commands (admin) |

In Discord, use **slash commands only** — do not type `!` commands in a channel. In-game team chat still uses the `!` prefix.

To check switch state in Discord: `/alias name:<your-alias> action:status` (alias must be configured on Devices or Automations).

### Discord channel purposes (`/channel set`)

- **Live information board** — auto-updating embed (map, server, team, events, Deep Sea) every 60s
- **Smart alarms**
- **Team chat mirror**
- **Commands channel** — optional channel binding (legacy); all bot commands are **slash commands**, not typed `!` messages in Discord
- **Map events**
- **Deep Sea**
- **Storage**
- **Default** — fallback for unbound notification types

Bindings persist in the database; `.env` channel IDs remain as fallback.

### Live information board

Set a channel with `/channel set purpose:information` — one message updated every minute with population, map thumbnail, team summary, active events, and Deep Sea status.

---

## In-game chat commands

Type in **team chat**, or use matching **slash commands** in Discord (Switch permission for device commands).

### Help & team

- `!help` — multi-part command list
- `!online` · `!offline` · `!afk` · `!alive` — roster filters
- `!leader` — promote yourself to team leader (when eligible)
- `!send <discord-user> <message>` — DM a Discord teammate from in-game

### Events & world

- `!cargo` · `!heli` · `!chinook` · `!vendor` · `!bradley` · `!convoy` · `!bradley` · `!convoy`
- `!large` · `!small` — oil rig status and crate unlock timers
- `!events` — summary of all tracked events
- `!deepsea` · `!ds` — Deep Sea status

### Storage & TC

- `!upkeepdetail` — all linked tool cupboards with decay and upkeep projection

### Switches

- `!alias` — toggle (custom alias set on Devices or Automations)
- `!alias on` · `!alias off` · `!alias toggle` · `!alias status` — **status** reads live ON/OFF from Rust+
- `!alias on 60s` — timed revert

On the **web Devices** page, switch state is shown as an ON/OFF badge and updates when you toggle from the UI, from Discord, from in-game chat, or when someone flips the switch manually in-game (via Rust+ push).

### Admin

- `!mute` · `!unmute` — stop/start bot team-chat output

Per-device aliases and switch group aliases are configured on the **Devices** and **Automations** pages.

---

## Admin & security

- **Audit log** — who changed what (devices, settings, automations, FCM config uploads)
- **Discord blacklist** — block users by Discord account or Steam ID from slash commands and in-game `!` commands
- **Admin data reset** — selective clears (cache, pairing, map overlays, procgen data, etc.)
- **FCM config upload** — replace pairing credentials without shell access; shows expiry countdown
- **Internal API key** — secures Discord bot → API calls
- **Session management** — logout, secure cookies, WebSocket token for cross-origin clients

---

## Operations

- **Docker Compose** deploy with Caddy reverse proxy (see [docs/SETUP.md](docs/SETUP.md))
- **Environment-based config** — Discord, Rust+, Twilio, SendGrid, VAPID, notification channels, automation defaults, `API_RATE_LIMIT_MAX`
- **Monorepo packages** — shared types, DB schema (Drizzle), Rust+ client library
- **Auto DB migrations** — applied when the API starts
- **Smoke tests** — `npm run test:smoke` (API health, auth, routes; optional live Rust+ checks when configured)

---

## Not included (by design)

RustTools is a **single-host, self-hosted web + Discord** product. These are intentionally out of scope or deferred:

- Native desktop app, system tray, auto-update
- Cloud account sync across hosts
- Multi-tenant Rust+ credentials per Discord user
- BattleMetrics player lists and trackers
- Base footprint planner UI (API exists; web editor not built)
- Storage snapshot history UI, death heatmaps, loot planner, vending price graphs
- Outgoing webhooks (Home Assistant / Zapier)
- In-game `!marker` navigation (planned)
- Item/crafting reference slash commands (`/craft`, `/research`, etc.)
- Browser file picker opening directly to the Rust `.map` cache folder (blocked by browser security)

For a detailed comparison against rustplusplus and rustplus-desktop, see [.local/feature-gap-analysis.md](.local/feature-gap-analysis.md) (maintainer doc).
