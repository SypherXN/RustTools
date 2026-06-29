import { useEffect } from "react";
import { apiUrl, getDiscordLoginUrl } from "../lib/api";
import { assetUrl } from "../lib/asset-url";

const ERROR_MESSAGES: Record<string, string> = {
  discord_token_failed:
    "Discord login failed. Check that the Discord app redirect URL matches your configured API callback.",
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
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : null;

  return (
    <div className="login-page">
      <div className="login-card">
        <img className="login-brand-icon" src={assetUrl("icon-192.png")} alt="RustTools" width={72} height={72} />
        <h1>RustTools</h1>
        <p className="login-tagline">&gt; Awaiting Discord authentication…</p>
        <p className="muted">Control your base, monitor storage, and stay connected with your team.</p>
        {errorMessage && <div className="alert alert-error">{errorMessage}</div>}
        <a className="btn btn-discord" href={getDiscordLoginUrl()}>
          Login with Discord
        </a>
      </div>
    </div>
  );
}
