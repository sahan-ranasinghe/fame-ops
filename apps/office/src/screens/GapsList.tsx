// The Gaps list beside a route's map (Phase 7, §21): one row per gap marker,
// with its icon (Round 3 A1, TimelineIcon: no coloured bar), its time, what it
// was, how long and the estimated km by road. A row
// zooms the map to the gap and opens its marker's card; the open one is
// highlighted (the map's own open/close comes back the same way). Round 48:
// useRouteMarks (below) gives a page every mark of a route, the pins and the
// stops' dots with the gaps, and the Events layer (it replaced useGaps).
import { useMemo, useState } from "react";
import type { Route } from "../data/route";
import { joinDots, num } from "../lib/format";
import { visibleMarks } from "../map/layers";
import type { GapMarker, RoutePoint } from "../map/types";
import { gapDuration, type GapRow } from "./gapsLogic";
import { markFocus, routeMarks } from "./routeMarks";
import { TimelineIcon } from "./TimelineIcon";

export function GapsList({ rows, open, onOpen, bare }: {
  rows: GapRow[];
  open: string | null;
  onOpen: (row: GapRow) => void;
  /** Inside another card (a task's route, Live's card): no card of its own. */
  bare?: boolean;
}) {
  if (!rows.length) return null;
  const head = <><b>Gaps</b> <span className="muted small">· {rows.length} · tap one to see it on the map</span></>;
  return (
    <div className={bare ? undefined : "card"} data-testid="gaps-list" aria-label="Gaps">
      {bare ? <div style={{ paddingBottom: 6 }}>{head}</div> : <div className="card-b" style={{ paddingBottom: 6 }}>{head}</div>}
      {rows.map((g) => (
        <button type="button" key={g.id} data-testid="gap-row" aria-pressed={open === g.id}
          className={`tl-row ${g.kind === "late" ? "offline" : g.kind}${open === g.id ? " sel" : ""}`} onClick={() => onOpen(g)}>
          <TimelineIcon kind={g.kind} />
          <span className="when">{g.when}</span>
          <span className="grow">
            <span className="what">{g.what}</span>
            <span className="sub">{joinDots([gapDuration(g.minutes), g.km != null ? `about ${num(g.km)} km by road` : null])}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Round 48 (item 3): a route's marks for a page: the pins, the stops' dots and the gaps' event marks (routeMarks), the
 * ones the map draws now (the Events layer, map/layers.ts: events only while `events` is on, plus the open one), the
 * open card and what a tap does (zoom the map to the mark, open its card). `latest`: today's line still grows.
 */
export function useRouteMarks(route: Route | null, snap: boolean, setFocus: (points: RoutePoint[] | null) => void, opts: { events: boolean; latest?: boolean }): {
  rows: GapRow[];
  /** Every mark (the page's own lists). */
  all: GapMarker[];
  /** The marks the map draws. */
  marks: GapMarker[];
  open: string | null;
  setOpen: (id: string | null) => void;
  /** A Gaps list row. */
  pick: (row: GapRow) => void;
  /** A tap on any mark (or null: closed). */
  onMark: (id: string | null) => void;
} {
  const all = useMemo(() => routeMarks(route, snap, opts.latest), [route, snap, opts.latest]);
  const [open, setOpen] = useState<string | null>(null);
  const shown = open && all.all.some((m) => m.id === open) ? open : null;
  const marks = useMemo(() => visibleMarks(all.all, opts.events, shown), [all, opts.events, shown]);
  const onMark = (id: string | null) => {
    setOpen(id);
    if (!id) return;
    const focus = markFocus(id, all);
    if (focus) setFocus(focus);
  };
  return { rows: all.rows, all: all.all, marks, open: shown, setOpen, pick: (row) => onMark(row.id), onMark };
}
