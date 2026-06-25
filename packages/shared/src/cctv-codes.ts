import cctvData from "./data/cctv-codes.json" with { type: "json" };

export interface CctvEntry {
  codes: string[];
  dynamic: boolean;
}

const CCTV_BY_NAME = cctvData as Record<string, CctvEntry>;

/** Normalize monument token/name for CCTV lookup. */
function normalizeMonumentKey(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

const TOKEN_ALIASES: Record<string, string> = {
  "Large Oil Rig": "Large Oil Rig",
  "Small Oil Rig": "Small Oil Rig",
  oil_rig_2: "Large Oil Rig",
  oil_rig_1: "Small Oil Rig",
  airfield_display_name: "Airfield",
  bandit_town: "Bandit Camp",
  compound: "Outpost",
  launch_site: "Launch Site",
  military_tunnel: "Military Tunnel",
  trainyard: "Train Yard",
  powerplant: "Power Plant",
  water_treatment_plant: "Water Treatment Plant",
  satellite_dish: "Satellite Dish",
  excavator: "Excavator",
  junkyard: "Junkyard",
  sewer_branch: "Sewer Branch",
  ferry_terminal: "Ferry Terminal",
  underwater_lab: "Underwater Labs",
  abandoned_military_base: "Abandoned Military Base",
  missile_silo: "Missile Silo",
  dome_monument: "Dome",
  harbor_1: "Large Harbor",
  harbor_2: "Small Harbor",
};

export function getCctvForMonument(tokenOrName: string): CctvEntry | null {
  const raw = tokenOrName.trim();
  if (!raw) return null;

  const alias = TOKEN_ALIASES[raw.toLowerCase()] ?? TOKEN_ALIASES[raw];
  if (alias && CCTV_BY_NAME[alias]) return CCTV_BY_NAME[alias];

  const normalized = normalizeMonumentKey(raw);
  if (CCTV_BY_NAME[normalized]) return CCTV_BY_NAME[normalized];

  const lower = raw.toLowerCase();
  for (const [key, entry] of Object.entries(CCTV_BY_NAME)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return entry;
    }
  }

  return null;
}

export function listCctvMonuments(): string[] {
  return Object.keys(CCTV_BY_NAME).sort();
}

/** Static monument CCTV codes (excludes dynamic patterns with `*`). */
export function listStaticCctvCodes(): string[] {
  const codes = new Set<string>();
  for (const entry of Object.values(CCTV_BY_NAME)) {
    if (entry.dynamic) continue;
    for (const code of entry.codes) codes.add(code);
  }
  return [...codes].sort();
}
