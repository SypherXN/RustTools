# Ponytail audit — implementation tracker

Repo-wide complexity audit (ponytail-audit). Each task has a stable **`id`** and **`num`** for `/implement-by-id`.

**Plan file:** [`.cursor/plans/ponytail-audit.plan.md`](../.cursor/plans/ponytail-audit.plan.md)

**Estimated net:** ~450 lines, 3 npm deps removed (`nanoid`, `dotenv` ×2) — **all tasks complete**.

---

## Task index

| # | id | status | what implementing does |
|---|-----|--------|-------------------------|
| 1 | `dead-unused-exports` | completed | Remove `demoVendingResults`, `getApiCacheTimestamp` — no behavior change |
| 2 | `dead-deprecated-fns` | completed | Remove deprecated formatters with zero callers |
| 3 | `dead-barrel-files` | completed | Delete `procgen/index`, `useWebSocket` barrel; fix imports |
| 4 | `dead-fcm-legacy` | completed | Remove dead FCM exports; update smoke script |
| 5 | `config-unused-fields` | completed | Drop unused `config.ts` fields and env aliases |
| 6 | `deepsea-env-remove` | completed | Deep Sea alerts UI/DB only; drop `AUTOMATION_DEEP_SEA_*` env |
| 7 | `nanoid-uuid` | completed | UUID ids for new rows; remove `nanoid` dep |
| 8 | `dotenv-env-file` | completed | Node `--env-file`; remove `dotenv` dep |
| 9 | `http-wrapper-shrink` | completed | Collapse thin Discord/bot/chat HTTP wrappers |
| 10 | `formatters-unify` | completed | One coord/quantity/duration formatter set in shared |
| 11 | `misc-thin-dedup` | completed | Inline small hooks; dedupe FCM type; devDep `@types/three` |
| 12 | `discord-commands-remove` | completed | Remove dead `commands` channel purpose; fix Settings/docs |
| 13 | `automation-env-once` | completed | **Behavior:** `.env` automations no longer override saved Settings |
| 14 | `discord-info-env` | completed | Drop `DISCORD_INFORMATION_CHANNEL_ID` env fallback |
| 15 | `demo-router-shrink` | completed | Shorter `demo.ts` via prefix catch-alls; demo-only |
| 16 | `demo-mode-parity` | completed | Fix `?demo=1` vs `VITE_DEMO_MODE` docs or code |
| 17 | `notification-callbacks` | completed | Replace `NotificationService` class with callbacks |
| 18 | `radius-meters-only` | completed | **Behavior:** meters-only radius; migrate/read fallback for `radiusGrid` |

---

## Implementation order

1. ✅ #1 `dead-unused-exports`
2. ✅ #2 `dead-deprecated-fns`
3. ✅ #3 `dead-barrel-files`
4. ✅ #4 `dead-fcm-legacy`
5. ✅ #5 `config-unused-fields`
6. ✅ #6 `deepsea-env-remove`
7. ✅ #7 `nanoid-uuid`
8. ✅ #8 `dotenv-env-file`
9. ✅ #9 `http-wrapper-shrink`
10. ✅ #10 `formatters-unify`
11. ✅ #11 `misc-thin-dedup`
12. ✅ #12 `discord-commands-remove`
13. ✅ #13 `automation-env-once`
14. ✅ #14 `discord-info-env`
15. ✅ #15 `demo-router-shrink`
16. ✅ #16 `demo-mode-parity`
17. ✅ #17 `notification-callbacks`
18. ✅ #18 `radius-meters-only`

---

## Phases (risk summary)

| Phase | Tasks | User impact |
|-------|-------|-------------|
| **A — Safe deletes** | #1–#6 | None — ✅ |
| **B — Dependencies** | #7–#8 | New IDs are UUIDs; verify Docker start — ✅ |
| **C — Maintainability** | #9–#11 | None intentional — ✅ (#10 formatters too) |
| **D — Config honesty** | #12–#14 | ✅ |
| **E — Demo** | #15–#16 | ✅ |
| **F — Larger** | #17–#18 | ✅ |

---

## Out of scope

- Shrinking `RustPlusManager`, `api-cache`, `JobScheduler`
- Removing Twilio / SendGrid / VAPID
- Removing `patch-package` for `@liamcottle/rustplus.js`

---

## Per-task detail

See plan file sections `### [#N] [id]` for acceptance criteria and file lists.

**Next:** All plan tasks complete. Optional: `/plan-status docs/PONYTAIL-AUDIT.md`
