# RustTools

Self-hosted Rust companion for your team — Rust+ device control, live web dashboard, and Discord bot.

**Account model:** one **master bot** Rust+ connection (FCM on the server) powers devices and live data; each teammate optionally links **Steam ID** and **companion Rust+** in Settings for identity and leader promotion.

**Full feature list:** [FEATURES.md](FEATURES.md) · **Production deploy:** [docs/SETUP.md](docs/SETUP.md)

## Architecture

- **Frontend** — React SPA on GitHub Pages (or Vite dev server locally)
- **Backend** — Node.js API on your VM (Rust+ WebSocket, FCM pairing, auth)
- **Discord bot** — slash commands (embed responses) calling the API via internal auth

```
GitHub Pages (UI)  ──HTTPS──►  Oracle A1 VM (Caddy → API + Discord bot)
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

# Stop: Ctrl+C in each terminal, or kill processes on ports 3000 / 5173

npm run register-commands --workspace=@rusttools/discord-bot
npm run test:smoke     # optional API smoke tests (see FEATURES.md)
```

The API dev script sets `NODE_OPTIONS='--max-old-space-size=4096'` for procgen map parsing.

### Discord app setup

1. Create application → OAuth2 redirect: `http://localhost:5173/api/auth/discord/callback` (via Vite proxy — **not** port 3000)
2. Copy Client ID + Secret to `.env`
3. Create bot → copy token to `DISCORD_BOT_TOKEN`
4. Invite bot with `bot` + `applications.commands` scopes (Message Content Intent is **not** required)
5. Set `DISCORD_GUILD_ID`, `INTERNAL_API_KEY` (32+ characters; same value in API and bot `.env`)
6. **Production:** set at least one of `DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_SWITCH`, or `DISCORD_ROLE_VIEW` — the API refuses to start without them when `NODE_ENV=production`
7. Register slash commands (see above)

### Rust+ pairing (three tiers)

RustTools separates the **24/7 bot account** from **per-user identity** and **optional companion credentials**:

| Tier | Who | Where in UI | Purpose |
|------|-----|-------------|---------|
| **Master bot** | Admin | **Settings → Server & Map → Master Bot Server Pair** | 24/7 Rust+ WebSocket for devices, team, map, automations |
| **Steam identity** | Anyone (View+) | **Settings → Account → Steam Identity** | Links Discord → Steam ID for `!leader` and command identity |
| **Companion Rust+** | Optional (View+) | **Settings → Account → Companion Rust+** | Lets the bot promote via your account when you are in-game leader |

**Master bot** uses the server FCM config (`fcm-config.json`). **Companion** credentials are stored encrypted on your user row only — they do **not** replace or disconnect the master bot.

**Option A — CLI (one-time on a machine with Chrome):**

```bash
npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
```

Restart the API if it was already running. Use the **same Steam account** as the dedicated bot / Rust+ phone.

**Option B — Web upload (admin):** run `fcm-register` locally, then **Settings → Admin → FCM credentials** and upload `fcm-config.json`. The API saves it and restarts the FCM listener.

**In-game (master):** Rust+ menu → **Pair with Server** (after admin starts **Master Bot Server Pair**), then pair devices with the wire tool. In production, unprompted server pairs are rejected — the admin must start **Re-pair Server** first.

**Teammates:** **Settings → Account** → enter Steam ID (F1 `player.id`) or link optional companion Rust+ with locally generated credentials — no server FCM required.

FCM credentials expire after ~90 days; admins see a warning banner within 14 days of expiry and full status in **Settings → Admin**.

### Procgen map (optional, unlocks 3D + heatmaps)

In **Settings → Server & Map**, upload the server’s `.map` file from your Rust client cache after joining, or from in-game F1 → `Download map file`. This enables building-blocked overlays, resource heatmaps, roads/caves on the map, and the **3D** view.

On production (Oracle **A1 12 GB**), parsing uses an isolated child process (default **4 GB** heap). Local dev uses a larger in-process heap via `npm run dev`.

### Server automation base (optional)

Admins can define a **server base** for proximity automations and map visualization:

1. **Automations → Server base location** — enter coordinates, pick a map pin, set **Radius (m)**, or click **Pick on map**
2. **Map → Set server base** — click the map, set label and radius, save
3. Enable the **Server base** layer on the map to see the circular zone (2D and 3D)

Default proximity radius is **150 m** (circular world distance). Each automation rule can override with its own **Radius (m)** on proximity triggers/conditions.

### Live cameras (optional)

The **Cameras** page is enabled by default. Remote CCTV requires the server owner to run `cctvrender.enabled true` in the server console (usually off on public servers). Set `VITE_LIVE_CAMERAS=false` at web build time to hide the nav item.

## Production (Oracle A1)

Target layout: **Ampere A1** with **2 OCPU · 12 GB RAM** (Oracle Always Free). UI stays on **GitHub Pages**; the VM runs API + Discord bot + Caddy only.

See **[docs/SETUP.md](docs/SETUP.md)** for step-by-step deploy instructions.

```bash
cp .env.example .env
./scripts/setup.sh   # generates SESSION_SECRET + ENCRYPTION_KEY
# Set DOMAIN, API_PUBLIC_URL, CORS_ORIGINS, FRONTEND_URL, Discord credentials,
# DISCORD_GUILD_ID, DISCORD_ROLE_* (at least one), INTERNAL_API_KEY (32+ chars)
# PROCGEN_PARSE_HEAP_MB defaults to 4096 in docker-compose.yml

docker compose up -d --build
```

**GitHub Pages:** set repository variable `VITE_API_URL` to your API origin (e.g. `https://rusttools.yourdomain.com`, no trailing slash). The Pages workflow **fails the build** if this variable is missing.

**Production startup checks:** with `NODE_ENV=production`, the API exits on boot if secrets use dev defaults, `DISCORD_GUILD_ID` is unset, no Discord role env vars are set, `INTERNAL_API_KEY` is missing/short, or `RUSTPLUS_ALLOW_UNPROMPTED_PAIR=true`.

**Other services** (e.g. a household Discord bot) can run on a separate **E2.1.Micro** without using the A1 memory pool.

## Highlights

| Area | What you get |
|------|----------------|
| **Rust+** | Gated master FCM pairing (prod), per-user Steam + companion links, switches/alarms/storage, map/team/markers, reconnect + read caching |
| **Web UI** | Dashboard, devices (live ON/OFF badges, explicit On/Off controls), storage, 2D/3D map, server base zone, live team chat, automations, cameras, audit, settings |
| **Map** | Live Rust+ map, server base overlay, optional procgen `.map` layers (heatmaps, no-build zones, 3D terrain) |
| **Automations** | IFTTT rules, switch groups, server base + configurable proximity radius (meters) |
| **Discord** | Slash commands with embeds, live info board, channel bindings, team chat mirror |
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
