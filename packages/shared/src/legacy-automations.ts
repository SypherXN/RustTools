/** Legacy env automations — env values seed defaults once into saved Settings, then Settings wins. */

export interface NightLightsAutomationSettings {
  enabled: boolean;
  /** Rust+ entity IDs for smart switches. */
  entityIds: number[];
}

export interface TeamOfflineSamSettings {
  enabled: boolean;
  switchEntityId: number | null;
}

export interface LegacyAutomationSettings {
  nightLights: NightLightsAutomationSettings;
  teamOfflineSam: TeamOfflineSamSettings;
}

export const DEFAULT_LEGACY_AUTOMATION_SETTINGS: LegacyAutomationSettings = {
  nightLights: { enabled: false, entityIds: [] },
  teamOfflineSam: { enabled: false, switchEntityId: null },
};

export function legacyAutomationsFromEnv(): LegacyAutomationSettings {
  const entityIds = (process.env.AUTOMATION_NIGHT_LIGHT_ENTITY_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));

  const samRaw = process.env.AUTOMATION_SAM_SWITCH_ENTITY_ID?.trim();
  const samId = samRaw ? Number(samRaw) : NaN;

  return {
    nightLights: {
      enabled: process.env.AUTOMATION_NIGHT_LIGHTS === "true",
      entityIds,
    },
    teamOfflineSam: {
      enabled: process.env.AUTOMATION_TEAM_OFFLINE_SAM === "true",
      switchEntityId: Number.isNaN(samId) ? null : samId,
    },
  };
}

/** Remove legacy automation references to a Rust+ entity ID that no longer exists. */
export function scrubLegacyAutomationsForRemovedRustEntity(
  legacy: LegacyAutomationSettings,
  rustEntityId: number,
): LegacyAutomationSettings | null {
  const entityIds = legacy.nightLights.entityIds.filter((id) => id !== rustEntityId);
  const switchEntityId =
    legacy.teamOfflineSam.switchEntityId === rustEntityId
      ? null
      : legacy.teamOfflineSam.switchEntityId;

  if (
    entityIds.length === legacy.nightLights.entityIds.length &&
    switchEntityId === legacy.teamOfflineSam.switchEntityId
  ) {
    return null;
  }

  return {
    ...legacy,
    nightLights: { ...legacy.nightLights, entityIds },
    teamOfflineSam: { ...legacy.teamOfflineSam, switchEntityId },
  };
}

/** Clear all legacy automation device references (e.g. on server wipe). */
export function clearLegacyAutomationEntityRefs(
  legacy: LegacyAutomationSettings,
): LegacyAutomationSettings {
  return {
    ...legacy,
    nightLights: { ...legacy.nightLights, entityIds: [] },
    teamOfflineSam: { ...legacy.teamOfflineSam, switchEntityId: null },
  };
}
