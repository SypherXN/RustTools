/** Public Rust item icons (same CDN as rusthelp.com). */
export function rustItemIconUrl(shortname: string): string {
  const safe = shortname.trim();
  return `https://cdn.rusthelp.com/images/public/${encodeURIComponent(safe)}.png`;
}
