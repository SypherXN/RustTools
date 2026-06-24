import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthUserResponse } from "@rusttools/shared";
import { apiFetch } from "../lib/api";
import { demoUser, isDemoMode } from "../lib/demo";

interface AuthContextValue {
  user: AuthUserResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserResponse | null>(isDemoMode() ? demoUser : null);
  const [loading, setLoading] = useState(!isDemoMode());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const refresh = async () => {
    if (isDemoMode()) {
      setUser(demoUser);
      return;
    }
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    refreshPromiseRef.current = (async () => {
      try {
        const data = await apiFetch<AuthUserResponse>("/auth/me");
        setUser(data);
      } catch {
        setUser(null);
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    return refreshPromiseRef.current;
  };

  const logout = async () => {
    if (isDemoMode()) {
      setUser(demoUser);
      return;
    }
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
  };

  useEffect(() => {
    if (isDemoMode()) {
      setUser(demoUser);
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
