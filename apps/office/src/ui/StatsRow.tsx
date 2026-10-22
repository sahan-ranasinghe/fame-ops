// The StatsRow (docs/design-pass.md §4.7, Samsara's KPI tiles, Uber Fleet's summary): the counts that matter in one card,
// the most used first. Each cell is a Tile (ui/basics.tsx): a count with a list behind it opens that list (R9). One row on
// a desktop, wrapping when a panel beside it takes the room; two a line on a phone (the lines between the cells are the
// cells' own, the ones on the card's edge clipped: styles.css .stats-row).
import type { ReactNode } from "react";

export function StatsRow({ label, children, testId = "stats-tiles" }: {
  /** What the numbers are about, for a screen reader (the cells carry their own labels). */
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="card stats-row" aria-label={label} data-testid={testId}>
      <div className="stats-cells">{children}</div>
    </section>
  );
}
