/** IFTTT-style automation rules (#52). */

export type AutomationTriggerType =
  | "smart_alarm"
  | "storage_changed"
  | "tc_upkeep_low"
  | "team_online_change"
  | "team_all_offline_change"
  | "team_presence_change"
  | "time_of_day"
  | "interval";

/** Which teammates count for proximity rules. */
export type TeamMemberFilter = "active" | "online" | "not_offline";

/** How to interpret distance to a base point. */
export type TeamProximityCheck =
  | "any_near"
  | "all_near"
  | "none_near"
  | "all_away"
  | "any_away";

export type AutomationConditionType =
  | "switch_is"
  | "team_any_online"
  | "team_all_offline"
  | "upkeep_below_hours"
  | "time_is_day"
  | "time_is_night"
  | "team_near_point"
  | "team_away_from_point";

export type AutomationActionType =
  | "set_switch"
  | "toggle_switch"
  | "toggle_switch_group"
  | "send_team_chat"
  | "send_discord";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Entity DB id for device triggers. */
  entityId?: string;
  /** Hours threshold for tc_upkeep_low. */
  upkeepHours?: number;
  /** day | night for time_of_day. */
  phase?: "day" | "night";
  /** Interval minutes for interval trigger. */
  intervalMinutes?: number;
  /** team_presence_change — fire when team crosses into this proximity state. */
  memberFilter?: TeamMemberFilter;
  proximityCheck?: TeamProximityCheck;
  baseX?: number;
  baseY?: number;
  radiusGrid?: number;
  useServerBase?: boolean;
  mapPinId?: string;
}

export interface AutomationCondition {
  type: AutomationConditionType;
  entityId?: string;
  switchValue?: boolean;
  upkeepHours?: number;
  memberFilter?: TeamMemberFilter;
  proximityCheck?: TeamProximityCheck;
  baseX?: number;
  baseY?: number;
  radiusGrid?: number;
  useServerBase?: boolean;
  mapPinId?: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  entityId?: string;
  groupId?: string;
  switchValue?: boolean;
  message?: string;
  pingEveryone?: boolean;
}

export interface AutomationRuleRecord {
  id: string;
  serverId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleInput {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
}

/** Default proximity check for condition types. */
export function defaultProximityCheckForCondition(
  type: "team_near_point" | "team_away_from_point",
): TeamProximityCheck {
  return type === "team_near_point" ? "any_near" : "none_near";
}

/** Preset: no active (online, not AFK) teammates near base. */
export function activeAllAwayFromBaseCondition(
  overrides: Partial<AutomationCondition> = {},
): AutomationCondition {
  return {
    type: "team_away_from_point",
    memberFilter: "active",
    proximityCheck: "none_near",
    useServerBase: true,
    radiusGrid: 1,
    ...overrides,
  };
}

/** Preset: at least one active teammate near base. */
export function activeAnyNearBaseCondition(
  overrides: Partial<AutomationCondition> = {},
): AutomationCondition {
  return {
    type: "team_near_point",
    memberFilter: "active",
    proximityCheck: "any_near",
    useServerBase: true,
    radiusGrid: 1,
    ...overrides,
  };
}

export interface AutomationRuleTemplateRecord {
  id: string;
  serverId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleTemplateInput {
  name: string;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
}
