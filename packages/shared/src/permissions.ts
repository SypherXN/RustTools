export type AppCapability = "view" | "switch" | "admin";

export interface UserCapabilities {
  view: boolean;
  switch: boolean;
  admin: boolean;
}

export interface UserPermissions extends UserCapabilities {
  /** True when DISCORD_ROLE_* env vars are set on the server. */
  rolesConfigured: boolean;
}

export const FULL_USER_PERMISSIONS: UserPermissions = {
  view: true,
  switch: true,
  admin: true,
  rolesConfigured: false,
};

export function hasAppCapability(
  permissions: UserCapabilities | undefined,
  capability: AppCapability,
): boolean {
  if (!permissions) return false;
  if (capability === "admin") return permissions.admin;
  if (capability === "switch") return permissions.switch;
  return permissions.view;
}
