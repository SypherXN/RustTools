const TTL_MS = 60_000;
const tokens = new Map<string, { userId: string; expiresAt: number }>();

export function issueWsToken(userId: string): string {
  const token = crypto.randomUUID();
  tokens.set(token, { userId, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumeWsToken(token: string): string | null {
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token);
  }
}, 60_000).unref();
