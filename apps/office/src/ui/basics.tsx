import type { ReactNode } from "react";
import type { Entry } from "../data/store";
import { clock, initials, plateOf, type Tone } from "../lib/format";
import { AUTHZ, errText, type Fix } from "../transport/errors";
import { Icon } from "./icons";

export const Plate = ({ v }: { v?: string | null }) => v ? <span className="plate">{plateOf(v)}</span> : null;
export const Pill = ({ tone = "", children }: { tone?: Tone; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;
export const Dot = ({ tone = "" }: { tone?: Tone }) => <i className={`dot ${tone}`} />;
export const Loading = ({ children }: { children: ReactNode }) => <div className="loading">{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Avatar = ({ name, small }: { name?: string | null; small?: boolean }) => (
  <span className={`avatar${small ? " sm" : ""}`}>{initials(name)}</span>
);

export function Notice({ tone = "", children, action }: { tone?: "" | "bad" | "info" | "ok"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`}>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Tile({ label, value, unit, sub, tone = "" }: { label: string; value: ReactNode; unit: string; sub: string; tone?: "" | "warn" | "bad" }) {
  return (
    <div className="tile">
      <div className="lbl">{label}</div>
      <div className="val">
        <b className="num">{value}</b>
        <span>{unit}</span>
      </div>
      <div className={`sub ${tone}`}>{sub}</div>
    </div>
  );
}

export function IconLink({ href, icon, label }: { href?: string; icon: string; label: string }) {
  if (!href) return null;
  const external = !href.startsWith("tel:");
  return (
    <a className="btn icon-btn" href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} aria-label={label} title={label}>
      <Icon name={icon} />
    </a>
  );
}

/** The error of an entry with no data: the sentence and, when there is one, the fix. */
export function ErrBox({ entry, onRetry, onFix }: { entry: Entry; onRetry?: () => void; onFix?: (fix: Fix) => void }) {
  const e = entry.err;
  if (!e || entry.data) return null;
  const [text, fix] = errText(e);
  let btn: ReactNode = null;
  if (fix === "perms" && onFix) btn = <button type="button" className="btn small" onClick={() => onFix("perms")}>Open permissions</button>;
  else if (fix === "approve" && onRetry) btn = <button type="button" className="btn small" onClick={onRetry}>Allow and load</button>;
  else if (fix === "retry" && onRetry) btn = <button type="button" className="btn small" onClick={onRetry}>Try again</button>;
  else if (fix === "signin" && onFix) btn = <button type="button" className="btn small" onClick={() => onFix("signin")}>Sign in</button>;
  return <Notice tone={AUTHZ.has(e.code) ? "bad" : ""} action={btn}>{text}</Notice>;
}

/** Data is shown but the last fetch failed. */
export function StaleNote({ entry }: { entry: Entry }) {
  const e = entry.err;
  if (!e || !entry.data || AUTHZ.has(e.code)) return null;
  return <div className="stale">Showing data from {entry.at ? clock(entry.at) : "earlier"}. {errText(e)[0]}</div>;
}

export const Updated = ({ entry }: { entry: Entry }) => entry.at ? <span className="updated">Updated {clock(entry.at)}</span> : null;

export function Chips<K extends string>({ options, value, onChange, counts }: { options: [K, string][]; value: K; onChange: (k: K) => void; counts?: Partial<Record<K, number>> }) {
  return (
    <div className="chips">
      {options.map(([k, label]) => (
        <button key={k} type="button" className="chip" aria-pressed={value === k} onClick={() => onChange(k)}>
          {label}{counts && counts[k] != null ? ` · ${counts[k]}` : ""}
        </button>
      ))}
    </div>
  );
}

export const WarningsNote = ({ warnings }: { warnings: string[] }) =>
  warnings.length ? (
    <div className="notice" style={{ marginTop: 10 }}>
      <p>
        <b>Check:</b> {warnings.map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)}
      </p>
    </div>
  ) : null;
