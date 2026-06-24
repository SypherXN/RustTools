import { hasAppCapability, type AppCapability } from "@rusttools/shared";
import { useAuth } from "./useAuth";

export function usePermissions() {
  const { user } = useAuth();
  return {
    view: user?.permissions.view ?? false,
    switch: user?.permissions.switch ?? false,
    admin: user?.permissions.admin ?? false,
    rolesConfigured: user?.rolesConfigured ?? false,
  };
}

export function useCan(capability: AppCapability): boolean {
  const { user } = useAuth();
  return hasAppCapability(user?.permissions, capability);
}
