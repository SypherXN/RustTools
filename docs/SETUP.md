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
9. [Rust+ FCM registration (master bot)](#9-rust-fcm-registration-master-bot)
10. [Pair your server, link accounts, and devices](#10-pair-your-server-link-accounts-and-devices)
11. [Register Discord slash commands](#11-register-discord-slash-commands)
12. [Verify everything works](#12-verify-everything-works)
13. [Updating after deploy](#13-updating-after-deploy)
14. [Troubleshooting](#14-troubleshooting)
15. [Disk usage & data growth](#disk-usage--data-growth)
16. [Hands-off operations (optional)](#16-hands-off-operations-optional)

---

## 1. What you are deploying

RustTools splits across two hosts:

| Component | Where it runs | Purpose |
|-----------|---------------|---------|
| **Web UI** | GitHub Pages | React dashboard (login, devices, map, etc.) |
| **API** | Your VM (Docker) — **Oracle A1 12 GB** recommended | REST + WebSocket, Rust+ connection, FCM listener, auth |
| **Discord bot** | Same VM (Docker) | Slash commands → internal API |
| **Caddy** | Same VM (Docker) | HTTPS reverse proxy for the API |

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
- [ ] Discord **role IDs** for at least one permission tier (`DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_SWITCH`, or `DISCORD_ROLE_VIEW`) — required in production
- [ ] GitHub Actions variable **`VITE_API_URL`** set before the first Pages deploy

Recommended hosting (Oracle Always Free):

| Role | Shape | Sizing |
|------|--------|--------|
| **RustTools** (this stack) | **Ampere A1** (`VM.Standard.A1.Flex`) | **2 OCPU · 12 GB RAM** (uses the full A1 Always Free pool) |
| Other light bots / scripts | **E2.1.Micro** (optional, separate) | 1 OCPU · 1 GB — fine for a small Discord bot; **not** recommended for RustTools + procgen |

Oracle Always Free A1 totals (across all A1 instances in the tenancy): **2 OCPUs** and **12 GB memory**. See [Oracle Always Free docs](https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

Also works on any Linux VPS with a public IP, Docker, and **≥ 2 GB RAM** (12 GB recommended if you use procgen 3D map).

- Ubuntu 22.04 or 24.04 (ARM64 on A1)
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
3. **Icon** → upload `apps/discord-bot/assets/icon-512.png` (512×512 orange terminal HUD mark — same as the web app favicon).
4. **Banner** (optional) → upload `apps/discord-bot/assets/discord-banner.png` (680×240, **17:6** aspect ratio). Full PCB circuit background with centered **RUSTTOOLS** logotype and orange HUD corner brackets; the bot avatar carries the icon so the banner is text-only. See `apps/discord-bot/assets/README.md`.
5. Under **Privileged Gateway Intents**, you do **not** need **Message Content Intent** — the bot uses slash commands only (no reading channel messages).

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
   - `commands` — optional legacy channel binding (bot commands are slash commands, not `!` in channel)
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

### 3.6 Role-based permissions

**Required in production** — the API will not start without `DISCORD_GUILD_ID` and at least one role env var.

To restrict who can use the web dashboard and Discord bot:

1. Create roles (e.g. `RustTools Admin`, `RustTools Switch`, `RustTools View`).
2. Copy each role ID → `DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_SWITCH`, `DISCORD_ROLE_VIEW`.

| Role | Web UI | Discord bot |
|------|--------|-------------|
| **View** | Read dashboard, map, storage, team | `/status`, `/devices`, `/team`, `/map`, `/online`, `/cargo`, `/events`, etc. |
| **Switch** | Toggle switches, send team chat | `/switch`, `/alias`, `/chat`, `/send`, all team/world slash commands |
| **Admin** | Settings, master bot re-pair, audit, renames | All of the above + `/channel`, `/blacklist`, `/mute`, `/unmute` |

Higher roles include lower ones (Admin can do everything Switch and View can).

In production, set `DISCORD_GUILD_ID` and at least one of `DISCORD_ROLE_ADMIN`,
`DISCORD_ROLE_SWITCH`, or `DISCORD_ROLE_VIEW`. Development mode may leave role
env vars blank to allow any logged-in Discord user full access.

---

## 4. GitHub repository setup

### 4.1 Enable GitHub Pages

1. Repo → **Settings** → **Pages**
2. **Build and deployment** → Source: **GitHub Actions**

Pushes to `main` run `.github/workflows/deploy-pages.yml` and publish the web UI.

### 4.2 Set the API URL variable

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. Add (**required** — the Pages workflow fails the build if this is missing):

| Name | Example value |
|------|----------------|
| `VITE_API_URL` | `https://rusttools.yourdomain.com` |

No trailing slash. This is baked into the frontend at build time. Local dev uses the Vite proxy (`/api`) when this variable is unset.

After `./scripts/setup.sh`, see **`data/DEPLOY-REMINDERS.txt`** for the suggested value (from `API_PUBLIC_URL` in `.env`).

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
2. Image: **Ubuntu 22.04** or **24.04** (A1 uses **aarch64**)
3. Shape: **Ampere A1** → `VM.Standard.A1.Flex` → **2 OCPUs**, **12 GB** memory (Always Free)
4. Boot volume: default **47 GB** is fine (200 GB block storage free tier shared across volumes)
5. Add your SSH public key
6. Create the instance and note the **public IP**

**Splitting with other projects:** You can run RustTools on **1 OCPU · 12 GB** and leave 1 OCPU unused, or use **2 OCPU · 12 GB** on one VM (recommended for faster procgen). Do not run RustTools on **E2.1.Micro** (1 GB) unless you add swap and accept slow procgen — see [Minimal VM (E2.1.Micro)](#minimal-vm-e21micro).

**Other bots:** A separate **E2.1.Micro** does not count against the A1 2/12 pool — a common layout is RustTools on A1, household bot on micro.

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
./scripts/setup.sh    # creates data/, generates secrets, writes data/DEPLOY-REMINDERS.txt
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
| `DISCORD_GUILD_ID` | Your Discord server ID (**required in production**) |
| `DISCORD_ROLE_ADMIN` / `DISCORD_ROLE_SWITCH` / `DISCORD_ROLE_VIEW` | Role IDs for permission tiers — **at least one required in production** |
| `INTERNAL_API_KEY` | Long random string, **32+ characters** (same value in API and bot — generate with `openssl rand -hex 32`) |
| `CORS_ORIGINS` | Your GitHub Pages origin, e.g. `https://sypherxn.github.io` |
| `FRONTEND_URL` | Full Pages URL including repo path, e.g. `https://sypherxn.github.io/RustTools` |

`./scripts/setup.sh` generates `SESSION_SECRET`, `ENCRYPTION_KEY`, and `INTERNAL_API_KEY` if they still use the `.env.example` placeholders. It prints a checklist of remaining `.env` values and writes **`data/DEPLOY-REMINDERS.txt`** (GitHub Actions `VITE_API_URL`, Discord OAuth URLs, post-deploy steps). In production, the API also refuses to start if any secret still uses example defaults.

Do **not** set `RUSTPLUS_ALLOW_UNPROMPTED_PAIR=true` in production — master server pairing must go through **Settings → Server & Map → Re-pair Server**.

### Optional — ops monitoring & backups

For hands-off alerting and scheduled backups after deploy, see [§16 Hands-off operations](#16-hands-off-operations-optional). Common optional vars (full list in `.env.example`):

| Variable | Purpose |
|----------|---------|
| `OPS_DISCORD_WEBHOOK_URL` | Ops channel webhook for health, FCM expiry, disk, and deploy notifications |
| `OPS_HEALTH_STATE_FILE` | State file for `health-watch.sh --quiet` (alert only on change) |
| `OPS_NOTIFY_RECOVERY=true` | Also ping when `/health` recovers after a failure |
| `BACKUP_DIR` / `BACKUP_RETENTION_DAYS` | Where `backup-vm.sh` writes archives and how long to keep them |
| `DISK_WARN_PCT` | Disk usage threshold for `disk-watch.sh` (default 85%) |

### Production example (partial)

```env
NODE_ENV=production
DOMAIN=rusttools.yourdomain.com
ACME_EMAIL=you@example.com
API_PUBLIC_URL=https://rusttools.yourdomain.com

SESSION_SECRET=<generated by setup.sh>
ENCRYPTION_KEY=<generated by setup.sh>
INTERNAL_API_KEY=<generated by setup.sh>

CORS_ORIGINS=https://sypherxn.github.io
FRONTEND_URL=https://sypherxn.github.io/RustTools

DISCORD_CLIENT_ID=1234567890123456789
DISCORD_CLIENT_SECRET=your-secret
DISCORD_REDIRECT_URI=https://rusttools.yourdomain.com/auth/discord/callback
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=9876543210987654321
DISCORD_ROLE_ADMIN=1111111111111111111
DISCORD_ROLE_SWITCH=2222222222222222222
DISCORD_ROLE_VIEW=3333333333333333333

INTERNAL_API_KEY=your-long-random-internal-key-at-least-32-characters

DISCORD_NOTIFICATION_CHANNEL_ID=1111111111111111111
DISCORD_TEAM_CHAT_CHANNEL_ID=2222222222222222222

RUSTPLUS_FCM_CONFIG_PATH=./data/fcm-config.json
DATABASE_URL=file:./data/rusttools.db

# Procgen parse heap for child worker (default 4096 — tuned for A1 12 GB)
# PROCGEN_PARSE_HEAP_MB=4096

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
| `api` | Runs DB migrations (`node packages/db/dist/migrate.js`), then the API on port 3000 |
| `discord-bot` | Connects to Discord; calls API at `http://api:3000` |
| `caddy` | Terminates HTTPS and proxies API routes |

Caddy forwards these paths to the API: `/admin/*`, `/audit`, `/auth/*`, `/automation-*`, `/cameras/*`, `/device-library*`, `/devices*`, `/health`, `/push/*`, `/servers*`, `/storage*`, `/switch-groups*`, `/vending/*`, `/ws`. All other HTTPS requests get a short “use GitHub Pages” message.

Container logs use the **json-file** driver with rotation (**10 MB × 3 files** per service) — see `docker-compose.yml`.

The **discord-bot** service has a Docker healthcheck (verifies the bot Node process is PID 1). It detects a crashed entrypoint but not a hung event loop.

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

SQLite and FCM config live in the Docker volume `rusttools-data`, mounted at `/app/data` inside the API container.

**Recommended — use the backup script:**

```bash
./scripts/backup-vm.sh
# Weekly cron example (Sunday 03:15):
# 15 3 * * 0 cd /home/ubuntu/RustTools && ./scripts/backup-vm.sh >>/tmp/rusttools-backup.log 2>&1
```

Creates `~/backups/rusttools-YYYYMMDD-HHMM.tar.gz`, prunes old archives, optional restore with `--restore`. See [§16](#16-hands-off-operations-optional) and `scripts/backup-vm.sh --help`.

**Manual one-off backup** (same volume):

```bash
docker run --rm -v rusttools_rusttools-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/rusttools-data-backup.tar.gz -C /data .
```

---

## 9. Rust+ FCM registration (master bot)

FCM registration links the **master bot’s** Facepunch/Rust+ account to the API so **server and device pairing notifications** reach your host. This is **one shared config** for the 24/7 bot — not per-teammate.

Teammates do **not** need FCM on the server. They link **Steam ID** (and optionally **companion Rust+** credentials) in **Settings → Account** without touching the master connection.

**This step requires Chrome with a display** (run on your laptop, not headless on the VM). Use a dedicated Rust+ account / phone for the bot if possible.

### 9.1 Register locally

On your computer (with the repo cloned or any directory):

```bash
mkdir -p data
npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json
```

Follow the browser prompts and sign in with the **Steam account used for the master bot** (the account that will stay paired 24/7).

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

## 10. Pair your server, link accounts, and devices

RustTools uses three separate link types. Only **master bot** pairing affects the live Rust+ WebSocket that powers devices, team, and automations.

| Link type | Who | Settings location | Stored where |
|-----------|-----|-------------------|--------------|
| **Master bot** | Admin | **Server & Map → Master Bot Server Pair** | `rust_servers` + active WebSocket |
| **Steam identity** | Any teammate (View+) | **Account → Steam Identity** | `users.steam_id` |
| **Companion Rust+** | Optional (View+) | **Account → Companion Rust+** | Encrypted on `users` row only |

Companion credentials are used **only** for brief leader promotion when the in-game leader is not the master bot. Saving or using companion links **does not** disconnect the master bot or take down other features.

### 10.1 Pair the master server (admin)

1. Confirm FCM is listening (section 9.4)
2. Open the web UI → log in with Discord (admin role)
3. **Settings → Server & Map → Master Bot Server Pair** → click **Re-pair Server**
4. In-game on the **bot’s Rust+ account**: **Pair with Server**
5. Within a minute, the Dashboard should show the server connected

In **production**, unprompted server pairs (FCM notifications without a pending admin-started link) are **rejected**. In local dev, unprompted pairing is allowed by default (`RUSTPLUS_ALLOW_UNPROMPTED_PAIR` defaults to true unless set to `false`).

### 10.2 Link Steam identity (teammates)

Required for `!leader` / `/leader` (bot must know your Steam ID).

1. **Settings → Account → Steam Identity**
2. **Recommended:** enter your 17-digit Steam ID from in-game F1 → `player.id` → **Save Steam ID**
3. **Alternative:** click **Start pairing flow**, then pair a device on the master Rust+ account (admin operation) — only one pending Steam link is processed at a time

Steam linking does **not** give teammates device control; permissions still come from Discord roles.

### 10.3 Link companion Rust+ (optional)

Only needed if you want RustTools to promote someone **while you are in-game leader** but the master bot is not leader.

1. On your own computer (not the VM):
   ```bash
   npx @liamcottle/rustplus.js fcm-register --config-file=./fcm-companion.json
   ```
2. In **your** Rust+ app: **Pair with Server** on the same Rust server
3. Copy `playerId` and `playerToken` from the pairing output / notification
4. **Settings → Account → Companion Rust+** → paste both → **Save companion credentials**

The master bot keeps running. During promote, RustTools opens a **short-lived** second connection as your account, sends `promoteToLeader`, then disconnects.

Do **not** use the bot’s FCM listener for companion pairing unless you intend to capture that notification on the server — the recommended path is **local `fcm-register` + paste**.

### 10.4 Pair devices (admin / bot account)

In-game on the **master bot’s Rust+ session**, use the **wire tool** on smart switches, alarms, and storage monitors while connected to the paired server. They appear under **Devices** in the web UI.

Each **smart switch** shows a live **ON** / **OFF** / **Unknown** badge (from Rust+). The badge updates when you toggle from the web UI, Discord, in-game chat, or when someone flips the switch manually in-game — as long as Rust+ is connected and you have the Devices page (or another tab with WebSocket) open.

On the Devices page, **On** and **Off** force that state; **Toggle** flips the current value. The same applies to switch groups.

Check switch state in-game: `!alias status` (alias configured under device Settings). In Discord: `/alias name:<alias> action:status`.

### 10.5 Team chat (web)

On the **Team** page (Switch permission to send):

- Live feed of in-game team chat over WebSocket
- The chat panel **scrolls inside a fixed area** — it does not grow the page as messages pile up
- Messages you send from the web appear **immediately** (no page refresh)
- Outbound web messages show in-game as `[YourDiscordName] your text`

Discord `/chat` uses the same delivery path and also mirrors to the team-chat channel when configured.

### 10.6 Server automation base (optional, admin)

Used by **Automations** proximity rules (e.g. “all teammates away from base”) and shown on the map as a blue circle:

1. **Automations → Logic rules → Server base location**
   - Enter world **X/Y**, link a **map pin**, or click **Pick on map**
   - Set **Radius (m)** — circular distance in world meters (default **150**, max **10,000**)
2. **Map page** (admin): **Set server base** in the toolbar → click the map → label + radius → save  
   Or open a team pin → **Set as server base**
3. On the map, enable **Layers → Server base** to see the zone in **2D** and **3D** (3D requires procgen upload, section 10.7)
4. **Layers panel** (admin): edit proximity radius inline; **Focus base** pans to the center

Per-rule **Radius (m)** on proximity triggers/conditions overrides the server default when set.

### 10.7 Procgen map upload (optional)

Unlocks building-blocked overlays, resource heatmaps, roads/caves, and the **3D map** (not available from Rust+ alone):

1. Join your Rust server on the same machine you use for RustTools admin
2. Get the `.map` file:
   - **In-game:** F1 console → `Download map file` (usually saves to Downloads), or
   - **Client cache:** after joining, find the file under your Rust `maps` folder (OS-specific path)
3. Web UI → **Settings → Server & Map** → **Upload .map file**
4. Parsing runs in a **background child process** (default **4 GB** heap on A1 — see [Disk usage & data growth](#disk-usage--data-growth))
5. Open **Map** → enable procgen layers in the layers panel; switch to **3D** when parse status is `ready`
6. Toggle **Server base** in layers to verify the automation base circle on terrain (if configured in 10.5)

Seed/world-size mismatches are shown if the uploaded map does not match the active server.

### 10.8 Live cameras (optional)

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

The npm script on a dev machine is the easiest path. After registration, commands appear in your Discord server within a few seconds.

**Core:** `/help`, `/status`, `/devices`, `/switch`, `/alias`, `/alarm`, `/storage`, `/team`, `/time`, `/deepsea`, `/chat`, `/send`, `/map`, `/pair`, `/link`

**Team & world (mirror in-game `!` commands):** `/online`, `/offline`, `/afk`, `/alive`, `/leader`, `/cargo`, `/heli`, `/chinook`, `/vendor`, `/bradley`, `/convoy`, `/large`, `/small`, `/events`, `/upkeep`

**Admin:** `/channel show|set|clear`, `/blacklist add|remove|list`, `/mute`, `/unmute`

Bot responses use **embeds** (not plain text). Re-register after changing `apps/discord-bot/src/commands.ts`.

---

## 12. Verify everything works

Use this checklist after deploy:

| Step | How to verify |
|------|----------------|
| API HTTPS | `curl https://YOUR_DOMAIN/health` returns 200 |
| Production env | API container stays up (no startup validation errors in `docker compose logs api`) |
| GitHub Pages | UI loads at `https://USER.github.io/RustTools/` |
| Discord login | Log in on the web UI; redirects back to Pages logged in |
| FCM | `/health` shows `"fcm": { "listening": true, "configured": true }` |
| FCM expiry | **Settings → Admin** shows registered/expiry dates |
| Rust+ | Dashboard shows server name and player count (master bot paired) |
| Account links | Teammate can save Steam ID; optional companion credentials in Settings → Account |
| Leader promote | `!leader` works when sender is online/alive and promotion path exists (master or companion) |
| Devices | Each switch shows ON/OFF badge; **On**/**Off** set state; **Toggle** flips |
| Switch live update | Flip a switch in-game → badge updates on open Devices page (Rust+ connected) |
| Team chat | Send from Team page → message appears instantly; feed scrolls |
| Discord slash | `/cargo`, `/online`, `/alias action:status` return embeds |
| WebSocket | Team page shows live chat when someone talks in team chat |
| Procgen map | Upload `.map` in Settings; Map page shows parse status `ready` and 3D toggle |
| Server base | **Automations** or **Map → Set server base**; **Server base** layer shows circle on 2D/3D |
| Automations | Create a proximity rule; radius inherits server default or set **Radius (m)** per rule |
| Discord bot | `/status` responds in your server |
| Notifications | Trigger an alarm in-game → message in notification channel |
| Live info board | `/channel set purpose:information` → embed updates within ~60s |
| Ops health (optional) | `./scripts/health-watch.sh` exits 0; with webhook configured, no false alerts |
| Backup (optional) | `./scripts/backup-vm.sh` creates archive under `~/backups/` |

After first deploy, configure optional hands-off ops in [§16](#16-hands-off-operations-optional).

---

## 13. Updating after deploy

### Manual update on the VM

```bash
cd RustTools
git pull
docker compose up -d --build
```

### Update from your laptop (SSH)

```bash
./scripts/update-vm.sh
```

Runs `git pull`, `docker compose up -d --build`, prints `/health`, and posts to `OPS_DISCORD_WEBHOOK_URL` on success or failure (if configured). Pass host/user/path via env or `~/.rusttools-deploy.env`.

### GitHub Actions auto-deploy (optional)

Workflow: `.github/workflows/deploy-vm.yml` — runs on push to `main` when paths under `apps/api`, `apps/discord-bot`, `packages/`, etc. change.

1. Set repository variable `VM_DEPLOY_ENABLED=true`
2. Add secrets: `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH`
3. Push to `main` — workflow SSHs to the VM and runs `scripts/update-vm.sh`

The web UI on GitHub Pages is **not** redeployed by this workflow; push any `apps/web` change to `main` for the Pages workflow separately.

Database migrations run automatically when the API container starts (`node packages/db/dist/migrate.js` before the API process).

After API URL or frontend changes:

1. Update `.env` on the VM if needed
2. Update `VITE_API_URL` in GitHub Actions variables
3. Push to `main` to redeploy Pages

Re-register slash commands only if command definitions changed in `apps/discord-bot/src/commands.ts`.

---

## 14. Troubleshooting

### API container exits immediately on startup

Check `docker compose logs api` for a validation error. In production (`NODE_ENV=production`), common causes:

- `SESSION_SECRET` or `ENCRYPTION_KEY` still use `.env.example` placeholders — run `./scripts/setup.sh` or set unique values
- `DISCORD_GUILD_ID` is empty
- No `DISCORD_ROLE_ADMIN`, `DISCORD_ROLE_SWITCH`, or `DISCORD_ROLE_VIEW` set
- `INTERNAL_API_KEY` is missing, shorter than 32 characters, or still the example default
- `RUSTPLUS_ALLOW_UNPROMPTED_PAIR=true` is set (not allowed in production)

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

- Confirm GitHub variable `VITE_API_URL` is set and matches your live API URL (Pages build fails without it)
- Re-run the Pages deploy workflow after changing `VITE_API_URL`
- Browser devtools → Network: requests should go to your API domain, not `localhost`

### `rustplus.connected: false`

- Admin: complete **Master Bot Server Pair** (Settings → Server & Map) and pair in-game on the bot account
- FCM must be listening (`fcm.listening: true`)
- Check API logs: `docker compose logs api`

Teammate Steam / companion links do **not** affect `rustplus.connected`.

### Leader promote fails

- Target must be **online** and **alive**, and on the team roster
- `!leader` / `/leader`: link **Steam ID** in Settings → Account first
- If the current leader is **not** the master bot, that leader must save **Companion Rust+** credentials, or promote the master bot account in-game first
- Web **Team** page promote (admin): same rules; **Make leader** only shows for eligible targets when promotion is possible

### FCM not listening

- `fcm-config.json` missing or wrong path — copy into `/app/data/` in the container, or upload via **Settings → Admin**
- Restart API after adding config: `docker compose restart api`
- Check **Settings → Admin** for configured/listening status and expiry

### HTTP 429 / “Too Many Requests” on the web UI

- Default API limit is 600 requests/minute per IP (`API_RATE_LIMIT_MAX` in `.env`)
- Common with multiple tabs or heavy map/procgen overlay use — raise the limit or reduce open tabs
- `/health` is exempt from rate limiting

### Rust+ “rate limit” on map or team data

- Facepunch limits Rust+ API calls; RustTools caches reads (15–120s TTL), uses short entity-info cache with re-read after subscribe, limits concurrent switch/storage reads, staggers 60s background jobs (0s / 20s / 40s offsets), and retries on rate-limit errors
- Wait a few seconds and refresh; avoid hammering the map refresh button

### Cameras time out or show no feed

- Server owner must run `cctvrender.enabled true` in the server console
- Verify camera ID (e.g. `DOME1`, not `DOMELAND`)
- Only one remote viewer per camera at a time
- Public servers often have CCTV rendering disabled entirely

### Discord bot online but commands fail

- `INTERNAL_API_KEY` must match in API and bot and be **32+ characters** in production
- Bot uses `http://api:3000` inside Docker (set in `docker-compose.yml`; do not override with public URL for the bot service)
- Register commands: `npm run register-commands --workspace=@rusttools/discord-bot`
- Restart API and bot after deploy so slash-command routes and embed payloads are current

### Switch badge shows Unknown on Devices page

- Rust+ must be connected (`/health` → `rustplus.connected: true`)
- Device must be paired and subscribed (reconnect API after pairing new switches)
- Badge updates live only while a web tab with WebSocket is open; refresh the page to re-fetch state

### Slash commands not visible

- Re-run command registration (section 11)
- Bot needs `applications.commands` scope when invited
- Commands are guild-scoped; check `DISCORD_GUILD_ID`

### Procgen `.map` upload fails or hangs

- Check **Settings → Server & Map** parse status and error message
- On **A1 12 GB** (default): `PROCGEN_PARSE_HEAP_MB=4096` in `.env` / `docker-compose.yml` — no swap required
- Parse can take **several minutes** on 1 OCPU; watch `docker compose logs -f api`
- On **E2.1.Micro**: see [Minimal VM (E2.1.Micro)](#minimal-vm-e21micro) — swap + `PROCGEN_PARSE_HEAP_MB=2048`
- Ensure the uploaded file matches the active server (seed/size warnings on status page)

### Team chat / live updates not working on GitHub Pages

- Live updates use WebSocket with a short-lived token from `/auth/ws-token`
- You must be logged in; check browser console for WebSocket errors
- API must be HTTPS (`wss://`)
- If your own sent messages do not appear, restart the API after upgrading — older builds did not broadcast outbound web chat over WebSocket

---

## Disk usage & data growth

RustTools keeps disk use bounded automatically:

| What | Where | Retention |
|------|--------|-----------|
| **Audit log** | `audit_events` table | Entries **older than 30 days** pruned automatically; **cleared on map wipe** |
| **Procgen map** | `data/procgen/<serverId>/` | **Replaced** when you upload a new `.map` (old files deleted first) |
| **FCM config** | `data/fcm-config.json` | **Replaced** on admin upload; expiry clock resets from upload time |
| **SQLite database** | `data/rusttools.db` | Usually stays small with the policies above |
| **User link data** | `users` table | Steam ID + encrypted companion tokens (small; promote-only) |
| **Team death / connection logs** | `team_death_log`, `team_connection_log` | **Cleared automatically on map wipe** (seed change detected every 5 min) |
| **Docker logs** | `docker compose logs` | **Rotated** — 10 MB × 3 files per service (see `docker-compose.yml`) |

**Manual cleanup (optional):**

- **Settings → Admin → Data reset** can still clear `audit_log` or team logs immediately.
- Monitor with `du -sh data/` and `ls -lh data/rusttools.db`.

### Oracle A1 (12 GB) — recommended for RustTools

Procgen `.map` parsing runs in a **short-lived child process** so the main API stays responsive. Defaults are tuned for **12 GB RAM**:

| Setting | Default | Notes |
|---------|---------|--------|
| `PROCGEN_PARSE_HEAP_MB` | **4096** | Child process heap; set in `.env` or `docker-compose.yml` |
| Swap | Not required | Optional 1–2 GB swap as insurance |

Upload the `.map` from **Settings → Server & Map** when the server is quiet. On **2 OCPU · 12 GB**, parsing usually finishes in a few minutes.

### Minimal VM (E2.1.Micro)

**Not recommended** for RustTools if you use procgen — only 1 GB RAM. If you must run here (or are testing):

1. Add **2 GB swap** (required for procgen):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

2. In `.env`:

```env
PROCGEN_PARSE_HEAP_MB=2048
```

Parsing may take **5–15 minutes** and will be slow. Prefer moving RustTools to **A1 12 GB** and keeping other bots on micro.

---

## 16. Hands-off operations (optional)

After the stack is live, you can reduce day-to-day SSH with the ops tooling in `scripts/` and optional GitHub Actions workflows. Full task index and acceptance criteria: **[docs/OPS-AUTOMATION.md](OPS-AUTOMATION.md)**.

### Minimum recommended stack

| Tool | What it does |
|------|----------------|
| External uptime monitor | Ping `https://YOUR_DOMAIN/health` (e.g. UptimeRobot) — detects VM/network down |
| `scripts/health-watch.sh` | Cron poller for API, Rust+, and FCM nuance; Discord ops webhook |
| `scripts/backup-vm.sh` | Weekly `rusttools-data` volume backup + restore helper |

### Ops Discord webhook

Create a **private ops channel** in your Discord server (separate from raid/alarm channels). Channel settings → **Integrations** → **Webhooks** → copy URL → set in `.env`:

```env
OPS_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Used by `health-watch.sh`, `disk-watch.sh`, and deploy notifications from `update-vm.sh`.

### Example crontab (on the VM)

```cron
# Health + FCM/Rust+ alerts (state-change only with --quiet)
*/10 * * * * cd /home/ubuntu/RustTools && ./scripts/health-watch.sh --quiet >>/tmp/rusttools-health-watch.log 2>&1

# Weekly backup (Sunday 03:15)
15 3 * * 0 cd /home/ubuntu/RustTools && ./scripts/backup-vm.sh >>/tmp/rusttools-backup.log 2>&1

# Optional: disk usage (daily)
0 8 * * * cd /home/ubuntu/RustTools && ./scripts/disk-watch.sh --quiet >>/tmp/rusttools-disk-watch.log 2>&1
```

Install `jq` on the VM if missing: `sudo apt install -y jq`.

### Scripts reference

| Script | Purpose |
|--------|---------|
| `scripts/health-watch.sh` | `curl` `/health`; alert on API/Rust+/FCM issues; `--quiet` uses `OPS_HEALTH_STATE_FILE` |
| `scripts/backup-vm.sh` | Tar `rusttools-data` volume; `--restore` for interactive restore |
| `scripts/disk-watch.sh` | Alert when disk usage exceeds `DISK_WARN_PCT` |
| `scripts/update-vm.sh` | Pull + rebuild on VM (local or over SSH); deploy webhook |

### GitHub Actions (optional)

| Workflow | Enable | Secrets / variables |
|----------|--------|---------------------|
| `.github/workflows/deploy-vm.yml` | Variable `VM_DEPLOY_ENABLED=true` | `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH` |
| `.github/workflows/smoke-scheduled.yml` | Variable `SMOKE_SCHEDULED_ENABLED=true` | `SMOKE_API_URL`, `SMOKE_INTERNAL_API_KEY` |

### What still needs manual intervention

| Task | Cadence |
|------|---------|
| FCM re-register | ~90 days (Chrome + bot Steam login) |
| Slash command register | When `commands.ts` changes |
| Server re-pair after wipe | Per wipe |
| Discord icon/banner | Rare — assets in `apps/discord-bot/assets/` |

Private maintainer notes (Phase P walkthrough, ops runbook) may also exist in `.local/` if you use the extended deploy walkthrough.

---

## Quick reference: local development

```bash
git clone https://github.com/SypherXN/RustTools.git
cd RustTools
./scripts/setup.sh
# Edit .env — checklist + data/DEPLOY-REMINDERS.txt (includes VITE_API_URL for GitHub Actions)

npm install
npm run db:migrate

npm run dev          # API http://localhost:3000 (4 GB heap for procgen parsing)
npm run dev:web      # UI http://localhost:5173 (proxies /api)
npm run dev:bot      # Discord bot

# Stop: Ctrl+C in each terminal, or kill processes on ports 3000 / 5173

npm run register-commands --workspace=@rusttools/discord-bot
npm run test:smoke     # API smoke tests (health, routes; live Rust+ optional)
```

Local OAuth redirect: `http://localhost:5173/api/auth/discord/callback`

Optional: `npm run dev:web:demo` for UI-only demo mode (`?demo=1`).

After FCM register, upload `fcm-config.json` in **Settings → Admin** instead of copying into `data/` manually.

---

## Support

If something breaks after following this guide, check `docker compose logs` for the relevant service and compare your `.env` against `.env.example`. Most issues are DNS, Discord redirect URI mismatches, or missing FCM config.
