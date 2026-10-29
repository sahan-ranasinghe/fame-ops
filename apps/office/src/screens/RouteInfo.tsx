// The words beside a route's map (Round 48, item 2): ONE compact legend row (Google Maps' and Samsara's map keys: a
// swatch and a short word each) that also holds the "Recorded points" toggle (§26), the credits a licence requires
// (openrouteservice's, on an estimated line) and the ⓘ button; the ⓘ opens the site's sheet (ui/Sheet.tsx, docs/
// ui-patterns.md §6; Apple Maps' and Google Maps' info sheet: a popover under the button on a desktop, a bottom sheet
// on a phone) with every explanation that used to sit under the map (routeInfo.ts). Used by the driver page, the task
// page's route and Live's card.
import { type ReactNode, useRef, useState } from "react";
import { type Route, snapControl } from "../data/route";
import { useGoogleMap } from "../map/google/useGoogleMap";
import { GAP_ICONS, svgMarkup } from "../map/mapIcons";
import { usePageScheme } from "../map/scheme";
import { estimatedColor, speedColors } from "../map/types";
import { Icon } from "../ui/icons";
import { Sheet } from "../ui/Sheet";
import { infoSections, legendItems, type MapName, type Swatch, visibleCredits } from "./routeInfo";

/** Which map the page draws now (for the sheet's Credits line). */
function useMapName(): MapName {
  const choice = useGoogleMap();
  if (choice.kind === "google") return "google";
  if (choice.kind === "loading") return "loading";
  return __BUILD__ === "web" ? "free" : "drawn";
}

/** The ⓘ button and its sheet. */
export function RouteInfo({ route, snap, events }: { route: Route | null; snap: boolean; events: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const map = useMapName();
  return (
    <>
      <button ref={btn} type="button" className="btn icon-btn info-btn" aria-label="About this map" title="About this map" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-testid="route-info-button">
        <Icon name="info" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="About this map" anchor={btn} width={380} testId="route-info"
        footer={<><span className="grow" /><button type="button" className="btn primary" onClick={() => setOpen(false)}>Done</button></>}>
        <div className="route-info" data-testid="route-info-sections">
          {infoSections(route, snap, { map, events }).map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.lines.map((l) => <p key={l}>{l}</p>)}
            </section>
          ))}
        </div>
      </Sheet>
    </>
  );
}

/** A legend swatch: the line colours as short bars, the dashed and estimated lines, a thin bar, the dot and the pin. */
function SwatchMark({ kind }: { kind: Swatch }) {
  const scheme = usePageScheme();
  const speed = speedColors(scheme);
  switch (kind) {
    case "stopped":
    case "slow":
    case "normal":
    case "fast":
      return <i style={{ background: speed[kind] }} />;
    case "thin":
      return <i className="thin" />;
    case "dashed":
      return <i className="dashed" />;
    case "estimated":
      return <i style={{ background: `repeating-linear-gradient(90deg, ${estimatedColor(scheme)} 0 3px, transparent 3px 8px)` }} />;
    case "web":
      // Round 50: a web trip's straight line, dashed ink (no live route).
      return <i style={{ background: "repeating-linear-gradient(90deg, var(--ink) 0 5px, transparent 5px 9px)" }} />;
    case "dot":
      // A stop is a small dot on the map (Round 48): the legend draws the same dot (the pin's icon was its look before).
      return <i className="dot" />;
    case "pin":
      return <i className="pinmark" dangerouslySetInnerHTML={{ __html: svgMarkup(GAP_ICONS.start) }} />;
  }
}

/**
 * The compact row: the legend items, the estimated line's credit (kept visible: its terms), "Recorded points" with what
 * the line is (data-testid snap-legend, as before), anything the page adds (a Filter button), and the ⓘ.
 */
export function RouteLegend({ route, snap, onSnap, busy, events, extra }: {
  route: Route | null;
  snap: boolean;
  /** onSnap(raw): true asks for the recorded points, false for the snapped line. */
  onSnap: (raw: boolean) => void;
  busy?: boolean;
  events: boolean;
  extra?: ReactNode;
}) {
  const snapUi = snapControl(route, snap);
  const credits = visibleCredits(route);
  return (
    <div className="legend compact" aria-label="Legend" data-testid="route-legend">
      {legendItems(route).map((it) => (
        <span key={it.key} data-testid={it.key === "dot" ? "legend-stop" : it.key === "estimated" ? "legend-estimated" : it.key === "web" ? "legend-web" : undefined}><SwatchMark kind={it.key} />{it.text}</span>
      ))}
      {credits.map((c) => <span key={c} className="credit" data-testid="estimated-legend">{c}</span>)}
      {(snapUi.toggle || snapUi.note) && (
        <span className="snap" data-testid="snap-legend">
          {snapUi.toggle && <label><input type="checkbox" checked={!snap} disabled={busy} onChange={(e) => onSnap(e.target.checked)} /> Recorded points</label>}
          {snapUi.note && <span className="note">{snapUi.note}</span>}
        </span>
      )}
      <span className="legend-end">
        {extra}
        <RouteInfo route={route} snap={snap} events={events} />
      </span>
    </div>
  );
}
