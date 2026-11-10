# RustTools handoff

Written 2026-09-26 for moving this working copy off WSL2. This file is safe for a public GitHub repo: **no tokens, keys, passwords, GPS, or public IPs**. Those live in the files named below.

## Locate

| | |
|---|---|
| **WSL path (former source)** | `/home/mattg/projects/RustTools` — **removed** after copy to Windows on 2026-09-26 |
| **Windows path (use this)** | `C:\Users\mattg\projects\RustTools` |
| **Git remote** | `https://github.com/SypherXN/RustTools.git` (`origin`) |
| **Branch** | `main` (tracks `origin/main`) |
| **HEAD when this was written** | `c062e171d662d9a412f259deb45536d0d84b81db` — *Update map monument data through Breach and Clear.* |
| **vs GitHub** | `main` matches `origin/main`. The satellite/CCTV/HQM work below is **uncommitted and not on GitHub or the VM**. |

## What it is

Self-hosted Rust companion for one team: Rust+ device control, live web dashboard, Discord bot, map/world-event tracking, automations, and optional CCTV.

**Account model:** one **master bot** Rust+ connection (FCM on the server) for devices and live data; teammates optionally link Steam ID and companion Rust+ in Settings for identity and leader promotion.

Public docs:

- [README.md](../README.md) — overview, local dev
- [FEATURES.md](../FEATURES.md) — product surface
- [docs/SETUP.md](SETUP.md) — production deploy
- [docs/OPS-AUTOMATION.md](OPS-AUTOMATION.md) — VM ops scripts and GHA
- [docs/GAME-DATA.md](GAME-DATA.md) — which Rust patch static game data is verified against

## Layout

npm workspaces (`apps/*`, `packages/*`). Node 20+.

```
apps/api/                 Fastify REST + WebSocket, Rust+, map poll, automations
apps/web/                 React SPA (Vite)
apps/discord-bot/         Slash commands → internal API
packages/shared/          Types, CCTV list, world-event helpers, game-data version
packages/db/              Drizzle + SQLite
packages/rustplus-client/ Rust+ manager, FCM, cameras
scripts/                  setup, VM update, health/backup/disk watch
docker-compose.yml        api + discord-bot + caddy
```

Local: `npm run dev` / `dev:web` / `dev:bot`. Production: Docker Compose on the VM; UI usually GitHub Pages.

## Secrets and private files (do not commit)

| What | Where |
|------|--------|
| Discord, session, encryption, API keys, domain, CORS, Twilio/SendGrid/VAPID, ops webhook | Repo-root `.env` (laptop) and the **same filename on the VM** (`~/RustTools/.env`). Template: `.env.example` |
| Filled-in IDs, URLs, Oracle instance notes | `.local/MY-DEPLOY-VALUES.md` (gitignored) |
| Private deploy walkthrough | `.local/DEPLOY-WALKTHROUGH.md` |
| Private ops cheat sheet | `.local/OPS-RUNBOOK.md` |
| FCM master-bot credentials | `data/fcm-config.json` (or `RUSTPLUS_FCM_CONFIG_PATH` in `.env`); also Docker volume `rusttools-data` on the VM |
| SQLite (local laptop DB; not production) | `data/rusttools.db` |
| Caddy extra site snippets (optional) | `$HOME/caddy-sites/*.caddy` (`EXTRA_CADDY_DIR` in `scripts/render-caddyfile.sh`) |
| SSH to the RustTools VM | `ssh rusttools` (OpenSSH config Host). Canonical fields: `ssh-info/SSH.md` (gitignored). Do not pass `-i` or `ubuntu@HOST` |
| GitHub Actions deploy | Repo **secrets** `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH`; **variable** `VM_DEPLOY_ENABLED`. Pages: **variable** `VITE_API_URL` |
| Discord Developer Portal | Bot token / OAuth client secret (copied into `.env`, not stored in git) |

`.gitignore` already excludes `.env`, `.local/`, `/ssh-info/`, `/data/`, `fcm-credentials.json`, `Caddyfile.generated`.

## Machines

Three places, not one:

| Host | Runs | Notes |
|------|------|--------|
| **This laptop** | Dev checkout, FCM CLI registration (Chrome), Discord slash-command register | Working copy: `C:\Users\mattg\projects\RustTools` (migrated from WSL `/home/mattg/projects/RustTools` on 2026-09-26) |
| **Oracle Cloud Always Free Ampere A1** (`VM.Standard.A1.Flex`, 2 OCPU / 12 GB) | Docker: **api**, **discord-bot**, **caddy** | Production backend. User `ubuntu`. Install dir `~/RustTools` (`/home/ubuntu/RustTools`) |
| **GitHub Pages** | Built React UI | `.github/workflows/deploy-pages.yml` on push to `main`. Needs `VITE_API_URL`. The VM can also serve UI if `WEB_DOMAIN` is set in `.env` |

A separate Oracle **E2.1.Micro** may run other household bots; it is **not** this stack.

Public hostname / DNS / IP: **not in this file**. Read `.local/MY-DEPLOY-VALUES.md` and VM `.env` keys `DOMAIN`, `WEB_DOMAIN`, `API_PUBLIC_URL`, `FRONTEND_URL`.

## VM: connect, deploy, health

**User:** `ubuntu`

**Connect:** `ssh rusttools`

Verified 2026-10-14. The local OpenSSH config Host `rusttools` supplies the key, user, and address. No `-i` and no `user@host`. A non-interactive check is `ssh -o BatchMode=yes rusttools`. Fields `/deploy` reads are in gitignored `ssh-info/SSH.md`. Host details for humans are in `.local/VM-SSH.md`.

```bash
ssh rusttools
cd ~/RustTools
```

**Deploy / update on the VM:**

```bash
cd ~/RustTools
./scripts/update-vm.sh
```

That fast-forwards `origin/main`, renders `Caddyfile.generated`, optionally builds the web UI if `WEB_DOMAIN` is set, then `docker compose up -d --build`. Optional ops Discord notify via `OPS_DISCORD_WEBHOOK_URL` in `.env`.

From the laptop you SSH in and run that script; it is not a local-only pull. GitHub Actions `.github/workflows/deploy-vm.yml` does the same over SSH when `VM_DEPLOY_ENABLED=true`.

**Uncommitted laptop work is not on the VM.** Push `main` first, then update the VM. Slash-command **definitions** were registered from this laptop (`npm run register-commands --workspace=@rusttools/discord-bot`); the **handler** for `/satellite` is in the uncommitted tree, so the live bot will not implement it until that code is committed, pushed, and the VM rebuilt.

**Check it is up:**

```bash
# on VM
docker compose ps
curl -fsS "https://${DOMAIN}/health"

# or from laptop, using DOMAIN from .env / .local/MY-DEPLOY-VALUES.md
curl -fsS "https://DOMAIN/health"
```

Expect JSON with `status`, Rust+ `connected`, and FCM listening/expiry fields. Cron on the VM: `scripts/health-watch.sh --quiet` (see `docs/SETUP.md` §16). Logs: `docker compose logs api --tail 50`.

## Work already done (committed on `main`)

Recent `main` includes (newest first): monument/CCTV/game-data through Facepunch **Breach and Clear**; ponytail audit cleanup; team-chat markup/sender-name fixes; 3D terrain / map scaling fixes; custom alarm sound upload; FCM credentials migration fix. Broader product is documented in FEATURES.md (devices, map, automations, Discord, alerts, ops scripts).

Game-data baseline in code: `packages/shared/src/game-data-version.ts` (Breach and Clear, 2026-09-03; last audit stamp 2026-09-20 in the uncommitted tree).

## Uncommitted working-tree changes (not pushed)

About **40 files, +581 / −62**, all modified. **`docs/HANDOFF.md` is untracked** (this file); everything else in that diff set is modified tracked files.

**Intended feature work (do 1–4 from game-data pending):**

1. **Satellite crash** as a world event: name-match GENERIC/CRATE/EXPLOSION (exclude Satellite Dish); crate-cool ~5 min; cooldown ~35 min; dock, dashboard, `!satellite` / `/satellite`, map-event alert type `satellite`.
2. **SPECTRE\*\*\*\*** CCTV: documented as a 4-digit wipe prefix; suffix is in-game only.
3. **Apartment CCTV:** still only public ID `RADTOWNAPARTMENTS`; room cameras are basement-terminal only.
4. **HQM procgen overlay:** parser v3; spawn-ground Decor/Cliffside/Clutter — `.map` files do not mark HQM vs other ores.

Cameras: treat monument IDs as **Computer Station reference**. Most servers leave `cctvrender.enabled` off; the Cameras page says so.

Also dirty: `scripts/render-caddyfile.sh` (append extra Caddy snippets from `EXTRA_CADDY_DIR` / `~/caddy-sites`). Unrelated to the four game-data items.

**Not done:** commit, push, VM deploy of this tree. Re-register Discord commands again after the bot container is running the new `commands.ts` if the live list drifts.

## Local dev after the move

```bash
cd C:\Users\mattg\projects\RustTools   # or the WSL mount of that path
npm install
# .env should have been copied with the working tree (gitignored)
npm run dev
npm run dev:web
npm run dev:bot
```

Do not copy `node_modules` / `dist` from WSL; reinstall and rebuild.

## Cursor / implementer notes

Workspace rule: multi-file implementation may go through local Codex MCP (`user-codex`) / NInfer rather than the chat model. Skill: `.cursor/skills` / user `delegate-qwen`. SSH for the VM is `ssh rusttools`, not a `-i` key path.
