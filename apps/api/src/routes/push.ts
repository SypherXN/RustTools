import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { pushSubscriptions } from "@rusttools/db";
import { env } from "../config.js";
import { requireCapability } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { webPushConfigured } from "../lib/web-push.js";

export async function registerPushRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get("/push/vapid-public-key", async () => {
    return { publicKey: env.webPush.publicKey || null, configured: webPushConfigured() };
  });

  app.post("/push/subscribe", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    const { subscription } = request.body as {
      subscription?: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
    };

    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return reply.status(400).send({ error: "Invalid push subscription" });
    }

    const [existing] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
      .limit(1);

    if (existing) {
      await db
        .update(pushSubscriptions)
        .set({
          userId: user.id,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        })
        .where(eq(pushSubscriptions.id, existing.id));
      return { ok: true, id: existing.id };
    }

    const id = generateId();
    await db.insert(pushSubscriptions).values({
      id,
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      createdAt: new Date(),
    });

    return { ok: true, id };
  });

  app.post("/push/unsubscribe", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "view");
    if (!user) return;

    const { endpoint } = request.body as { endpoint?: string };
    if (!endpoint?.trim()) {
      return reply.status(400).send({ error: "endpoint is required" });
    }

    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint.trim()));
    return { ok: true };
  });
}
