import { useEffect } from "react";
import { getDiscordLoginUrl } from "../lib/api";

const ERROR_MESSAGES: Record<string, string> = {
  discord_token_failed:
    "Discord login failed. Check that the redirect URL in the Discord app is exactly: http://localhost:5173/api/auth/discord/callback",
};

export function LoginPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      // Discord sometimes redirects to the frontend root if the callback URL is misconfigured.
      window.location.replace(`/api/auth/discord/callback?${params.toString()}`);
    }
  }, []);

  const params = new URLSearchParams(window.location.search);
  const errorKey = params.get("error");
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : null;

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>RustTools</h1>
        <p>Control your base, monitor storage, and stay connected with your team.</p>
        {errorMessage && <div className="alert alert-error">{errorMessage}</div>}
        <a className="btn btn-discord" href={getDiscordLoginUrl()}>
          Login with Discord
        </a>
      </div>
    </div>
  );
}
