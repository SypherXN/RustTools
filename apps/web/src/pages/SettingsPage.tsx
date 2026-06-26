import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { apiFetch } from "../lib/api";
import { ServerSwitcher } from "../components/ServerSwitcher";
import { DataResetPanel } from "../components/DataResetPanel";
import type { NotificationSettingsResponse } from "@rusttools/shared";
import { DEFAULT_MAP_EVENT_TYPES } from "@rusttools/shared";
import { useCan } from "../hooks/usePermissions";
import { useActiveServer } from "../hooks/useActiveServer";
import { PushNotificationSetup } from "../components/PushNotificationSetup";
import { ProcgenMapUpload } from "../components/ProcgenMapUpload";
import { FcmConfigUpload } from "../components/FcmConfigUpload";

type SettingsTab =
  | "server"
  | "account"
  | "alarms"
  | "tc"
  | "deepsea"
  | "team-chat"
  | "events"
  | "legacy"
  | "admin";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; adminOnly?: boolean }> = [
  { id: "server", label: "Server & Map" },
  { id: "account", label: "Account" },
  { id: "alarms", label: "Smart Alarms" },
  { id: "tc", label: "TC Decay" },
  { id: "deepsea", label: "Deep Sea" },
  { id: "team-chat", label: "Team Chat" },
  { id: "events", label: "Event Timers" },
  { id: "legacy", label: "Legacy Automations" },
  { id: "admin", label: "Admin", adminOnly: true },
];

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const canAdmin = useCan("admin");
  const { epoch } = useActiveServer();
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettingsResponse | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsSaved, setNotificationsSaved] = useState(false);
  const [serverInfo, setServerInfo] = useState<{
    mapMeta?: { seed: number | null; salt: number | null; mapName: string | null; mapSize: number | null };
    connectString?: string | null;
  } | null>(null);
  const [tab, setTab] = useState<SettingsTab>("server");

  useEffect(() => {
    void apiFetch<{
      mapMeta?: { seed: number | null; salt: number | null; mapName: string | null; mapSize: number | null };
      connectString?: string | null;
    }>("/servers/active/info")
      .then((d) => setServerInfo(d))
      .catch(() => setServerInfo(null));
  }, [epoch]);

  useEffect(() => {
    setNotificationsLoading(true);
    void apiFetch<NotificationSettingsResponse>("/servers/active/notifications")
      .then(setNotifications)
      .catch((err) => {
        setNotificationsError(err instanceof Error ? err.message : "Failed to load notification settings");
      })
      .finally(() => setNotificationsLoading(false));
  }, [epoch]);

  const saveNotifications = async (patch: {
    smartAlarm?: Partial<NotificationSettingsResponse["settings"]["smartAlarm"]> & {
      escalation?: Partial<NotificationSettingsResponse["settings"]["smartAlarm"]["escalation"]>;
    };
    deepSea?: Partial<NotificationSettingsResponse["settings"]["deepSea"]>;
    tcDecay?: Partial<NotificationSettingsResponse["settings"]["tcDecay"]>;
    teamChatBot?: Partial<NotificationSettingsResponse["settings"]["teamChatBot"]>;
    eventTimers?: Partial<NotificationSettingsResponse["settings"]["eventTimers"]>;
    legacyAutomations?: Partial<NotificationSettingsResponse["settings"]["legacyAutomations"]> & {
      nightLights?: Partial<
        NotificationSettingsResponse["settings"]["legacyAutomations"]["nightLights"]
      >;
      teamOfflineSam?: Partial<
        NotificationSettingsResponse["settings"]["legacyAutomations"]["teamOfflineSam"]
      >;
      mapEvents?: Partial<
        NotificationSettingsResponse["settings"]["legacyAutomations"]["mapEvents"]
      >;
    };
  }) => {
    if (!notifications) return;
    setNotificationsSaving(true);
    setNotificationsError(null);
    setNotificationsSaved(false);
    try {
      const data = await apiFetch<NotificationSettingsResponse>("/servers/active/notifications", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setNotifications(data);
      setNotificationsSaved(true);
    } catch (err) {
      setNotificationsError(err instanceof Error ? err.message : "Failed to save notification settings");
    } finally {
      setNotificationsSaving(false);
    }
  };

  const updateSmartAlarm = (
    key: "discord" | "teamChat" | "pingEveryone" | "webPush" | "browserSiren",
    value: boolean,
  ) => {
    if (!notifications) return;
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        smartAlarm: { ...notifications.settings.smartAlarm, [key]: value },
      },
    };
    setNotifications(next);
    void saveNotifications({ smartAlarm: { [key]: value } });
  };

  const updateSmartAlarmEscalation = (
    key: keyof NotificationSettingsResponse["settings"]["smartAlarm"]["escalation"],
    value: boolean | string[],
  ) => {
    if (!notifications) return;
    const escalation = { ...notifications.settings.smartAlarm.escalation, [key]: value };
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        smartAlarm: { ...notifications.settings.smartAlarm, escalation },
      },
    };
    setNotifications(next);
    void saveNotifications({
      smartAlarm: {
        escalation: { ...escalation },
      },
    });
  };

  const updateLegacyAutomations = (
    section: "nightLights" | "teamOfflineSam" | "mapEvents",
    patch: Record<string, unknown>,
  ) => {
    if (!notifications) return;
    const legacyAutomations = {
      ...notifications.settings.legacyAutomations,
      [section]: { ...notifications.settings.legacyAutomations[section], ...patch },
    };
    const next = {
      ...notifications,
      settings: { ...notifications.settings, legacyAutomations },
    };
    setNotifications(next);
    void saveNotifications({ legacyAutomations: { [section]: patch } });
  };

  const updateTcDecay = (
    key: keyof NotificationSettingsResponse["settings"]["tcDecay"],
    value: boolean | number,
  ) => {
    if (!notifications) return;
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        tcDecay: { ...notifications.settings.tcDecay, [key]: value },
      },
    };
    setNotifications(next);
    void saveNotifications({ tcDecay: { [key]: value } });
  };

  const updateDeepSea = (key: "discord" | "teamChat", value: boolean) => {
    if (!notifications) return;
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        deepSea: { ...notifications.settings.deepSea, [key]: value },
      },
    };
    setNotifications(next);
    void saveNotifications({ deepSea: { [key]: value } });
  };

  const updateTeamChatBot = (
    key: keyof NotificationSettingsResponse["settings"]["teamChatBot"],
    value: boolean | number,
  ) => {
    if (!notifications) return;
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        teamChatBot: { ...notifications.settings.teamChatBot, [key]: value },
      },
    };
    setNotifications(next);
    void saveNotifications({ teamChatBot: { [key]: value } });
  };

  const updateEventTimers = (
    key: keyof NotificationSettingsResponse["settings"]["eventTimers"],
    value: number | number[],
  ) => {
    if (!notifications) return;
    const next = {
      ...notifications,
      settings: {
        ...notifications.settings,
        eventTimers: { ...notifications.settings.eventTimers, [key]: value },
      },
    };
    setNotifications(next);
    void saveNotifications({ eventTimers: { [key]: value } });
  };

  const linkRust = async () => {
    setLinking(true);
    setLinkError(null);
    setLinkMessage(null);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string }>("/auth/link-rust", {
        method: "POST",
      });
      await refresh();
      await refresh();
      setLinkMessage(res.message ?? "Ready for in-game pairing.");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to start Rust+ link");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Settings</h1>
        <p>Account linking, servers, and pairing setup.</p>
      </header>

      <nav className="page-tabs">
        {SETTINGS_TABS.filter((t) => !t.adminOnly || canAdmin).map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "server" && (
        <>
      <ServerSwitcher />

      <section className="card">
        <h2>Server & Map</h2>
        {serverInfo?.mapMeta ? (
          <dl className="stat-list">
            <div>
              <dt>Map name</dt>
              <dd>{serverInfo.mapMeta.mapName ?? "—"}</dd>
            </div>
            <div>
              <dt>Seed</dt>
              <dd>{serverInfo.mapMeta.seed ?? "—"}</dd>
            </div>
            <div>
              <dt>Salt</dt>
              <dd>{serverInfo.mapMeta.salt ?? "—"}</dd>
            </div>
            {serverInfo.mapMeta.mapSize != null && (
              <div>
                <dt>World size</dt>
                <dd>{serverInfo.mapMeta.mapSize}m</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="muted">Connect Rust+ to see map seed and salt.</p>
        )}
        {serverInfo?.connectString && (
          <p style={{ marginTop: "0.75rem" }}>
            F1 connect: <code>{serverInfo.connectString}</code>{" "}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void navigator.clipboard.writeText(serverInfo.connectString!)}
            >
              Copy
            </button>
          </p>
        )}
      </section>

      <ProcgenMapUpload />
        </>
      )}

      {tab === "account" && (
        <>
      <section className="card">
        <h2>Permissions</h2>
        <p className="muted">
          Web access is controlled by Discord roles on your server. Set role IDs in{" "}
          <code>DISCORD_ROLE_VIEW</code>, <code>DISCORD_ROLE_SWITCH</code>, and{" "}
          <code>DISCORD_ROLE_ADMIN</code>. Leave all blank to allow everyone.
        </p>
        <ul className="setup-steps">
          <li>
            <strong>View</strong> — dashboard, map, storage, team roster (read-only)
          </li>
          <li>
            <strong>Switch</strong> — toggle smart switches, send team chat (includes View)
          </li>
          <li>
            <strong>Admin</strong> — settings, server activation, Rust+ link, audit log, renames
            (includes Switch and View)
          </li>
        </ul>
        {user?.rolesConfigured && (
          <p className="muted">
            Your access:{" "}
            <strong>
              {user.permissions.admin
                ? "Admin"
                : user.permissions.switch
                  ? "Switch"
                  : user.permissions.view
                    ? "View"
                    : "None"}
            </strong>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Discord Account</h2>
        <p>
          Logged in as <strong>{user?.user.discordUsername}</strong>
        </p>
      </section>

      <section className="card">
        <h2>Rust+ Link</h2>
        {!canAdmin ? (
          <p className="muted">Only admins can start or manage Rust+ account linking.</p>
        ) : user?.linkedRust ? (
          <>
            <p>
              Steam ID linked: <code>{user.user.steamId}</code>
            </p>
            {notifications && (
              <p>
                Rust+ WebSocket:{" "}
                <span className={notifications.capabilities.rustPlusConnected ? "badge badge-ok" : "badge"}>
                  {notifications.capabilities.rustPlusConnected ? "Connected" : "Disconnected"}
                </span>
              </p>
            )}
            {linkError && <div className="alert alert-error">{linkError}</div>}
            {linkMessage && <div className="alert">{linkMessage}</div>}
            <p className="muted">
              {user.pendingRustLink
                ? "Waiting for in-game pairing… open Rust+ and Pair with Server now."
                : "Re-pair in-game to refresh your server token or link a different server."}
            </p>
            <button type="button" disabled={linking || user.pendingRustLink} onClick={() => void linkRust()}>
              {linking ? "Starting…" : user.pendingRustLink ? "Waiting for pairing…" : "Re-pair Server"}
            </button>
          </>
        ) : (
          <>
            {linkError && <div className="alert alert-error">{linkError}</div>}
            {linkMessage && <div className="alert">{linkMessage}</div>}
            <p className="muted">
              {user?.pendingRustLink
                ? "Waiting for in-game pairing… open Rust+ and Pair with Server now."
                : "Not linked yet. Click below, then pair in-game."}
            </p>
            <button type="button" disabled={linking || user?.pendingRustLink} onClick={() => void linkRust()}>
              {linking ? "Starting…" : user?.pendingRustLink ? "Waiting for pairing…" : "Link Rust+ Account"}
            </button>
          </>
        )}
      </section>
        </>
      )}

      {tab === "alarms" && (
      <section className="card">
        <h2>Smart Alarm Notifications</h2>
        <p className="muted">
          Choose where smart alarm triggers are announced for the active server. Discord channel can
          be set with <code>/channel set purpose:alarms</code> in your server, or via{" "}
          <code>DISCORD_NOTIFICATION_CHANNEL_ID</code> / <code>DISCORD_ALARM_CHANNEL_ID</code> in{" "}
          <code>.env</code>.
        </p>
        {!canAdmin && (
          <p className="muted">Only admins can change notification settings.</p>
        )}
        {notificationsLoading && <p className="muted">Loading…</p>}
        {notificationsError && <div className="alert alert-error">{notificationsError}</div>}
        {notificationsSaved && <div className="alert">Notification settings saved.</div>}
        {notifications && (
          <div className="form-stack">
            <div className="checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.discord}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("discord", e.target.checked)}
              />
              <span>Send to Discord</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.teamChat}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("teamChat", e.target.checked)}
              />
              <span>Send to in-game team chat</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.pingEveryone}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("pingEveryone", e.target.checked)}
              />
              <span>Ping @everyone on Discord (global default; per-alarm override on Devices)</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.webPush}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("webPush", e.target.checked)}
              />
              <span>Send web push notifications (PWA / background)</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.browserSiren}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("browserSiren", e.target.checked)}
              />
              <span>Play browser siren when this tab is open</span>
            </label>
            </div>
            {notifications.settings.smartAlarm.discord && !notifications.capabilities.discordConfigured && (
              <p className="alert alert-error">
                Discord is enabled but no alarm channel is configured on the server.
              </p>
            )}
            {notifications.settings.smartAlarm.teamChat && !notifications.capabilities.rustPlusConnected && (
              <p className="alert alert-error">
                Team chat is enabled but Rust+ is not connected to the active server.
              </p>
            )}
            <div className="form-subsection">
              <h3>Browser push setup</h3>
              <PushNotificationSetup disabled={notificationsSaving || !canAdmin} />
            </div>
            <div className="form-subsection">
              <h3>SMS / email escalation</h3>
              <p className="muted">
                After Discord, optionally send Twilio SMS and SendGrid email (configure{" "}
                <code>TWILIO_*</code> and <code>SENDGRID_*</code> on the API).
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notifications.settings.smartAlarm.escalation.enabled}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => updateSmartAlarmEscalation("enabled", e.target.checked)}
                />
                <span>Enable escalation</span>
              </label>
              <label>
                SMS numbers (E.164, comma-separated)
                <input
                  type="text"
                  value={notifications.settings.smartAlarm.escalation.smsNumbers.join(", ")}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => {
                    const smsNumbers = e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    updateSmartAlarmEscalation("smsNumbers", smsNumbers);
                  }}
                />
              </label>
              <label>
                Email addresses (comma-separated)
                <input
                  type="text"
                  value={notifications.settings.smartAlarm.escalation.emailAddresses.join(", ")}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => {
                    const emailAddresses = e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    updateSmartAlarmEscalation("emailAddresses", emailAddresses);
                  }}
                />
              </label>
            </div>
          </div>
        )}
      </section>
      )}

      {tab === "tc" && (
      <section className="card">
        <h2>TC Decay Alerts</h2>
        <p className="muted">
          Proactive tool cupboard upkeep warnings to Discord and team chat when decay time drops
          below your thresholds.
        </p>
        {notifications && (
          <div className="form-stack">
            <div className="checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.tcDecay.discord}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("discord", e.target.checked)}
              />
              <span>Send to Discord</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.tcDecay.teamChat}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("teamChat", e.target.checked)}
              />
              <span>Send to in-game team chat</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.tcDecay.pingEveryone}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("pingEveryone", e.target.checked)}
              />
              <span>Ping @everyone on Discord</span>
            </label>
            </div>
            <label>
              Warning threshold (hours)
              <input
                type="number"
                min={1}
                max={168}
                value={notifications.settings.tcDecay.warningHours}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("warningHours", Number(e.target.value) || 24)}
              />
            </label>
            <label>
              Critical threshold (hours)
              <input
                type="number"
                min={1}
                max={48}
                value={notifications.settings.tcDecay.criticalHours}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("criticalHours", Number(e.target.value) || 6)}
              />
            </label>
            <label>
              Poll interval (minutes)
              <input
                type="number"
                min={5}
                max={120}
                value={notifications.settings.tcDecay.pollIntervalMinutes}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTcDecay("pollIntervalMinutes", Number(e.target.value) || 15)}
              />
            </label>
          </div>
        )}
      </section>
      )}

      {tab === "deepsea" && (
      <section className="card">
        <h2>Deep Sea Notifications</h2>
        <p className="muted">
          Alert when the Deep Sea opens or closes. Channel: <code>/channel set purpose:Deep Sea</code>{" "}
          or <code>DISCORD_DEEP_SEA_CHANNEL_ID</code> in <code>.env</code>. Status: Dashboard,{" "}
          <code>/deepsea</code>, or <code>!deepsea</code> in team chat.
        </p>
        {notifications && (
          <div className="form-stack">
            <div className="checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.deepSea.discord}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateDeepSea("discord", e.target.checked)}
              />
              <span>Send to Discord</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.deepSea.teamChat}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateDeepSea("teamChat", e.target.checked)}
              />
              <span>Send to in-game team chat</span>
            </label>
            </div>
          </div>
        )}
      </section>
      )}

      {tab === "team-chat" && (
      <section className="card">
        <h2>Team Chat Bot</h2>
        <p className="muted">
          Control in-game bot behavior. Admins can also use <code>!mute</code> and <code>!unmute</code>{" "}
          in team chat (requires linked Steam ID + admin role). Link a Discord channel with{" "}
          <code>/channel set purpose:In-game command runner</code> to run <code>!commands</code> from
          Discord.
        </p>
        {notifications && (
          <div className="form-stack">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.teamChatBot.muted}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateTeamChatBot("muted", e.target.checked)}
              />
              <span>Muted in team chat (no bot replies or automated team chat)</span>
            </label>
            <label>
              Command delay (ms)
              <input
                type="number"
                min={0}
                max={60_000}
                step={250}
                value={notifications.settings.teamChatBot.commandDelayMs}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) =>
                  updateTeamChatBot("commandDelayMs", Math.max(0, Number(e.target.value) || 0))
                }
              />
            </label>
            <p className="muted">
              Minimum time between handled <code>!commands</code>. <code>!mute</code> /{" "}
              <code>!unmute</code> are not delayed.
            </p>
          </div>
        )}
      </section>
      )}

      {tab === "events" && (
      <section className="card">
        <h2>Event Timers</h2>
        <p className="muted">
          Adjust countdowns for cargo egress, oil rig locked crate unlock, and team chat reminders before
          unlock.
        </p>
        {notifications && (
          <div className="form-stack">
            <label>
              Cargo egress (seconds)
              <input
                type="number"
                min={60}
                max={7200}
                step={60}
                value={notifications.settings.eventTimers.cargoEgressSeconds}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) =>
                  updateEventTimers(
                    "cargoEgressSeconds",
                    Math.max(60, Number(e.target.value) || 2700),
                  )
                }
              />
            </label>
            <label>
              Oil crate unlock (seconds)
              <input
                type="number"
                min={60}
                max={3600}
                step={60}
                value={notifications.settings.eventTimers.oilCrateUnlockSeconds}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) =>
                  updateEventTimers(
                    "oilCrateUnlockSeconds",
                    Math.max(60, Number(e.target.value) || 900),
                  )
                }
              />
            </label>
            <label>
              Oil rig proximity (world units)
              <input
                type="number"
                min={50}
                max={1000}
                step={10}
                value={notifications.settings.eventTimers.oilRigProximityUnits}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) =>
                  updateEventTimers(
                    "oilRigProximityUnits",
                    Math.max(50, Number(e.target.value) || 250),
                  )
                }
              />
            </label>
            <label>
              Oil unlock reminders (minutes, comma-separated)
              <input
                type="text"
                value={notifications.settings.eventTimers.oilCrateReminderMinutes.join(", ")}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => {
                  const values = e.target.value
                    .split(",")
                    .map((part) => Number(part.trim()))
                    .filter((n) => Number.isFinite(n) && n > 0);
                  updateEventTimers("oilCrateReminderMinutes", values.length ? values : [10, 5, 1]);
                }}
              />
            </label>
          </div>
        )}
      </section>
      )}

      {tab === "legacy" && (
      <section className="card">
        <h2>Legacy Automations</h2>
        <p className="muted">
          Night lights, team-offline SAM, and map event announcements. Env vars seed defaults for new
          servers; changes here are stored per active server.
        </p>
        {notifications && (
          <div className="form-stack">
            <div className="form-subsection">
              <h3>Night lights</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notifications.settings.legacyAutomations.nightLights.enabled}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) =>
                    updateLegacyAutomations("nightLights", { enabled: e.target.checked })
                  }
                />
                <span>Turn on smart switches at night (also configure schedule in Automations)</span>
              </label>
              <label>
                Switch entity IDs (comma-separated Rust+ IDs)
                <input
                  type="text"
                  value={notifications.settings.legacyAutomations.nightLights.entityIds.join(", ")}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => {
                    const entityIds = e.target.value
                      .split(",")
                      .map((s) => Number(s.trim()))
                      .filter((n) => !Number.isNaN(n));
                    updateLegacyAutomations("nightLights", { entityIds });
                  }}
                />
              </label>
            </div>

            <div className="form-subsection">
              <h3>Team offline SAM</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notifications.settings.legacyAutomations.teamOfflineSam.enabled}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) =>
                    updateLegacyAutomations("teamOfflineSam", { enabled: e.target.checked })
                  }
                />
                <span>Turn on SAM site switch when whole team goes offline</span>
              </label>
              <label>
                SAM switch entity ID
                <input
                  type="number"
                  value={notifications.settings.legacyAutomations.teamOfflineSam.switchEntityId ?? ""}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    updateLegacyAutomations("teamOfflineSam", {
                      switchEntityId: raw ? Number(raw) : null,
                    });
                  }}
                />
              </label>
            </div>

            <div className="form-subsection">
              <h3>Map event alerts</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notifications.settings.legacyAutomations.mapEvents.teamChat}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) =>
                    updateLegacyAutomations("mapEvents", { teamChat: e.target.checked })
                  }
                />
                <span>Announce in team chat</span>
              </label>
              <label>
                Discord
                <select
                  value={
                    notifications.settings.legacyAutomations.mapEvents.discord === null
                      ? "inherit"
                      : notifications.settings.legacyAutomations.mapEvents.discord
                        ? "on"
                        : "off"
                  }
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateLegacyAutomations("mapEvents", {
                      discord: v === "inherit" ? null : v === "on",
                    });
                  }}
                >
                  <option value="inherit">Same as team chat</option>
                  <option value="on">Always on</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label>
                Message prefix
                <input
                  type="text"
                  value={notifications.settings.legacyAutomations.mapEvents.prefix}
                  disabled={notificationsSaving || !canAdmin}
                  onChange={(e) => updateLegacyAutomations("mapEvents", { prefix: e.target.value })}
                />
              </label>
              <fieldset>
                <legend>Event types</legend>
                <div className="checkbox-grid">
                  {DEFAULT_MAP_EVENT_TYPES.map((type) => (
                    <label key={type} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={notifications.settings.legacyAutomations.mapEvents.types.includes(
                          type,
                        )}
                        disabled={notificationsSaving || !canAdmin}
                        onChange={(e) => {
                          const current = notifications.settings.legacyAutomations.mapEvents.types;
                          const types = e.target.checked
                            ? [...current, type]
                            : current.filter((t) => t !== type);
                          updateLegacyAutomations("mapEvents", { types });
                        }}
                      />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        )}
      </section>
      )}

      {tab === "admin" && canAdmin && (
        <>
        <section className="card">
          <h2>Data Management</h2>
          <DataResetPanel disabled={notificationsSaving || linking} />
        </section>

        <FcmConfigUpload />

      <section className="card">
        <h2>Pairing Setup</h2>
        <ol className="setup-steps">
          <li>
            Run <code>npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json</code>{" "}
            (or upload the generated file above)
          </li>
          <li>Click <strong>Link Rust+ Account</strong> or <strong>Re-pair Server</strong> in the Server tab</li>
          <li>In Rust, open Rust+ menu → Pair with Server</li>
          <li>Pair smart devices with the wire tool</li>
        </ol>
      </section>
        </>
      )}
    </div>
  );
}
