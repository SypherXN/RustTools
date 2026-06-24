export interface MonumentRecycler {
  count: number;
  /** e.g. "100%" or "60% (safe zone)" */
  efficiency: string;
  location?: string;
}

export interface MonumentInfo {
  category: string;
  description: string;
  radiation: string;
  /** Minimum radiation protection % recommended (reference — varies by area). */
  /** Reference loot / puzzle reset behavior (not live Rust+ timers). */
  lootReset: string;
  recyclers: MonumentRecycler[];
  keycards?: string;
  workbench?: string;
  scientists?: string;
  notes: string[];
}

const MONUMENT_ENTRIES: Array<{ match: RegExp; info: MonumentInfo }> = [
  {
    match: /outpost/i,
    info: {
      category: "Safe Zone (Tier 0)",
      description: "Neutral hub with shops, repair bench, and workbenches.",
      radiation: "None",
      lootReset: "Shop stock only — no monument loot crates.",
      recyclers: [{ count: 1, efficiency: "60% (safe zone)", location: "Main compound" }],
      workbench: "Tier 1 + Tier 2",
      notes: ["No PvP or damage", "Vending machines and drone market"],
    },
  },
  {
    match: /bandit/i,
    info: {
      category: "Safe Zone (Tier 0)",
      description: "Bandit Camp — gambling, shops, and a safe recycler.",
      radiation: "None",
      lootReset: "Shop stock only — no monument loot crates.",
      recyclers: [{ count: 1, efficiency: "60% (safe zone)", location: "Near shops" }],
      workbench: "Tier 1",
      notes: ["No PvP or damage", "Casino and blackjack"],
    },
  },
  {
    match: /lighthouse/i,
    info: {
      category: "Tier 1",
      description: "Small coastal monument with basic barrels and crates.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Good early-wipe scrap run", "Low traffic"],
    },
  },
  {
    match: /gas_station/i,
    info: {
      category: "Tier 1",
      description: "Roadside gas station with barrels and a few crates.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Quick roadside stop"],
    },
  },
  {
    match: /supermarket/i,
    info: {
      category: "Tier 1",
      description: "Small supermarket with food crates and barrels.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Food and basic components"],
    },
  },
  {
    match: /warehouse/i,
    info: {
      category: "Tier 1",
      description: "Open warehouse with crates and recycler access.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Easy recycler access"],
    },
  },
  {
    match: /satellite/i,
    info: {
      category: "Tier 1",
      description: "Satellite dish with a small puzzle and crates.",
      radiation: "15% protection",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green",
      notes: ["Single green card puzzle"],
    },
  },
  {
    match: /dome/i,
    info: {
      category: "Tier 1",
      description: "The Dome — climbable landmark with crates at the top.",
      radiation: "15% protection",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%", location: "Ground level" }],
      notes: ["Recycler at base", "Exposed at the top"],
    },
  },
  {
    match: /sewer/i,
    info: {
      category: "Tier 2",
      description: "Sewer Branch with green card access and underground loot.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted (timer starts on first open).",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green",
      notes: ["Underground tunnels"],
    },
  },
  {
    match: /harbor/i,
    info: {
      category: "Tier 2",
      description: "Harbor with boats, scientists, and recycler access.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      scientists: "Small harbor: few · Large harbor: armed scientists",
      keycards: "Green (large harbor)",
      notes: ["Boat spawns", "Two size variants on map"],
    },
  },
  {
    match: /airfield/i,
    info: {
      category: "Tier 2 (Blue)",
      description: "Airfield with hangars, scientists, and a blue card puzzle.",
      radiation: "15% protection (higher in puzzle rooms)",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green + Blue",
      workbench: "Tier 1",
      scientists: "5–7 patrolling",
      notes: ["Helicopter can visit", "Bradley APC nearby on some maps"],
    },
  },
  {
    match: /train_yard/i,
    info: {
      category: "Tier 2",
      description: "Train yard with multiple buildings and crate spawns.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green",
      notes: ["Multiple loot buildings"],
    },
  },
  {
    match: /water_treatment/i,
    info: {
      category: "Tier 2",
      description: "Water treatment plant with spread-out loot and radiation pockets.",
      radiation: "15% protection (higher in some rooms)",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green",
      notes: ["Large footprint", "Multiple crate buildings"],
    },
  },
  {
    match: /power_plant/i,
    info: {
      category: "Tier 2",
      description: "Power plant with fuse puzzles and military crates.",
      radiation: "25% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green",
      notes: ["Fuse puzzles", "High foot traffic"],
    },
  },
  {
    match: /launch_site/i,
    info: {
      category: "Tier 3 (Red)",
      description: "Largest monument — green/red puzzle, elite loot, and Bradley APC.",
      radiation: "23% protection (higher in puzzle rooms)",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [
        { count: 2, efficiency: "100%", location: "On-site" },
      ],
      keycards: "Green + Red",
      workbench: "Tier 1 + Tier 2",
      scientists: "9 patrolling + Bradley APC",
      notes: ["Bradley APC: ~60 min default respawn (server configurable)", "Highest-tier puzzle loot"],
    },
  },
  {
    match: /military_tunnel/i,
    info: {
      category: "Tier 3 (Red)",
      description: "Underground tunnels with heavy scientist presence and red card access.",
      radiation: "23% at entrance; 26%+ deeper inside",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [{ count: 1, efficiency: "100%", location: "Outside entrance area" }],
      keycards: "Green + Blue + Red",
      scientists: "~29 armed scientists",
      notes: ["Bradley APC outside", "No on-site workbench"],
    },
  },
  {
    match: /small.*oil|oil.*small/i,
    info: {
      category: "Offshore (Tier 3)",
      description: "Small oil rig with scientists and a locked crate.",
      radiation: "0% on lower decks; 15%+ on upper levels",
      lootReset: "Locked crate: ~15 min after hack. Puzzle loot resets after looted.",
      recyclers: [],
      scientists: "Armed scientists on deck",
      notes: ["Requires boat or air transport", "Locked crate marker appears on map when hacked"],
    },
  },
  {
    match: /large.*oil|oil.*large|oil_rig/i,
    info: {
      category: "Offshore (Tier 3)",
      description: "Large oil rig with heavy scientist presence and elite loot.",
      radiation: "0% on lower decks; 25%+ on upper levels",
      lootReset: "Locked crate: ~15 min after hack. Puzzle loot resets after looted.",
      recyclers: [],
      scientists: "Heavy scientist presence",
      keycards: "Green + Blue + Red",
      notes: ["Requires boat or air transport", "One of the highest PvE challenges"],
    },
  },
  {
    match: /excavator/i,
    info: {
      category: "Quarry",
      description: "Giant excavator — trade diesel fuel for ore output.",
      radiation: "None",
      lootReset: "Ore production runs while diesel is loaded (not crate-based).",
      recyclers: [],
      notes: ["HQM, sulfur, or metal output modes", "Often heavily contested"],
    },
  },
  {
    match: /junkyard/i,
    info: {
      category: "Quarry / Yard",
      description: "Junkyard with magnet crane, shredder, and recycler.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Shredder for car parts", "Good component source"],
    },
  },
  {
    match: /quarry/i,
    info: {
      category: "Quarry",
      description: "Mining quarry — produces stone, sulfur, or HQM passively.",
      radiation: "None",
      lootReset: "Passive mining while powered with diesel.",
      recyclers: [],
      notes: ["Stone / sulfur / HQM modes", "Diesel fuel required"],
    },
  },
  {
    match: /mining_outpost/i,
    info: {
      category: "Tier 1",
      description: "Mining outpost with basic loot and a recycler.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Quiet alternative to larger monuments"],
    },
  },
  {
    match: /arctic/i,
    info: {
      category: "Tier 3",
      description: "Arctic research base with cold exposure and scientist guards.",
      radiation: "15% protection in heated areas",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green + Blue",
      scientists: "Armed scientists",
      notes: ["Bring warm clothing or tea", "Snow biome monument", "Cold exposure outside heated rooms"],
    },
  },
  {
    match: /fishing/i,
    info: {
      category: "Special",
      description: "Fishing village with boats and basic loot.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      notes: ["Boat vendor", "Good for early water travel"],
    },
  },
  {
    match: /underwater/i,
    info: {
      category: "Special (Underwater)",
      description: "Underwater lab with air pockets, scientists, and elite crates.",
      radiation: "None (drowning risk instead)",
      lootReset: "Crate loot: ~20–30 min. Puzzle loot resets after looted.",
      recyclers: [{ count: 1, efficiency: "100%" }],
      keycards: "Green + Blue + Red",
      scientists: "Armed scientists in corridors",
      notes: ["Rebreather or submarine access", "Multiple module layouts"],
    },
  },
  {
    match: /missile|silo|nuclear/i,
    info: {
      category: "Tier 3 (Red)",
      description: "Nuclear missile silo — deepest multi-floor PvE monument.",
      radiation: "~28% protection (10% on some surface areas; up to 50% in hotspots)",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [],
      keycards: "Green + Blue + Red",
      scientists: "Heavy scientist presence on all floors",
      notes: [
        "Hazmat (50%) works but isn't required — mixed armor kits are common",
        "Some objects deal radiation damage regardless of protection",
        "Longest monument run in the game",
      ],
    },
  },
  {
    match: /ranch|barn|abandoned/i,
    info: {
      category: "Tier 1",
      description: "Small rural monument with basic loot spawns.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [],
      notes: ["Low risk, low reward"],
    },
  },
];

const DEFAULT_INFO: MonumentInfo = {
  category: "Monument",
  description: "Monument location on the server map.",
  radiation: "Unknown — check monument type",
  lootReset: "Loot timers vary by crate type and server settings.",
  recyclers: [],
  notes: [],
};

export function getMonumentInfo(token: string): MonumentInfo {
  for (const entry of MONUMENT_ENTRIES) {
    if (entry.match.test(token)) return entry.info;
  }
  return DEFAULT_INFO;
}

export function formatMonumentRecyclers(recyclers: MonumentRecycler[]): string {
  if (recyclers.length === 0) return "None on-site";
  return recyclers
    .map((r) => {
      const qty = r.count > 1 ? `${r.count}× ` : "";
      const loc = r.location ? ` (${r.location})` : "";
      return `${qty}${r.efficiency}${loc}`;
    })
    .join(" · ");
}
