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
  { patchName: "Livestock", patchDate: "2026-10-01" },
  { patchName: "Printed and Polished", patchDate: "2026-11-05" },
];

/** Current RustTools game-data baseline (map monument panel, CCTV list, etc.). */
export const RUST_GAME_DATA: RustGameDataCoverage = {
  patchName: "Printed and Polished",
  patchDate: "2026-11-05",
  verifiedAt: "2026-11-08",
  sources: [
    "https://rust.facepunch.com/news/printed_and_polished",
    "https://www.rustafied.com/updates/2026/11/5/november-update-incoming",
    "https://www.rustafied.com/updates/2026/10/29/blueprint-changes-roaming-scientists-and-more",
    "https://www.rustafied.com/updates/2026/10/22/halloween-event-goes-live",
    "https://rusthelp.com/tools/cctv-codes",
  ],
  pending: [
    "rust-items.json item-name map last refreshed 2026-06-24; Livestock-era items (Milk, Wool, Biofuel Generator) and newer items (Uzi 9mm, Shears, Wool Armor Insert, Blueprint Fragment/Page/Book, Halloween 2026 cosmetics) missing",
  ],
};

export function formatRustGameDataLabel(data: RustGameDataCoverage = RUST_GAME_DATA): string {
  const d = new Date(`${data.patchDate}T12:00:00`);
  const month = d.toLocaleString("en-US", { month: "short", year: "numeric" });
  return `${data.patchName} (${month})`;
}
