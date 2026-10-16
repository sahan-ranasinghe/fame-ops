// Pieces the Users pages share: a secret shown once (a set-password link, a
// connector URL), the permission chips, and the preset buttons with the tick boxes.
import { normalisePermissions, type Permission, PERMISSION_TEXT, PERMISSIONS, PRESETS } from "@fleet/permissions";
import { waLink } from "../../lib/format";
import { useToast } from "../../ui/Toast";
import { type Preset, presetOf, togglePermission, VIEW_LOCKED_HINT, viewLocked } from "./usersLogic";

const PRESET_KEYS = Object.keys(PRESETS) as Preset[];

export function Secret({ label, value, hint }: { label: string; value: string; hint: string }) {
  const toast = useToast();
  return (
    <div className="card card-b" style={{ display: "grid", gap: 10 }}>
      <b>{label}</b>
      <span className="secret" data-testid="secret">{value}</span>
      <div className="acts">
        <button type="button" className="btn small dark" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast("Copied")); }}>Copy</button>
        <a className="btn small" href={waLink("", `${label}: ${value}`).replace("https://wa.me/", "https://wa.me/?text=").replace("?text=&text=", "?text=") || `https://wa.me/?text=${encodeURIComponent(value)}`} target="_blank" rel="noopener">Share by WhatsApp</a>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

/** The permission chips of a user, in the table's order. */
export function PermissionChips({ permissions }: { permissions?: string[] }) {
  const list = normalisePermissions(permissions);
  if (!list.length) return <span className="muted">None</span>;
  return <>{list.map((p) => <span key={p} className="perm">{PERMISSION_TEXT[p].label}</span>)}</>;
}

/**
 * The preset buttons and the tick boxes, shared by the create and the edit forms. View is greyed
 * and locked while another permission is ticked (any of them implies view, §12).
 */
export function PermissionPicker({ value, onChange, idPrefix }: { value: Permission[]; onChange: (p: Permission[]) => void; idPrefix: string }) {
  const current = presetOf(value);
  const locked = viewLocked(value);
  return (
    <div className="field">
      <span className="lab">Permissions</span>
      <div className="presets" role="group" aria-label="Presets">
        {PRESET_KEYS.map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={current === k} onClick={() => onChange([...PRESETS[k].permissions])}>{PRESETS[k].label}</button>
        ))}
        <button type="button" className="chip" aria-pressed={current === "admin"} onClick={() => onChange([...PERMISSIONS])}>Admin (everything)</button>
      </div>
      <div className="perm-list">
        {PERMISSIONS.map((p) => {
          const lock = p === "view" && locked;
          return (
            <label key={p} htmlFor={`${idPrefix}-${p}`} style={lock ? { opacity: 0.6, cursor: "not-allowed" } : undefined} title={lock ? VIEW_LOCKED_HINT : undefined}>
              <input type="checkbox" id={`${idPrefix}-${p}`} checked={value.includes(p) || lock} disabled={lock} onChange={() => onChange(togglePermission(value, p))} />
              <span className="grow">
                <b>{PERMISSION_TEXT[p].label}</b>
                <span>{PERMISSION_TEXT[p].text}</span>
                {lock && <span style={{ display: "block", fontWeight: 600 }} data-testid="view-locked">{VIEW_LOCKED_HINT}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export const userPath = (email: string) => `/settings/users/${encodeURIComponent(email)}/edit`;
