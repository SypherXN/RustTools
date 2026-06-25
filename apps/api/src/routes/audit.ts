import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { auditEvents, users } from "@rusttools/db";
import { requireCapability } from "../lib/auth.js";

export async function registerAuditRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get("/audit", async (request, reply) => {
    const user = await requireCapability(db, request, reply, "admin");
    if (!user) return;

    const events = await db
      .select({
        id: auditEvents.id,
        userId: auditEvents.userId,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
        discordId: users.discordId,
        discordUsername: users.discordUsername,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.userId, users.id))
      .orderBy(desc(auditEvents.createdAt))
      .limit(100);

    return { events };
  });
}
