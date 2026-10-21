// The Gaps list beside a route's map (Phase 7, §21): one row per gap marker,
// with its icon (Round 3 A1, TimelineIcon: no coloured bar), its time, what it
// was, how long and the estimated km by road. A row
// zooms the map to the gap and opens its marker's card; the open one is
// highlighted (the map's own open/close comes back the same way).
import { useMemo, useState } from "react";
import type { Route } from "../data/route";
import { joinDots, num } from "../lib/format";
import type { GapMarker, RoutePoint } from "../map/types";
import { gapDuration, gapMarkers, gapsOf, type GapRow } from "./gapsLogic";
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
 * A route's gaps for a page: the rows, the map's markers, the open one and what a row does (zoom the map to the gap,
 * open its card). `setFocus` is the page's own map focus. The open card is kept by its id across refreshes.
 */
export function useGaps(route: Route | null, snap: boolean, setFocus: (points: RoutePoint[] | null) => void): {
  rows: GapRow[];
  markers: GapMarker[];
  open: string | null;
  setOpen: (id: string | null) => void;
  pick: (row: GapRow) => void;
} {
  const rows = useMemo(() => gapsOf(route, snap), [route, snap]);
  const markers = useMemo(() => gapMarkers(rows), [rows]);
  const [open, setOpen] = useState<string | null>(null);
  const shown = open && rows.some((r) => r.id === open) ? open : null;
  const pick = (row: GapRow) => {
    setOpen(row.id);
    setFocus(row.focus);
  };
  return { rows, markers, open: shown, setOpen, pick };
}
