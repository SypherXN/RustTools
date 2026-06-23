import { useAuth } from "../hooks/useAuth";
import { apiFetch } from "../lib/api";
import { ServerSwitcher } from "../components/ServerSwitcher";

export function SettingsPage() {
  const { user, refresh } = useAuth();

  const linkRust = async () => {
    await apiFetch("/auth/link-rust", { method: "POST" });
    await refresh();
  };

  return (
    <div>
      <header className="page-header">
        <h1>Settings</h1>
        <p>Account linking, servers, and pairing setup.</p>
      </header>

      <ServerSwitcher />

      <section className="card">
        <h2>Discord Account</h2>
        <p>
          Logged in as <strong>{user?.user.discordUsername}</strong>
        </p>
      </section>

      <section className="card">
        <h2>Rust+ Link</h2>
        {user?.linkedRust ? (
          <p>
            Steam ID linked: <code>{user.user.steamId}</code>
          </p>
        ) : (
          <>
            <p className="muted">
              {user?.pendingRustLink
                ? "Waiting for in-game pairing… pair your server now."
                : "Not linked yet. Start linking, then pair in-game."}
            </p>
            <button type="button" onClick={() => void linkRust()}>
              Link Rust+ Account
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>Automations</h2>
        <p className="muted">
          Configure on the server via <code>.env</code>:{" "}
          <code>AUTOMATION_NIGHT_LIGHTS</code>, <code>AUTOMATION_TEAM_OFFLINE_SAM</code>
        </p>
      </section>

      <section className="card">
        <h2>Pairing Setup</h2>
        <ol className="setup-steps">
          <li>
            Run <code>npx @liamcottle/rustplus.js fcm-register --config-file=./data/fcm-config.json</code>
          </li>
          <li>Restart the API so FCM listener picks up the config</li>
          <li>In Rust, open Rust+ menu → Pair with Server</li>
          <li>Pair smart devices with the wire tool</li>
        </ol>
      </section>
    </div>
  );
}
