import webpush from "web-push";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { pushSubscriptions } from "@rusttools/db";
import { env } from "../config.js";

let configured = false;

function ensureWebPush(): boolean {
  if (!env.webPush.publicKey || !env.webPush.privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(
      env.webPush.subject,
      env.webPush.publicKey,
      env.webPush.privateKey,
    );
    configured = true;
  }
  return true;
}

export function webPushConfigured(): boolean {
  return Boolean(env.webPush.publicKey && env.webPush.privateKey);
}

export async function broadcastWebPush(
  db: Database,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!ensureWebPush()) return;

  const rows = await db.select().from(pushSubscriptions);
  const data = JSON.stringify(payload);

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        data,
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      } else {
        console.error("[WebPush] Delivery failed:", err);
      }
    }
  }
}
