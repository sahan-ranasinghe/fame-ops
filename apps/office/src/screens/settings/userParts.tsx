// Pieces the Users pages share: a secret shown once (a set-password link, a
// connector URL), the permission chips, and the preset buttons with the tick boxes.
import { ADMIN_MANAGED, givablePermissions } from "@fleet/accountGuards";
import { normalisePermissions, type Permission, PERMISSION_TEXT, PERMISSIONS, PRESETS } from "@fleet/permissions";
import { waLink } from "../../lib/format";
import { useToast } from "../../ui/Toast";
import { type Preset, presetOf, togglePermission, VIEW_LOCKED_HINT, viewLocked } from "./usersLogic";
import { ChoiceChip } from "../../ui/Select";

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
 * and locked while another permission is ticked (any of them implies view, §12). Round 2b (Google Workspace's help-desk
 * admin): only what the signed-in person may give is offered (accountGuards.ts, the server's rule); the rest is greyed
 * with the reason, and a preset holding any of it is not shown.
 */
export function PermissionPicker({ value, onChange, idPrefix, holder }: { value: Permission[]; onChange: (p: Permission[]) => void; idPrefix: string; holder: readonly Permission[] }) {
  const current = presetOf(value);
  const locked = viewLocked(value);
  const givable = givablePermissions(normalisePermissions(holder));
  const fits = (list: readonly Permission[]) => list.every((p) => givable.includes(p));
  const whyNot = (p: Permission) => (ADMIN_MANAGED.includes(p) ? "Only an admin can give this." : "You can only give permissions you hold yourself.");
  return (
    <div className="field">
      <span className="lab">Permissions</span>
      <div className="presets" role="group" aria-label="Presets">
        {PRESET_KEYS.filter((k) => fits(PRESETS[k].permissions)).map((k) => (
          <ChoiceChip key={k} selected={current === k} onClick={() => onChange([...PRESETS[k].permissions])}>{PRESETS[k].label}</ChoiceChip>
        ))}
        {fits(PERMISSIONS) && <ChoiceChip selected={current === "admin"} onClick={() => onChange([...PERMISSIONS])}>Admin (everything)</ChoiceChip>}
      </div>
      <div className="perm-list">
        {PERMISSIONS.map((p) => {
          const lock = p === "view" && locked;
          const barred = !lock && !givable.includes(p);
          const off = lock || barred;
          return (
            <label key={p} htmlFor={`${idPrefix}-${p}`} style={off ? { opacity: 0.6, cursor: "not-allowed" } : undefined} title={lock ? VIEW_LOCKED_HINT : barred ? whyNot(p) : undefined}>
              <input type="checkbox" id={`${idPrefix}-${p}`} checked={value.includes(p) || lock} disabled={off} onChange={() => onChange(togglePermission(value, p))} />
              <span className="grow">
                <b>{PERMISSION_TEXT[p].label}</b>
                <span>{PERMISSION_TEXT[p].text}</span>
                {lock && <span style={{ display: "block", fontWeight: 600 }} data-testid="view-locked">{VIEW_LOCKED_HINT}</span>}
                {barred && <span style={{ display: "block", fontWeight: 600 }} data-testid={`perm-barred-${p}`}>{whyNot(p)}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export const userPath = (email: string) => `/settings/users/${encodeURIComponent(email)}/edit`;
