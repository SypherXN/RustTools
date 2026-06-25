import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AutomationAction,
  AutomationBaseSettings,
  AutomationCondition,
  AutomationRuleRecord,
  AutomationRuleTemplateRecord,
  AutomationTrigger,
  SwitchAutoMode,
  TeamMemberFilter,
  TeamProximityCheck,
} from "@rusttools/shared";
import { activeAllAwayFromBaseCondition } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { DeviceMemberPicker } from "../components/DeviceMemberPicker";
import { LIVE_CAMERAS_ENABLED } from "../lib/features";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";

interface Device {
  id: string;
  name: string;
  displayName: string | null;
  entityType: string;
}

interface SwitchGroup {
  id: string;
  name: string;
  displayName: string | null;
  chatCommand: string | null;
  memberEntityIds: string[];
}

interface LibraryGroup {
  id: string;
  name: string;
  parentId: string | null;
  memberEntityIds: string[];
  childGroupIds: string[];
}

interface MapPinOption {
  id: string;
  label: string;
  x: number;
  y: number;
}

function LibraryFolderCard({
  group,
  allGroups,
  devices,
  canAdmin,
  onMembersChange,
}: {
  group: LibraryGroup;
  allGroups: LibraryGroup[];
  devices: Device[];
  canAdmin: boolean;
  onMembersChange: (groupId: string, memberEntityIds: string[]) => Promise<void>;
}) {
  const children = allGroups.filter((g) => g.parentId === group.id);

  return (
    <li className="card device-card library-folder-card">
      <div className="library-folder-header">
        <strong>{group.name}</strong>
        <span className="badge">{group.memberEntityIds.length}</span>
      </div>
      <DeviceMemberPicker
        devices={devices}
        memberEntityIds={group.memberEntityIds}
        onMembersChange={(ids) => onMembersChange(group.id, ids)}
        readOnly={!canAdmin}
        addLabel="Add to folder…"
        emptyLabel="Folder is empty — add devices to organize them for your team."
      />
      {children.length > 0 && (
        <ul className="device-library-tree">
          {children.map((child) => (
            <LibraryFolderCard
              key={child.id}
              group={child}
              allGroups={allGroups}
              devices={devices}
              canAdmin={canAdmin}
              onMembersChange={onMembersChange}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const TRIGGER_LABELS: Record<AutomationTrigger["type"], string> = {
  smart_alarm: "Smart alarm triggered",
  storage_changed: "Storage monitor changed",
  tc_upkeep_low: "TC upkeep low",
  team_online_change: "Teammate came online",
  team_all_offline_change: "Whole team went offline",
  team_presence_change: "Team base presence changes",
  time_of_day: "Time of day",
  schedule_window: "Schedule window",
  interval: "On a schedule",
};

const MEMBER_FILTER_LABELS: Record<TeamMemberFilter, string> = {
  active: "Active (online, not AFK, has position)",
  online: "Online (includes AFK)",
  not_offline: "Anyone not offline",
};

const PROXIMITY_LABELS: Record<TeamProximityCheck, string> = {
  any_near: "Any matching member near base",
  all_near: "All matching members near base",
  none_near: "No matching members near base",
  all_away: "All matching members away from base",
  any_away: "Any matching member away from base",
};

const CONDITION_LABELS: Record<AutomationCondition["type"], string> = {
  switch_is: "Switch is on/off",
  team_any_online: "Any teammate online",
  team_all_offline: "All teammates offline",
  upkeep_below_hours: "TC upkeep below hours",
  time_is_day: "It is day",
  time_is_night: "It is night",
  team_near_point: "Team near point",
  team_away_from_point: "Team away from point",
};

const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  set_switch: "Set switch on/off",
  toggle_switch: "Toggle switch",
  toggle_switch_group: "Toggle switch group",
  send_team_chat: "Send team chat",
  send_discord: "Send Discord message",
};

const AUTO_MODES: Array<{ value: SwitchAutoMode; label: string }> = [
  { value: "auto-day-night", label: "On at night" },
  { value: "auto-night-day", label: "On at day" },
  { value: "auto-on", label: "Always on" },
  { value: "auto-off", label: "Always off" },
  { value: "any-online", label: "On when any teammate online" },
  { value: "proximity", label: "On when teammate nearby" },
];

function deviceLabel(device: Device): string {
  return device.displayName ?? device.name;
}

function defaultTrigger(type: AutomationTrigger["type"]): AutomationTrigger {
  switch (type) {
    case "interval":
      return { type, intervalMinutes: 60 };
    case "time_of_day":
      return { type, phase: "night" };
    case "schedule_window":
      return {
        type,
        startHour: 18,
        startMinute: 0,
        endHour: 6,
        endMinute: 0,
        overnight: true,
        scheduleEdge: "enter",
      };
    case "tc_upkeep_low":
      return { type, upkeepHours: 24 };
    case "team_presence_change":
      return {
        type,
        memberFilter: "active",
        proximityCheck: "none_near",
        useServerBase: true,
        radiusGrid: 1,
      };
    default:
      return { type };
  }
}

function defaultCondition(type: AutomationCondition["type"]): AutomationCondition {
  switch (type) {
    case "team_away_from_point":
      return activeAllAwayFromBaseCondition();
    case "team_near_point":
      return {
        type,
        memberFilter: "active",
        proximityCheck: "any_near",
        useServerBase: true,
        radiusGrid: 1,
      };
    case "switch_is":
      return { type, switchValue: true };
    case "upkeep_below_hours":
      return { type, upkeepHours: 24 };
    default:
      return { type };
  }
}

function defaultAction(type: AutomationAction["type"]): AutomationAction {
  switch (type) {
    case "send_team_chat":
      return { type, message: "Automation fired" };
    case "send_discord":
      return { type, message: "Automation fired" };
    case "set_switch":
      return { type, switchValue: true };
    case "toggle_switch":
      return { type };
    case "toggle_switch_group":
      return { type, switchValue: true };
    default:
      return { type: "send_team_chat", message: "Automation fired" };
  }
}

function summarizeRuleParts(
  trigger: AutomationTrigger,
  conditions: AutomationCondition[],
  actions: AutomationAction[],
): string {
  const actionText =
    actions.length > 0 ? actions.map((a) => ACTION_LABELS[a.type]).join(", ") : "No action";
  const condText = conditions.length > 0 ? ` · ${conditions.length} condition(s)` : "";
  return `${TRIGGER_LABELS[trigger.type]}${condText} → ${actionText}`;
}

function summarizeRule(rule: AutomationRuleRecord): string {
  return summarizeRuleParts(rule.trigger, rule.conditions, rule.actions);
}

function ActionFields({
  action,
  onChange,
  switches,
  groups,
}: {
  action: AutomationAction;
  onChange: (next: AutomationAction) => void;
  switches: Device[];
  groups: SwitchGroup[];
}) {
  return (
    <>
      <label>
        Action type
        <select
          value={action.type}
          onChange={(e) => onChange(defaultAction(e.target.value as AutomationAction["type"]))}
        >
          {(Object.keys(ACTION_LABELS) as AutomationAction["type"][]).map((type) => (
            <option key={type} value={type}>
              {ACTION_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      {(action.type === "set_switch" || action.type === "toggle_switch") && (
        <label>
          Switch
          <select
            value={action.entityId ?? ""}
            onChange={(e) => onChange({ ...action, entityId: e.target.value || undefined })}
          >
            <option value="">Select switch…</option>
            {switches.map((sw) => (
              <option key={sw.id} value={sw.id}>
                {deviceLabel(sw)}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === "set_switch" && (
        <label>
          State
          <select
            value={action.switchValue === false ? "off" : "on"}
            onChange={(e) => onChange({ ...action, switchValue: e.target.value === "on" })}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      )}

      {action.type === "toggle_switch_group" && (
        <>
          <label>
            Switch group
            <select
              value={action.groupId ?? ""}
              onChange={(e) => onChange({ ...action, groupId: e.target.value || undefined })}
            >
              <option value="">Select group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.displayName ?? g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Set switches
            <select
              value={action.switchValue === false ? "off" : action.switchValue === true ? "on" : "toggle"}
              onChange={(e) => {
                const mode = e.target.value;
                onChange({
                  ...action,
                  switchValue: mode === "toggle" ? undefined : mode === "on",
                });
              }}
            >
              <option value="toggle">Toggle each switch</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
        </>
      )}

      {(action.type === "send_team_chat" || action.type === "send_discord") && (
        <>
          <label>
            Message
            <input
              value={action.message ?? ""}
              onChange={(e) => onChange({ ...action, message: e.target.value })}
              placeholder="Message to send"
            />
          </label>
          {action.type === "send_discord" && (
            <label className="automation-checkbox">
              <input
                type="checkbox"
                checked={action.pingEveryone === true}
                onChange={(e) => onChange({ ...action, pingEveryone: e.target.checked })}
              />
              Ping @everyone
            </label>
          )}
        </>
      )}
    </>
  );
}

function ProximityFields({
  memberFilter,
  proximityCheck,
  radiusGrid,
  useServerBase,
  mapPinId,
  pins,
  onChange,
}: {
  memberFilter: TeamMemberFilter;
  proximityCheck: TeamProximityCheck;
  radiusGrid: number;
  useServerBase: boolean;
  mapPinId?: string;
  pins: MapPinOption[];
  onChange: (patch: {
    memberFilter?: TeamMemberFilter;
    proximityCheck?: TeamProximityCheck;
    radiusGrid?: number;
    useServerBase?: boolean;
    mapPinId?: string;
  }) => void;
}) {
  return (
    <>
      <label>
        Teammates to count
        <select
          value={memberFilter}
          onChange={(e) => onChange({ memberFilter: e.target.value as TeamMemberFilter })}
        >
          {(Object.keys(MEMBER_FILTER_LABELS) as TeamMemberFilter[]).map((key) => (
            <option key={key} value={key}>
              {MEMBER_FILTER_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Proximity
        <select
          value={proximityCheck}
          onChange={(e) => onChange({ proximityCheck: e.target.value as TeamProximityCheck })}
        >
          {(Object.keys(PROXIMITY_LABELS) as TeamProximityCheck[]).map((key) => (
            <option key={key} value={key}>
              {PROXIMITY_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Base radius (grid cells)
        <input
          type="number"
          min={0}
          max={10}
          value={radiusGrid}
          onChange={(e) => onChange({ radiusGrid: Math.max(0, Number(e.target.value) || 1) })}
        />
      </label>
      <label>
        Base location
        <select
          value={mapPinId ?? (useServerBase ? "__server_base__" : "")}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "__server_base__") {
              onChange({ useServerBase: true, mapPinId: undefined });
            } else if (!value) {
              onChange({ useServerBase: false, mapPinId: undefined });
            } else {
              onChange({ useServerBase: false, mapPinId: value });
            }
          }}
        >
          <option value="__server_base__">Server base (configured below)</option>
          {pins.map((pin) => (
            <option key={pin.id} value={pin.id}>
              Map pin: {pin.label} ({Math.round(pin.x)}, {Math.round(pin.y)})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function AutomationRuleEditor({
  rule,
  draft,
  devices,
  groups,
  pins,
  onSave,
  onDelete,
  onCancel,
  onSaveAsTemplate,
  isCreate = false,
}: {
  rule?: AutomationRuleRecord;
  draft?: {
    name?: string;
    enabled?: boolean;
    trigger?: AutomationTrigger;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
  };
  devices: Device[];
  groups: SwitchGroup[];
  pins: MapPinOption[];
  onSave: (patch: {
    name: string;
    enabled: boolean;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
  onSaveAsTemplate?: (data: {
    name: string;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => Promise<void>;
  isCreate?: boolean;
}) {
  const [name, setName] = useState(draft?.name ?? rule?.name ?? "New rule");
  const [enabled, setEnabled] = useState(draft?.enabled ?? rule?.enabled ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(
    draft?.trigger ?? rule?.trigger ?? defaultTrigger("interval"),
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    draft?.conditions ?? rule?.conditions ?? [],
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    draft?.actions ?? rule?.actions ?? [defaultAction("send_team_chat")],
  );
  const [saving, setSaving] = useState(false);
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const switches = devices.filter((d) => d.entityType === "smart_switch");
  const alarms = devices.filter((d) => d.entityType === "smart_alarm");
  const storage = devices.filter((d) => d.entityType === "storage_monitor");

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name: name.trim() || "Untitled rule",
        enabled,
        trigger,
        conditions,
        actions: actions.length > 0 ? actions : [defaultAction("send_team_chat")],
      });
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    if (!onSaveAsTemplate || !templateName.trim()) return;
    setSaving(true);
    try {
      await onSaveAsTemplate({
        name: templateName.trim(),
        trigger,
        conditions,
        actions: actions.length > 0 ? actions : [defaultAction("send_team_chat")],
      });
      setShowTemplateSave(false);
      setTemplateName("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className={`card device-card automation-rule-card${isCreate ? " automation-rule-card-create" : ""}`}>
      {isCreate && <h3 className="automation-rule-create-title">New rule</h3>}

      <label>
        Rule name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="automation-checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enabled
      </label>

      <label>
        When (trigger)
        <select
          value={trigger.type}
          onChange={(e) => setTrigger(defaultTrigger(e.target.value as AutomationTrigger["type"]))}
        >
          {(Object.keys(TRIGGER_LABELS) as AutomationTrigger["type"][]).map((type) => (
            <option key={type} value={type}>
              {TRIGGER_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      {trigger.type === "interval" && (
        <label>
          Every (minutes)
          <input
            type="number"
            min={1}
            value={trigger.intervalMinutes ?? 60}
            onChange={(e) =>
              setTrigger({ ...trigger, intervalMinutes: Math.max(1, Number(e.target.value) || 60) })
            }
          />
        </label>
      )}

      {trigger.type === "time_of_day" && (
        <label>
          Phase
          <select
            value={trigger.phase ?? "night"}
            onChange={(e) => setTrigger({ ...trigger, phase: e.target.value as "day" | "night" })}
          >
            <option value="day">Day</option>
            <option value="night">Night</option>
          </select>
        </label>
      )}

      {trigger.type === "schedule_window" && (
        <>
          <label>
            Start (local time)
            <div className="inline-time-row">
              <input
                type="number"
                min={0}
                max={23}
                value={trigger.startHour ?? 18}
                onChange={(e) =>
                  setTrigger({ ...trigger, startHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })
                }
              />
              <span>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={trigger.startMinute ?? 0}
                onChange={(e) =>
                  setTrigger({
                    ...trigger,
                    startMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
          </label>
          <label>
            End (local time)
            <div className="inline-time-row">
              <input
                type="number"
                min={0}
                max={23}
                value={trigger.endHour ?? 6}
                onChange={(e) =>
                  setTrigger({ ...trigger, endHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })
                }
              />
              <span>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={trigger.endMinute ?? 0}
                onChange={(e) =>
                  setTrigger({
                    ...trigger,
                    endMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
              />
            </div>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={trigger.overnight ?? false}
              onChange={(e) => setTrigger({ ...trigger, overnight: e.target.checked })}
            />
            <span>Window crosses midnight (e.g. 18:00–06:00)</span>
          </label>
          <label>
            Fire when
            <select
              value={trigger.scheduleEdge ?? "enter"}
              onChange={(e) =>
                setTrigger({
                  ...trigger,
                  scheduleEdge: e.target.value as "enter" | "exit" | "both",
                })
              }
            >
              <option value="enter">Window starts</option>
              <option value="exit">Window ends</option>
              <option value="both">Window starts or ends</option>
            </select>
          </label>
        </>
      )}

      {trigger.type === "tc_upkeep_low" && (
        <label>
          Upkeep below (hours)
          <input
            type="number"
            min={1}
            value={trigger.upkeepHours ?? 24}
            onChange={(e) =>
              setTrigger({ ...trigger, upkeepHours: Math.max(1, Number(e.target.value) || 24) })
            }
          />
        </label>
      )}

      {(trigger.type === "smart_alarm" || trigger.type === "storage_changed") && (
        <label>
          Device (optional — leave blank for any)
          <select
            value={trigger.entityId ?? ""}
            onChange={(e) => setTrigger({ ...trigger, entityId: e.target.value || undefined })}
          >
            <option value="">Any {trigger.type === "smart_alarm" ? "alarm" : "storage monitor"}</option>
            {(trigger.type === "smart_alarm" ? alarms : storage).map((d) => (
              <option key={d.id} value={d.id}>
                {deviceLabel(d)}
              </option>
            ))}
          </select>
        </label>
      )}

      {trigger.type === "team_presence_change" && (
        <ProximityFields
          memberFilter={trigger.memberFilter ?? "active"}
          proximityCheck={trigger.proximityCheck ?? "none_near"}
          radiusGrid={trigger.radiusGrid ?? 1}
          useServerBase={trigger.useServerBase !== false}
          mapPinId={trigger.mapPinId}
          pins={pins}
          onChange={(patch) => setTrigger({ ...trigger, ...patch })}
        />
      )}

      <fieldset className="automation-conditions">
        <legend>And only if (optional conditions)</legend>
        {conditions.length === 0 && (
          <p className="muted device-card-hint">No extra conditions — the trigger alone controls when this runs.</p>
        )}
        {conditions.map((condition, index) => (
          <div key={index} className="automation-condition-block">
            <label>
              Condition
              <select
                value={condition.type}
                onChange={(e) => {
                  const next = [...conditions];
                  next[index] = defaultCondition(e.target.value as AutomationCondition["type"]);
                  setConditions(next);
                }}
              >
                {(Object.keys(CONDITION_LABELS) as AutomationCondition["type"][]).map((type) => (
                  <option key={type} value={type}>
                    {CONDITION_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            {condition.type === "switch_is" && (
              <>
                <label>
                  Switch
                  <select
                    value={condition.entityId ?? ""}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[index] = { ...condition, entityId: e.target.value || undefined };
                      setConditions(next);
                    }}
                  >
                    <option value="">Select switch…</option>
                    {switches.map((sw) => (
                      <option key={sw.id} value={sw.id}>
                        {deviceLabel(sw)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  State
                  <select
                    value={condition.switchValue === false ? "off" : "on"}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[index] = { ...condition, switchValue: e.target.value === "on" };
                      setConditions(next);
                    }}
                  >
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              </>
            )}
            {condition.type === "upkeep_below_hours" && (
              <>
                <label>
                  Storage monitor (TC)
                  <select
                    value={condition.entityId ?? ""}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[index] = { ...condition, entityId: e.target.value || undefined };
                      setConditions(next);
                    }}
                  >
                      <option value="">Select monitor…</option>
                      {storage.map((d) => (
                        <option key={d.id} value={d.id}>
                          {deviceLabel(d)}
                        </option>
                      ))}
                    </select>
                </label>
                <label>
                  Below (hours)
                  <input
                    type="number"
                    min={1}
                    value={condition.upkeepHours ?? 24}
                    onChange={(e) => {
                      const next = [...conditions];
                      next[index] = {
                        ...condition,
                        upkeepHours: Math.max(1, Number(e.target.value) || 24),
                      };
                      setConditions(next);
                    }}
                  />
                </label>
              </>
            )}
            {(condition.type === "team_near_point" || condition.type === "team_away_from_point") && (
              <ProximityFields
                memberFilter={condition.memberFilter ?? "active"}
                proximityCheck={
                  condition.proximityCheck ??
                  (condition.type === "team_near_point" ? "any_near" : "none_near")
                }
                radiusGrid={condition.radiusGrid ?? 1}
                useServerBase={condition.useServerBase !== false}
                mapPinId={condition.mapPinId}
                pins={pins}
                onChange={(patch) => {
                  const next = [...conditions];
                  next[index] = { ...condition, ...patch };
                  setConditions(next);
                }}
              />
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
            >
              Remove condition
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setConditions([...conditions, defaultCondition("time_is_day")])}
        >
          Add condition
        </button>
      </fieldset>

      <fieldset className="automation-actions">
        <legend>Then (actions)</legend>
        {actions.map((action, index) => (
          <div key={index} className="automation-action-block">
            <ActionFields
              action={action}
              switches={switches}
              groups={groups}
              onChange={(next) => {
                const updated = [...actions];
                updated[index] = next;
                setActions(updated);
              }}
            />
            {actions.length > 1 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActions(actions.filter((_, i) => i !== index))}
              >
                Remove action
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setActions([...actions, defaultAction("send_team_chat")])}
        >
          Add action
        </button>
      </fieldset>

      <p className="muted device-card-hint">
        {summarizeRuleParts(trigger, conditions, actions)}
      </p>

      <div className="btn-row">
        <button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : isCreate ? "Create rule" : "Save rule"}
        </button>
        {onSaveAsTemplate && !showTemplateSave && (
          <button
            type="button"
            className="btn-secondary"
            disabled={saving}
            onClick={() => {
              setTemplateName(name.trim() || "My template");
              setShowTemplateSave(true);
            }}
          >
            Save as template
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => void onDelete()}>
            Delete
          </button>
        )}
      </div>

      {showTemplateSave && onSaveAsTemplate && (
        <form
          className="automation-template-save"
          onSubmit={(e) => {
            e.preventDefault();
            void saveTemplate();
          }}
        >
          <label>
            Template name
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Name for this template"
            />
          </label>
          <div className="btn-row">
            <button type="submit" disabled={saving || !templateName.trim()}>
              Save template
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowTemplateSave(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function AutomationsPage() {
  const canAdmin = useCan("admin");
  const { epoch } = useActiveServer();
  const [tab, setTab] = useState<"rules" | "groups" | "library">("rules");
  const [devices, setDevices] = useState<Device[]>([]);
  const [rules, setRules] = useState<AutomationRuleRecord[]>([]);
  const [templates, setTemplates] = useState<AutomationRuleTemplateRecord[]>([]);
  const [groups, setGroups] = useState<SwitchGroup[]>([]);
  const [library, setLibrary] = useState<{
    groups: LibraryGroup[];
    cameras: Array<{ id: string; cameraId: string; label: string }>;
  }>({ groups: [], cameras: [] });
  const [automationBase, setAutomationBase] = useState<AutomationBaseSettings | null>(null);
  const [mapPins, setMapPins] = useState<MapPinOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newLibraryName, setNewLibraryName] = useState("");
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [createDraft, setCreateDraft] = useState<{
    name?: string;
    trigger?: AutomationTrigger;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
  } | null>(null);

  const load = async () => {
    try {
      const [deviceData, ruleData, templateData, groupData, libraryData, settingsData] = await Promise.all([
        apiFetch<{ devices: Device[] }>("/devices"),
        apiFetch<{ rules: AutomationRuleRecord[] }>("/automation-rules"),
        apiFetch<{ templates: AutomationRuleTemplateRecord[] }>("/automation-rule-templates"),
        apiFetch<{ groups: SwitchGroup[] }>("/switch-groups"),
        apiFetch<{
          groups: LibraryGroup[];
          cameras: Array<{ id: string; cameraId: string; label: string }>;
        }>("/device-library"),
        apiFetch<{ automationBase: AutomationBaseSettings; pins: MapPinOption[] }>("/automation-settings"),
      ]);
      setDevices(deviceData.devices);
      setRules(ruleData.rules);
      setTemplates(templateData.templates);
      setGroups(groupData.groups);
      setLibrary(libraryData);
      setAutomationBase(settingsData.automationBase);
      setMapPins(settingsData.pins);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  };

  useEffect(() => {
    void load();
  }, [epoch]);

  const switches = devices.filter((d) => d.entityType === "smart_switch");

  const startCreateRule = (draft?: {
    name?: string;
    trigger?: AutomationTrigger;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
  }) => {
    setCreateDraft(draft ?? null);
    setShowCreateRule(true);
  };

  const createRule = async (data: {
    name: string;
    enabled: boolean;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => {
    await apiFetch("/automation-rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
    setShowCreateRule(false);
    setCreateDraft(null);
    await load();
  };

  const saveTemplate = async (data: {
    name: string;
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => {
    await apiFetch("/automation-rule-templates", {
      method: "POST",
      body: JSON.stringify(data),
    });
    await load();
  };

  const deleteTemplate = async (templateId: string) => {
    await apiFetch(`/automation-rule-templates/${templateId}`, { method: "DELETE" });
    await load();
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    await apiFetch("/switch-groups", {
      method: "POST",
      body: JSON.stringify({ name: newGroupName.trim(), memberEntityIds: [] }),
    });
    setNewGroupName("");
    await load();
  };

  const updateLibraryMembers = async (groupId: string, memberEntityIds: string[]) => {
    await apiFetch(`/device-library/groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify({ memberEntityIds }),
    });
    await load();
  };

  const updateGroupMembers = async (groupId: string, memberEntityIds: string[]) => {
    await apiFetch(`/switch-groups/${groupId}`, {
      method: "PATCH",
      body: JSON.stringify({ memberEntityIds }),
    });
    await load();
  };

  const createLibraryGroup = async () => {
    if (!newLibraryName.trim()) return;
    await apiFetch("/device-library/groups", {
      method: "POST",
      body: JSON.stringify({ name: newLibraryName.trim(), memberEntityIds: [] }),
    });
    setNewLibraryName("");
    await load();
  };

  const updateRule = async (ruleId: string, patch: Partial<AutomationRuleRecord>) => {
    await apiFetch(`/automation-rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: patch.name,
        enabled: patch.enabled,
        trigger: patch.trigger,
        conditions: patch.conditions,
        actions: patch.actions,
      }),
    });
    await load();
  };

  const saveAutomationBase = async (patch: Partial<AutomationBaseSettings>) => {
    const res = await apiFetch<{ automationBase: AutomationBaseSettings }>("/automation-settings", {
      method: "PATCH",
      body: JSON.stringify({ automationBase: patch }),
    });
    setAutomationBase(res.automationBase);
  };

  return (
    <div>
      <header className="page-header">
        <h1>Automations</h1>
        <p>IFTTT-style rules, switch groups, and a shared device library for your team.</p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="btn-row" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={tab === "rules" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("rules")}
        >
          Logic rules
        </button>
        <button
          type="button"
          className={tab === "groups" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("groups")}
        >
          Switch groups
        </button>
        <button
          type="button"
          className={tab === "library" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("library")}
        >
          Device library
        </button>
        {LIVE_CAMERAS_ENABLED && (
          <Link to="/cameras" className="btn-secondary">
            Cameras →
          </Link>
        )}
      </div>

      {tab === "rules" && (
        <section className="card">
          <h2>Logic rules</h2>
          <p className="muted automation-tab-intro">
            Build rules from any combination of triggers, conditions, and actions. Save a configuration
            as a <strong>template</strong> to reuse when creating new rules on this server.
          </p>
          {canAdmin && automationBase && (
            <div className="automation-base-card">
              <h3>Server base location</h3>
              <p className="muted device-card-hint">
                Used by proximity rules unless a rule picks a specific map pin. Place a “Base” pin on the map or enter
                world coordinates from the map detail panel.
              </p>
              <div className="automation-base-grid">
                <label>
                  World X
                  <input
                    type="number"
                    value={automationBase.x ?? ""}
                    placeholder="e.g. 1200"
                    onChange={(e) =>
                      setAutomationBase({
                        ...automationBase,
                        x: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    onBlur={() =>
                      void saveAutomationBase({ x: automationBase.x, y: automationBase.y }).catch(() => load())
                    }
                  />
                </label>
                <label>
                  World Y
                  <input
                    type="number"
                    value={automationBase.y ?? ""}
                    placeholder="e.g. 800"
                    onChange={(e) =>
                      setAutomationBase({
                        ...automationBase,
                        y: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    onBlur={() =>
                      void saveAutomationBase({ x: automationBase.x, y: automationBase.y }).catch(() => load())
                    }
                  />
                </label>
                <label>
                  Radius (grid)
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={automationBase.radiusGrid}
                    onChange={(e) =>
                      setAutomationBase({
                        ...automationBase,
                        radiusGrid: Math.max(0, Number(e.target.value) || 1),
                      })
                    }
                    onBlur={() =>
                      void saveAutomationBase({ radiusGrid: automationBase.radiusGrid }).catch(() => load())
                    }
                  />
                </label>
                <label>
                  Or map pin
                  <select
                    value={automationBase.mapPinId ?? ""}
                    onChange={(e) => {
                      const mapPinId = e.target.value || null;
                      setAutomationBase({ ...automationBase, mapPinId });
                      void saveAutomationBase({ mapPinId });
                    }}
                  >
                      <option value="">Coordinates above</option>
                      {mapPins.map((pin) => (
                        <option key={pin.id} value={pin.id}>
                          {pin.label}
                        </option>
                      ))}
                    </select>
                </label>
              </div>
            </div>
          )}
          {!canAdmin && (
            <p className="muted">Admin permission is required to create or edit rules.</p>
          )}
          {canAdmin && (
            <>
              {templates.length > 0 && (
                <div className="automation-templates">
                  <h3>Your templates</h3>
                  <ul className="automation-template-list">
                    {templates.map((template) => (
                      <li key={template.id} className="automation-template-item">
                        <div>
                          <strong>{template.name}</strong>
                          <p className="muted device-card-hint">
                            {summarizeRuleParts(template.trigger, template.conditions, template.actions)}
                          </p>
                        </div>
                        <div className="btn-row">
                          <button
                            type="button"
                            onClick={() =>
                              startCreateRule({
                                name: template.name,
                                trigger: template.trigger,
                                conditions: template.conditions,
                                actions: template.actions,
                              })
                            }
                          >
                            New rule from template
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void deleteTemplate(template.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!showCreateRule ? (
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      startCreateRule({
                        name: "Night lights",
                        trigger: {
                          type: "schedule_window",
                          startHour: 18,
                          startMinute: 0,
                          endHour: 6,
                          endMinute: 0,
                          overnight: true,
                          scheduleEdge: "enter",
                        },
                        conditions: [{ type: "time_is_night" }],
                        actions: [{ type: "toggle_switch_group" }],
                      })
                    }
                  >
                    Night lights schedule
                  </button>
                  <button type="button" className="btn-primary" onClick={() => startCreateRule()}>
                    New rule
                  </button>
                </div>
              ) : null}
            </>
          )}
          {rules.length === 0 && !showCreateRule && <p className="muted">No automation rules yet.</p>}
          <ul className="device-list">
            {showCreateRule && canAdmin && (
              <AutomationRuleEditor
                key={createDraft ? `draft-${createDraft.name}` : "draft-new"}
                draft={createDraft ?? undefined}
                devices={devices}
                groups={groups}
                pins={mapPins}
                isCreate
                onSave={createRule}
                onSaveAsTemplate={saveTemplate}
                onCancel={() => {
                  setShowCreateRule(false);
                  setCreateDraft(null);
                }}
              />
            )}
            {rules.map((rule) =>
              canAdmin ? (
                <AutomationRuleEditor
                  key={rule.id}
                  rule={rule}
                  devices={devices}
                  groups={groups}
                  pins={mapPins}
                  onSave={(patch) => updateRule(rule.id, patch)}
                  onSaveAsTemplate={saveTemplate}
                  onDelete={async () => {
                    await apiFetch(`/automation-rules/${rule.id}`, { method: "DELETE" });
                    await load();
                  }}
                />
              ) : (
                <li key={rule.id} className="card device-card">
                  <strong>{rule.name}</strong>
                  <p className="muted">{summarizeRule(rule)}</p>
                  <p className="muted">{rule.enabled ? "Enabled" : "Disabled"}</p>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {tab === "groups" && (
        <section className="card">
          <h2>Switch groups</h2>
          <p className="muted automation-tab-intro">
            <strong>Switch groups</strong> are for <em>doing things</em>: toggle several smart switches
            together from the Devices page, via team chat (<code>!lights</code> if you set a chat alias),
            or from automation rules. They only include smart switches.
          </p>
          {canAdmin && (
            <form
              className="automation-inline-create"
              onSubmit={(e) => {
                e.preventDefault();
                void createGroup();
              }}
            >
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
              />
              <button type="submit" disabled={!newGroupName.trim()}>
                Create group
              </button>
            </form>
          )}
          {groups.length === 0 && (
            <p className="muted">No switch groups yet. Create one to toggle multiple switches together.</p>
          )}
          <ul className="device-list">
            {groups.map((group) => (
              <li key={group.id} className="card device-card">
                <strong>{group.displayName ?? group.name}</strong>
                {group.chatCommand && (
                  <p className="muted">
                    Chat command: <code>!{group.chatCommand}</code>
                  </p>
                )}
                <p className="muted">{group.memberEntityIds.length} switch(es)</p>
                {canAdmin && (
                  <>
                    <label>
                      Chat alias
                      <input
                        defaultValue={group.chatCommand ?? ""}
                        placeholder="e.g. lights"
                        onBlur={(e) =>
                          void apiFetch(`/switch-groups/${group.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ chatCommand: e.target.value || null }),
                          }).then(() => load())
                        }
                      />
                    </label>
                    <DeviceMemberPicker
                      devices={switches}
                      memberEntityIds={group.memberEntityIds}
                      onMembersChange={(ids) => updateGroupMembers(group.id, ids)}
                      entityTypes={["smart_switch"]}
                      addLabel="Add switch…"
                      emptyLabel="No switches in this group yet."
                    />
                  </>
                )}
                {!canAdmin && group.memberEntityIds.length > 0 && (
                  <DeviceMemberPicker
                    devices={switches}
                    memberEntityIds={group.memberEntityIds}
                    onMembersChange={() => {}}
                    entityTypes={["smart_switch"]}
                    readOnly
                    emptyLabel="No switches in this group."
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "library" && (
        <section className="card">
          <h2>Team device library</h2>
          <p className="muted automation-tab-intro">
            <strong>Device library</strong> is for <em>organizing</em>: nested folders of all paired
            devices (switches, alarms, storage) plus saved CCTV bookmarks. It does not toggle anything
            by itself — use switch groups or rules for actions. Per-switch auto modes (day/night,
            proximity) are configured on the Devices page.
          </p>
          {canAdmin && (
            <form
              className="automation-inline-create"
              onSubmit={(e) => {
                e.preventDefault();
                void createLibraryGroup();
              }}
            >
              <input
                value={newLibraryName}
                onChange={(e) => setNewLibraryName(e.target.value)}
                placeholder="Folder name"
              />
              <button type="submit" disabled={!newLibraryName.trim()}>
                New folder
              </button>
            </form>
          )}
          {library.groups.length === 0 && (
            <p className="muted">Organize devices into nested folders shared with your team.</p>
          )}
          <ul className="device-list">
            {library.groups
              .filter((g) => !g.parentId)
              .map((group) => (
                <LibraryFolderCard
                  key={group.id}
                  group={group}
                  allGroups={library.groups}
                  devices={devices}
                  canAdmin={canAdmin}
                  onMembersChange={updateLibraryMembers}
                />
              ))}
          </ul>
          {library.cameras.length > 0 && (
            <>
              <h3>Saved cameras</h3>
              <ul>
                {library.cameras.map((cam) => (
                  <li key={cam.id}>
                    {cam.label} — <code>{cam.cameraId}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted device-card-hint">
            Switch auto modes (Devices page): {AUTO_MODES.map((m) => m.label).join(" · ")}
          </p>
        </section>
      )}
    </div>
  );
}
