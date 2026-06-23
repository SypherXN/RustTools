import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { auditEvents } from "@rusttools/db";
import { requireAuth } from "../lib/auth.js";

export async function registerAuditRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get("/audit", async (request, reply) => {
    const user = await requireAuth(db, request, reply);
    if (!user) return;

    const events = await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(100);

    return { events };
  });
}
