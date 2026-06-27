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

function isValidSubscriptionRow(row: typeof pushSubscriptions.$inferSelect): boolean {
  return Boolean(row.endpoint?.trim() && row.p256dh?.trim() && row.auth?.trim());
}

export async function broadcastWebPush(
  db: Database,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!ensureWebPush()) return;

  const rows = await db.select().from(pushSubscriptions);
  const data = JSON.stringify(payload);

  for (const row of rows) {
    if (!isValidSubscriptionRow(row)) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      continue;
    }

    const [current] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, row.id))
      .limit(1);
    if (!current || !isValidSubscriptionRow(current)) {
      if (current) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      }
      continue;
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: current.endpoint,
          keys: {
            p256dh: current.p256dh,
            auth: current.auth,
          },
        },
        data,
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, current.id));
      } else {
        console.error("[WebPush] Delivery failed:", err);
      }
    }
  }
}
