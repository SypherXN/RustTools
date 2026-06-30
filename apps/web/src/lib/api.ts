import { demoHandleApi, isDemoMode } from "./demo";
import { cachedApiFetch } from "./api-cache";

const API_BASE = (import.meta.env.VITE_API_URL?.trim() || "/api").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (isDemoMode()) {
    await new Promise((r) => setTimeout(r, 120));
    return demoHandleApi<T>(path, init);
  }

  return cachedApiFetch(path, () => fetchJson<T>(path, init), init);
}

async function fetchJson<T>(path: string, init?: RequestInit, permissionRetry = false): Promise<T> {
  const hasBody = init?.body != null && init.body !== "";
  const headers = new Headers(init?.headers);
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      credentials: "include",
      headers,
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("Could not reach the API — check your connection or sign in again.");
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error ?? `Request failed: ${res.status}`;
    if (
      !permissionRetry &&
      res.status === 403 &&
      typeof message === "string" &&
      message.startsWith("Missing ") &&
      message.endsWith(" permission")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return fetchJson<T>(path, init, true);
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
  init?: Omit<RequestInit, "body">,
): Promise<T> {
  if (isDemoMode()) {
    throw new Error("Uploads are disabled in demo mode");
  }

  const res = await fetch(apiUrl(path), {
    ...init,
    method: init?.method ?? "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function getDiscordLoginUrl(): string {
  return apiUrl("/auth/discord");
}
