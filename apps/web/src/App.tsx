import type { ReactNode } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ActiveServerProvider } from "./hooks/useActiveServer";
import { WebSocketProvider } from "./hooks/WebSocketProvider";
import { isDemoMode } from "./lib/demo";
import { assetUrl } from "./lib/asset-url";
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
import { FcmWarningBanner } from "./components/FcmWarningBanner";
import { AlarmNotifier } from "./components/AlarmNotifier";
import { BootLoader } from "./components/BootLoader";
import { useRustPlusStatus } from "./hooks/useRustPlusStatus";
import {
  IconAudit,
  IconAutomations,
  IconCamera,
  IconDashboard,
  IconDevices,
  IconMap,
  IconSettings,
  IconStorage,
  IconTeam,
} from "./components/NavIcons";

function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink to={to} end={end}>
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}

function Shell() {
  const { user, loading, logout } = useAuth();
  const { status: rustPlusStatus } = useRustPlusStatus();

  if (loading) {
    return (
      <>
        <BootLoader active />
        <div className="center">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <BootLoader active={false} />
        <LoginPage />
      </>
    );
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

  const statusLabel =
    rustPlusStatus === "ok"
      ? "Rust+ online"
      : rustPlusStatus === "warn"
        ? "Rust+ offline"
        : rustPlusStatus === "error"
          ? "API unreachable"
          : "Checking…";

  const statusClass =
    rustPlusStatus === "ok"
      ? "status-pill--ok"
      : rustPlusStatus === "warn"
        ? "status-pill--warn"
        : rustPlusStatus === "error"
          ? "status-pill--error"
          : "";

  return (
    <>
      <BootLoader active={false} />
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-mark" src={assetUrl("icon-192.png")} alt="" width={36} height={36} />
            <div className="brand-text">
              <span>RustTools</span>
              <span className="brand-sub">Rust+ Dashboard</span>
            </div>
          </div>
          <nav>
            <NavItem to="/" end icon={<IconDashboard />}>
              Dashboard
            </NavItem>
            <NavItem to="/devices" icon={<IconDevices />}>
              Devices
            </NavItem>
            <NavItem to="/automations" icon={<IconAutomations />}>
              Automations
            </NavItem>
            {LIVE_CAMERAS_ENABLED && (
              <NavItem to="/cameras" icon={<IconCamera />}>
                Cameras
              </NavItem>
            )}
            <NavItem to="/storage" icon={<IconStorage />}>
              Storage
            </NavItem>
            <NavItem to="/map" icon={<IconMap />}>
              Map
            </NavItem>
            <NavItem to="/team" icon={<IconTeam />}>
              Team
            </NavItem>
            {user.permissions.admin && (
              <NavItem to="/audit" icon={<IconAudit />}>
                Audit
              </NavItem>
            )}
            <NavItem to="/settings" icon={<IconSettings />}>
              Settings
            </NavItem>
          </nav>
          <div className="sidebar-footer">
            <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
            <p className="user-name">{user.user.discordUsername}</p>
            <p className="muted permission-badge">{permissionLabel(user.permissions)}</p>
            <button type="button" className="btn-secondary" onClick={() => void logout()}>
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
          <FcmWarningBanner />
          <AlarmNotifier />
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
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ActiveServerProvider>
        <WebSocketProvider>
          <Shell />
        </WebSocketProvider>
      </ActiveServerProvider>
    </AuthProvider>
  );
}
