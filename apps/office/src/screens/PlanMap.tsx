// The plan on the map beside its timeline (Phase 7, §20), on Approve, Assign a
// task, Edit stops and the task detail. On a desktop the map sits beside the
// timeline (they wrap one under the other when the panel is narrow); on a
// phone the map is a fixed-height block above it, so the form still scrolls.
// The pins are the start ("S") and the stops by number, Google's road line is
// drawn on Google's map only, and a Google place on any other map is listed
// under it instead (rule 10). Tapping a pin highlights its row; hovering or
// tapping a row highlights its pin. The plan shown stays while the next one is
// planned (the preview keeps its last answer), so the map never flickers.
import { useMemo, useState } from "react";
import { MapView } from "../map/MapView";
import { googleDrawn, useGoogleMap } from "../map/google/useGoogleMap";
import { useIsPhone } from "../ui/phone";
import { type PlanMapStart, type PlanMapStop, planMapOf } from "./planMapLogic";
import { PlanTimeline, type PlanTimelineProps } from "./PlanTimeline";

/** The map's height on a phone (a block above the timeline) and on a desktop (beside it). */
export const PLAN_MAP_PHONE_PX = 260;
export const PLAN_MAP_DESKTOP_PX = 360;

/** Is Google's map the one drawn (the google package, its load counted and allowed): only then Google's pins and lines go on it. */
export function useGoogleMapInUse(): boolean {
  return googleDrawn(useGoogleMap());
}

export function PlanWithMap({ stops, start, ...props }: PlanTimelineProps & {
  /** The plan answer's stops (with their pins). */
  stops?: PlanMapStop[];
  /** The plan answer's start (with its pin). */
  start?: PlanMapStart | null;
}) {
  const google = useGoogleMapInUse();
  const phone = useIsPhone();
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const selected = hover ?? picked;
  // The start is often built by the page on every render: compared by value, so the map gets a new plan only when it changes.
  const startKey = JSON.stringify(start ?? null);
  const view = useMemo(
    () => planMapOf({ timeline: props.timeline, stops, start: JSON.parse(startKey) as PlanMapStart | null, google, offset: props.offset ?? 0 }),
    [props.timeline, stops, startKey, google, props.offset],
  );
  const plan = useMemo(() => (view ? { ...view.plan, selected } : null), [view, selected]);
  // A phone has no pointer to hover with (a tap would leave its row "hovered"): rows are tapped there.
  const timeline = <PlanTimeline {...props} selected={selected} onSelect={setPicked} onHover={phone ? undefined : setHover} />;
  if (!view || !plan || !props.timeline || (!plan.pins.length && !view.googleNotDrawn.length)) return timeline;
  const map = (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }} data-testid="plan-map">
      {plan.pins.length > 0 && (
        <MapView markers={[]} route={null} plan={plan} onPin={(id) => setPicked((p) => (p === id ? null : id))} onPick={() => undefined}
          height={phone ? PLAN_MAP_PHONE_PX : PLAN_MAP_DESKTOP_PX} />
      )}
      {view.googleNotDrawn.length > 0 && <span className="muted small" data-testid="plan-map-google">Google place, not drawn: {view.googleNotDrawn.join(", ")}</span>}
      {view.noPin.length > 0 && <span className="muted small" data-testid="plan-map-nopin">No map pin: {view.noPin.join(", ")}</span>}
    </div>
  );
  return (
    <div data-testid="plan-with-map" style={phone
      ? { display: "grid", gap: 12 }
      : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
      {map}
      {timeline}
    </div>
  );
}
