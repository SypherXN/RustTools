import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ActiveServerContextValue {
  /** Increments when the active server changes; use as a useEffect dependency. */
  epoch: number;
  notifyActivated: () => void;
}

const ActiveServerContext = createContext<ActiveServerContextValue | null>(null);

export function ActiveServerProvider({ children }: { children: ReactNode }) {
  const [epoch, setEpoch] = useState(0);
  const notifyActivated = useCallback(() => {
    setEpoch((e) => e + 1);
  }, []);

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
