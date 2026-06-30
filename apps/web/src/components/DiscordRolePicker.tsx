import { useEffect, useState, type CSSProperties } from "react";
import { fetchDiscordGuildRoles, type DiscordGuildRole } from "../lib/discord-roles";

export type { DiscordGuildRole };

interface DiscordRolePickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}

function roleColorStyle(color: number): CSSProperties | undefined {
  if (!color) return undefined;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return { color: `rgb(${r}, ${g}, ${b})` };
}

export function DiscordRolePicker({
  selectedIds,
  onChange,
  disabled = false,
  label = "Ping Discord roles",
  hint = "Selected roles are mentioned when alerts fire. You can still use @everyone separately.",
}: DiscordRolePickerProps) {
  const [roles, setRoles] = useState<DiscordGuildRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchDiscordGuildRoles()
      .then((data) => {
        if (!cancelled) {
          setRoles(data);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (roleId: string) => {
    if (disabled) return;
    if (selectedIds.includes(roleId)) {
      onChange(selectedIds.filter((id) => id !== roleId));
    } else {
      onChange([...selectedIds, roleId]);
    }
  };

  return (
    <div className="form-subsection discord-role-picker">
      <h3>{label}</h3>
      {hint && <p className="muted">{hint}</p>}
      {loading && <p className="muted">Loading Discord roles…</p>}
      {error && <p className="alert alert-error">{error}</p>}
      {!loading && !error && roles.length === 0 && (
        <p className="muted">No Discord roles found. Check bot permissions and DISCORD_GUILD_ID.</p>
      )}
      {!loading && roles.length > 0 && (
        <div className="checkbox-group">
          {roles.map((role) => (
            <label key={role.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(role.id)}
                disabled={disabled}
                onChange={() => toggle(role.id)}
              />
              <span style={roleColorStyle(role.color)}>{role.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
