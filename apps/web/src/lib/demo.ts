import type {
  AuthUserResponse,
  NotificationSettingsResponse,
  TeamApiResponse,
  TeamChatMessage,
  TeamDeathEvent,
  TeamRosterMember,
} from "@rusttools/shared";
import {
  aggregateStorageItemSearch,
  DEFAULT_SERVER_NOTIFICATION_SETTINGS,
  FULL_USER_PERMISSIONS,
  parseStorageEntityInfo,
  resolveStorageMonitorIcon,
  searchVendingListings,
  STORAGE_CONTAINER_ICON_CATALOG,
} from "@rusttools/shared";

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === "true";
}

export const demoUser: AuthUserResponse = {
  user: {
    id: "demo-user",
    discordId: "000000000000000000",
    discordUsername: "Demo Player",
    discordAvatar: null,
    steamId: "76561198000000000",
  },
  linkedRust: true,
  pendingRustLink: false,
  permissions: {
    view: FULL_USER_PERMISSIONS.view,
    switch: FULL_USER_PERMISSIONS.switch,
    admin: FULL_USER_PERMISSIONS.admin,
  },
  rolesConfigured: false,
};

export const demoServers = [
  {
    id: "demo-server-1",
    name: "US West — Demo Server",
    ip: "192.168.1.100",
    port: 28015,
    isActive: true,
  },
  {
    id: "demo-server-2",
    name: "EU Main — Backup",
    ip: "10.0.0.50",
    port: 28016,
    isActive: false,
  },
];

let demoNotificationSettings: NotificationSettingsResponse = {
  settings: {
    smartAlarm: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.smartAlarm },
    deepSea: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.deepSea },
    teamChatBot: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.teamChatBot },
    eventTimers: { ...DEFAULT_SERVER_NOTIFICATION_SETTINGS.eventTimers },
  },
  capabilities: {
    discordConfigured: true,
    rustPlusConnected: true,
  },
};

const demoDeepSeaStatus = {
  phase: "closed" as const,
  isOpen: false,
  offshoreVendingCount: 0,
  deepSeaMonumentCount: 0,
  openedAt: null,
  closedAt: Math.floor(Date.now() / 1000) - 3600,
  nextTransitionAt: Math.floor(Date.now() / 1000) + 3600,
  secondsRemaining: 3600,
  label: "Closed — opens in ~1h 0m",
  source: "estimated" as const,
};

const demoWorldEventsStatus = {
  updatedAt: Math.floor(Date.now() / 1000),
  cargo: {
    active: true,
    x: 1200,
    y: 900,
    grid: "H12",
    sinceSec: Math.floor(Date.now() / 1000) - 600,
    egressInSec: 2100,
    trail: [
      { x: 1100, y: 850, t: Math.floor(Date.now() / 1000) - 300 },
      { x: 1150, y: 875, t: Math.floor(Date.now() / 1000) - 150 },
      { x: 1200, y: 900, t: Math.floor(Date.now() / 1000) },
    ],
  },
  heli: {
    active: false,
    x: null,
    y: null,
    grid: null,
    sinceSec: Math.floor(Date.now() / 1000) - 3600,
    egressInSec: null,
    trail: [],
  },
  chinook: {
    active: false,
    x: null,
    y: null,
    grid: null,
    sinceSec: Math.floor(Date.now() / 1000) - 7200,
    egressInSec: null,
    trail: [],
  },
  vendor: {
    active: false,
    x: null,
    y: null,
    grid: null,
    sinceSec: null,
    egressInSec: null,
    trail: [],
  },
  oilRigs: {
    small: {
      triggered: false,
      triggeredAt: null,
      crateUnlockAt: null,
      crateUnlockInSec: null,
      crateUnlockLabel: null,
      lastTriggeredAt: null,
    },
    large: {
      triggered: true,
      triggeredAt: Math.floor(Date.now() / 1000) - 300,
      crateUnlockAt: Math.floor(Date.now() / 1000) + 600,
      crateUnlockInSec: 600,
      crateUnlockLabel: "10m",
      lastTriggeredAt: Math.floor(Date.now() / 1000) - 300,
    },
  },
  stats: {
    cargoLastSpawnAt: Math.floor(Date.now() / 1000) - 600,
    cargoLastDespawnAt: null,
    heliLastSpawnAt: Math.floor(Date.now() / 1000) - 7200,
    heliLastDespawnAt: Math.floor(Date.now() / 1000) - 3600,
    heliLastDownAt: Math.floor(Date.now() / 1000) - 3600,
    chinookLastSpawnAt: Math.floor(Date.now() / 1000) - 7200,
    chinookLastDespawnAt: Math.floor(Date.now() / 1000) - 7000,
    vendorLastSpawnAt: null,
    vendorLastDespawnAt: null,
    oilSmallLastTriggeredAt: null,
    oilLargeLastTriggeredAt: Math.floor(Date.now() / 1000) - 300,
  },
};

export const demoDevices = [
  {
    id: "dev-1",
    entityId: 10001,
    entityType: "smart_switch",
    name: "Front Door",
    displayName: "Front Door Lights",
  },
  {
    id: "dev-2",
    entityId: 10002,
    entityType: "smart_switch",
    name: "SAM Site",
    displayName: "SAM Site",
  },
  {
    id: "dev-3",
    entityId: 10003,
    entityType: "smart_alarm",
    name: "Core Alarm",
    displayName: "Core Alarm",
  },
  {
    id: "dev-4",
    entityId: 10004,
    entityType: "storage_monitor",
    name: "Main TC",
    displayName: "Main TC",
  },
];

export const demoMonitors = [
  {
    id: "dev-4",
    name: "Main TC",
    displayName: "Main TC",
    entityId: 10004,
    icon: null as string | null,
  },
  {
    id: "dev-5",
    name: "Bunker Box",
    displayName: "Bunker Box",
    entityId: 10005,
    icon: null as string | null,
  },
];

export const demoTeam: TeamRosterMember[] = [
  {
    name: "Demo Player",
    steamId: "76561198000000000",
    isOnline: true,
    isLeader: true,
    isAlive: true,
    locationKnown: true,
    x: 820,
    y: 1450,
    spawnTime: Math.floor(Date.now() / 1000) - 2700,
    deathTime: null,
  },
  {
    name: "Teammate One",
    steamId: "76561198000000001",
    isOnline: true,
    isLeader: false,
    isAlive: false,
    locationKnown: true,
    x: 1100,
    y: 980,
    spawnTime: Math.floor(Date.now() / 1000) - 5400,
    deathTime: Math.floor(Date.now() / 1000) - 480,
  },
  {
    name: "Teammate Two",
    steamId: "76561198000000002",
    isOnline: false,
    isLeader: false,
    isAlive: true,
    locationKnown: true,
    x: 450,
    y: 620,
    spawnTime: null,
    deathTime: null,
  },
  {
    name: "Teammate Three",
    steamId: "76561198000000003",
    isOnline: true,
    isLeader: false,
    isAlive: true,
    locationKnown: true,
    x: 1550,
    y: 1200,
    spawnTime: Math.floor(Date.now() / 1000) - 900,
    deathTime: null,
    status: "afk" as const,
    afkSince: Math.floor(Date.now() / 1000) - 720,
  },
  {
    name: "Teammate Four",
    steamId: "76561198000000004",
    isOnline: false,
    isLeader: false,
    isAlive: true,
    locationKnown: false,
    x: 1000,
    y: 1000,
    spawnTime: null,
    deathTime: null,
  },
];

const demoChatNow = Math.floor(Date.now() / 1000);

export const demoTeamChat: TeamChatMessage[] = [
  {
    steamId: "76561198000000001",
    name: "Teammate One",
    message: "Anyone on for oil?",
    sentAt: demoChatNow - 600,
  },
  {
    steamId: "76561198000000000",
    name: "Demo Player",
    message: "Give me 10, heading to base",
    sentAt: demoChatNow - 420,
  },
  {
    steamId: "76561198000000003",
    name: "Teammate Three",
    message: "TC has 2 days upkeep",
    sentAt: demoChatNow - 180,
  },
];

export const demoTeamInfo = {
  leaderSteamId: "76561198000000000",
  members: demoTeam,
};

const demoNow = Math.floor(Date.now() / 1000);

export const demoTeamDeaths: TeamDeathEvent[] = [
  {
    steamId: "76561198000000001",
    name: "Teammate One",
    deathTime: demoNow - 480,
    x: 1100,
    y: 980,
    grid: "H6",
  },
  {
    steamId: "76561198000000005",
    name: "Teammate Five",
    deathTime: demoNow - 3600,
    x: 620,
    y: 1780,
    grid: "E11",
  },
  {
    steamId: "76561198000000002",
    name: "Teammate Two",
    deathTime: demoNow - 7200,
    grid: "C4",
    x: 450,
    y: 620,
  },
];

export const demoTeamResponse: TeamApiResponse = {
  team: demoTeamInfo,
  deaths: demoTeamDeaths,
  pairedPlayerId: "76561198000000000",
  canPromote: true,
};

export const demoMapSize = { width: 2000, height: 2000 };

export const demoMapTransform = {
  imageWidth: demoMapSize.width,
  imageHeight: demoMapSize.height,
  oceanMargin: 0,
  worldSize: demoMapSize.width,
};

export const demoMonuments = [
  { token: "airfield_display_name", name: "Airfield", x: 1200, y: 600 },
  { token: "launch_site_display_name", name: "Launch Site", x: 400, y: 1600 },
  { token: "outpost_display_name", name: "Outpost", x: 500, y: 800 },
];

export const demoMapMarkers = [
  {
    id: "vending-1",
    type: 3,
    label: "Vending",
    name: "Outpost Shop",
    x: 500,
    y: 800,
    sellOrderCount: 2,
    sellOrders: [
      {
        item: "-932201673",
        itemName: "Scrap",
        itemShortname: "scrap",
        quantity: 100,
        costItem: "69511070",
        costItemName: "Metal Fragments",
        costItemShortname: "metal.fragments",
        costQuantity: 500,
      },
      {
        item: "1568388703",
        itemName: "Wood",
        itemShortname: "wood",
        quantity: 1000,
        costItem: "-932201673",
        costItemName: "Scrap",
        costItemShortname: "scrap",
        costQuantity: 20,
      },
    ],
  },
  {
    id: "vending-2",
    type: 3,
    label: "Vending",
    name: "Bandit Camp",
    x: 1400,
    y: 1100,
    sellOrderCount: 1,
    sellOrders: [
      {
        item: "1545779598",
        itemName: "Assault Rifle",
        itemShortname: "rifle.ak",
        quantity: 1,
        costItem: "-932201673",
        costItemName: "Scrap",
        costItemShortname: "scrap",
        costQuantity: 500,
      },
    ],
  },
  {
    id: "cargo-1",
    type: 5,
    label: "Cargo Ship",
    name: "Cargo Ship",
    x: 900,
    y: 400,
  },
  {
    id: "heli-1",
    type: 8,
    label: "Patrol Heli",
    name: "Patrol Helicopter",
    x: 1700,
    y: 1300,
  },
];

export const demoStorageContents = {
  capacity: 24,
  hasProtection: true,
  protectionExpiry: Math.floor(Date.now() / 1000) + 72 * 3600,
  items: [
    { itemId: 69511070, quantity: 12500 },
    { itemId: -151838493, quantity: 48000 },
    { itemId: -2099697608, quantity: 22000 },
    { itemId: -1581843485, quantity: 3400 },
    { itemId: 1545779598, quantity: 2 },
    { itemId: -1211166256, quantity: 256 },
    { itemId: 317398316, quantity: 42 },
    { itemId: -932201673, quantity: 890 },
  ],
};

function enrichDemoMonitor(monitor: (typeof demoMonitors)[number]) {
  const info = monitor.id === "dev-5" ? demoBunkerStorage : demoStorageContents;
  const parsed = parseStorageEntityInfo(info);
  const resolved = resolveStorageMonitorIcon({ savedIcon: monitor.icon, parsed });
  return {
    ...monitor,
    containerKind: resolved.kind,
    iconShortname: resolved.shortname,
    iconUrl: resolved.iconUrl,
    iconName: resolved.name,
    iconAutoDetected: resolved.autoDetected,
  };
}

export const demoBunkerStorage = {
  capacity: 48,
  items: [
    { itemId: -1581843485, quantity: 12000 },
    { itemId: 69511070, quantity: 8000 },
    { itemId: -932201673, quantity: 1500 },
    { itemId: 1545779598, quantity: 1 },
  ],
};

export const demoAuditEvents = [
  {
    id: "audit-1",
    userId: "demo-user",
    action: "device.toggle",
    targetType: "smart_switch",
    targetId: "10001",
    metadata: JSON.stringify({ value: true, source: "web" }),
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: "audit-2",
    userId: "demo-user",
    action: "device.rename",
    targetType: "smart_switch",
    targetId: "10001",
    metadata: JSON.stringify({ displayName: "Front Door Lights" }),
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  },
  {
    id: "audit-3",
    userId: null,
    action: "automation.night_lights",
    targetType: "smart_switch",
    targetId: "10002",
    metadata: JSON.stringify({ value: true, reason: "night" }),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

export const demoVendingResults = [
  {
    markerId: "vending-1",
    name: "Outpost Shop",
    x: 500,
    y: 800,
    item: "-932201673",
    itemName: "Scrap",
    itemShortname: "scrap",
    quantity: 100,
    costItem: "69511070",
    costItemName: "Metal Fragments",
    costItemShortname: "metal.fragments",
    costQuantity: 500,
  },
  {
    markerId: "vending-2",
    name: "Bandit Camp",
    x: 1400,
    y: 1100,
    item: "1545779598",
    itemName: "Assault Rifle",
    itemShortname: "rifle.ak",
    quantity: 1,
    costItem: "-932201673",
    costItemName: "Scrap",
    costItemShortname: "scrap",
    costQuantity: 500,
  },
];

let demoSwitchStates: Record<string, boolean> = {
  "dev-1": true,
  "dev-2": false,
};

export function demoHandleApi<T>(path: string, init?: RequestInit): T | Promise<T> {
  const method = init?.method ?? "GET";
  const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

  if (path === "/auth/me") return demoUser as T;
  if (path === "/auth/logout" || path === "/auth/link-rust") return { ok: true } as T;
  if (path === "/auth/ws-token") return { token: "demo-ws-token" } as T;

  if (path === "/health") {
    return {
      status: "ok",
      rustplus: { connected: true, activeServerId: "demo-server-1" },
      fcm: { listening: true },
    } as T;
  }

  if (path === "/servers") return { servers: demoServers } as T;

  const activateMatch = path.match(/^\/servers\/([^/]+)\/activate$/);
  if (activateMatch && method === "POST") {
    for (const s of demoServers) {
      s.isActive = s.id === activateMatch[1];
    }
    return { ok: true } as T;
  }

  if (path === "/servers/active/info") {
    return {
      info: { name: "US West — Demo Server", players: 87, maxPlayers: 200, queuedPlayers: 3 },
      wipe: { label: "4d 12h", secondsRemaining: 388_800 },
      mapMeta: {
        seed: 123456789,
        salt: 987654321,
        mapName: "Procedural Map",
        mapSize: 4500,
      },
      connectString: "client.connect demo.rusttools.local:28015",
    } as T;
  }

  if (path === "/servers/active/time") {
    return { time: { time: "14:32", isDay: true } } as T;
  }

  if (path === "/servers/active/deepsea") {
    return { status: demoDeepSeaStatus } as T;
  }

  if (path === "/servers/active/world-events") {
    return { status: demoWorldEventsStatus } as T;
  }

  if (path === "/servers/active/notifications") {
    if (method === "PATCH") {
      const patch = body as {
        smartAlarm?: Partial<NotificationSettingsResponse["settings"]["smartAlarm"]>;
        deepSea?: Partial<NotificationSettingsResponse["settings"]["deepSea"]>;
        teamChatBot?: Partial<NotificationSettingsResponse["settings"]["teamChatBot"]>;
        eventTimers?: Partial<NotificationSettingsResponse["settings"]["eventTimers"]>;
      };
      demoNotificationSettings = {
        ...demoNotificationSettings,
        settings: {
          smartAlarm: {
            ...demoNotificationSettings.settings.smartAlarm,
            ...patch.smartAlarm,
          },
          deepSea: {
            ...demoNotificationSettings.settings.deepSea,
            ...patch.deepSea,
          },
          teamChatBot: {
            ...demoNotificationSettings.settings.teamChatBot,
            ...patch.teamChatBot,
          },
          eventTimers: {
            ...demoNotificationSettings.settings.eventTimers,
            ...patch.eventTimers,
          },
        },
      };
      return demoNotificationSettings as T;
    }
    return demoNotificationSettings as T;
  }

  if (path === "/servers/active/team") return demoTeamResponse as T;

  if (path === "/servers/active/team/deaths") return { deaths: demoTeamDeaths } as T;

  if (path === "/servers/active/team/connections") {
    return {
      connections: [
        {
          steamId: "76561198000000002",
          name: "Teammate Two",
          event: "connected",
          occurredAt: demoNow - 900,
        },
        {
          steamId: "76561198000000003",
          name: "Teammate Three",
          event: "disconnected",
          occurredAt: demoNow - 1800,
        },
      ],
    } as T;
  }

  if (path === "/servers/active/team/chat") return { messages: demoTeamChat } as T;

  if (path === "/servers/active/team/promote" && method === "POST") {
    const targetId = (body as { steamId?: string }).steamId;
    const target = demoTeam.find((m) => m.steamId === targetId);
    if (!target || target.isLeader) {
      throw new Error("Cannot promote that player");
    }
    const promotedTeam = {
      leaderSteamId: target.steamId,
      members: demoTeam.map((m) => ({
        ...m,
        isLeader: m.steamId === target.steamId,
      })),
    };
    demoTeamInfo.leaderSteamId = promotedTeam.leaderSteamId;
    demoTeamInfo.members = promotedTeam.members;
    return {
      ...demoTeamResponse,
      team: promotedTeam,
      canPromote: false,
      pairedPlayerId: target.steamId,
    } as T;
  }

  if (path === "/servers/active/map") {
    return {
      map: { width: demoMapSize.width, height: demoMapSize.height, imageBase64: null },
      transform: demoMapTransform,
      team: demoTeam,
      monuments: demoMonuments,
      markers: demoMapMarkers,
    } as T;
  }

  if (path === "/servers/active/map/live") {
    return { team: demoTeam, markers: demoMapMarkers, worldEvents: demoWorldEventsStatus } as T;
  }

  if (path === "/servers/active/map/overlays") {
    return { drawings: [], pins: [] } as T;
  }

  if (path.startsWith("/vending/search")) {
    const params = new URLSearchParams(path.split("?")[1] ?? "");
    const q = params.get("q") ?? undefined;
    const filters = {
      currency: params.get("currency") ?? undefined,
      minPrice: params.get("minPrice") ? Number(params.get("minPrice")) : undefined,
      maxPrice: params.get("maxPrice") ? Number(params.get("maxPrice")) : undefined,
      minProfitMargin: params.get("minProfitMargin")
        ? Number(params.get("minProfitMargin"))
        : undefined,
    };
    const sort = params.get("sort");
    const sortMode = sort === "price" || sort === "margin" ? sort : undefined;
    const markerPayload = {
      markers: demoMapMarkers.map((marker) => ({
        id: marker.id,
        type: marker.type,
        name: marker.name,
        x: marker.x,
        y: marker.y,
        sellOrders: marker.sellOrders?.map((order) => ({
          itemId: Number(order.item),
          currencyId: Number(order.costItem),
          costPerItem: order.costQuantity,
          amountInStock: order.quantity,
        })),
      })),
    };
    const results = searchVendingListings(markerPayload, q, filters, sortMode);
    return {
      results: results.length ? results : searchVendingListings(markerPayload, "scrap"),
    } as T;
  }

  if (path === "/servers/active/chat" && method === "POST") {
    const text = (body as { message?: string }).message?.trim();
    if (text) {
      demoTeamChat.push({
        steamId: demoUser.user.steamId ?? "76561198000000000",
        name: "Demo Player",
        message: text,
        sentAt: Math.floor(Date.now() / 1000),
      });
    }
    return { ok: true } as T;
  }

  if (path === "/devices") return { devices: demoDevices } as T;

  const toggleMatch = path.match(/^\/devices\/([^/]+)\/toggle$/);
  if (toggleMatch && method === "POST") {
    const id = toggleMatch[1];
    const action = body.action as string;
    const current = demoSwitchStates[id] ?? false;
    if (action === "toggle") demoSwitchStates[id] = !current;
    else demoSwitchStates[id] = action === "on";
    return { ok: true, value: demoSwitchStates[id] } as T;
  }

  const patchMatch = path.match(/^\/devices\/([^/]+)$/);
  if (patchMatch && method === "PATCH") {
    const monitor = demoMonitors.find((m) => m.id === patchMatch[1]);
    if (monitor) {
      if (typeof body.displayName === "string") monitor.displayName = body.displayName;
      if (body.icon === null || typeof body.icon === "string") monitor.icon = body.icon;
    }
    const device = demoDevices.find((d) => d.id === patchMatch[1]);
    if (device && typeof body.displayName === "string") {
      device.displayName = body.displayName;
    }
    return { ok: true } as T;
  }

  if (path === "/devices/switch-group" && method === "POST") {
    return { ok: true } as T;
  }

  if (path === "/storage") return { monitors: demoMonitors.map(enrichDemoMonitor) } as T;

  if (path === "/storage/container-icons") {
    return { catalog: STORAGE_CONTAINER_ICON_CATALOG } as T;
  }

  if (path.startsWith("/storage/search")) {
    return { monitors: demoMonitors.map(enrichDemoMonitor) } as T;
  }

  if (path.startsWith("/storage/items/search")) {
    const params = new URL(`http://local${path}`).searchParams;
    const q = params.get("q") ?? "";
    const monitorResults = demoMonitors.map((monitor) => {
      const info = monitor.id === "dev-5" ? demoBunkerStorage : demoStorageContents;
      const parsed = parseStorageEntityInfo(info);
      return {
        id: monitor.id,
        name: monitor.displayName ?? monitor.name,
        entityId: monitor.entityId,
        items: parsed.items,
      };
    });
    return {
      query: q.trim(),
      matches: aggregateStorageItemSearch(monitorResults, q),
      failed: [],
    } as T;
  }

  const infoMatch = path.match(/^\/devices\/([^/]+)\/info$/);
  if (infoMatch) {
    const info = infoMatch[1] === "dev-5" ? demoBunkerStorage : demoStorageContents;
    return {
      info,
      recycle: { scrap: 42, extras: { "metal.refined": 8 } },
    } as T;
  }

  if (path === "/audit") return { events: demoAuditEvents } as T;

  throw new Error(`Demo mode: unhandled API path ${method} ${path}`);
}
