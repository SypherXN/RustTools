/** Vite `base` — always ends with `/` (e.g. `/` or `/RustTools/`). */
export const BASE_URL = import.meta.env.BASE_URL;

/** Resolve a public-folder asset path for the current deploy base. */
export function assetUrl(path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `${BASE_URL}${normalized}`;
}
