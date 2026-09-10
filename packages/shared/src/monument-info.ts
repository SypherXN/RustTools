export interface MonumentRecycler {
  count: number;
  /** e.g. "50–60% (grid)" or "40% (safe zone, 8s)" */
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
      recyclers: [{ count: 1, efficiency: "40% (safe zone, 8s)", location: "Main compound" }],
      workbench: "Tier 1 + Tier 2",
      notes: [
        "No PvP or damage",
        "Vending machines and drone market",
        "Drone marketplace needs Power Plant grid (charges with 4+ fuses; orders need ≥50% battery)",
      ],
    },
  },
  {
    match: /bandit/i,
    info: {
      category: "Safe Zone (Tier 0)",
      description: "Bandit Camp — gambling, shops, and a safe recycler.",
      radiation: "None",
      lootReset: "Shop stock only — no monument loot crates.",
      recyclers: [{ count: 1, efficiency: "40% (safe zone, 8s)", location: "Near shops" }],
      workbench: "Tier 1",
      notes: ["No PvP or damage", "Casino and blackjack"],
    },
  },
  {
    match: /apartment/i,
    info: {
      category: "Safe Zone (Tier 1)",
      description:
        "Apartment Complex — rentable rooms and player-run shops in a safe-zone city block.",
      radiation: "None",
      lootReset: "Room rent and shop stock — not standard monument crates.",
      recyclers: [],
      workbench: "Tier 1 in rented rooms (built-in, not placeable)",
      notes: [
        "Rent rooms (basement / standard / penthouse) or marketplace shops with scrap",
        "Rented rooms are combat zones; monument exterior is safe zone",
        "Basement security terminal and master keys (~1000 scrap) for break-ins",
        "Repair bench, research table, elevators, mailboxes, playground",
        "CCTV: RADTOWNAPARTMENTS (+ per-room feeds in-game)",
        "Rentable shops refrigerate food when Power Plant grid is active",
      ],
    },
  },
  {
    match: /lighthouse/i,
    info: {
      category: "Tier 1",
      description: "Small coastal monument with basic barrels and crates.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      notes: ["Good early-wipe scrap run", "Low traffic"],
    },
  },
  {
    match: /gas_station/i,
    info: {
      category: "Tier 1",
      description: "Oxum's Gas Station — roadside loot plus a powered car garage.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      notes: ["Car lift/garage runs on island grid or a low-grade backup generator"],
    },
  },
  {
    match: /supermarket/i,
    info: {
      category: "Tier 1",
      description: "Small supermarket with food crates and powered freezers.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      notes: ["Food freezers run when island power grid is active (Power Trip)"],
    },
  },
  {
    match: /warehouse/i,
    info: {
      category: "Tier 1",
      description: "Open warehouse with crates and recycler access.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
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
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      keycards: "Green",
      notes: ["Single green card puzzle"],
    },
  },
  {
    match: /dome/i,
    info: {
      category: "Tier 1",
      description: "The Dome — climbable landmark with green-card puzzle room and crude pumps.",
      radiation: "15% protection",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)", location: "Green card puzzle room" }],
      keycards: "Green",
      notes: [
        "Recycler inside green-card + fuse puzzle room",
        "Three crude pumps (hose to vehicle tanker) — enabled via Oil Rig switch when grid is up",
        "Fuel pumps hold 1,000 crude each (Breach and Clear)",
        "Exposed loot at the top",
      ],
    },
  },
  {
    match: /sewer/i,
    info: {
      category: "Tier 2",
      description: "Sewer Branch with green card access and underground loot.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted (timer starts on first open).",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
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
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      scientists: "Small harbor: few · Large harbor: armed scientists",
      keycards: "Green (large harbor)",
      notes: ["Boat spawns", "Two size variants on map"],
    },
  },
  {
    match: /airfield/i,
    info: {
      category: "Tier 2 (Blue)",
      description: "Airfield with hangars, scientists, and a refreshed control tower.",
      radiation: "15% protection (higher in puzzle rooms)",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      keycards: "Green + Blue",
      workbench: "Tier 1",
      scientists: "5–7 patrolling",
      notes: [
        "Control tower terminals (grid-powered): faster airdrops or Chinook resupply crate",
        "Helicopter can visit",
        "Bradley APC nearby on some maps",
      ],
    },
  },
  {
    match: /train.?yard/i,
    info: {
      category: "Tier 2",
      description: "Train yard with multiple buildings and crate spawns.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      keycards: "Green",
      notes: ["Multiple loot buildings"],
    },
  },
  {
    match: /water_treatment/i,
    info: {
      category: "Tier 2",
      description: "Water treatment plant — maintainable pressurized tank feeds roadside water pipes.",
      radiation: "15% protection (higher in some rooms)",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      keycards: "Green",
      notes: [
        "Gearboxes pressurize tank (~3 h each; ~6 h at full pressure) — output scales with pressure",
        "Roadside water pipes are empty until WTP is maintained; pipes lose water when tank depletes",
        "Large footprint",
      ],
    },
  },
  {
    match: /power.?plant/i,
    info: {
      category: "Tier 2",
      description: "Power Plant — island grid hub with heavy fuses and elite recycler.",
      radiation: "25% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [
        { count: 1, efficiency: "75% (red, max grid, 4s)", location: "Green card room" },
      ],
      keycards: "Green + Blue",
      notes: [
        "Heavy fuses in green card room restore island-wide power stages (fuses decay over time)",
        "Bonus loot room unlocks at higher grid stages",
        "Powers marketplace, Dome crude pumps, WTP pipes, Airfield terminals, and more",
        "High foot traffic",
      ],
    },
  },
  {
    match: /launch_site/i,
    info: {
      category: "Tier 3 (Red)",
      description: "Largest monument — green/red puzzle, Bradley APC, and satellite crash control.",
      radiation: "23% protection (higher in puzzle rooms)",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [
        { count: 2, efficiency: "50–60% (grid)", location: "On-site" },
      ],
      keycards: "Green + Red",
      workbench: "Tier 1 + Tier 2",
      scientists: "9 patrolling + Bradley APC",
      notes: [
        "Monument blockers in red puzzle rooms (destroy once, no respawn — Breach and Clear)",
        "Satellite Crash terminal — steer a satellite impact when grid is restored (Power Trip)",
        "Bradley APC: ~60 min default respawn (server configurable)",
        "Highest-tier puzzle loot",
      ],
    },
  },
  {
    match: /military_tunnel/i,
    info: {
      category: "Tier 3 (Red)",
      description: "Underground tunnels with heavy scientist presence and red card access.",
      radiation: "23% at entrance; 26%+ deeper inside",
      lootReset: "Puzzle loot resets after containers are looted. Severe radiation ~10 min before refresh.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)", location: "Outside entrance area" }],
      keycards: "Green + Blue + Red",
      scientists: "~29 armed scientists",
      notes: [
        "Monument blockers in red puzzle rooms (Breach and Clear)",
        "Bradley APC outside",
        "No on-site workbench",
      ],
    },
  },
  {
    match: /oil_rig_1|small.?oil|oil.?small/i,
    info: {
      category: "Offshore (Tier 3)",
      description: "Small oil rig with scientists and a locked crate.",
      radiation: "0% on lower decks; 15%+ on upper levels",
      lootReset: "Locked crate: ~15 min after hack. Puzzle loot resets after looted.",
      recyclers: [],
      scientists: "Armed scientists on deck",
      notes: [
        "Switch in red puzzle room enables Dome crude pumps when island grid is up (Power Trip)",
        "Requires boat or air transport",
        "Locked crate marker appears on map when hacked",
      ],
    },
  },
  {
    match: /oil_rig_2|large.?oil|oil.?large/i,
    info: {
      category: "Offshore (Tier 3)",
      description: "Large oil rig with heavy scientist presence and elite loot.",
      radiation: "0% on lower decks; 25%+ on upper levels",
      lootReset: "Locked crate: ~15 min after hack. Puzzle loot resets after looted.",
      recyclers: [],
      scientists: "Heavy scientist presence",
      keycards: "Green + Blue + Red",
      notes: [
        "Switch in red puzzle room enables Dome crude pumps when island grid is up (Power Trip)",
        "Requires boat or air transport",
        "One of the highest PvE challenges",
      ],
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
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
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
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
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
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      keycards: "Green + Blue",
      scientists: "Armed scientists",
      notes: ["Bring warm clothing or tea", "Snow biome monument", "Cold exposure outside heated rooms"],
    },
  },
  {
    match: /large.?fishing|fishing.?large/i,
    info: {
      category: "Safe Zone",
      description: "Large fishing village with boats, vendors, and a safe-zone recycler.",
      radiation: "None",
      lootReset: "Shop stock and fish vendor — not a loot-crate monument.",
      recyclers: [{ count: 1, efficiency: "40% (safe zone, 8s)" }],
      notes: ["Boat vendor", "Safe-zone recycler (yellow)"],
    },
  },
  {
    match: /fishing/i,
    info: {
      category: "Special",
      description: "Fishing village with boats and basic loot.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [],
      notes: ["Boat vendor", "Only Large Fishing Village has a recycler (40% safe zone)"],
    },
  },
  {
    match: /underwater/i,
    info: {
      category: "Special (Underwater)",
      description: "Underwater lab with air pockets, scientists, and elite crates.",
      radiation: "None (drowning risk instead)",
      lootReset: "Crate loot: ~20–30 min. Puzzle loot resets after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
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
        "Monument blockers in red puzzle rooms (Breach and Clear)",
        "Hazmat (50%) works but isn't required — mixed armor kits are common",
        "Some objects deal radiation damage regardless of protection",
        "Longest monument run in the game",
      ],
    },
  },
  {
    match: /radtown/i,
    info: {
      category: "Tier 2",
      description: "Radtown — urban monument with CCTV and mixed loot.",
      radiation: "15% protection in some areas",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      notes: ["CCTV: RADTOWNAPARTMENTS, RADTOWNHOUSE, RADTOWNSBL"],
    },
  },
  {
    match: /ranch|barn|cabin/i,
    info: {
      category: "Tier 1",
      description: "Small rural monument with basic loot spawns.",
      radiation: "None",
      lootReset: "Standard crates: ~15 min after looted.",
      recyclers: [],
      notes: ["Low risk, low reward"],
    },
  },
  {
    match: /ferry/i,
    info: {
      category: "Tier 2",
      description: "Ferry Terminal with scientists, loot, and coastal access.",
      radiation: "15% protection in some areas",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [{ count: 1, efficiency: "50–60% (grid)" }],
      scientists: "Armed scientists",
      notes: ["Cobalt-style PvE monument", "Multiple CCTV feeds"],
    },
  },
  {
    match: /abandoned.*military|military.*base/i,
    info: {
      category: "Tier 2",
      description: "Abandoned Military Base with dynamic CCTV and military loot.",
      radiation: "15% protection",
      lootReset: "Puzzle loot resets after containers are looted.",
      recyclers: [],
      scientists: "Armed scientists",
      notes: [
        "Dynamic CCTV codes per wipe — check communications tent terminal",
        "COMPOUND****** / OUTDOOR****** pattern codes",
      ],
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

function monumentLookupNeedles(token: string): string[] {
  const stripped = token.replace(/_display_name$/i, "").replace(/_/g, " ");
  return stripped === token ? [token] : [token, stripped];
}

export function getMonumentInfo(token: string): MonumentInfo {
  const needles = monumentLookupNeedles(token);
  for (const entry of MONUMENT_ENTRIES) {
    if (needles.some((needle) => entry.match.test(needle))) return entry.info;
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
