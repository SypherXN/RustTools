# RustTools game data version

Static Rust gameplay reference in RustTools (map monument facts, CCTV codes, recycle yields) is tracked separately from the RustTools app version (`0.1.0` in package.json).

**Source of truth in code:** `packages/shared/src/game-data-version.ts` (`RUST_GAME_DATA`, `RUST_GAME_DATA_PATCHES_APPLIED`).

## Current baseline

| Field | Value |
|-------|--------|
| **Last verified patch** | Livestock |
| **Patch date** | 2026-10-01 (October forced wipe) |
| **RustTools audited** | 2026-10-04 |
| **Patches applied in data** | Common Ground → Power Trip → Breach and Clear → Livestock |
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
- **HQM nodes/collectables** on procedural maps — procgen overlay uses Decor/Cliffside/Clutter spawn ground (`.map` files do not distinguish HQM from other ores)
- TC upkeep group scaling, honey bandage, heli/HAB armor — **out of scope** for map static data

### Livestock (2026-10-01)

- **Power-grid loot rooms** — Heavy Fuses at Power Plant open extra rooms at Airfield, Ferry Terminal, Harbor 1, Harbor 2, Junkyard, Launch Site, Military Tunnels, Missile Silo, Radtown, Sewer Branch, Train Yard, and Water Treatment. Fuse counts and crate mixes are from Rustafied testing (Facepunch did not publish them). The small fuse box is reachable through a broken window. Fuse decay is about 4× slower at 10 or fewer players and normal at 100 or more.
- **Bandit Camp** — Air Wolf helipad starts broken each wipe (30,000 wood, 10,000 metal fragments, 100 rope). New public camera `AIRWOLF`.
- **Dome / Oil Rig** — crude starts flowing 15 minutes after the Oil Rig switch, not immediately.
- **The Ranch** — livestock vendor (calves 300 scrap, lambs 150, sales of grown animals and wool up to 400).
- Cows, sheep, critters, milk, wool, biofuel generator, stacked sandbags, teas, and the render pipeline — **out of scope**. The smaller HQM pickup is a model change, not a spawn-rule change.

## Pending (not yet in RustTools data)

None for the Livestock baseline. Camera IDs that only exist in-game (Underwater Lab wipe suffixes, apartment room cameras) are documented as in-game copy, not guessed — most servers also disable Rust+ CCTV streaming (`cctvrender.enabled`). A Halloween content update is scheduled for 2026-10-22 and is not in this data.

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
| 2026-10-04 | Livestock | Power-grid loot rooms; Bandit `AIRWOLF` and helipad repair; Dome crude 15-minute delay; Ranch livestock vendor |
| 2026-09-20 | Breach and Clear | Satellite crash tracking; SPECTRE prefix documented (suffix in-game); apartment room CCTV in-game-only; HQM spawn-ground overlay |
| 2026-09-09 | Breach and Clear | Monument blockers; marketplace power; WTP rework notes; Dome fuel cap; grid recycler labels across monuments |
| 2026-09-09 | Power Trip | (same audit) Grid hub, red recycler, satellite terminal, maintainables at Dome/WTP/Airfield/Oxum's/Supermarket |
| 2026-07-30 | Common Ground | Apartment Complex + CCTV; recycler 40%/60% labels; SPECTRE code; tracker introduced |
| (prior) | Pre–Common Ground | Missing Apartment Complex; wrong recycler efficiencies |
