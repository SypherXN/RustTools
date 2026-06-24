# RustTools

Self-hosted Rust companion for your team — Rust+ device control, web dashboard, and Discord bot.

## Architecture

- **Frontend** — React SPA on GitHub Pages
- **Backend** — Node.js API on your Oracle VM (Rust+ WebSocket, FCM pairing, auth)
- **Discord bot** — slash commands calling the API via internal auth

```
GitHub Pages (UI)  ──HTTPS──►  Oracle VM (Caddy → API + Discord bot)
                                    │
                                    ├── FCM ──► Rust Companion API
                                    └── WebSocket ──► Rust game server
```

## Quick Start (local dev)

See **[docs/SETUP.md](docs/SETUP.md)** for the full production deployment guide (Oracle VM, Discord, GitHub Pages, Rust+ pairing).

### Prerequisites

- Node.js 20+
- Discord application ([Discord Developer Portal](https://discord.com/developers/applications))
- Google Chrome (for one-time Rust+ FCM registration)

### Setup

```bash
git clone https://github.com/SypherXN/RustTools.git
cd RustTools
./scripts/setup.sh
# Edit .env — Discord credentials, INTERNAL_API_KEY, secrets

npm install
npm run db:migrate

npm run dev          # API :3000
npm run dev:web      # UI :5173
npm run dev:bot      # Discord bot

npm run register-commands --workspace=@rusttools/discord-bot
```

### Discord app setup

1. Create application → OAuth2 redirect: `http://localhost:5173/api/auth/discord/callback` (via Vite proxy — **not** port 3000)
2. Copy Client ID + Secret to `.env`
3. Create bot → copy token to `DISCORD_BOT_TOKEN`
4. Invite bot with `bot` + `applications.commands` scopes
5. Set `DISCORD_GUILD_ID`, `INTERNAL_API_KEY` (same value in API and bot `.env`)
6. Register slash commands (see above)

### Rust+ pairing

```bash
npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
```

In-game: Rust+ menu → **Pair with Server**, then pair devices with the wire tool.

Web: Settings → **Link Rust+ Account**, then pair in-game.

## Production (Oracle VM)

See **[docs/SETUP.md](docs/SETUP.md)** for step-by-step deploy instructions.

```bash
cp .env.example .env
# Set DOMAIN, API_PUBLIC_URL, CORS_ORIGINS, all secrets

docker compose up -d --build
```

## Features

### Rust+ Integration
- Server pairing via FCM
- Smart switches, alarms, storage monitors
- Server info, map, team positions, map markers
- Team chat send/receive (WebSocket events)
- Entity subscriptions with reconnect + backoff

### Web Dashboard
- Discord OAuth login with persistent sessions
- Dashboard, devices (live updates), storage, map, team, audit log, settings
- Rust+ account linking flow
- Cross-origin auth for GitHub Pages (cookies + WebSocket tokens)

### Discord Bot
- `/status`, `/devices`, `/switch`, `/alarm`, `/storage`
- `/team`, `/time`, `/chat`, `/map`, `/pair`, `/link`
- Role-based permissions via `DISCORD_ROLE_*` env vars (web UI + Discord bot)

### Notifications & Automations
- Raid/smart alarm → Discord channel (`DISCORD_NOTIFICATION_CHANNEL_ID`)
- Map events: Chinook, cargo ship, patrol heli — Discord + optional in-game team chat with grid location
- Deep Sea open/close tracking with timers — Dashboard, `/deepsea`, `!deepsea` in team chat
- Optional night lights + SAM-when-offline automations

## Project structure

```
apps/api/           Fastify REST + WebSocket
apps/web/           React SPA
apps/discord-bot/   Discord slash commands
packages/shared/    Types
packages/db/        Drizzle + SQLite
packages/rustplus-client/  Rust+ manager, FCM, EventBus
```

## Clone-and-deploy

Other teams can clone, fill `.env`, run `docker compose up`, and register their own FCM + Discord app.

## License

MIT
