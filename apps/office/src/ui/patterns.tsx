// Round 4–7, item 12 (the approved mockups of 22 October 2026, design/mockups/2026-10-22): the website's twins of the
// app's mockup patterns (apps/driver/src/components/patterns), one component per pattern, in the site's own tokens
// (styles.css, the `pt-` classes: light and dark themes, the contrast rules of themeContrast.test.ts):
// - StatusBanner: ONE status per page (a round icon in the tone, the state, one second line, one chip at the right);
// - StatsRow: a row of facts, an icon over a mono value over a grey word ("197 km / distance");
// - RouteStepper: a trip's stops on one rail (the time on the left, S / numbered / B marks, one meta line, the legs);
// - ListRow: an icon or avatar, one title, one grey meta line, a small chip;
// - BottomActionBar: the outlined second action, the one primary, ⋯ More, the reason under them (sticky on a phone);
// - NewTripFab: the one floating New trip button (a phone; a desktop keeps the header's buttons);
// - TopBar: the site's PageTop (ui/Page.tsx) is the thin top bar; its back button is the round one.
// The Overview's stats row is the existing Tile in its new look (ui/basics.tsx), the plan's stepper the existing
// PlanTimeline and the live stops' the existing StopProgress, restyled in place (their words and test ids unchanged).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "./icons";

export type PtTone = "live" | "ok" | "warn" | "bad" | "muted";

/** ONE status per page: the round icon, the state, one line under it, a chip at the right; a link when it opens a place. */
export function StatusBanner({ tone, icon, title, line, chip, to, children, testId = "status-banner" }: {
  tone: PtTone;
  /** An icon of ui/icons.tsx ("clock", "check", "route", "alert"…). */
  icon: string;
  title: ReactNode;
  line?: ReactNode;
  chip?: { text: string; tone: PtTone } | null;
  /** The place it opens (Live with the driver). */
  to?: string;
  children?: ReactNode;
  testId?: string;
}) {
  const body = (
    <>
      <span className="pt-banner-ic" aria-hidden="true"><Icon name={icon} /></span>
      <span className="pt-banner-tx">
        <b data-testid={`${testId}-title`}>{title}</b>
        {line ? <span className="pt-banner-line" data-testid={`${testId}-line`}>{line}</span> : null}
        {children}
      </span>
      {chip ? <span className={`pt-chip ${chip.tone}`} data-testid={`${testId}-chip`}>{chip.text}</span> : null}
    </>
  );
  if (to) return <Link className={`pt-banner ${tone}`} to={to} data-testid={testId}>{body}</Link>;
  return <div className={`pt-banner ${tone}`} role="status" data-testid={testId}>{body}</div>;
}

export interface Fact {
  key: string;
  icon: string;
  value: ReactNode;
  label: string;
}

/** A row of facts (Review, the request, the trip): an icon over the value over a grey word. */
export function StatsRow({ facts, framed = true, testId = "stats-row" }: { facts: readonly Fact[]; framed?: boolean; testId?: string }) {
  if (!facts.length) return null;
  return (
    <div className={`pt-facts${framed ? " framed" : ""}`} data-testid={testId}>
      {facts.map((f) => (
        <div className="pt-fact" key={f.key} data-testid={`fact-${f.key}`}>
          <Icon name={f.icon} />
          <b className="num">{f.value}</b>
          <span>{f.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface StepRow {
  key: string;
  /** "S", "2", "B". */
  mark: string;
  kind: "start" | "stop" | "back";
  state?: "done" | "current" | "todo" | "skipped";
  time?: string;
  /** The planned time under the actual one (struck through once it differs). */
  sub?: string;
  title: ReactNode;
  chip?: { text: string; tone: PtTone } | null;
  meta?: ReactNode;
  /** More lines under the meta (the stop's own words, its buttons). */
  lines?: ReactNode;
  /** The leg to the next row: "99 km · 2 h 23 min". */
  leg?: string;
  testId?: string;
}

/** A trip's stops on one rail: the time on the left, S / numbered / B, the place, one meta line, the leg under it. */
export function RouteStepper({ rows, live = false, testId = "route-stepper" }: { rows: readonly StepRow[]; live?: boolean; testId?: string }) {
  if (!rows.length) return null;
  return (
    <ol className={`pt-steps${live ? " live" : ""}`} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className={`pt-step ${r.kind} ${r.state ?? "todo"}`} data-testid={r.testId} aria-current={r.state === "current" ? "step" : undefined}>
          <span className="pt-time num">
            {r.time ? <b>{r.time}</b> : null}
            {r.sub ? <s>{r.sub}</s> : null}
          </span>
          <span className="pt-mark" aria-hidden="true">{r.state === "done" ? <Icon name="check" /> : r.mark}</span>
          <span className="pt-body">
            <span className="pt-title">{r.title}{r.chip ? <span className={`pt-chip ${r.chip.tone}`}>{r.chip.text}</span> : null}</span>
            {r.meta ? <span className="pt-meta">{r.meta}</span> : null}
            {r.lines}
            {r.leg ? <span className="pt-leg num"><Icon name="car" />{r.leg}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One list row: an icon (or an avatar, or a time), ONE title, ONE grey meta line, a small chip; a link when it opens. */
export function ListRow({ lead, title, meta, chip, end, to, testId }: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  chip?: { text: string; tone: PtTone } | null;
  end?: ReactNode;
  to?: string;
  testId?: string;
}) {
  const body = (
    <>
      {lead}
      <span className="pt-row-tx">
        <span className="pt-row-title">{title}</span>
        {meta ? <span className="pt-row-meta">{meta}</span> : null}
      </span>
      {chip ? <span className={`pt-chip ${chip.tone}`}>{chip.text}</span> : null}
      {end}
    </>
  );
  if (to) return <Link className="pt-row" to={to} data-testid={testId}>{body}</Link>;
  return <div className="pt-row" data-testid={testId}>{body}</div>;
}

/** The tinted 40 px tile with an icon at a row's left. */
export const RowIcon = ({ icon, tone = "muted" }: { icon: string; tone?: PtTone }) => (
  <span className={`pt-row-ic ${tone}`} aria-hidden="true"><Icon name={icon} /></span>
);

/** The sticky bar: the buttons as the screen lays them out (each keeps its own id and state), the reason under them. */
export function BottomActionBar({ children, reason, reasonTestId }: { children: ReactNode; reason?: ReactNode; reasonTestId?: string }) {
  return (
    <div className="sticky-acts pt-bar">
      {children}
      {reason ? <p className="hint btn-why" data-testid={reasonTestId}>{reason}</p> : null}
    </div>
  );
}

/** The one floating New trip button (a phone): it opens the trip editor the person may use. */
export function NewTripFab({ to, label = "New trip", testId = "new-trip-fab" }: { to: string; label?: string; testId?: string }) {
  return (
    <Link className="pt-fab phone-only" to={to} data-testid={testId}>
      <Icon name="plus" />{label}
    </Link>
  );
}
