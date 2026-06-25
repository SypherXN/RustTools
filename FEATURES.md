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
- **Live updates** — WebSocket pushes team, devices, storage, alarms, map events, and chat to open tabs
- **PWA-ready** — web app manifest + service worker for installable mobile/desktop experience

---

## Rust+ integration & pairing

- **FCM server pairing** — register once via `fcm-register`; API listens for Rust Companion push events
- **In-game Rust+ account link** — Settings flow to pair your Steam/Rust+ identity with the host
- **Smart device pairing** — wire-tool pair switches, alarms, and storage monitors; synced to the dashboard
- **Rust+ WebSocket** — live entity subscriptions with reconnect and backoff
- **FCM credential expiry warning** — admin banner when config is approaching the ~90-day refresh window
- **Granular data reset** — admin panel to clear cache, pairing, overlays, or other scopes without full wipe

---

## Web dashboard

| Page | What you get |
|------|----------------|
| **Dashboard** | Server info, population, wipe countdown, in-game time, Deep Sea status, world event summary |
| **Devices** | All paired switches, alarms, and monitors; live state; per-device settings |
| **Automations** | IFTTT-style rules, switch groups, device library, automation base point |
| **Cameras** | Live CCTV view + basic PTZ (optional; `VITE_LIVE_CAMERAS=true`) |
| **Storage** | All storage monitors, contents, upkeep/decay, cross-monitor item search |
| **Map** | Interactive map with team, monuments, markers, vending search, event dock, overlays |
| **Team** | Roster, online/AFK/dead status, positions, death history, connection log, team chat |
| **Audit** | Admin action log (device toggles, settings changes, etc.) |
| **Settings** | Rust+ link, notifications, legacy automations, server info, data management |

---

## Smart devices

### Smart switches

- Toggle on/off from web UI, Discord, or in-game chat
- **Per-device chat commands** — custom `!alias` for toggle, on, off, status
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
- Team base presence change (near/away from base point)
- Time of day (day/night)
- **Schedule window** — local time ranges (e.g. 18:00–06:00), including overnight windows
- Interval (every N minutes)

### Conditions

- Switch is on/off
- Any/all teammates online or offline
- TC upkeep below hours
- It is day / night
- Team near or away from a point (base, map pin, or custom coordinates)

### Actions

- Set or toggle a switch
- Toggle a switch group
- Send team chat message
- Send Discord message

### Other automation features

- **Automation base point** — default coordinates + radius for proximity rules
- **Night lights schedule template** — one-click rule draft for evening light windows
- **Device library** — nested folders of switches and saved CCTV bookmarks for rule building
- **Rule templates** — save and reuse rule definitions per server

### Legacy automations (Settings)

Per-server config (env vars seed defaults for new servers):

- **Night lights** — turn on configured switches at night
- **Team-offline SAM** — flip a SAM site switch when everyone goes offline
- **Map event alerts** — team chat and/or Discord for cargo, heli, chinook, vendor, oil, bradley, convoy

---

## Map & world intelligence

- **Server map** — image from Rust+ with grid overlay and zoom controls (fit-to-map floor)
- **Team positions** — live teammate markers with detail panel
- **Monuments** — labels on map; **CCTV codes** per monument in detail panel
- **Map markers** — vending machines, crates, events from Rust+
- **Smart map follow** — track a teammate from the detail panel until you pan away
- **Event dock** — track cargo, heli, chinook, vendor, bradley, convoy on the map
- **Collaborative drawings** — server-persisted pen strokes (Switch permission to draw)
- **Base pins** — notes, labels, optional screenshot upload; edit in side detail panel
- **Vending search** — find items across all shops; filter by currency, price range, deal % vs median; item icons in results
- **Connect string** — copy `client.connect ip:port` from Settings/Dashboard
- **Map seed, salt, name, size** — displayed from Rust+ server info

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

### On-demand event queries (team chat & Discord commands channel)

`!cargo` · `!heli` · `!chinook` · `!vendor` · `!bradley` · `!convoy` · `!large` · `!small` · `!events`

---

## Team & social

- **Live roster** — online, AFK, dead, alive; grid position when available
- **Team chat** — send/receive in web UI; mirrored to Discord team-chat channel
- **Discord → in-game** — `/chat` slash command; team chat prefixed with Discord username
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

Slash commands (role-gated same as web permissions):

| Command | Description |
|---------|-------------|
| `/help` | Command reference for Discord and in-game chat |
| `/status` | API and Rust+ connection health |
| `/devices` | List paired smart devices |
| `/switch` | Toggle, on, or off a switch by name or entity ID |
| `/alarm` | List smart alarms |
| `/storage` | Show a storage monitor's contents |
| `/team` | Online teammates |
| `/time` | In-game time |
| `/deepsea` | Deep Sea status and countdown |
| `/chat` | Send a message to in-game team chat |
| `/map` | Post the current server map image |
| `/pair` | FCM pairing status |
| `/link` | Start Rust+ account linking |
| `/channel show\|set\|clear` | Bind channels to notification purposes (admin) |
| `/blacklist add\|remove\|list` | Block Discord or Steam users from bot commands (admin) |

### Discord channel purposes (`/channel set`)

- **Live information board** — auto-updating embed (map, server, team, events, Deep Sea) every 60s
- **Smart alarms**
- **Team chat mirror**
- **Commands** — run `!` commands from Discord as if in team chat
- **Map events**
- **Deep Sea**
- **Storage**
- **Default** — fallback for unbound notification types

Bindings persist in the database; `.env` channel IDs remain as fallback.

### Live information board

Set a channel with `/channel set purpose:information` — one message updated every minute with population, map thumbnail, team summary, active events, and Deep Sea status.

---

## In-game chat commands

Type in **team chat** or the Discord **commands** channel (Switch permission for device commands).

### Help & team

- `!help` — multi-part command list
- `!online` · `!offline` · `!afk` · `!alive` — roster filters
- `!leader` — promote yourself to team leader (when eligible)
- `!send <discord-user> <message>` — DM a Discord teammate from in-game

### Events & world

- `!cargo` · `!heli` · `!chinook` · `!vendor` · `!bradley` · `!convoy`
- `!large` · `!small` — oil rig status and crate unlock timers
- `!events` — summary of all tracked events
- `!deepsea` · `!ds` — Deep Sea status

### Storage & TC

- `!upkeepdetail` — all linked tool cupboards with decay and upkeep projection

### Switches

- `!alias` — toggle (custom alias set on Devices or Automations)
- `!alias on` · `!alias off` · `!alias toggle` · `!alias status`
- `!alias on 60s` — timed revert

### Admin

- `!mute` · `!unmute` — stop/start bot team-chat output

Per-device aliases and switch group aliases are configured on the **Devices** and **Automations** pages.

---

## Admin & security

- **Audit log** — who changed what (devices, settings, automations)
- **Discord blacklist** — block users by Discord account or Steam ID from slash and `!` commands
- **Admin data reset** — selective clears (cache, pairing, map overlays, etc.)
- **Internal API key** — secures Discord bot → API calls
- **Session management** — logout, secure cookies, WebSocket token for cross-origin clients

---

## Operations

- **Docker Compose** deploy with Caddy reverse proxy (see [docs/SETUP.md](docs/SETUP.md))
- **Environment-based config** — Discord, Rust+, Twilio, SendGrid, VAPID, notification channels, automation defaults
- **Monorepo packages** — shared types, DB schema (Drizzle), Rust+ client library
- **Auto DB migrations** — applied when the API starts

---

## Not included (by design)

RustTools is a **single-host, self-hosted web + Discord** product. These are intentionally out of scope or deferred:

- Native desktop app, system tray, auto-update
- Cloud account sync across hosts
- Multi-tenant Rust+ credentials per Discord user
- BattleMetrics player lists and trackers
- 3D map / `.map` file resource heatmaps (server-side procgen data)
- Storage snapshot history UI, death heatmaps, loot planner, vending price graphs
- Outgoing webhooks (Home Assistant / Zapier)
- In-game `!marker` navigation (planned)
- Item/crafting reference slash commands (`/craft`, `/research`, etc.)

For a detailed comparison against rustplusplus and rustplus-desktop, see [.local/feature-gap-analysis.md](.local/feature-gap-analysis.md) (maintainer doc).
