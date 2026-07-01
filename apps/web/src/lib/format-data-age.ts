export function formatDataAge(fetchedAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
