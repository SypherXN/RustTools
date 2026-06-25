import { useEffect, useState } from "react";
import { isDemoMode } from "../lib/demo";

const BOOT_LINES: Array<{ text: string; className?: string; delay: number }> = [
  { text: "> Initializing RustTools v1.0...", className: "tag-cmd", delay: 0 },
  { text: "> Syncing Discord session...", className: "tag-cmd", delay: 200 },
  { text: "[INFO] Checking API health...", className: "tag-info", delay: 450 },
  { text: "[OK] Backend online", className: "tag-ok", delay: 700 },
  { text: "> Loading Rust+ bridge...", className: "tag-cmd", delay: 950 },
  { text: "[OK] WebSocket ready", className: "tag-ok", delay: 1200 },
  { text: "> Preparing dashboard...", className: "tag-cmd", delay: 1450 },
  { text: "[OK] All systems operational", className: "tag-ok", delay: 1700 },
];

const TRIVIA = [
  "Smart alarms can ping Discord, team chat, web push, and SMS escalation.",
  "Use !events in team chat for a live world event summary.",
  "Automations support schedule windows — perfect for night lights.",
  "Map pins support screenshots and notes for your team.",
  "Pair devices in-game with the wire tool after linking Rust+.",
];

const BOOT_SESSION_KEY = "rusttools-boot-seen";

interface BootLoaderProps {
  active: boolean;
  onComplete?: () => void;
}

export function BootLoader({ active, onComplete }: BootLoaderProps) {
  const [visible, setVisible] = useState(active);
  const [lines, setLines] = useState<typeof BOOT_LINES>([]);
  const trivia = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }

    if (isDemoMode() || sessionStorage.getItem(BOOT_SESSION_KEY)) {
      setVisible(false);
      onComplete?.();
      return;
    }

    setVisible(true);
    setLines([]);

    const timers = BOOT_LINES.map((line) =>
      setTimeout(() => {
        setLines((prev) => [...prev, line]);
      }, line.delay),
    );

    const hideTimer = setTimeout(() => {
      sessionStorage.setItem(BOOT_SESSION_KEY, "1");
      setVisible(false);
      onComplete?.();
    }, 2400);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(hideTimer);
    };
  }, [active, onComplete]);

  if (!visible && !active) return null;

  return (
    <div className={`boot-loader${visible ? "" : " boot-loader--hidden"}`} aria-hidden={!visible}>
      <div className="boot-loader-inner">
        <div className="boot-loader-brand">
          <img className="boot-loader-icon" src="/icon-192.png" alt="" width={64} height={64} />
          <h1>RustTools</h1>
          <p>Rust+ Companion Dashboard</p>
        </div>
        <div className="boot-terminal" aria-live="polite">
          {lines.map((line) => (
            <p
              key={line.text}
              className={`boot-terminal-line ${line.className ?? ""}`}
              style={{ animationDelay: "0ms" }}
            >
              {line.text}
            </p>
          ))}
        </div>
        <div className="boot-trivia">
          <strong>Did you know?</strong>
          {trivia}
        </div>
      </div>
    </div>
  );
}
