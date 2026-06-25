/** Per-entity settings stored in `rust_entities.settings_json`. */

export type SwitchAutoMode =
  | "auto-day-night"
  | "auto-night-day"
  | "auto-on"
  | "auto-off"
  | "any-online"
  | "proximity";

export interface SmartAlarmDeviceSettings {
  customMessage?: string | null;
  pingEveryone?: boolean;
  lastTriggeredAt?: number | null;
}

export interface SmartSwitchDeviceSettings {
  chatCommand?: string | null;
  autoMode?: SwitchAutoMode | null;
  /** Grid cells for proximity mode (default 1). */
  proximityGridRadius?: number;
}

export interface StorageMonitorDeviceSettings {
  /** Last upkeep level we alerted for (dedupe). */
  lastUpkeepAlertLevel?: UpkeepAlertLevel | null;
}

export interface CameraDeviceSettings {
  cameraId?: string | null;
  label?: string | null;
}

export type UpkeepAlertLevel = "warning" | "critical";

export interface EntityDeviceSettings {
  switch?: SmartSwitchDeviceSettings;
  alarm?: SmartAlarmDeviceSettings;
  storage?: StorageMonitorDeviceSettings;
  camera?: CameraDeviceSettings;
}

export const DEFAULT_ENTITY_DEVICE_SETTINGS: EntityDeviceSettings = {};

export function parseEntityDeviceSettings(raw: string | null | undefined): EntityDeviceSettings {
  if (!raw?.trim()) return { ...DEFAULT_ENTITY_DEVICE_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as EntityDeviceSettings;
    return {
      switch: parsed.switch ?? undefined,
      alarm: parsed.alarm ?? undefined,
      storage: parsed.storage ?? undefined,
      camera: parsed.camera ?? undefined,
    };
  } catch {
    return { ...DEFAULT_ENTITY_DEVICE_SETTINGS };
  }
}

export function mergeEntityDeviceSettings(
  current: EntityDeviceSettings,
  patch: Partial<EntityDeviceSettings>,
): EntityDeviceSettings {
  return {
    switch: patch.switch !== undefined ? { ...current.switch, ...patch.switch } : current.switch,
    alarm: patch.alarm !== undefined ? { ...current.alarm, ...patch.alarm } : current.alarm,
    storage:
      patch.storage !== undefined ? { ...current.storage, ...patch.storage } : current.storage,
    camera: patch.camera !== undefined ? { ...current.camera, ...patch.camera } : current.camera,
  };
}

export function normalizeChatCommandAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/^!+/, "");
}
