import type { EntityType } from "./types.js";
import { rustItemIconUrl } from "./item-icons.js";

export interface DeviceTypeMeta {
  type: EntityType;
  title: string;
  inGameItem: string;
  iconShortname: string;
  iconUrl: string;
  description: string;
  remoteActions: string;
}

/** Rust+ wire-tool paired entity types (the only kinds exposed via companion API). */
export const RUSTPLUS_DEVICE_TYPES: DeviceTypeMeta[] = [
  {
    type: "smart_switch",
    title: "Smart Switches",
    inGameItem: "Smart Switch",
    iconShortname: "smart.switch",
    iconUrl: rustItemIconUrl("smart.switch"),
    description:
      "Remote on/off control for anything on the switch’s power output — lights, turrets, doors, SAM sites, etc.",
    remoteActions: "On, off, toggle",
  },
  {
    type: "smart_alarm",
    title: "Smart Alarms",
    inGameItem: "Smart Alarm",
    iconShortname: "smart.alarm",
    iconUrl: rustItemIconUrl("smart.alarm"),
    description:
      "Push notification when the alarm receives power. Wire from HBHF sensors, turret outputs, or any 1rW trigger.",
    remoteActions: "Receive alerts (no remote toggle)",
  },
  {
    type: "storage_monitor",
    title: "Storage Monitors",
    inGameItem: "Storage Monitor",
    iconShortname: "storage.monitor",
    iconUrl: rustItemIconUrl("storage.monitor"),
    description:
      "Read container contents remotely. On tool cupboards you also get upkeep/decay time. Rust+ does not identify box vs barrel.",
    remoteActions: "View inventory & TC upkeep",
  },
];

export const DEVICE_TYPE_ORDER: EntityType[] = RUSTPLUS_DEVICE_TYPES.map((d) => d.type);

export function deviceTypeMeta(type: string): DeviceTypeMeta | undefined {
  return RUSTPLUS_DEVICE_TYPES.find((d) => d.type === type);
}

export function deviceTypeIconUrl(type: string): string {
  return deviceTypeMeta(type)?.iconUrl ?? rustItemIconUrl("smart.switch");
}

export function groupDevicesByType<T extends { entityType: string }>(
  devices: T[],
): Array<{ meta: DeviceTypeMeta; devices: T[] }> {
  const byType = new Map<EntityType, T[]>();
  for (const device of devices) {
    const type = device.entityType as EntityType;
    const list = byType.get(type) ?? [];
    list.push(device);
    byType.set(type, list);
  }

  return DEVICE_TYPE_ORDER.filter((type) => (byType.get(type)?.length ?? 0) > 0).map((type) => ({
    meta: RUSTPLUS_DEVICE_TYPES.find((d) => d.type === type)!,
    devices: byType.get(type)!,
  }));
}
