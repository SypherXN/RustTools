export interface ServerConnectInput {
  ip: string;
  port: number;
  /** Rust+ player token if available (not used in F1 connect). */
  playerToken?: number;
  /** Server password from getInfo when set. */
  password?: string | null;
}

export interface ParsedServerMapMeta {
  seed: number | null;
  salt: number | null;
  mapName: string | null;
  mapSize: number | null;
  url: string | null;
  headerImage: string | null;
}

export function parseServerMapMeta(info: unknown): ParsedServerMapMeta {
  const data = info as {
    seed?: number;
    salt?: number;
    map?: string;
    mapSize?: number;
    url?: string;
    headerImage?: string;
  };

  return {
    seed: data.seed ?? null,
    salt: data.salt ?? null,
    mapName: data.map?.trim() || null,
    mapSize: data.mapSize ?? null,
    url: data.url?.trim() || null,
    headerImage: data.headerImage?.trim() || null,
  };
}

/** F1 console connect string: `client.connect ip:port password` */
export function buildConnectString(input: ServerConnectInput): string {
  const { ip, port, password } = input;
  const base = `client.connect ${ip}:${port}`;
  if (password?.trim()) {
    return `${base} ${password.trim()}`;
  }
  return base;
}
