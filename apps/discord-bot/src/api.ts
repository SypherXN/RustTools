import { AttachmentBuilder } from "discord.js";
import { apiBaseUrl, env } from "./config.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const payload = body as { error?: string; code?: string };
  return new ApiError(payload.error ?? `API error ${res.status}`, res.status, payload.code);
}

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
    throw await parseApiError(res);
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
    throw await parseApiError(res);
  }

  return res.json() as Promise<T>;
}

export function mapAttachment(base64: string | null, filename = "map.jpg"): AttachmentBuilder | null {
  if (!base64) return null;
  return new AttachmentBuilder(Buffer.from(base64, "base64"), { name: filename });
}
