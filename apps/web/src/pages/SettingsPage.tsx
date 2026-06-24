import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { apiFetch } from "../lib/api";
import { ServerSwitcher } from "../components/ServerSwitcher";
import type { NotificationSettingsResponse } from "@rusttools/shared";
import { useCan } from "../hooks/usePermissions";

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const canAdmin = useCan("admin");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettingsResponse | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsSaved, setNotificationsSaved] = useState(false);

  useEffect(() => {
    setNotificationsLoading(true);
    void apiFetch<NotificationSettingsResponse>("/servers/active/notifications")
      .then(setNotifications)
      .catch((err) => {
        setNotificationsError(err instanceof Error ? err.message : "Failed to load notification settings");
      })
      .finally(() => setNotificationsLoading(false));
  }, []);

  const saveNotifications = async (patch: {
    smartAlarm?: Partial<NotificationSettingsResponse["settings"]["smartAlarm"]>;
    deepSea?: Partial<NotificationSettingsResponse["settings"]["deepSea"]>;
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

  const updateSmartAlarm = (key: "discord" | "teamChat", value: boolean) => {
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

  const linkRust = async () => {
    setLinking(true);
    setLinkError(null);
    setLinkMessage(null);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string }>("/auth/link-rust", {
        method: "POST",
      });
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

      <ServerSwitcher />

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
          <p>
            Steam ID linked: <code>{user.user.steamId}</code>
          </p>
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.discord}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("discord", e.target.checked)}
              />
              <span>Send to Discord</span>
            </label>
            {notifications.settings.smartAlarm.discord && !notifications.capabilities.discordConfigured && (
              <p className="alert alert-error">
                Discord is enabled but no alarm channel is configured on the server.
              </p>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={notifications.settings.smartAlarm.teamChat}
                disabled={notificationsSaving || !canAdmin}
                onChange={(e) => updateSmartAlarm("teamChat", e.target.checked)}
              />
              <span>Send to in-game team chat</span>
            </label>
            {notifications.settings.smartAlarm.teamChat && !notifications.capabilities.rustPlusConnected && (
              <p className="alert alert-error">
                Team chat is enabled but Rust+ is not connected to the active server.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Deep Sea Notifications</h2>
        <p className="muted">
          Alert when the Deep Sea opens or closes. Channel: <code>/channel set purpose:Deep Sea</code>{" "}
          or <code>DISCORD_DEEP_SEA_CHANNEL_ID</code> in <code>.env</code>. Status: Dashboard,{" "}
          <code>/deepsea</code>, or <code>!deepsea</code> in team chat.
        </p>
        {notifications && (
          <div className="form-stack">
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
        )}
      </section>

      <section className="card">
        <h2>Map Event Automations</h2>
        <p className="muted">
          Configure on the server via <code>.env</code>:{" "}
          <code>AUTOMATION_NIGHT_LIGHTS</code>, <code>AUTOMATION_TEAM_OFFLINE_SAM</code>,{" "}
          <code>AUTOMATION_EVENT_TEAM_CHAT</code>
        </p>
        <ul className="setup-steps">
          <li>
            <code>AUTOMATION_EVENT_TEAM_CHAT=true</code> — announce cargo, chinook, and patrol heli in
            team chat with grid + coordinates
          </li>
          <li>
            <code>AUTOMATION_EVENT_DISCORD=true</code> — also post to Discord (on by default when team
            chat alerts are enabled)
          </li>
          <li>
            <code>DISCORD_EVENT_CHANNEL_ID</code> — optional dedicated channel; otherwise uses{" "}
            <code>DISCORD_NOTIFICATION_CHANNEL_ID</code>
          </li>
          <li>
            <code>AUTOMATION_EVENT_TYPES</code> — optional filter, e.g. <code>cargo,heli</code>
          </li>
          <li>
            <code>AUTOMATION_EVENT_TEAM_CHAT_PREFIX</code> — in-game message prefix (default{" "}
            <code>RustTools</code>)
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Pairing Setup</h2>
        <ol className="setup-steps">
          <li>
            Run <code>npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json</code>
          </li>
          <li>Restart the API so FCM listener picks up the config</li>
          <li>Click <strong>Link Rust+ Account</strong> above</li>
          <li>In Rust, open Rust+ menu → Pair with Server</li>
          <li>Pair smart devices with the wire tool</li>
        </ol>
      </section>
    </div>
  );
}
