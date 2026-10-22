// Round 4–7, item 12 (the approved mockups of 22 October 2026, design/mockups/2026-10-22): the website's twin of the
// app's StatusBanner (apps/driver/src/components/patterns), in the site's own tokens (styles.css, the `pt-` classes: light
// and dark themes, the contrast rules of themeContrast.test.ts): ONE status per page (a round icon in the tone, the state,
// one second line, one chip at the right). The mockups' other patterns are the site's existing components restyled in
// place (docs/ui-patterns.md §17; one component per pattern per codebase): the stats row is `Tile` (ui/basics.tsx), the
// route stepper `PlanTimeline` (the plan) and `StopProgress` (the live stops), the sticky bottom bar `StickyActions`
// (ui/Page.tsx), the list row the lists' `.row` markup in ui/ListKit.tsx's list (ListHeader, SkeletonRows, EmptyLine, LoadMore), the
// thin top bar `PageTop` (ui/Page.tsx).
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
