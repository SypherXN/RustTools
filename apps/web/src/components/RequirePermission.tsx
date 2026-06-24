import type { ReactNode } from "react";
import { hasAppCapability, type AppCapability } from "@rusttools/shared";
import { useAuth } from "../hooks/useAuth";

const LABELS: Record<AppCapability, string> = {
  view: "View",
  switch: "Switch",
  admin: "Admin",
};

export function RequirePermission({
  capability,
  children,
}: {
  capability: AppCapability;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !hasAppCapability(user.permissions, capability)) {
    return (
      <section className="card">
        <h2>Access denied</h2>
        <p className="muted">
          You need the <strong>{LABELS[capability]}</strong> permission to access this page. Ask a
          server admin to assign the matching Discord role.
        </p>
      </section>
    );
  }
  return <>{children}</>;
}

export function permissionLabel(permissions: {
  admin: boolean;
  switch: boolean;
  view: boolean;
}): string {
  if (permissions.admin) return "Admin";
  if (permissions.switch) return "Switch";
  if (permissions.view) return "View";
  return "No access";
}
