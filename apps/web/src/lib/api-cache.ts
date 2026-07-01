const CACHEABLE_PATHS: Record<string, number> = {
  "/servers/active/info": 20_000,
  "/servers/active/team": 15_000,
  "/servers/active/team/chat": 15_000,
  "/servers/active/team/deaths": 60_000,
  "/servers/active/team/connections": 60_000,
  "/servers/active/time": 30_000,
  "/servers/active/deepsea": 30_000,
  "/servers/active/world-events": 30_000,
  "/devices": 10_000,
  "/devices/switch-states": 8_000,
  "/switch-groups": 10_000,
  "/automation-settings": 30_000,
  "/board/global": 30_000,
  "/servers/active/board": 30_000,
  "/servers/active/map/overlays": 60_000,
  "/servers/active/map/live": 15_000,
  "/servers/active/map/procgen/status": 30_000,
};

const CACHEABLE_PREFIXES: Array<{ prefix: string; ttl: number }> = [
  { prefix: "/servers/active/map?", ttl: 120_000 },
  { prefix: "/vending/search", ttl: 30_000 },
];

/** Serve cached data for up to 30 minutes when the API is slow or Rust+ is down. */
const STALE_MAX_MS = 30 * 60_000;
const SESSION_PREFIX = "rt-api-cache:";
const SESSION_MAX_BYTES = 480_000;

type CacheEntry = { at: number; value: unknown };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function cacheKey(path: string, init?: RequestInit): string {
  const method = init?.method ?? "GET";
  return `${method}:${path}`;
}

function resolveTtl(path: string): number | null {
  if (CACHEABLE_PATHS[path] != null) {
    return CACHEABLE_PATHS[path];
  }
  const bare = path.split("?")[0] ?? path;
  if (CACHEABLE_PATHS[bare] != null) {
    return CACHEABLE_PATHS[bare];
  }
  for (const { prefix, ttl } of CACHEABLE_PREFIXES) {
    if (path.startsWith(prefix) || bare.startsWith(prefix)) {
      return ttl;
    }
  }
  return null;
}

function loadFromSession(key: string): CacheEntry | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.at > STALE_MAX_MS) {
      sessionStorage.removeItem(`${SESSION_PREFIX}${key}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function persistToSession(key: string, entry: CacheEntry): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const json = JSON.stringify(entry);
    if (json.length > SESSION_MAX_BYTES) return;
    sessionStorage.setItem(`${SESSION_PREFIX}${key}`, json);
  } catch {
    /* quota — memory cache still works for this session */
  }
}

function removeFromSession(key: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(`${SESSION_PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

function getEntry(key: string): CacheEntry | null {
  const mem = cache.get(key);
  if (mem && Date.now() - mem.at <= STALE_MAX_MS) {
    return mem;
  }
  const session = loadFromSession(key);
  if (session) {
    cache.set(key, session);
    return session;
  }
  return mem ?? null;
}

function storeEntry(key: string, value: unknown): void {
  const entry = { at: Date.now(), value };
  cache.set(key, entry);
  persistToSession(key, entry);
}

function revalidateInBackground<T>(key: string, fetcher: () => Promise<T>): void {
  if (inflight.has(key)) return;

  const promise = fetcher()
    .then((value) => {
      storeEntry(key, value);
      return value;
    })
    .catch((err) => {
      const hit = getEntry(key);
      if (hit) return hit.value as T;
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
}

export function peekApiCache<T>(path: string, init?: RequestInit): { value: T; fetchedAt: number } | null {
  const method = init?.method ?? "GET";
  if (method !== "GET") return null;
  if (resolveTtl(path) == null) return null;

  const key = cacheKey(path, init);
  const hit = getEntry(key);
  if (!hit) return null;
  return { value: hit.value as T, fetchedAt: hit.at };
}

export function getApiCacheTimestamp(path: string, init?: RequestInit): number | null {
  return peekApiCache(path, init)?.fetchedAt ?? null;
}

export async function cachedApiFetch<T>(
  path: string,
  fetcher: () => Promise<T>,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method ?? "GET";
  if (method !== "GET") {
    return fetcher();
  }

  const ttl = resolveTtl(path);
  if (ttl == null) {
    return fetcher();
  }

  const key = cacheKey(path, init);
  const hit = getEntry(key);
  const age = hit ? Date.now() - hit.at : null;

  if (hit && age != null && age < ttl) {
    return hit.value as T;
  }

  if (hit && age != null && age < STALE_MAX_MS) {
    revalidateInBackground(key, fetcher);
    return hit.value as T;
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      storeEntry(key, value);
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      const stale = getEntry(key);
      if (stale) return stale.value as T;
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(SESSION_PREFIX)) {
          sessionStorage.removeItem(k);
        }
      }
    }
    return;
  }

  for (const key of [...cache.keys()]) {
    if (key.includes(prefix)) {
      cache.delete(key);
      removeFromSession(key);
    }
  }
}
