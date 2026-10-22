import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Entry } from "../data/store";
import { clock, initials, plateOf, type Tone } from "../lib/format";
import { AUTHZ, errText, type Fix } from "../transport/errors";
import { Icon } from "./icons";
import { ChoiceChip } from "./Select";
import { datesInWords } from "../lib/when";

export const Plate = ({ v }: { v?: string | null }) => v ? <span className="plate">{plateOf(v)}</span> : null;
export const Pill = ({ tone = "", title, children }: { tone?: Tone; title?: string; children: ReactNode }) => <span className={`pill ${tone}`} title={title}>{children}</span>;
export const Dot = ({ tone = "" }: { tone?: Tone }) => <i className={`dot ${tone}`} />;
export const Loading = ({ children }: { children: ReactNode }) => <div className="loading">{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
/**
 * A person: their photo (Phase 7, §5), else the initials as before. The server hands out the same link while it lasts,
 * so the browser keeps the picture across refreshes (never add anything to the link); a link that fails shows the initials.
 */
export function Avatar({ name, src, small, large }: { name?: string | null; src?: string | null; small?: boolean; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;
  return (
    <span className={`avatar${small ? " sm" : large ? " lg" : ""}${photo ? " photo" : ""}`}>
      {photo ? <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailed(photo)} /> : initials(name)}
    </span>
  );
}

/**
 * A vehicle's photo (§6): the thumbnail beside its plate, `md` on the request page, `large` on the vehicle's page.
 * Nothing when the vehicle has none or the link fails. The same link across refreshes, as for Avatar.
 */
export function VehicleThumb({ src, plate, size }: { src?: string | null; plate?: string | null; size?: "md" | "lg" }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || src === failed) return null;
  // Beside the plate it is decoration (the plate says which vehicle); alone it is the vehicle's photo.
  const alt = size && plate ? `Photo of ${plateOf(plate)}` : "";
  return <img className={`vthumb${size ? ` ${size}` : ""}`} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}

export function Notice({ tone = "", children, action }: { tone?: "" | "bad" | "info" | "ok"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`}>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Phase 7 (§16): a tile that opens its list (the Overview's side panel or the full page). */
export interface TileLink {
  to: string;
  replace?: boolean;
  state?: unknown;
  /** Its panel is the one open. */
  current?: boolean;
}

export function Tile({ label, value, unit, sub, tone = "", link }: { label: string; value: ReactNode; unit: string; sub: string; tone?: "" | "warn" | "bad"; link?: TileLink }) {
  const body = (
    <>
      <div className="lbl">{label}</div>
      <div className="val">
        <b className="num">{value}</b>
        <span>{unit}</span>
      </div>
      <div className={`sub ${tone}`}>{sub}</div>
    </>
  );
  if (!link) return <div className="tile">{body}</div>;
  return (
    <Link className="tile" to={link.to} replace={link.replace} state={link.state} aria-current={link.current ? "true" : undefined} data-testid="tile-link">
      {body}
    </Link>
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

/**
 * "Updated 10:42". A refresh with the same answer re-renders nothing (the store keeps the object and notes the time in
 * place), so the line looks at the entry's time again every 15 seconds by itself.
 */
export function Updated({ entry }: { entry: Entry }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  return entry.at ? <span className="updated">Updated {clock(entry.at)}</span> : null;
}

/**
 * A segmented control (docs/ui-patterns.md §8): two or three options that switch the view inside a screen ("Now | Week",
 * "All | Requests | Tasks I created"). Not a filter: filters are the Filter button (ui/FilterBar.tsx).
 */
export function Segmented<K extends string>({ options, value, onChange, label }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** Choices inside a form (a reason, a part of the day): chips that pick one. Never a list's filters (ui/FilterBar.tsx). */
export function Chips<K extends string>({ options, value, onChange, counts }: { options: [K, string][]; value: K; onChange: (k: K) => void; counts?: Partial<Record<K, number>> }) {
  return (
    <div className="chips">
      {options.map(([k, label]) => (
        <ChoiceChip key={k} selected={value === k} onClick={() => onChange(k)}>
          {label}{counts && counts[k] != null ? ` · ${counts[k]}` : ""}
        </ChoiceChip>
      ))}
    </div>
  );
}

/**
 * One switch (Settings lists, docs/ui-patterns.md §14): a short title on one line, an optional grey line under it; the
 * whole line flips it. Notifications and (Round 3) the Activity log's "Show routine actions".
 */
export function SwitchLine({ title, text, on, onChange, disabled = false, testId }: { title: string; text?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className={`set-switch${disabled ? " is-disabled" : ""}`} data-testid={testId}>
      <span className="grow"><span className="name">{title}</span>{text && <span className="sub">{text}</span>}</span>
      <input type="checkbox" role="switch" aria-label={title} checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export const WarningsNote = ({ warnings }: { warnings: string[] }) =>
  warnings.length ? (
    <div className="notice" style={{ marginTop: 10 }}>
      <p>
        <b>Check:</b> {warnings.map((w, i) => <span key={i}>{i > 0 && <br />}{datesInWords(w)}</span>)}
      </p>
    </div>
  ) : null;
