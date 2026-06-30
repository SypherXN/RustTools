import { useEffect } from "react";
import { apiUrl, getDiscordLoginUrl, isMobileLoginDevice } from "../lib/api";
import { assetUrl } from "../lib/asset-url";

const ERROR_MESSAGES: Record<string, string> = {
  discord_token_failed:
    "Discord login failed. Check that the Discord app redirect URL matches your configured API callback.",
  oauth_state_invalid: "Login session expired. Try again.",
  blocked: "Your account is blocked from this dashboard.",
};

export function LoginPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.location.replace(apiUrl(`/auth/discord/callback?${params.toString()}`));
    }
  }, []);

  const params = new URLSearchParams(window.location.search);
  const errorKey = params.get("error");
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] ?? "Login failed. Try again." : null;
  const mobile = isMobileLoginDevice();

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-brand-icon" src={assetUrl("icon-192.png")} alt="RustTools" width={72} height={72} />
        <h1>RustTools</h1>
        <p className="login-tagline">&gt; Awaiting Discord authentication…</p>
        <p className="muted">Control your base, monitor storage, and stay connected with your team.</p>
        {errorMessage && <div className="alert alert-error">{errorMessage}</div>}
        <div className="login-actions">
          <a className="btn btn-discord" href={getDiscordLoginUrl()}>
            Login with Discord
          </a>
          {mobile && (
            <a className="btn btn-discord btn-discord-app" href={getDiscordLoginUrl({ preferApp: true })}>
              Open Discord app
            </a>
          )}
        </div>
        {mobile && (
          <p className="muted login-app-hint">
            On mobile, try <strong>Open Discord app</strong> if you are already signed into Discord. You will return
            here after approving access.
          </p>
        )}
      </div>
    </div>
  );
}
