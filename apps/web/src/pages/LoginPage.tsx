import { getDiscordLoginUrl } from "../lib/api";

export function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>RustTools</h1>
        <p>Control your base, monitor storage, and stay connected with your team.</p>
        <a className="btn btn-discord" href={getDiscordLoginUrl()}>
          Login with Discord
        </a>
      </div>
    </div>
  );
}
