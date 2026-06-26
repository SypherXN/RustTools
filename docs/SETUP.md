# RustTools — Deployment Guide

Step-by-step instructions to deploy RustTools end-to-end: Discord app, GitHub Pages frontend, Oracle VM backend (API + bot), Rust+ pairing, and verification.

For a quick local dev start, see the [README](../README.md).

---

## Table of contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Prerequisites checklist](#2-prerequisites-checklist)
3. [Discord application setup](#3-discord-application-setup)
4. [GitHub repository setup](#4-github-repository-setup)
5. [Oracle Cloud VM setup](#5-oracle-cloud-vm-setup)
6. [Domain and DNS](#6-domain-and-dns)
7. [Configure environment variables](#7-configure-environment-variables)
8. [Deploy with Docker Compose](#8-deploy-with-docker-compose)
9. [Rust+ FCM registration](#9-rust-fcm-registration)
10. [Pair your server and devices](#10-pair-your-server-and-devices)
11. [Register Discord slash commands](#11-register-discord-slash-commands)
12. [Verify everything works](#12-verify-everything-works)
13. [Updating after deploy](#13-updating-after-deploy)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. What you are deploying

RustTools splits across two hosts:

| Component | Where it runs | Purpose |
|-----------|---------------|---------|
| **Web UI** | GitHub Pages | React dashboard (login, devices, map, etc.) |
| **API** | Your VM (Docker) | REST + WebSocket, Rust+ connection, FCM listener, auth |
| **Discord bot** | Your VM (Docker) | Slash commands → internal API |
| **Caddy** | Your VM (Docker) | HTTPS reverse proxy for the API |

```
Browser (GitHub Pages)
    │  HTTPS + cookies
    ▼
https://your-api-domain.com  ←── Caddy ──► API :3000
                                    └──► Discord bot (internal)

API ──FCM──► Facepunch pairing notifications
API ──WebSocket──► Rust game server (Rust+)
```

The web UI talks to the API over HTTPS. The API and bot run on the same Docker network; the bot reaches the API at `http://api:3000` (configured automatically in `docker-compose.yml`).

---

## 2. Prerequisites checklist

Before you start, have these ready:

- [ ] A **GitHub account** and this repo cloned or forked
- [ ] A **Discord account** with permission to create applications and invite bots to your server
- [ ] An **Oracle Cloud Always Free** VM (or any Linux VPS with a public IP)
- [ ] A **domain name** pointing at your VM (required for HTTPS and Discord OAuth in production)
- [ ] **Docker** and **Docker Compose** on the VM
- [ ] A machine with **Google Chrome** for one-time Rust+ FCM registration (can be your laptop, not the VM)
- [ ] A **Rust+ mobile app** account linked to the same Steam account you play Rust with

Recommended VM specs (Oracle Free Tier):

- Ubuntu 22.04 or 24.04
- 1 OCPU / 1–6 GB RAM (the stack is lightweight)
- Open inbound ports **80** and **443**

---

## 3. Discord application setup

Do this once in the [Discord Developer Portal](https://discord.com/developers/applications).

### 3.1 Create the application

1. **New Application** → name it (e.g. `RustTools`).
2. **General Information** → copy the **Application ID** → this is `DISCORD_CLIENT_ID`.

### 3.2 OAuth2 (web login)

1. Go to **OAuth2**.
2. Add a **Redirect URL** for production:
   ```
   https://YOUR_API_DOMAIN/auth/discord/callback
   ```
   For local dev, also add:
   ```
   http://localhost:5173/api/auth/discord/callback
   ```
3. **OAuth2 → General** → copy **Client Secret** → `DISCORD_CLIENT_SECRET`.

### 3.3 Bot

1. Go to **Bot** → **Add Bot**.
2. Copy the **Token** → `DISCORD_BOT_TOKEN` (treat as a secret; never commit it).
3. Under **Privileged Gateway Intents**, enable **Message Content Intent** only if you plan to extend the bot later (not required for slash commands).

### 3.4 Invite the bot to your server

1. **OAuth2 → URL Generator**
2. Scopes: `bot`, `applications.commands`
3. Bot permissions: at minimum **Send Messages**, **Embed Links**, **Use Slash Commands**
4. Open the generated URL and add the bot to your guild.
5. Copy your **Server ID** (enable Developer Mode in Discord → right-click server → Copy Server ID) → `DISCORD_GUILD_ID`.

### 3.5 Notification channels

You can configure channels in **two ways**:

1. **Discord commands (recommended)** — in your server, run `/channel set` inside the target channel:
   - `information` — auto-updating live server info embed (updated every 60s)
   - `alarms` — smart alarm notifications
   - `team_chat` — in-game team chat mirror
   - `commands` — run in-game `!` commands from Discord
   - `events` — cargo, chinook, patrol heli, and other map events
   - `deep_sea` — Deep Sea open/close alerts
   - `storage` — storage monitor change alerts
   - `default` — general fallback

   Use `/channel show` to list bindings. `/channel clear` removes a linked channel (`.env` fallbacks still apply).

2. **`.env` fallbacks** — used when no `/channel` binding exists:

- Raid/alarm notifications → `DISCORD_NOTIFICATION_CHANNEL_ID` or `DISCORD_ALARM_CHANNEL_ID`
- Team chat mirror → `DISCORD_TEAM_CHAT_CHANNEL_ID`
- Map events → `DISCORD_EVENT_CHANNEL_ID`

Re-register slash commands after updating the bot: `npm run register-commands --workspace=@rusttools/discord-bot`

### 3.6 Role-based permissions (optional)

To restrict who can use the web dashboard and Discord bot:

1. Create roles (e.g. `RustTools Admin`, `RustTools Switch`, `RustTools View`).
2. Copy each role ID → `DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_SWITCH`, `DISCORD_ROLE_VIEW`.

| Role | Web UI | Discord bot |
|------|--------|-------------|
| **View** | Read dashboard, map, storage, team | `/status`, `/devices`, `/team`, `/map`, etc. |
| **Switch** | Toggle switches, send team chat | `/switch`, `/chat` |
| **Admin** | Settings, server activation, audit, renames | All of the above |

Higher roles include lower ones (Admin can do everything Switch and View can).

Leave all role env vars blank to allow any logged-in Discord user full access.

---

## 4. GitHub repository setup

### 4.1 Enable GitHub Pages

1. Repo → **Settings** → **Pages**
2. **Build and deployment** → Source: **GitHub Actions**

Pushes to `main` run `.github/workflows/deploy-pages.yml` and publish the web UI.

### 4.2 Set the API URL variable

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. Add:

| Name | Example value |
|------|----------------|
| `VITE_API_URL` | `https://rusttools.yourdomain.com` |

No trailing slash. This is baked into the frontend at build time.

Optional GitHub Actions variable:

| Name | Value | Purpose |
|------|-------|---------|
| `VITE_LIVE_CAMERAS` | `false` | Hide the Cameras nav page in production (enabled by default) |

### 4.3 Confirm the Pages base path

The deploy workflow sets `VITE_BASE_PATH=/RustTools/` for the repo name `RustTools`. Your live UI URL will be:

```
https://YOUR_GITHUB_USERNAME.github.io/RustTools/
```

If you rename the repo, update `VITE_BASE_PATH` in `.github/workflows/deploy-pages.yml` to match (`/YourRepoName/`).

### 4.4 Trigger a Pages deploy

After `VITE_API_URL` is set and your API is live, push to `main` (or re-run the **Deploy GitHub Pages** workflow). The UI will not work against the API until both are up and `VITE_API_URL` is correct.

---

## 5. Oracle Cloud VM setup

These steps are for Oracle Cloud; adapt as needed for other providers.

### 5.1 Create the instance

1. Oracle Cloud Console → **Compute** → **Instances** → **Create instance**
2. Image: **Ubuntu 22.04** or **24.04**
3. Shape: **Ampere A1** (Always Free) or equivalent
4. Add your SSH public key
5. Create the instance and note the **public IP**

### 5.2 Open firewall ports

**Oracle VCN security list** (Networking → your VCN → Security Lists):

- Ingress: TCP **22** (SSH) from your IP
- Ingress: TCP **80**, **443** from `0.0.0.0/0`

**On the VM** (Ubuntu often has `iptables` rules too):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save   # if installed
```

### 5.3 Install Docker

SSH into the VM:

```bash
ssh ubuntu@YOUR_VM_IP
```

Install Docker (official convenience script):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so group membership applies. Verify:

```bash
docker --version
docker compose version
```

### 5.4 Clone the repo on the VM

```bash
git clone https://github.com/SypherXN/RustTools.git
cd RustTools
```

---

## 6. Domain and DNS

Point a subdomain (or apex domain) at your VM public IP.

Example DNS record:

| Type | Name | Value |
|------|------|-------|
| A | `rusttools` | `YOUR_VM_PUBLIC_IP` |

Result: `rusttools.yourdomain.com` → your VM.

Wait for DNS to propagate (often a few minutes, sometimes longer). Caddy will obtain a Let's Encrypt certificate automatically once port 443 is open and DNS resolves correctly.

---

## 7. Configure environment variables

On the VM, in the repo root:

```bash
cp .env.example .env
./scripts/setup.sh    # creates data/ and generates SESSION_SECRET + ENCRYPTION_KEY
nano .env             # or your preferred editor
```

### Required values

| Variable | What to set |
|----------|-------------|
| `DOMAIN` | `rusttools.yourdomain.com` (must match DNS) |
| `ACME_EMAIL` | Your email for Let's Encrypt |
| `API_PUBLIC_URL` | `https://rusttools.yourdomain.com` |
| `DISCORD_CLIENT_ID` | Application ID from Discord portal |
| `DISCORD_CLIENT_SECRET` | OAuth client secret |
| `DISCORD_REDIRECT_URI` | `https://rusttools.yourdomain.com/auth/discord/callback` |
| `DISCORD_BOT_TOKEN` | Bot token |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `INTERNAL_API_KEY` | Long random string (same value used by API and bot — generate with `openssl rand -hex 32`) |
| `CORS_ORIGINS` | Your GitHub Pages origin, e.g. `https://sypherxn.github.io` |
| `FRONTEND_URL` | Full Pages URL including repo path, e.g. `https://sypherxn.github.io/RustTools` |

### Production example (partial)

```env
NODE_ENV=production
DOMAIN=rusttools.yourdomain.com
ACME_EMAIL=you@example.com
API_PUBLIC_URL=https://rusttools.yourdomain.com

SESSION_SECRET=<generated by setup.sh>
ENCRYPTION_KEY=<generated by setup.sh>

CORS_ORIGINS=https://sypherxn.github.io
FRONTEND_URL=https://sypherxn.github.io/RustTools

DISCORD_CLIENT_ID=1234567890123456789
DISCORD_CLIENT_SECRET=your-secret
DISCORD_REDIRECT_URI=https://rusttools.yourdomain.com/auth/discord/callback
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=9876543210987654321

INTERNAL_API_KEY=your-long-random-internal-key

DISCORD_NOTIFICATION_CHANNEL_ID=1111111111111111111
DISCORD_TEAM_CHAT_CHANNEL_ID=2222222222222222222

RUSTPLUS_FCM_CONFIG_PATH=./data/fcm-config.json
DATABASE_URL=file:./data/rusttools.db

# Optional — default 600 req/min per IP; /health is exempt
# API_RATE_LIMIT_MAX=600
```

### Optional automations

```env
AUTOMATION_NIGHT_LIGHTS=true
AUTOMATION_NIGHT_LIGHT_ENTITY_IDS=12345,67890

AUTOMATION_TEAM_OFFLINE_SAM=true
AUTOMATION_SAM_SWITCH_ENTITY_ID=12345

AUTOMATION_EVENT_TEAM_CHAT=true
AUTOMATION_EVENT_DISCORD=true
AUTOMATION_EVENT_TYPES=cargo,chinook,heli
AUTOMATION_EVENT_TEAM_CHAT_PREFIX=RustTools
# Optional: route event alerts to a different Discord channel than raid alarms
DISCORD_EVENT_CHANNEL_ID=
```

Entity IDs come from the Devices page or `/devices` API after pairing.

---

## 8. Deploy with Docker Compose

From the repo root on the VM:

```bash
docker compose up -d --build
```

This starts three services:

| Service | Role |
|---------|------|
| `api` | Runs DB migrations on start, then the API on port 3000 |
| `discord-bot` | Connects to Discord; calls API at `http://api:3000` |
| `caddy` | Terminates HTTPS and proxies API routes |

### Check status

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f discord-bot
docker compose logs -f caddy
```

### Health check

```bash
curl -s https://rusttools.yourdomain.com/health | jq
```

Expected: `"status": "ok"`. `rustplus.connected` may be `false` until you pair a server.

### Data persistence

SQLite and FCM config live in the Docker volume `rusttools-data`, mounted at `/app/data` inside the API container. Back up this volume before major changes:

```bash
docker run --rm -v rusttools_rusttools-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/rusttools-data-backup.tar.gz -C /data .
```

---

## 9. Rust+ FCM registration

FCM registration links your Facepunch/Rust+ account to the API so in-game pairing notifications reach your server.

**This step requires Chrome with a display** (run on your laptop, not headless on the VM).

### 9.1 Register locally

On your computer (with the repo cloned or any directory):

```bash
mkdir -p data
npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
```

Follow the browser prompts and sign in with the **same Steam account** you use in Rust.

### 9.2 Copy config to the VM

Copy `data/fcm-config.json` to the server and into the Docker volume.

**Option A — copy before first deploy** (simplest):

```bash
# On your laptop
scp data/fcm-config.json ubuntu@YOUR_VM_IP:~/RustTools/data/
```

Ensure `data/` exists on the VM before `docker compose up`. The API container mounts the named volume at `/app/data`; on first run you may need to copy into the volume:

```bash
# On the VM, after first docker compose up
docker compose cp data/fcm-config.json api:/app/data/fcm-config.json
docker compose restart api
```

**Option B — register on a machine with a desktop, then scp** (same as above).

### 9.3 Upload via web UI (alternative)

If the API is already running and you have **Admin** permission:

1. Run `fcm-register` locally to produce `fcm-config.json` (section 9.1)
2. Open the web UI → **Settings → Admin → FCM credentials**
3. Upload the JSON file — the API saves it to `data/fcm-config.json` and restarts the FCM listener

Use this instead of `scp` when shell access to the VM is inconvenient. You can also **replace** credentials here when they expire (~90 days; warning banner appears within 14 days of expiry).

### 9.4 Confirm FCM is listening

```bash
curl -s https://rusttools.yourdomain.com/health | jq '.fcm'
```

Expected: `"listening": true`. If `false`, check that the file exists at `/app/data/fcm-config.json` inside the container:

```bash
docker compose exec api ls -la /app/data/
```

---

## 10. Pair your server and devices

### 10.1 Link your Steam account (web)

1. Open your GitHub Pages URL, e.g. `https://sypherxn.github.io/RustTools/`
2. **Log in with Discord**
3. Go to **Settings** → **Link Rust+ Account** → click the button
4. Status should show “Waiting for in-game pairing…”

### 10.2 Pair the server (in-game)

1. Join your Rust server
2. Open the **Rust+** menu (mobile app or in-game overlay)
3. Choose **Pair with Server**
4. Within a minute, the server should appear in RustTools (Dashboard shows connection; Settings shows linked Steam ID)

### 10.3 Pair devices

In-game, use the **wire tool** on smart switches, alarms, and storage monitors while connected to the paired server. They appear under **Devices** in the web UI.

### 10.4 Server automation base (optional, admin)

Used by **Automations** proximity rules (e.g. “all teammates away from base”) and shown on the map as a blue circle:

1. **Automations → Logic rules → Server base location**
   - Enter world **X/Y**, link a **map pin**, or click **Pick on map**
   - Set **Radius (m)** — circular distance in world meters (default **150**, max **10,000**)
2. **Map page** (admin): **Set server base** in the toolbar → click the map → label + radius → save  
   Or open a team pin → **Set as server base**
3. On the map, enable **Layers → Server base** to see the zone in **2D** and **3D** (3D requires procgen upload, section 10.5)
4. **Layers panel** (admin): edit proximity radius inline; **Focus base** pans to the center

Per-rule **Radius (m)** on proximity triggers/conditions overrides the server default when set.

### 10.5 Procgen map upload (optional)

Unlocks building-blocked overlays, resource heatmaps, roads/caves, and the **3D map** (not available from Rust+ alone):

1. Join your Rust server on the same machine you use for RustTools admin
2. Get the `.map` file:
   - **In-game:** F1 console → `Download map file` (usually saves to Downloads), or
   - **Client cache:** after joining, find the file under your Rust `maps` folder (OS-specific path)
3. Web UI → **Settings → Server & Map** → **Upload .map file**
4. Open **Map** → enable procgen layers in the layers panel; switch to **3D** when parse status is `ready`
5. Toggle **Server base** in layers to verify the automation base circle on terrain (if configured in 10.4)

Seed/world-size mismatches are shown if the uploaded map does not match the active server.

### 10.6 Live cameras (optional)

The **Cameras** page is on by default. To use it:

1. Server owner runs `cctvrender.enabled true` in the **server console** (off on most public servers)
2. Web UI → **Cameras** → enter a CCTV ID (e.g. `DOME1`) or pick a saved bookmark from Automations
3. Requires **Switch** permission to connect and control PTZ / auto turrets

To hide Cameras in a GitHub Pages build, set Actions variable `VITE_LIVE_CAMERAS=false` and redeploy.

---

## 11. Register Discord slash commands

Slash commands must be registered once per guild (and again if you change command definitions).

**On your laptop** (with `.env` filled in), from the repo root:

```bash
npm install
npm run register-commands --workspace=@rusttools/discord-bot
```

Requires `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` in `.env`.

Alternatively on the VM (one-off with Node installed, or via a temporary container):

```bash
docker compose run --rm -e DISCORD_BOT_TOKEN -e DISCORD_CLIENT_ID -e DISCORD_GUILD_ID \
  discord-bot node -e "..." 
```

The npm script on a dev machine is the easiest path. After registration, commands appear in your Discord server within a few seconds.

Available commands include: `/help`, `/status`, `/devices`, `/switch`, `/alarm`, `/storage`, `/team`, `/time`, `/deepsea`, `/chat`, `/map`, `/pair`, `/link`, and `/channel` / `/blacklist` (admin).

---

## 12. Verify everything works

Use this checklist after deploy:

| Step | How to verify |
|------|----------------|
| API HTTPS | `curl https://YOUR_DOMAIN/health` returns 200 |
| GitHub Pages | UI loads at `https://USER.github.io/RustTools/` |
| Discord login | Log in on the web UI; redirects back to Pages logged in |
| FCM | `/health` shows `"fcm": { "listening": true, "configured": true }` |
| FCM expiry | **Settings → Admin** shows registered/expiry dates |
| Rust+ | Dashboard shows server name and player count |
| Devices | Toggling a switch in the UI changes it in-game |
| WebSocket | Team page shows live chat when someone talks in team chat |
| Procgen map | Upload `.map` in Settings; Map page shows parse status `ready` and 3D toggle |
| Server base | **Automations** or **Map → Set server base**; **Server base** layer shows circle on 2D/3D |
| Automations | Create a proximity rule; radius inherits server default or set **Radius (m)** per rule |
| Discord bot | `/status` responds in your server |
| Notifications | Trigger an alarm in-game → message in notification channel |
| Live info board | `/channel set purpose:information` → embed updates within ~60s |

---

## 13. Updating after deploy

On the VM:

```bash
cd RustTools
git pull
docker compose up -d --build
```

Database migrations run automatically when the API container starts.

After API URL or frontend changes:

1. Update `.env` on the VM if needed
2. Update `VITE_API_URL` in GitHub Actions variables
3. Push to `main` to redeploy Pages

Re-register slash commands only if command definitions changed in `apps/discord-bot/src/commands.ts`.

---

## 14. Troubleshooting

### Caddy / HTTPS not working

- DNS must point to the VM IP (`dig rusttools.yourdomain.com`)
- Ports 80 and 443 open in cloud firewall and on the VM
- `DOMAIN` and `ACME_EMAIL` set correctly in `.env`
- Check logs: `docker compose logs caddy`

### Discord OAuth redirects but login fails

- `DISCORD_REDIRECT_URI` must exactly match the URL in the Discord portal
- `CORS_ORIGINS` must include your GitHub Pages origin (no trailing path): `https://user.github.io`
- `FRONTEND_URL` must be the full Pages URL **with** repo path: `https://user.github.io/RustTools`
- Cookies require HTTPS on the API in production

### Web UI shows errors / cannot reach API

- Confirm GitHub variable `VITE_API_URL` matches your live API URL
- Re-run the Pages deploy workflow after changing `VITE_API_URL`
- Browser devtools → Network: requests should go to your API domain, not `localhost`

### `rustplus.connected: false`

- Pair the server in-game (Rust+ menu)
- Complete **Link Rust+ Account** in Settings first
- FCM must be listening (`fcm.listening: true`)
- Check API logs: `docker compose logs api`

### FCM not listening

- `fcm-config.json` missing or wrong path — copy into `/app/data/` in the container, or upload via **Settings → Admin**
- Restart API after adding config: `docker compose restart api`
- Check **Settings → Admin** for configured/listening status and expiry

### HTTP 429 / “Too Many Requests” on the web UI

- Default API limit is 600 requests/minute per IP (`API_RATE_LIMIT_MAX` in `.env`)
- Common with multiple tabs or heavy map/procgen overlay use — raise the limit or reduce open tabs
- `/health` is exempt from rate limiting

### Rust+ “rate limit” on map or team data

- Facepunch limits Rust+ API calls; RustTools caches reads and staggers background polls
- Wait a few seconds and refresh; avoid hammering the map refresh button

### Cameras time out or show no feed

- Server owner must run `cctvrender.enabled true` in the server console
- Verify camera ID (e.g. `DOME1`, not `DOMELAND`)
- Only one remote viewer per camera at a time
- Public servers often have CCTV rendering disabled entirely

### Discord bot online but commands fail

- `INTERNAL_API_KEY` must match in API and bot (bot uses same `.env`)
- Bot uses `http://api:3000` inside Docker (set in `docker-compose.yml`; do not override with public URL for the bot service)
- Register commands: `npm run register-commands --workspace=@rusttools/discord-bot`

### Slash commands not visible

- Re-run command registration (section 11)
- Bot needs `applications.commands` scope when invited
- Commands are guild-scoped; check `DISCORD_GUILD_ID`

### Team chat / live updates not working on GitHub Pages

- Live updates use WebSocket with a short-lived token from `/auth/ws-token`
- You must be logged in; check browser console for WebSocket errors
- API must be HTTPS (`wss://`)

---

## Quick reference: local development

```bash
git clone https://github.com/SypherXN/RustTools.git
cd RustTools
./scripts/setup.sh
# Edit .env — use localhost OAuth redirect

npm install
npm run db:migrate

npm run dev          # API http://localhost:3000 (4 GB heap for procgen parsing)
npm run dev:web      # UI http://localhost:5173 (proxies /api)
npm run dev:bot      # Discord bot

npm run register-commands --workspace=@rusttools/discord-bot
npm run test:smoke     # API smoke tests (health, routes; live Rust+ optional)
```

Local OAuth redirect: `http://localhost:5173/api/auth/discord/callback`

Optional: `npm run dev:web:demo` for UI-only demo mode (`?demo=1`).

After FCM register, upload `fcm-config.json` in **Settings → Admin** instead of copying into `data/` manually.

---

## Support

If something breaks after following this guide, check `docker compose logs` for the relevant service and compare your `.env` against `.env.example`. Most issues are DNS, Discord redirect URI mismatches, or missing FCM config.
