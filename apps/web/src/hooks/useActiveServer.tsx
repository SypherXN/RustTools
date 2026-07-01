import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { invalidateApiCache } from "../lib/api-cache";
import { invalidateAlarmSoundCache } from "../lib/alarm-sound";

interface ActiveServerContextValue {
  /** Increments when the active server changes; use as a useEffect dependency. */
  epoch: number;
  notifyActivated: () => void;
}

const ActiveServerContext = createContext<ActiveServerContextValue | null>(null);

export function ActiveServerProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  const notifyActivated = useCallback(() => {
    invalidateApiCache();
    invalidateAlarmSoundCache();
    setEpoch((e) => e + 1);
  }, []);

  useEffect(() => {
    const onChanged = () => notifyActivated();
    window.addEventListener("rusttools:active-server-changed", onChanged);
    return () => window.removeEventListener("rusttools:active-server-changed", onChanged);
  }, [notifyActivated]);

  return (
    <ActiveServerContext.Provider value={{ epoch, notifyActivated }}>
      {children}
    </ActiveServerContext.Provider>
  );
}

export function useActiveServer(): ActiveServerContextValue {
  const ctx = useContext(ActiveServerContext);
  if (!ctx) {
    throw new Error("useActiveServer must be used within ActiveServerProvider");
  }
  return ctx;
}
