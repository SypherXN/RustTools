import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@rusttools/db";
import { automationRules, automationRuleTemplates, deviceLibraryGroups, deviceLibraryMembers, mapPins, rustEntities, savedCameras, switchGroupMembers, switchGroups } from "@rusttools/db";
import type { AutomationBaseSettings } from "@rusttools/shared";
import {
  getActiveNotificationSettings,
  updateActiveNotificationSettings,
} from "../lib/server-notification-settings.js";
import type { RustPlusManager } from "@rusttools/rustplus-client";
import type { AutomationRuleInput, AutomationRuleTemplateInput } from "@rusttools/shared";
import { logAudit } from "../lib/audit.js";
import { requireCapability } from "../lib/auth.js";
import { parseRule } from "../lib/automation-engine.js";
import { getEntitySettings, updateEntitySettings } from "../lib/entity-settings.js";
import { generateId } from "../lib/ids.js";
import { getActiveServerId } from "../lib/rust-data.js";

async function requireActiveServerId(db: Database, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) {
  const serverId = await getActiveServerId(db);
  if (!serverId) {
    reply.status(400).send({ error: "No active server" });
    return null;
  }
  return serverId;
}

export async function registerAutomationRoutes(
  app: FastifyInstance,
  deps: { db: Database; rustPlus: RustPlusManager },
): Promise<void> {
  app.get("/devices/:entityId/settings", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const settings = await getEntitySettings(deps.db, entityId);
    return { settings };
  });

  app.patch("/devices/:entityId/settings", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { entityId } = request.params as { entityId: string };
    const patch = request.body as Parameters<typeof updateEntitySettings>[2];
    const settings = await updateEntitySettings(deps.db, entityId, patch);

    await logAudit(deps.db, {
      userId: user.id,
      action: "device_settings_update",
      targetType: "entity",
      targetId: entityId,
      metadata: patch,
    });

    return { settings };
  });

  app.get("/switch-groups", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const groups = await deps.db
      .select()
      .from(switchGroups)
      .where(eq(switchGroups.serverId, serverId));

    const result = await Promise.all(
      groups.map(async (group) => {
        const members = await deps.db
          .select({ entityId: switchGroupMembers.entityId })
          .from(switchGroupMembers)
          .where(eq(switchGroupMembers.groupId, group.id));
        return {
          id: group.id,
          serverId: group.serverId,
          name: group.name,
          displayName: group.displayName,
          chatCommand: group.chatCommand,
          memberEntityIds: members.map((m) => m.entityId),
          createdAt: group.createdAt.toISOString(),
          updatedAt: group.updatedAt.toISOString(),
        };
      }),
    );

    return { groups: result };
  });

  app.post("/switch-groups", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const body = request.body as {
      name: string;
      displayName?: string | null;
      chatCommand?: string | null;
      memberEntityIds?: string[];
    };

    if (!body.name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }

    const now = new Date();
    const id = generateId();
    await deps.db.insert(switchGroups).values({
      id,
      serverId,
      name: body.name.trim(),
      displayName: body.displayName ?? null,
      chatCommand: body.chatCommand ?? null,
      createdAt: now,
      updatedAt: now,
    });

    for (const entityId of body.memberEntityIds ?? []) {
      await deps.db.insert(switchGroupMembers).values({ groupId: id, entityId });
    }

    return { ok: true, id };
  });

  app.patch("/switch-groups/:groupId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { groupId } = request.params as { groupId: string };
    const body = request.body as {
      name?: string;
      displayName?: string | null;
      chatCommand?: string | null;
      memberEntityIds?: string[];
    };

    const [group] = await deps.db
      .select()
      .from(switchGroups)
      .where(eq(switchGroups.id, groupId))
      .limit(1);
    if (!group) return reply.status(404).send({ error: "Group not found" });

    await deps.db
      .update(switchGroups)
      .set({
        name: body.name ?? group.name,
        displayName: body.displayName !== undefined ? body.displayName : group.displayName,
        chatCommand: body.chatCommand !== undefined ? body.chatCommand : group.chatCommand,
        updatedAt: new Date(),
      })
      .where(eq(switchGroups.id, groupId));

    if (body.memberEntityIds) {
      await deps.db.delete(switchGroupMembers).where(eq(switchGroupMembers.groupId, groupId));
      for (const entityId of body.memberEntityIds) {
        await deps.db.insert(switchGroupMembers).values({ groupId, entityId });
      }
    }

    return { ok: true };
  });

  app.delete("/switch-groups/:groupId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { groupId } = request.params as { groupId: string };
    await deps.db.delete(switchGroups).where(eq(switchGroups.id, groupId));
    return { ok: true };
  });

  app.post("/switch-groups/:groupId/toggle", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { groupId } = request.params as { groupId: string };
    const { value, action } = request.body as {
      value?: boolean;
      action?: "on" | "off" | "toggle";
    };

    const members = await deps.db
      .select({ entity: rustEntities })
      .from(switchGroupMembers)
      .innerJoin(rustEntities, eq(switchGroupMembers.entityId, rustEntities.id))
      .where(eq(switchGroupMembers.groupId, groupId));

    let toggled = 0;
    for (const { entity } of members) {
      try {
        let newValue = value;
        if (action === "toggle" || newValue === undefined) {
          const info = (await deps.rustPlus.getEntityInfo(entity.entityId)) as {
            payload?: { value?: boolean };
            value?: boolean;
          };
          const current = info.payload?.value ?? info.value ?? null;
          newValue = current === null ? true : !current;
        }
        await deps.rustPlus.toggleSwitch(entity.entityId, newValue);
        toggled += 1;
      } catch {
        // continue
      }
    }

    return { ok: true, toggled };
  });

  app.get("/device-library", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const groups = await deps.db
      .select()
      .from(deviceLibraryGroups)
      .where(eq(deviceLibraryGroups.serverId, serverId))
      .orderBy(deviceLibraryGroups.sortOrder);

    const enriched = await Promise.all(
      groups.map(async (group) => {
        const members = await deps.db
          .select({ entityId: deviceLibraryMembers.entityId })
          .from(deviceLibraryMembers)
          .where(eq(deviceLibraryMembers.groupId, group.id));
        const children = groups.filter((g) => g.parentId === group.id).map((g) => g.id);
        return {
          id: group.id,
          serverId: group.serverId,
          parentId: group.parentId,
          name: group.name,
          sortOrder: group.sortOrder,
          memberEntityIds: members.map((m) => m.entityId),
          childGroupIds: children,
          createdAt: group.createdAt.toISOString(),
          updatedAt: group.updatedAt.toISOString(),
        };
      }),
    );

    const cameras = await deps.db
      .select()
      .from(savedCameras)
      .where(eq(savedCameras.serverId, serverId));

    return { groups: enriched, cameras };
  });

  app.post("/device-library/groups", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const body = request.body as {
      name: string;
      parentId?: string | null;
      sortOrder?: number;
      memberEntityIds?: string[];
    };

    const now = new Date();
    const id = generateId();
    await deps.db.insert(deviceLibraryGroups).values({
      id,
      serverId,
      parentId: body.parentId ?? null,
      name: body.name.trim(),
      sortOrder: body.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });

    for (const entityId of body.memberEntityIds ?? []) {
      await deps.db.insert(deviceLibraryMembers).values({ groupId: id, entityId });
    }

    return { ok: true, id };
  });

  app.patch("/device-library/groups/:groupId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { groupId } = request.params as { groupId: string };
    const body = request.body as {
      name?: string;
      parentId?: string | null;
      sortOrder?: number;
      memberEntityIds?: string[];
    };

    const [group] = await deps.db
      .select()
      .from(deviceLibraryGroups)
      .where(eq(deviceLibraryGroups.id, groupId))
      .limit(1);
    if (!group) return reply.status(404).send({ error: "Group not found" });

    await deps.db
      .update(deviceLibraryGroups)
      .set({
        name: body.name ?? group.name,
        parentId: body.parentId !== undefined ? body.parentId : group.parentId,
        sortOrder: body.sortOrder ?? group.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(deviceLibraryGroups.id, groupId));

    if (body.memberEntityIds) {
      await deps.db.delete(deviceLibraryMembers).where(eq(deviceLibraryMembers.groupId, groupId));
      for (const entityId of body.memberEntityIds) {
        await deps.db.insert(deviceLibraryMembers).values({ groupId, entityId });
      }
    }

    return { ok: true };
  });

  app.delete("/device-library/groups/:groupId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { groupId } = request.params as { groupId: string };
    await deps.db.delete(deviceLibraryGroups).where(eq(deviceLibraryGroups.id, groupId));
    return { ok: true };
  });

  app.post("/device-library/cameras", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const body = request.body as { cameraId: string; label: string; libraryGroupId?: string | null };
    const id = generateId();
    await deps.db.insert(savedCameras).values({
      id,
      serverId,
      cameraId: body.cameraId.trim().toUpperCase(),
      label: body.label.trim(),
      libraryGroupId: body.libraryGroupId ?? null,
      createdAt: new Date(),
    });
    return { ok: true, id };
  });

  app.delete("/device-library/cameras/:cameraId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { cameraId } = request.params as { cameraId: string };
    await deps.db.delete(savedCameras).where(eq(savedCameras.id, cameraId));
    return { ok: true };
  });

  app.get("/automation-settings", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const settings = await getActiveNotificationSettings(deps.db, deps.rustPlus);
    const pins = await deps.db
      .select({ id: mapPins.id, label: mapPins.label, x: mapPins.x, y: mapPins.y })
      .from(mapPins)
      .where(eq(mapPins.serverId, serverId));

    return {
      automationBase: settings?.settings.automationBase ?? null,
      pins,
    };
  });

  app.patch("/automation-settings", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const body = request.body as { automationBase?: Partial<AutomationBaseSettings> };
    const next = await updateActiveNotificationSettings(deps.db, {
      automationBase: body.automationBase,
    });
    if (!next) return reply.status(400).send({ error: "No active server" });
    return { automationBase: next.automationBase };
  });

  app.get("/automation-rules", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const rows = await deps.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.serverId, serverId));

    return { rules: rows.map(parseRule) };
  });

  app.post("/automation-rules", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const body = request.body as AutomationRuleInput;
    const now = new Date();
    const id = generateId();

    await deps.db.insert(automationRules).values({
      id,
      serverId,
      name: body.name.trim(),
      enabled: body.enabled ?? true,
      triggerJson: JSON.stringify(body.trigger),
      conditionsJson: JSON.stringify(body.conditions ?? []),
      actionsJson: JSON.stringify(body.actions),
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, id };
  });

  app.patch("/automation-rules/:ruleId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { ruleId } = request.params as { ruleId: string };
    const body = request.body as Partial<AutomationRuleInput> & { enabled?: boolean };

    const [row] = await deps.db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, ruleId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: "Rule not found" });

    await deps.db
      .update(automationRules)
      .set({
        name: body.name ?? row.name,
        enabled: body.enabled ?? row.enabled,
        triggerJson: body.trigger ? JSON.stringify(body.trigger) : row.triggerJson,
        conditionsJson: body.conditions ? JSON.stringify(body.conditions) : row.conditionsJson,
        actionsJson: body.actions ? JSON.stringify(body.actions) : row.actionsJson,
        updatedAt: new Date(),
      })
      .where(eq(automationRules.id, ruleId));

    return { ok: true };
  });

  app.delete("/automation-rules/:ruleId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { ruleId } = request.params as { ruleId: string };
    await deps.db.delete(automationRules).where(eq(automationRules.id, ruleId));
    return { ok: true };
  });

  app.get("/automation-rule-templates", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const rows = await deps.db
      .select()
      .from(automationRuleTemplates)
      .where(eq(automationRuleTemplates.serverId, serverId));

    return {
      templates: rows.map((row) => ({
        id: row.id,
        serverId: row.serverId,
        name: row.name,
        trigger: JSON.parse(row.triggerJson),
        conditions: JSON.parse(row.conditionsJson),
        actions: JSON.parse(row.actionsJson),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  });

  app.post("/automation-rule-templates", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const serverId = await requireActiveServerId(deps.db, reply);
    if (!serverId) return;

    const body = request.body as AutomationRuleTemplateInput;
    if (!body.name?.trim()) {
      return reply.status(400).send({ error: "Name is required" });
    }

    const now = new Date();
    const id = generateId();
    await deps.db.insert(automationRuleTemplates).values({
      id,
      serverId,
      name: body.name.trim(),
      triggerJson: JSON.stringify(body.trigger),
      conditionsJson: JSON.stringify(body.conditions ?? []),
      actionsJson: JSON.stringify(body.actions),
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, id };
  });

  app.patch("/automation-rule-templates/:templateId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { templateId } = request.params as { templateId: string };
    const body = request.body as Partial<AutomationRuleTemplateInput>;

    const [row] = await deps.db
      .select()
      .from(automationRuleTemplates)
      .where(eq(automationRuleTemplates.id, templateId))
      .limit(1);
    if (!row) return reply.status(404).send({ error: "Template not found" });

    await deps.db
      .update(automationRuleTemplates)
      .set({
        name: body.name ?? row.name,
        triggerJson: body.trigger ? JSON.stringify(body.trigger) : row.triggerJson,
        conditionsJson: body.conditions ? JSON.stringify(body.conditions) : row.conditionsJson,
        actionsJson: body.actions ? JSON.stringify(body.actions) : row.actionsJson,
        updatedAt: new Date(),
      })
      .where(eq(automationRuleTemplates.id, templateId));

    return { ok: true };
  });

  app.delete("/automation-rule-templates/:templateId", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "admin");
    if (!user) return;

    const { templateId } = request.params as { templateId: string };
    await deps.db.delete(automationRuleTemplates).where(eq(automationRuleTemplates.id, templateId));
    return { ok: true };
  });

  app.post("/cameras/:cameraId/subscribe", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { cameraId } = request.params as { cameraId: string };
    try {
      const info = await deps.rustPlus.subscribeCamera(cameraId.toUpperCase(), (frame) => {
        deps.rustPlus.notifications.webSocket({
          event: "cameraFrame",
          payload: {
            cameraId: cameraId.toUpperCase(),
            frame: frame.toString("base64"),
          },
        });
      });
      return { ok: true, info };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Camera subscribe failed",
      });
    }
  });

  app.post("/cameras/unsubscribe", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    try {
      await deps.rustPlus.unsubscribeCamera();
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Camera unsubscribe failed",
      });
    }
  });

  app.post("/cameras/input", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    const { buttons, mouseDeltaX, mouseDeltaY } = request.body as {
      buttons?: number;
      mouseDeltaX?: number;
      mouseDeltaY?: number;
    };

    try {
      await deps.rustPlus.sendCameraInput(
        buttons ?? 0,
        mouseDeltaX ?? 0,
        mouseDeltaY ?? 0,
      );
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Camera input failed",
      });
    }
  });

  app.post("/cameras/shoot", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "switch");
    if (!user) return;

    try {
      await deps.rustPlus.shootCamera();
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : "Camera shoot failed",
      });
    }
  });

  app.get("/cameras/status", async (request, reply) => {
    const user = await requireCapability(deps.db, request, reply, "view");
    if (!user) return;

    return deps.rustPlus.getCameraStatus();
  });
}
