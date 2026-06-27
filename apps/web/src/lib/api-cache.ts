const CACHEABLE_PATHS: Record<string, number> = {
  "/servers/active/info": 20_000,
  "/servers/active/team": 15_000,
  "/devices": 10_000,
  "/switch-groups": 10_000,
  "/automation-settings": 30_000,
};

const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function cacheKey(path: string, init?: RequestInit): string {
  const method = init?.method ?? "GET";
  return `${method}:${path}`;
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

  const ttl = CACHEABLE_PATHS[path];
  if (ttl == null) {
    return fetcher();
  }

  const key = cacheKey(path, init);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return hit.value as T;
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.includes(prefix)) cache.delete(key);
  }
}
