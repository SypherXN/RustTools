# RustTools

Self-hosted Rust companion for your team — Rust+ device control, live web dashboard, and Discord bot.

**Full feature list:** [FEATURES.md](FEATURES.md) · **Production deploy:** [docs/SETUP.md](docs/SETUP.md)

## Architecture

- **Frontend** — React SPA on GitHub Pages (or Vite dev server locally)
- **Backend** — Node.js API on your VM (Rust+ WebSocket, FCM pairing, auth)
- **Discord bot** — slash commands calling the API via internal auth

```
GitHub Pages (UI)  ──HTTPS──►  Oracle VM (Caddy → API + Discord bot)
                                    │
                                    ├── FCM ──► Rust Companion API
                                    └── WebSocket ──► Rust game server
```

## Quick start (local dev)

See **[docs/SETUP.md](docs/SETUP.md)** for the full production deployment guide (Oracle VM, Discord, GitHub Pages, Rust+ pairing).

### Prerequisites

- Node.js 20+
- Discord application ([Discord Developer Portal](https://discord.com/developers/applications))
- Google Chrome (for one-time Rust+ FCM registration, unless you upload an existing config)

### Setup

```bash
git clone https://github.com/SypherXN/RustTools.git
cd RustTools
./scripts/setup.sh
# Edit .env — Discord credentials, INTERNAL_API_KEY, secrets

npm install
npm run db:migrate

npm run dev          # API http://localhost:3000
npm run dev:web      # UI http://localhost:5173 (proxies /api)
npm run dev:bot      # Discord bot

npm run register-commands --workspace=@rusttools/discord-bot
npm run test:smoke     # optional API smoke tests (see FEATURES.md)
```

The API dev script sets `NODE_OPTIONS='--max-old-space-size=4096'` for procgen map parsing.

### Discord app setup

1. Create application → OAuth2 redirect: `http://localhost:5173/api/auth/discord/callback` (via Vite proxy — **not** port 3000)
2. Copy Client ID + Secret to `.env`
3. Create bot → copy token to `DISCORD_BOT_TOKEN`
4. Invite bot with `bot` + `applications.commands` scopes
5. Set `DISCORD_GUILD_ID`, `INTERNAL_API_KEY` (same value in API and bot `.env`)
6. Register slash commands (see above)

### Rust+ pairing

**Option A — CLI (one-time on a machine with Chrome):**

```bash
npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
```

Restart the API if it was already running.

**Option B — Web upload (admin):** run `fcm-register` locally, then **Settings → Admin → FCM credentials** and upload `fcm-config.json`. The API saves it and restarts the FCM listener.

In-game: Rust+ menu → **Pair with Server**, then pair devices with the wire tool.

Web: **Settings → Account** → **Link Rust+ Account**, then pair in-game.

FCM credentials expire after ~90 days; admins see a warning banner within 14 days of expiry and full status in **Settings → Admin**.

### Procgen map (optional, unlocks 3D + heatmaps)

In **Settings → Server & Map**, upload the server’s `.map` file from your Rust client cache after joining, or from in-game F1 → `Download map file`. This enables building-blocked overlays, resource heatmaps, roads/caves on the map, and the **3D** view.

### Server automation base (optional)

Admins can define a **server base** for proximity automations and map visualization:

1. **Automations → Server base location** — enter coordinates, pick a map pin, set **Radius (m)**, or click **Pick on map**
2. **Map → Set server base** — click the map, set label and radius, save
3. Enable the **Server base** layer on the map to see the circular zone (2D and 3D)

Default proximity radius is **150 m** (circular world distance). Each automation rule can override with its own **Radius (m)** on proximity triggers/conditions.

### Live cameras (optional)

The **Cameras** page is enabled by default. Remote CCTV requires the server owner to run `cctvrender.enabled true` in the server console (usually off on public servers). Set `VITE_LIVE_CAMERAS=false` at web build time to hide the nav item.

## Production (Oracle VM)

See **[docs/SETUP.md](docs/SETUP.md)** for step-by-step deploy instructions.

```bash
cp .env.example .env
# Set DOMAIN, API_PUBLIC_URL, CORS_ORIGINS, all secrets

docker compose up -d --build
```

## Highlights

| Area | What you get |
|------|----------------|
| **Rust+** | FCM pairing, switches/alarms/storage, map/team/markers, reconnect + read caching |
| **Web UI** | Dashboard, devices, storage, 2D/3D map, server base zone, team chat, automations, cameras, audit, settings |
| **Map** | Live Rust+ map, server base overlay, optional procgen `.map` layers (heatmaps, no-build zones, 3D terrain) |
| **Automations** | IFTTT rules, switch groups, server base + configurable proximity radius (meters) |
| **Discord** | Slash commands, live info board, channel bindings, team chat mirror, `!` commands |
| **Alerts** | Raids, TC decay, Deep Sea, world events, storage changes — Discord, team chat, push, SMS/email |

Demo the UI without a backend: `npm run dev:web:demo` or open the app with `?demo=1`.

## Project structure

```
apps/api/                 Fastify REST + WebSocket
apps/web/                 React SPA
apps/discord-bot/         Discord slash commands
packages/shared/          Shared types and constants
packages/db/              Drizzle + SQLite
packages/rustplus-client/ Rust+ manager, FCM, EventBus, cameras
```

## Clone-and-deploy

Other teams can clone, fill `.env`, run `docker compose up`, register FCM (CLI or web upload), and configure their own Discord app.

## License

MIT
