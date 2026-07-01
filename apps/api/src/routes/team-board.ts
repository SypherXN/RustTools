import type { FastifyInstance } from "fastify";
import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { teamBoardEntries, teamBoardGlobalEntries } from "@rusttools/db";
import {
  isTeamBoardEntryKind,
  normalizeTeamBoardCategory,
  type TeamBoardEntry,
  validateTeamBoardLinkUrl,
} from "@rusttools/shared";
import { requireCapability } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { getActiveServer } from "../lib/rust-data.js";

type BoardBody = {
  kind?: string;
  title?: string;
  content?: string;
  category?: string;
  pinned?: boolean;
};

type BoardExisting = {
  kind: string;
  title: string;
  content: string;
  category: string;
};

function parseGlobalRow(row: typeof teamBoardGlobalEntries.$inferSelect): TeamBoardEntry {
  return {
    id: row.id,
    kind: row.kind as TeamBoardEntry["kind"],
    title: row.title,
    content: row.content,
    category: row.category,
    pinned: row.pinned,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseServerRow(row: typeof teamBoardEntries.$inferSelect): TeamBoardEntry {
  return {
    id: row.id,
    kind: row.kind as TeamBoardEntry["kind"],
    title: row.title,
    content: row.content,
    category: row.category,
    pinned: row.pinned,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseBoardBody(
  body: BoardBody,
  existing?: BoardExisting,
):
  | { ok: true; kind: TeamBoardEntry["kind"]; title: string; content: string; category: string; pinned?: boolean }
  | { ok: false; error: string } {
  const kind = (body.kind != null ? body.kind.trim() : existing?.kind) ?? "";
  if (!isTeamBoardEntryKind(kind)) {
    return { ok: false, error: "kind must be note or link" };
  }

  const title = (body.title != null ? body.title.trim() : existing?.title) ?? "";
  if (!title) {
    return { ok: false, error: "title is required" };
  }

  const content = (body.content != null ? body.content.trim() : existing?.content) ?? "";
  if (!content) {
    return { ok: false, error: "content is required" };
  }

  if (kind === "link") {
    const urlError = validateTeamBoardLinkUrl(content);
    if (urlError) {
      return { ok: false, error: urlError };
    }
  }

  const category = normalizeTeamBoardCategory(
    body.category !== undefined ? body.category : (existing?.category ?? ""),
  );

  return {
    ok: true,
    kind,
    title,
    content,
    category,
    ...(body.pinned != null ? { pinned: Boolean(body.pinned) } : {}),
  };
}

export async function registerTeamBoardRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  app.get("/board/global", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const rows = await deps.db
      .select()
      .from(teamBoardGlobalEntries)
      .orderBy(
        desc(teamBoardGlobalEntries.pinned),
        asc(teamBoardGlobalEntries.category),
        asc(teamBoardGlobalEntries.title),
      );

    return { entries: rows.map(parseGlobalRow) };
  });

  app.post("/board/global", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const parsed = parseBoardBody((request.body ?? {}) as BoardBody);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const id = generateId();
    const now = new Date();
    await deps.db.insert(teamBoardGlobalEntries).values({
      id,
      kind: parsed.kind,
      title: parsed.title,
      content: parsed.content,
      category: parsed.category,
      pinned: parsed.pinned ?? false,
      createdBy: user.discordUsername,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await deps.db
      .select()
      .from(teamBoardGlobalEntries)
      .where(eq(teamBoardGlobalEntries.id, id))
      .limit(1);
    return parseGlobalRow(row!);
  });

  app.patch("/board/global/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const [existing] = await deps.db
      .select()
      .from(teamBoardGlobalEntries)
      .where(eq(teamBoardGlobalEntries.id, id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: "Entry not found" });
    }

    const parsed = parseBoardBody((request.body ?? {}) as BoardBody, existing);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const now = new Date();
    await deps.db
      .update(teamBoardGlobalEntries)
      .set({
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
        category: parsed.category,
        ...(parsed.pinned != null ? { pinned: parsed.pinned } : {}),
        updatedAt: now,
      })
      .where(eq(teamBoardGlobalEntries.id, id));

    const [row] = await deps.db
      .select()
      .from(teamBoardGlobalEntries)
      .where(eq(teamBoardGlobalEntries.id, id))
      .limit(1);
    return parseGlobalRow(row!);
  });

  app.delete("/board/global/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const result = await deps.db.delete(teamBoardGlobalEntries).where(eq(teamBoardGlobalEntries.id, id));
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Entry not found" });
    }
    return { ok: true };
  });

  app.get("/servers/active/board", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) {
      return { entries: [] as TeamBoardEntry[] };
    }

    const rows = await deps.db
      .select()
      .from(teamBoardEntries)
      .where(eq(teamBoardEntries.serverId, active.id))
      .orderBy(desc(teamBoardEntries.pinned), asc(teamBoardEntries.category), asc(teamBoardEntries.title));

    return { entries: rows.map(parseServerRow) };
  });

  app.post("/servers/active/board", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const active = await getActiveServer(deps.db);
    if (!active) {
      return reply.status(503).send({ error: "No active server" });
    }

    const parsed = parseBoardBody((request.body ?? {}) as BoardBody);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const id = generateId();
    const now = new Date();
    await deps.db.insert(teamBoardEntries).values({
      id,
      serverId: active.id,
      kind: parsed.kind,
      title: parsed.title,
      content: parsed.content,
      category: parsed.category,
      pinned: parsed.pinned ?? false,
      createdBy: user.discordUsername,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await deps.db
      .select()
      .from(teamBoardEntries)
      .where(eq(teamBoardEntries.id, id))
      .limit(1);
    return parseServerRow(row!);
  });

  app.patch("/servers/active/board/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const [existing] = await deps.db
      .select()
      .from(teamBoardEntries)
      .where(eq(teamBoardEntries.id, id))
      .limit(1);
    if (!existing) {
      return reply.status(404).send({ error: "Entry not found" });
    }

    const parsed = parseBoardBody((request.body ?? {}) as BoardBody, existing);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const now = new Date();
    await deps.db
      .update(teamBoardEntries)
      .set({
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
        category: parsed.category,
        ...(parsed.pinned != null ? { pinned: parsed.pinned } : {}),
        updatedAt: now,
      })
      .where(eq(teamBoardEntries.id, id));

    const [row] = await deps.db
      .select()
      .from(teamBoardEntries)
      .where(eq(teamBoardEntries.id, id))
      .limit(1);
    return parseServerRow(row!);
  });

  app.delete("/servers/active/board/:id", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { id } = request.params as { id: string };
    const result = await deps.db.delete(teamBoardEntries).where(eq(teamBoardEntries.id, id));
    if (result.changes === 0) {
      return reply.status(404).send({ error: "Entry not found" });
    }
    return { ok: true };
  });
}
