/**
 * Tracks which Rust PC patch RustTools static game data (map monument info, CCTV codes, etc.)
 * has been verified against. Update this when auditing Facepunch patch notes or wiki changes.
 */
export interface RustGameDataCoverage {
  /** Facepunch patch / devblog name, e.g. "Common Ground". */
  patchName: string;
  /** First public release date (ISO), usually the monthly forced-wipe Thursday. */
  patchDate: string;
  /** When RustTools last audited game data against patches and wikis. */
  verifiedAt: string;
  /** Primary references used for the audit. */
  sources: string[];
  /** Known gaps — features on main/dev or documented but not yet reflected in data files. */
  pending: string[];
}

/** Patches reflected in static game data (oldest → newest). */
export const RUST_GAME_DATA_PATCHES_APPLIED: ReadonlyArray<{
  patchName: string;
  patchDate: string;
}> = [
  { patchName: "Common Ground", patchDate: "2026-07-02" },
  { patchName: "Power Trip", patchDate: "2026-08-06" },
  { patchName: "Breach and Clear", patchDate: "2026-09-03" },
];

/** Current RustTools game-data baseline (map monument panel, CCTV list, etc.). */
export const RUST_GAME_DATA: RustGameDataCoverage = {
  patchName: "Breach and Clear",
  patchDate: "2026-09-03",
  verifiedAt: "2026-09-09",
  sources: [
    "https://rust.facepunch.com/news/breach-and-clear",
    "https://rust.facepunch.com/news/power-trip",
    "https://www.rustafied.com/updates/2026/9/3/breach-and-clear-update-incoming",
    "https://www.rustafied.com/updates/2026/8/6/power-trip-update",
    "https://rusthelp.com/tools/cctv-codes",
  ],
  pending: [
    "Satellite crash as a tracked map/world event (Launch Site terminal — loot timers, cooldown)",
    "Underwater Lab SPECTRE dynamic CCTV suffix — verify in-game per wipe",
    "Apartment per-room CCTV codes beyond RADTOWNAPARTMENTS",
    "Procgen map overlays for new HQM world nodes (Breach and Clear)",
  ],
};

export function formatRustGameDataLabel(data: RustGameDataCoverage = RUST_GAME_DATA): string {
  const d = new Date(`${data.patchDate}T12:00:00`);
  const month = d.toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${data.patchName} (${month})`;
}
