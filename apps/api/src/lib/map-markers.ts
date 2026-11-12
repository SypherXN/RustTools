export interface ParsedMonument {
  token: string;
  name: string;
  x: number;
  y: number;
}

export function formatMonumentName(token: string): string {
  return token
    .replace(/_display_name$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseMonuments(map: unknown): ParsedMonument[] {
  const data = map as {
    monuments?: Array<{ token?: string; x?: number; y?: number }>;
  };

  return (data.monuments ?? [])
    .filter((m) => m.token && m.x != null && m.y != null)
    .map((m) => ({
      token: m.token!,
      name: formatMonumentName(m.token!),
      x: m.x!,
      y: m.y!,
    }));
}
