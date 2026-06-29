# RustTools — Hands-off operations implementation plan

Structured backlog for making the VM stack (API + Discord bot + Caddy) mostly self-running, with clear intervention paths when needed.

**Companion:** private deploy steps in `.local/DEPLOY-WALKTHROUGH.md` (Phases N, O, P).  
**Public setup:** [docs/SETUP.md §16](SETUP.md#16-hands-off-operations-optional) (cron, webhooks, GHA).  
**Cursor plan:** `.cursor/plans/ops-hands-off.plan.md` (same #N and ids).

**Reference format:** Each task has a stable **#N** (number) and **`id`** (kebab-case). Use either — e.g. “implement **#1**” or “`/implement-by-id health-watch-script`”.

**Already shipped (not in backlog):**

| What | Benefit |
|------|---------|
| `docker-compose.yml` `restart: unless-stopped` | Auto-restart on crash and VM reboot |
| API Docker healthcheck | Unhealthy API detected; bot waits for healthy API |
| Discord bot Docker healthcheck | Detects crashed bot entrypoint |
| `scripts/update-vm.sh` | One-command manual deploy over SSH (+ optional deploy webhook) |
| `scripts/health-watch.sh` | Cron `/health` poller + ops Discord alerts (FCM/Rust+) |
| `scripts/backup-vm.sh` | Weekly Docker volume backup + restore helper |
| `scripts/disk-watch.sh` | Disk usage alerts for small Oracle boot volumes |
| `.github/workflows/deploy-vm.yml` | Optional push-to-main VM deploy |
| `.github/workflows/smoke-scheduled.yml` | Optional weekly production smoke tests |
| Phase N / O / P walkthrough | 24/7 + update + hands-off ops (`.local/`) |
| `/health` + FCM fields | Single endpoint for uptime tools and expiry checks |
| FCM web banner | In-app warning 14 days before FCM expiry |
| Web HUD background | Global orange circuit-grid backdrop (`apps/web/src/styles/background.css`) |
| Discord branding assets | `icon-512.png` + `discord-banner.png` (17:6 PCB banner) |

---

## Task index

| # | id | status | priority | benefit (one line) |
|---|-----|--------|----------|-------------------|
| 1 | `health-watch-script` | completed | critical | Discord/email when API, Rust+, or FCM goes bad |
| 2 | `backup-vm-script` | completed | critical | Recover from wipe, bad upgrade, or volume corruption |
| 3 | `uptime-monitor-guide` | completed | critical | Alert when VM/API is down without SSH |
| 4 | `walkthrough-phase-p` | completed | high | Single doc section tying ops tools + cron together |
| 5 | `ops-runbook` | completed | high | One-page “when I must touch it” cheat sheet |
| 6 | `deploy-vm-workflow` | completed | high | Push to `main` updates API+bot without SSH |
| 7 | `fcm-discord-alert` | completed | high | Proactive FCM renewal reminder before pairing breaks |
| 8 | `disk-watch-script` | completed | medium | Avoid silent full-disk failures on small VMs |
| 9 | `unattended-upgrades-doc` | completed | medium | OS security patches without remembering apt |
| 10 | `oracle-notifications-guide` | completed | medium | Know when Oracle stops or reclaims the instance |
| 11 | `bot-compose-healthcheck` | completed | medium | Detect stuck bot container; faster compose recovery |
| 12 | `update-notify-webhook` | completed | low | Confirm deploys finished in Discord ops channel |
| 13 | `weekly-smoke-cron` | completed | low | Catch regressions on live API without manual runs |
| 14 | `health-state-file` | completed | low | Cron alerts only on state *change* (less spam) |
| 15 | `bot-http-health` | cancelled | — | (Deferred) True bot liveness HTTP — high effort vs pgrep |
| 16 | `watchtower-deploy` | cancelled | — | (Deferred) Wrong model — images built from git, not pulled |
| 17 | `grafana-stack` | cancelled | — | (Deferred) Overkill for single A1 VM |

---

## Tasks

### [#1 health-watch-script] VM health watcher script

**Status:** completed  
**Priority:** critical

**Benefit:** You learn about outages, Rust+ disconnects, and FCM problems in Discord (or email) without SSH or checking the game UI. Closes the biggest “hands-off” gap: **nobody tells you when it’s broken**.

**Scope:** Add `scripts/health-watch.sh` that:

- Reads `DOMAIN` from `.env` (or `HEALTH_URL` override)
- `curl`s `https://$DOMAIN/health`
- Checks: `status == ok`, `rustplus.connected`, `fcm.listening`, `fcm.warning`, `fcm.expired`
- Posts to `OPS_DISCORD_WEBHOOK_URL` (optional) on failure or FCM warning
- Exit 0 on success, non-zero on actionable failure (for cron/monitoring)
- Optional: `--quiet` only alert on state change (pairs with `health-state-file`)

**Acceptance criteria:**

- [x] Script runs on VM without Node (bash + curl + jq)
- [x] Documented env vars in script header and walkthrough
- [x] Example crontab line (every 5–15 min) in `docs/OPS-AUTOMATION.md` or walkthrough Phase P
- [x] Does not spam: at minimum, document rate-limit / state-file pattern

**Shipped:** `scripts/health-watch.sh` — use `--quiet` for state-change-only Discord alerts.

**Cron example:**

```cron
*/10 * * * * cd /home/ubuntu/RustTools && ./scripts/health-watch.sh --quiet >>/tmp/rusttools-health-watch.log 2>&1
```

**Files:** `scripts/health-watch.sh`, `.env.example` (`OPS_DISCORD_WEBHOOK_URL`)

**Depends on:** none

---

### [#2 backup-vm-script] Scheduled data backup script

**Status:** completed  
**Priority:** critical

**Benefit:** Restore SQLite, FCM config, and procgen files after a bad `docker compose` upgrade, accidental `down -v`, or Oracle volume issues — **without** hoping the data still exists.

**Scope:** Add `scripts/backup-vm.sh` that:

- Tars Docker volume `rusttools-data` (name from `docker volume ls`)
- Writes `~/backups/rusttools-YYYYMMDD-HHMM.tar.gz`
- Prunes backups older than N days (default 28)
- Optional: `BACKUP_REMOTE` doc hook for `rclone` copy

**Acceptance criteria:**

- [x] Script creates backup and prints path + size
- [x] Restore steps documented (extract into volume or `docker compose cp`)
- [x] Weekly cron example in walkthrough Phase P
- [x] Safe to run while stack is up (SQLite WAL — document brief API pause if needed)

**Shipped:** `scripts/backup-vm.sh` — auto-detects `*rusttools-data` volume, prunes old archives, optional `rclone` via `BACKUP_REMOTE`.

**Restore:**

```bash
# Interactive restore (stops API, replaces volume contents, restarts)
./scripts/backup-vm.sh --restore ~/backups/rusttools-YYYYMMDD-HHMM.tar.gz
```

**Manual restore** (if you prefer explicit steps):

```bash
docker compose stop api discord-bot
docker run --rm -v rusttools_rusttools-data:/data -v ~/backups:/backup:ro alpine:3.20 \
  sh -c 'cd /data && find . -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /backup/rusttools-YYYYMMDD-HHMM.tar.gz'
docker compose start api discord-bot
```

Replace `rusttools_rusttools-data` with the name from `docker volume ls` (suffix `rusttools-data`).

**Cron example** (weekly, Sunday 03:15 UTC):

```cron
15 3 * * 0 cd /home/ubuntu/RustTools && ./scripts/backup-vm.sh >>/tmp/rusttools-backup.log 2>&1
```

**Optional:** `BACKUP_PAUSE_API=true` before major upgrades; off-site: `BACKUP_REMOTE=remote:path rclone` (requires [rclone](https://rclone.org/install/) configured).

**Files:** `scripts/backup-vm.sh`

**Depends on:** none

---

### [#3 uptime-monitor-guide] External uptime monitor setup

**Status:** completed  
**Priority:** critical

**Benefit:** Independent check from outside the VM (UptimeRobot / Better Stack / Healthchecks.io). Catches **whole VM down**, networking, and Caddy failures that in-VM cron cannot.

**Scope:** Document in walkthrough Phase P (no code required):

- URL: `https://YOUR_DOMAIN/health`
- Interval: 5 min
- Keyword or JSON check for `"status":"ok"`
- Alert channels: email + optional Discord webhook

**Acceptance criteria:**

- [x] Step-by-step for one free provider (e.g. UptimeRobot)
- [x] Note: monitor does not replace `health-watch-script` (FCM/Rust+ nuance)
- [x] Checklist item in `MY-DEPLOY-VALUES.md`

**Shipped:** `.local/DEPLOY-WALKTHROUGH.md` **Phase P** (UptimeRobot step-by-step, keyword check, complement vs `health-watch.sh`).

**Files:** `.local/DEPLOY-WALKTHROUGH.md`, `.local/MY-DEPLOY-VALUES.md`

**Depends on:** none

---

### [#4 walkthrough-phase-p] Walkthrough Phase P — hands-off ops

**Status:** completed  
**Priority:** high

**Benefit:** One place to configure cron, webhooks, backups, and external monitors after first deploy — reduces “I forgot which phase had the cron line”.

**Scope:** New Phase P in `.local/DEPLOY-WALKTHROUGH.md`:

- Tie together Phases N & O with scripts from this plan
- Crontab block: health-watch, backup, optional auto-update (from Phase O.3)
- Env vars table: `OPS_DISCORD_WEBHOOK_URL`, backup retention
- “Recommended minimum hands-off stack” (uptime + backup + FCM watch)

**Acceptance criteria:**

- [x] TOC updated
- [x] Cross-links to `scripts/*.sh`
- [x] Clear “minimum” vs “optional” tiers

**Shipped:** `.local/DEPLOY-WALKTHROUGH.md` **Phase P** — tiers (minimum/recommended/optional), ops env var table, crontab block (health-watch + backup + optional auto-update), UptimeRobot section, ties to Phases N & O and `OPS-RUNBOOK.md`.

**Files:** `.local/DEPLOY-WALKTHROUGH.md`

**Depends on:** #1, #2, #3

---

### [#5 ops-runbook] One-page ops runbook

**Status:** completed  
**Priority:** high

**Benefit:** When something *does* need hands-on, open one page: symptom → command → expected result. Faster than searching the full walkthrough.

**Scope:** `.local/OPS-RUNBOOK.md` with tables:

| Symptom | Fix |
| Bot offline | `docker compose ps` / `up -d` |
| Update | `./scripts/update-vm.sh` |
| FCM expiring | Re-register + Admin upload |
| After wipe | Re-pair server + devices |
| Disk full | `df -h`, prune backups/images |
| Logs | `docker compose logs -f api` |

**Acceptance criteria:**

- [x] Fits on ~1–2 screens when rendered
- [x] Linked from `.local/README.md`

**Shipped:** `.local/OPS-RUNBOOK.md` — symptom → command tables, scripts reference, monitor split.

**Files:** `.local/OPS-RUNBOOK.md`, `.local/README.md`

**Depends on:** none (can draft before scripts land)

---

### [#6 deploy-vm-workflow] GitHub Actions VM auto-deploy

**Status:** completed  
**Priority:** high

**Benefit:** Merge to `main` rebuilds API + bot on the VM automatically — no SSH for routine code fixes. Matches how GitHub Pages already auto-deploys the UI.

**Scope:** Add `.github/workflows/deploy-vm.yml`:

- Trigger: `push` to `main` on backend paths
- SSH via secrets: `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH`
- Remote: `./scripts/update-vm.sh`
- `workflow_dispatch` for manual trigger
- Document required secrets in `docs/OPS-AUTOMATION.md` + walkthrough Phase O.2

**Acceptance criteria:**

- [x] Workflow does not run until secrets configured (fails clearly, or use `if:` guard)
- [x] Path filters exclude web-only changes
- [x] No secrets in repo

**Shipped:** `.github/workflows/deploy-vm.yml` — guarded by repository variable `VM_DEPLOY_ENABLED=true`; requires secrets `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH`. Supports `workflow_dispatch`.

**Enable auto-deploy:**

1. Add deploy SSH key to VM `~/.ssh/authorized_keys`
2. GitHub → Settings → Secrets and variables → Actions:
   - **Variable:** `VM_DEPLOY_ENABLED` = `true`
   - **Secrets:** `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_REPO_PATH` (e.g. `/home/ubuntu/RustTools`)
3. Push a backend change to `main` or run workflow manually

Path filters: `apps/api`, `apps/discord-bot`, `packages`, `docker-compose.yml`, `scripts/update-vm.sh`, etc. — **not** `apps/web` (Pages workflow handles UI).

**Files:** `.github/workflows/deploy-vm.yml`, `.local/DEPLOY-WALKTHROUGH.md` (Phase O.2)

**Depends on:** `scripts/update-vm.sh` (exists)

---

### [#7 fcm-discord-alert] FCM expiry Discord alert

**Status:** completed  
**Priority:** high

**Benefit:** FCM dies ~every 90 days and silently breaks pairing/alarms. Warning at 14 days in UI is useless if nobody opens Settings. **Ops webhook reminds you to re-register before breakage.**

**Scope:** Implement as part of `health-watch-script` or thin wrapper:

- If `fcm.warning` or `fcm.expired` → Discord message with link to Admin FCM steps
- Optional: calendar reminder text in message (day 75 of 90)

**Acceptance criteria:**

- [x] Alert includes `daysRemaining` and `expiresAt` from `/health`
- [x] Separate from game alert channels (ops webhook only)
- [x] Documented in Phase P

**Shipped:** Implemented inside `scripts/health-watch.sh` when `OPS_DISCORD_WEBHOOK_URL` is set.

**Files:** `scripts/health-watch.sh`

**Depends on:** #1

---

### [#8 disk-watch-script] Disk space watcher

**Status:** completed  
**Priority:** medium

**Benefit:** Procgen maps, Docker layers, and logs can fill a 47 GB boot volume. Early warning avoids SQLite corruption and failed deploys.

**Scope:** `scripts/disk-watch.sh` or flag on `health-watch.sh`:

- Alert if `/` or Docker root > 85% (configurable)
- Suggest: `docker system prune`, old backups, procgen cleanup

**Acceptance criteria:**

- [x] Works on Oracle Ubuntu layout
- [x] Cron example (daily)
- [x] Optional Discord webhook reuse

**Shipped:** `scripts/disk-watch.sh` — checks `/` and `/var/lib/docker` (configurable); reuses `OPS_DISCORD_WEBHOOK_URL`; documented in Phase P crontab.

**Cron example:**

```cron
0 4 * * * cd /home/ubuntu/RustTools && ./scripts/disk-watch.sh --quiet >>/tmp/rusttools-disk-watch.log 2>&1
```

**Files:** `scripts/disk-watch.sh`, `.env.example`

**Depends on:** #1 (optional — can share webhook env)

---

### [#9 unattended-upgrades-doc] Ubuntu unattended security upgrades

**Status:** completed  
**Priority:** medium

**Benefit:** Kernel/openssl patches apply without you scheduling maintenance. VM stays patched for SSH/Docker surface.

**Scope:** Walkthrough subsection only:

- `unattended-upgrades` package
- `dpkg-reconfigure`
- Note: occasional reboot for kernel (pair with uptime monitor)

**Acceptance criteria:**

- [x] Commands copy-paste ready
- [x] Reboot caveat documented

**Shipped:** `.local/DEPLOY-WALKTHROUGH.md` **Phase P.6** — `unattended-upgrades` install, verify, reboot-after-kernel notes.

**Files:** `.local/DEPLOY-WALKTHROUGH.md`

**Depends on:** none

---

### [#10 oracle-notifications-guide] Oracle Cloud alert subscriptions

**Status:** completed  
**Priority:** medium

**Benefit:** Email when instance stops, reaches capacity limits, or billing anomalies — especially important on Always Free (capacity, idle reclaim policies).

**Scope:** Walkthrough doc: Oracle Console → Monitoring / Notifications setup (high level, links).

**Acceptance criteria:**

- [x] List recommended event types
- [x] Checklist in `MY-DEPLOY-VALUES.md`

**Shipped:** `.local/DEPLOY-WALKTHROUGH.md` **Phase P.7** — announcement emails, notification topic, compute alarms (stop/unreachable/CPU/disk), budget alert, event checklist.

**Recommended events:** instance stopped, accessibility failed, budget $0–$1, service announcements (idle reclamation).

**Files:** `.local/DEPLOY-WALKTHROUGH.md`, `.local/MY-DEPLOY-VALUES.md`

**Depends on:** none

---

### [#11 bot-compose-healthcheck] Discord bot Docker healthcheck

**Status:** completed  
**Priority:** medium

**Benefit:** If the bot process hangs but container stays up, `restart: unless-stopped` never fires. A weak healthcheck enables compose to mark unhealthy and restart.

**Scope:** Add to `docker-compose.yml` for `discord-bot`:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pgrep -f 'node.*discord-bot' || exit 1"]
  interval: 60s
  timeout: 5s
  retries: 3
```

Or document why pgrep is insufficient and defer to `bot-http-health`.

**Acceptance criteria:**

- [x] `docker compose ps` shows bot health status
- [x] No false positives on ARM image
- [x] Documented in walkthrough

**Shipped:** `docker-compose.yml` healthcheck on `discord-bot` — verifies PID 1 cmdline (no `procps`; works on `node:20-bookworm-slim` ARM). Documented in Phase F.1.

**Note:** Detects crashed entrypoint, not hung event loops — see deferred `bot-http-health` (#15).

**Files:** `docker-compose.yml`, `.local/DEPLOY-WALKTHROUGH.md`

**Depends on:** none

---

### [#12 update-notify-webhook] Deploy success/failure webhook

**Status:** completed  
**Priority:** low

**Benefit:** After `update-vm.sh` or GitHub deploy, a Discord ops message confirms version/commit — useful when auto-deploy runs while you’re away.

**Scope:** Optional tail of `update-vm.sh` + deploy workflow:

- Post commit hash, health curl result
- Env: `OPS_DISCORD_WEBHOOK_URL`

**Acceptance criteria:**

- [x] Skips silently if webhook unset
- [x] Failure path posts error snippet

**Shipped:** `scripts/update-vm.sh` — `post_deploy_webhook` on success (commit + health snippet) and on failure via `ERR` trap. Auto-deploy (`deploy-vm.yml`) calls the same script.

**Files:** `scripts/update-vm.sh`

**Depends on:** #6 (optional)

---

### [#13 weekly-smoke-cron] Scheduled smoke test against production

**Status:** completed  
**Priority:** low

**Benefit:** Catches API regressions (auth, internal routes) that `/health` alone misses.

**Scope:** Document cron on laptop or VM:

```bash
SMOKE_API_URL=https://DOMAIN INTERNAL_API_KEY=... npm run test:smoke
```

Note: needs Node on runner; VM can use `docker compose exec` or run from GitHub Actions scheduled workflow instead.

**Acceptance criteria:**

- [x] Document trade-offs (VM vs GHA scheduled)
- [x] Optional `.github/workflows/smoke-scheduled.yml` stub

**Shipped:** `.github/workflows/smoke-scheduled.yml` (weekly + `workflow_dispatch`, guarded by `SMOKE_SCHEDULED_ENABLED`). **Phase P.8** documents GHA vs laptop vs VM cron trade-offs.

**Enable:** variable `SMOKE_SCHEDULED_ENABLED=true`; secrets `SMOKE_API_URL`, `SMOKE_INTERNAL_API_KEY`.

**Files:** `.github/workflows/smoke-scheduled.yml`, `.local/DEPLOY-WALKTHROUGH.md` (Phase P.8)

**Depends on:** none

---

### [#14 health-state-file] Alert only on state change

**Status:** completed  
**Priority:** low

**Benefit:** Prevents Discord webhook spam when Rust+ is intentionally offline (server wipe, bot account logged out). Alert on **transition** to bad state, recovery message on fix.

**Scope:** `health-watch.sh` writes `/tmp/rusttools-health-state.json` (or `data/ops-health-state.json` in volume); compare before notify.

**Acceptance criteria:**

- [x] Repeated cron runs while still broken → no duplicate alerts (or daily digest)
- [x] Recovery notification optional via `OPS_NOTIFY_RECOVERY=true`

**Shipped:** `scripts/health-watch.sh` — `--quiet` compares `OPS_HEALTH_STATE_FILE` before webhook; recovery when `OPS_NOTIFY_RECOVERY=true`. Phase P cron uses `--quiet` by default.

**Files:** `scripts/health-watch.sh`

**Depends on:** #1

---

### [#15 bot-http-health] Bot HTTP health endpoint

**Status:** cancelled

**Benefit:** (Deferred) Reliable liveness beyond `pgrep` — bot could expose `:3001/health` with Discord gateway status.

**Reason deferred:** Requires bot code changes, port wiring in compose, more moving parts. Try `bot-compose-healthcheck` first.

**Depends on:** none

---

### [#16 watchtower-deploy] Watchtower auto-pull

**Status:** cancelled

**Benefit:** (Deferred) N/A — RustTools builds images from git on the VM, not from a registry. Watchtower does not replace `update-vm.sh`.

---

### [#17 grafana-stack] Grafana / Prometheus monitoring

**Status:** cancelled

**Benefit:** (Deferred) Pretty dashboards — disproportionate RAM/ops cost on A1 free tier for a single-tenant hobby deploy.

---

## Recommended implementation order

| Order | # | id | status |
|-------|---|-----|--------|
| 1 | 1 | `health-watch-script` | ✅ completed |
| 2 | 2 | `backup-vm-script` | ✅ completed |
| 3 | 3 | `uptime-monitor-guide` | ✅ completed |
| 4 | 4 | `walkthrough-phase-p` | ✅ completed |
| 5 | 5 | `ops-runbook` | ✅ completed |
| 6 | 7 | `fcm-discord-alert` (often same PR as #1) | ✅ completed |
| 7 | 6 | `deploy-vm-workflow` | ✅ completed |
| 8 | 11 | `bot-compose-healthcheck` | ✅ completed |
| 9 | 8 | `disk-watch-script` | ✅ completed |
| 10 | 9–10 | `unattended-upgrades-doc` + `oracle-notifications-guide` (docs only) | ✅ completed |
| 11 | 14 | `health-state-file` | ✅ completed |
| 12 | 12 | `update-notify-webhook` | ✅ completed |
| 13 | 13 | `weekly-smoke-cron` | ✅ completed |

## Minimum hands-off stack (if you only do three)

| # | id | What |
|---|-----|------|
| 3 | `uptime-monitor-guide` | External `/health` check |
| 2 | `backup-vm-script` | Weekly volume backup |
| 1 + 7 | `health-watch-script` + `fcm-discord-alert` | FCM + Rust+ nuance in Discord |

## What will always need manual intervention

| Task | Cadence | Why |
|------|---------|-----|
| FCM re-register | ~90 days | Chrome + bot Steam login |
| Slash command register | When commands change | Discord API one-shot |
| Server wipe re-pair | Per wipe | Game state |
| `.env` secrets | Rare | Must not live in git |

---

**Status:** Ops backlog complete (tasks #1–#14 shipped; #15–#17 cancelled). Configure cron and webhooks per [SETUP.md §16](SETUP.md#16-hands-off-operations-optional).
