# RustTools game data version

Static Rust gameplay reference in RustTools (map monument facts, CCTV codes, recycle yields) is tracked separately from the RustTools app version (`0.1.0` in package.json).

**Source of truth in code:** `packages/shared/src/game-data-version.ts` (`RUST_GAME_DATA`, `RUST_GAME_DATA_PATCHES_APPLIED`).

## Current baseline

| Field | Value |
|-------|--------|
| **Last verified patch** | Breach and Clear |
| **Patch date** | 2026-09-03 (September forced wipe) |
| **RustTools audited** | 2026-09-09 |
| **Patches applied in data** | Common Ground → Power Trip → Breach and Clear |
| **Map data files** | `packages/shared/src/monument-info.ts`, `packages/shared/src/data/cctv-codes.json`, `packages/shared/src/cctv-codes.ts` |

## Patch coverage summary

### Common Ground (2026-07-02)

- Apartment Complex monument + `RADTOWNAPARTMENTS` CCTV
- Recycler yield labels: 40% safe zone / 60% monument baseline (pre–Power Trip)

### Power Trip (2026-08-06)

- **Player-maintained monuments** — Power Plant heavy-fuse grid powers cross-monument systems
- **Recyclers** — green monuments 50% unpowered → 60% with grid; Power Plant **red** recycler 75% at max grid (4s)
- **Launch Site** — Satellite Crash control terminal
- **Dome** — crude pumps via Oil Rig switch + grid
- **Water Treatment** — pressurized tank feeds roadside water pipes
- **Airfield** — control tower terminals (airdrop rate / Chinook crate)
- **Oxum's** — powered car garage; **Supermarket** — powered freezers
- **Large Oil Rig** — switch enables Dome crude flow

### Breach and Clear (2026-09-03)

- **Monument blockers** in red-keycard puzzle rooms (Launch Site, Military Tunnel, Missile Silo, etc.)
- **Outpost drone marketplace** requires Power Plant grid battery (4+ fuses to charge; orders need ≥50%)
- **Water Treatment** gearbox rework (~3 h per gearbox; output scales with tank pressure)
- **Dome** fuel pumps reduced to 1,000 crude capacity
- **Apartment** rentable shops refrigerate when grid is active
- **HQM nodes/collectables** on procedural maps (not yet in procgen overlays)
- TC upkeep group scaling, honey bandage, heli/HAB armor — **out of scope** for map static data

## Pending (not yet in RustTools data)

| Item | Notes |
|------|--------|
| Satellite crash world-event tracking | Map poll / event dock — terminal exists at Launch Site |
| HQM node procgen overlays | New world spawns from Breach and Clear |
| Underwater `SPECTRE****` CCTV suffix | Verify per wipe |
| Apartment per-room CCTV beyond `RADTOWNAPARTMENTS` | |

## Audit checklist (when a new patch drops)

1. Read [Rustafied](https://www.rustafied.com/) update post and [Facepunch news](https://rust.facepunch.com/news).
2. Check [RustHelp CCTV codes](https://rusthelp.com/tools/cctv-codes) for new/removed identifiers.
3. Update `monument-info.ts` for new monuments or recycler/keycard changes.
4. Update `cctv-codes.json` and `cctv-codes.ts` token aliases.
5. Bump `RUST_GAME_DATA.patchName`, `patchDate`, `verifiedAt`; append to `RUST_GAME_DATA_PATCHES_APPLIED`; trim `pending`.
6. Update this file's history table.
7. Run `npm run build --workspace=@rusttools/shared`.

## History

| Verified | Patch | Notes |
|----------|-------|--------|
| 2026-09-09 | Breach and Clear | Monument blockers; marketplace power; WTP rework notes; Dome fuel cap; grid recycler labels across monuments |
| 2026-09-09 | Power Trip | (same audit) Grid hub, red recycler, satellite terminal, maintainables at Dome/WTP/Airfield/Oxum's/Supermarket |
| 2026-07-30 | Common Ground | Apartment Complex + CCTV; recycler 40%/60% labels; SPECTRE code; tracker introduced |
| (prior) | Pre–Common Ground | Missing Apartment Complex; wrong recycler efficiencies |
