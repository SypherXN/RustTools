# RustTools game data version

Static Rust gameplay reference in RustTools (map monument facts, CCTV codes, recycle yields) is tracked separately from the RustTools app version (`0.1.0` in package.json).

**Source of truth in code:** `packages/shared/src/game-data-version.ts` (`RUST_GAME_DATA`, `RUST_GAME_DATA_PATCHES_APPLIED`).

## Current baseline

| Field | Value |
|-------|--------|
| **Last verified patch** | Printed and Polished |
| **Patch date** | 2026-11-05 (November forced wipe) |
| **RustTools audited** | 2026-11-09 |
| **Patches applied in data** | Common Ground → Power Trip → Breach and Clear → Livestock → Printed and Polished |
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

### Printed and Polished (2026-11-05)

- **Blueprint progression** — tech trees now cost Blueprint Fragments (Tier 1), Pages (Tier 2), and Books (Tier 3) instead of scrap; 10 Fragments combine into a Page, and Pages cannot become Books. Workbench crafting is back to scrap (50 / 500 / 1,250). The Research Table still uses scrap. RustTools has no tech-tree or blueprint calculator, so no app data changes.
- **Lighthouse** — lighthouses start damaged each wipe. Repair the light mechanism at the top to restore the island-wide system and open Deep Sea access; one repaired lighthouse restores every lighthouse.
- **Military Tunnels** — entrance blockers now require explosives, matching the blockers protecting red-card rooms.
- **The Ranch** — the vendor now focuses on mature, player-raised offspring; livestock vendor rewards are Blueprint Pages (previously Fragments). Animals become yours when purchased or when fed at your trough.
- **New items** — Uzi 9mm (loot-only, not craftable or researchable), Shears, Wool Armor Insert, Blueprint Fragment / Page / Book, and the Halloween 2026 cosmetics (Alien Costume, Skull Wall Lamp, Halloween Wreath, Halloween String Lights). All are in the item-name map as of the 2026-11-09 refresh.
- **Halloween event** — ran 2026-10-22 to 2026-11-05 and was disabled with this patch. It added scarecrows, mummies, candy hunts, portals into seasonal dungeons, and Frankenstein pets, but **no CCTV camera IDs**, so `cctv-codes.json` is unchanged.
- **Out of scope** — roaming scientist boat encounters (dynamic offshore spawns), fruit trees and bird flocks (visual), controller/gamepad support, stair mirroring, tea and consumable rebalancing, performance work, and Softcore/Hardcore rule changes.

## Pending (not yet in RustTools data)

- Camera IDs that only exist in-game (Underwater Lab wipe suffixes, apartment room cameras) are documented as in-game copy, not guessed — most servers also disable Rust+ CCTV streaming (`cctvrender.enabled`).

## Audit checklist (when a new patch drops)

1. Read [Rustafied](https://www.rustafied.com/) update post and [Facepunch news](https://rust.facepunch.com/news).
2. Check [RustHelp CCTV codes](https://rusthelp.com/tools/cctv-codes) for new/removed identifiers.
3. Update `monument-info.ts` for new monuments or recycler/keycard changes.
4. Update `cctv-codes.json` and `cctv-codes.ts` token aliases.
5. Run `node scripts/refresh-rust-items.mjs` when the patch adds or renames items — it regenerates `packages/shared/src/data/rust-items.json` from the Corrosion Hour item table (id / shortname / display name) and keeps any local-only entries.
6. Bump `RUST_GAME_DATA.patchName`, `patchDate`, `verifiedAt`; append to `RUST_GAME_DATA_PATCHES_APPLIED`; trim `pending`.
7. Update this file's history table.
8. Run `npm run build --workspace=@rusttools/shared`.

## History

| Verified | Patch | Notes |
|----------|-------|--------|
| 2026-11-09 | Printed and Polished | Item-name map refreshed from the Corrosion Hour item table (1,329 items) via `scripts/refresh-rust-items.mjs`; new items now resolve |
| 2026-11-08 | Printed and Polished | Blueprint rework (no app impact); Lighthouse repair gates Deep Sea; Military Tunnel entrance blockers need explosives; Ranch vendor update; new items missing from item map |
| 2026-10-20 | Livestock | No map or CCTV changes from the 2026-10-08 hotfixes; Halloween update pending; item-name map gap recorded |
| 2026-10-04 | Livestock | Power-grid loot rooms; Bandit `AIRWOLF` and helipad repair; Dome crude 15-minute delay; Ranch livestock vendor |
| 2026-09-20 | Breach and Clear | Satellite crash tracking; SPECTRE prefix documented (suffix in-game); apartment room CCTV in-game-only; HQM spawn-ground overlay |
| 2026-09-09 | Breach and Clear | Monument blockers; marketplace power; WTP rework notes; Dome fuel cap; grid recycler labels across monuments |
| 2026-09-09 | Power Trip | (same audit) Grid hub, red recycler, satellite terminal, maintainables at Dome/WTP/Airfield/Oxum's/Supermarket |
| 2026-07-30 | Common Ground | Apartment Complex + CCTV; recycler 40%/60% labels; SPECTRE code; tracker introduced |
| (prior) | Pre–Common Ground | Missing Apartment Complex; wrong recycler efficiencies |
