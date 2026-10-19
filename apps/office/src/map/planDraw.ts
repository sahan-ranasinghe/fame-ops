// The plan on a map (Phase 7, §20) and rule 10: what each map may draw of it. Google's map draws
// every pin and every leg's road line. Every other map (MapLibre, the drawn map) leaves Google's
// pins out and never draws Google's lines; Part 6: it draws openrouteservice's road lines (ours),
// and thin straight dashed connectors for the legs it has no line for, with a small note that
// those are not the road.
import { ORS_CREDIT } from "../data/route";
import type { MapPlan, PlanPin } from "./types";

type LatLng = { lat: number; lng: number };

export interface DrawnPlan {
  pins: PlanPin[];
  /** Straight dashed connectors between neighbouring pins (only where there is no road line). */
  links: [PlanPin, PlanPin][];
  /** Google's road lines (Google's map only). */
  lines: LatLng[][];
  /** Google pins left out on this map (listed, not drawn). */
  hidden: number;
  /** The corner note: "Straight lines, not the road" and the Google stops not drawn; null when there is nothing to say. */
  note: string | null;
}

const EMPTY: DrawnPlan = { pins: [], links: [], lines: [], hidden: 0, note: null };

/**
 * The plan as one map draws it. `google` = Google's own map. Connectors join neighbours in the plan's order only: a
 * Google stop left out breaks the chain there (a line straight past it would claim a leg that does not exist).
 */
export function planFor(plan: MapPlan | null | undefined, google: boolean): DrawnPlan {
  if (!plan || !plan.pins.length) return EMPTY;
  const drawable = (p: PlanPin) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (google || !p.google);
  const pins = plan.pins.filter(drawable);
  const hidden = plan.pins.filter((p) => !google && p.google).length;
  const lines: LatLng[][] = [];
  const links: [PlanPin, PlanPin][] = [];
  let ors = false;
  if (plan.legs?.length) {
    // Leg by leg (Part 6): its own line where this map may show it, else a straight connector between its two pins.
    const byId = new Map(pins.map((p) => [p.id, p]));
    for (const leg of plan.legs) {
      if (leg.points.length > 1 && (google || !leg.google)) {
        lines.push(leg.points);
        if (!leg.google) ors = true;
      }
      else {
        const a = byId.get(leg.from), b = byId.get(leg.to);
        if (a && b) links.push([a, b]);
      }
    }
  } else {
    if (google) lines.push(...(plan.lines ?? []).filter((l) => l.length > 1));
    if (!lines.length) {
      for (let i = 1; i < plan.pins.length; i++) {
        const a = plan.pins[i - 1], b = plan.pins[i];
        if (drawable(a) && drawable(b)) links.push([a, b]);
      }
    }
  }
  const parts = [
    links.length ? "Straight lines, not the road" : null,
    hidden ? `${hidden} Google stop${hidden > 1 ? "s" : ""} listed, not drawn` : null,
    ors ? ORS_CREDIT : null,
  ].filter(Boolean);
  return { pins, links, lines, hidden, note: parts.length ? parts.join(" · ") : null };
}

/** The view is fitted again only when this changes: the pins drawn and the lines' shape, never a highlight. */
export function planFitKey(d: DrawnPlan): string {
  if (!d.pins.length && !d.lines.length) return "";
  const pins = d.pins.map((p) => `${p.id}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  const at = (q: LatLng) => `${q.lat.toFixed(5)},${q.lng.toFixed(5)}`;
  const lines = d.lines.map((l) => `${l.length}:${at(l[0])}>${at(l[l.length - 1])}`).join("|");
  return `${pins}#${lines}`;
}

/** Every point the plan's view is fitted to: its pins and its lines. */
export function planPoints(d: DrawnPlan): LatLng[] {
  return [...d.pins.map((p) => ({ lat: p.lat, lng: p.lng })), ...d.lines.flat()];
}

/** The chip beside a pin: its label without the number the pin already shows ("2 · Kurunegala site · 09:00–10:30" → "Kurunegala site · 09:00–10:30"). */
export function pinChip(p: PlanPin): string {
  const lead = `${p.n} · `;
  return p.label.startsWith(lead) && p.label.length > lead.length ? p.label.slice(lead.length) : p.label;
}
