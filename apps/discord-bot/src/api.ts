import { AttachmentBuilder } from "discord.js";
import { apiBaseUrl, env } from "./config.js";

export async function internalFetch<T>(
  path: string,
  discordUserId: string,
  init?: RequestInit,
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${apiBaseUrl()}${path}${sep}discordUserId=${encodeURIComponent(discordUserId)}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.internalApiKey}`,
      ...(init?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function internalPost<T>(
  path: string,
  discordUserId: string,
  data: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.internalApiKey}`,
    },
    body: JSON.stringify({ discordUserId, ...data }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function mapAttachment(base64: string | null, filename = "map.jpg"): AttachmentBuilder | null {
  if (!base64) return null;
  return new AttachmentBuilder(Buffer.from(base64, "base64"), { name: filename });
}
