import { Routes, Route, NavLink } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ActiveServerProvider } from "./hooks/useActiveServer";
import { isDemoMode } from "./lib/demo";
import { LIVE_CAMERAS_ENABLED } from "./lib/features";
import { RequirePermission, permissionLabel } from "./components/RequirePermission";
import { AuditPage } from "./pages/AuditPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { CameraPage } from "./pages/CameraPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginPage } from "./pages/LoginPage";
import { MapPage } from "./pages/MapPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoragePage } from "./pages/StoragePage";
import { TeamPage } from "./pages/TeamPage";

function Shell() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!user.permissions.view) {
    return (
      <div className="center access-denied">
        <section className="card">
          <h1>Access denied</h1>
          <p className="muted">
            Your Discord account does not have permission to use RustTools. Ask a server admin to
            assign the <strong>View</strong> role (<code>DISCORD_ROLE_VIEW</code>).
          </p>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R+</span>
          <span>RustTools</span>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/automations">Automations</NavLink>
          {LIVE_CAMERAS_ENABLED && <NavLink to="/cameras">Cameras</NavLink>}
          <NavLink to="/storage">Storage</NavLink>
          <NavLink to="/map">Map</NavLink>
          <NavLink to="/team">Team</NavLink>
          {user.permissions.admin && <NavLink to="/audit">Audit</NavLink>}
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="sidebar-footer">
          <p className="user-name">{user.user.discordUsername}</p>
          <p className="muted permission-badge">{permissionLabel(user.permissions)}</p>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>
      <main className="content">
        {isDemoMode() && (
          <div className="demo-banner">
            Demo mode — mock data only. Run <code>npm run dev:web</code> for live API.
          </div>
        )}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          {LIVE_CAMERAS_ENABLED && <Route path="/cameras" element={<CameraPage />} />}
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/audit" element={<RequirePermission capability="admin"><AuditPage /></RequirePermission>} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ActiveServerProvider>
        <Shell />
      </ActiveServerProvider>
    </AuthProvider>
  );
}
