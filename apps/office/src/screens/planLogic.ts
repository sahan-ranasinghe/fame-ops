// The plan in one line, and the exact reason when there is none: what the page
// shows above Save as the stops change (pure, tested). Also the timeline's
// words (Phase 7, §17) and each stop's first time at the stop (the place's
// usual time, else the default for the type).
import type { PlannedStop, PlanPreview, PlanTimeline, TimelineItem } from "../data/types";
import type { DwellFallback } from "./DwellPicker";
import { driveText, hasDeadline, type StopDraft, stopsInput, typeDwell, usedRow } from "./stopsLogic";
import { duration } from "@fleet/durations";

export const SOURCE_LABEL: Record<string, string> = { ors: "OpenRouteService", google: "Google", estimate: "estimate" };
/** Where a leg's road time came from, in the timeline's words. */
export const LEG_SOURCE: Record<string, string> = { google: "Google traffic", ors: "openrouteservice", estimate: "estimate" };

const hhmm = (s?: string | null) => (s ? String(s).slice(-5) : "");

/** "Leave by 07:10 · Kalutara 07:35 · Galle 08:40 · Matara 09:45 · 2 h 35 driving · road time OpenRouteService" */
export function planLine(p: PlanPreview | null | undefined): string | null {
  if (!p || !p.leave_by) return null;
  const parts = [`Leave by ${hhmm(p.leave_by)}`];
  for (const s of p.stops) {
    if (s.planned_arrive) parts.push(`${s.place ?? `Stop ${s.seq}`} ${hhmm(s.planned_arrive)}`);
  }
  if (p.plan) {
    parts.push(`${driveText(p.plan.total_drive_min)} driving`);
    const src = (p.plan.source_label ?? SOURCE_LABEL[p.plan.source] ?? p.plan.source).replace(/^road time\s*·?\s*/i, "");
    parts.push(p.plan.source === "estimate" ? "estimated times" : `road time ${src}`);
  }
  return parts.join(" · ");
}

export interface PlanReason {
  text: string;
  /** A note (the plan exists, with a caveat), not a reason the plan is missing. */
  note?: boolean;
}

export interface PlanFields {
  date: string;
  stops: StopDraft[];
  leaveBy: string;
  start: string;
  returnToBase: boolean;
  /** Stops before the rows (the start stop, stops already reached): errors name the rows as their labels do. */
  offset?: number;
}

/**
 * Why there is no plan (or what to know about it): missing pieces in the form first, then the
 * server's answer. Each reason says what to do.
 */
export function planReasons(f: PlanFields, preview: PlanPreview | null | undefined, err: string | null | undefined): PlanReason[] {
  const out: PlanReason[] = [];
  if (!f.date.trim()) out.push({ text: "Add a date." });
  const stops = stopsInput(f.stops, f.offset ?? 0);
  if ("error" in stops) out.push({ text: stops.error === "Add at least one stop." ? "Add at least one stop with a place." : stops.error });
  if (!f.leaveBy.trim() && !hasDeadline(f.stops)) out.push({ text: "Add a leave-by time, or an arrive-by time on a stop, so it can be planned." });
  if (out.length) return out;
  if (err) return [{ text: err }];
  if (!preview) return [];
  for (const s of preview.stops) {
    if (s.pin === "none") out.push({ text: `${s.label ?? s.place ?? `Stop ${s.seq}`} has no pin — add one.` });
  }
  if (!preview.start?.has_pin && (f.returnToBase || !f.start.trim()) && preview.warnings.some((w) => /base place/i.test(w))) {
    // With a plan the trip simply starts from the first stop: a note; without one it is the reason.
    out.push({ text: "No base place set — pick it in Settings → Fleet.", ...(preview.leave_by ? { note: true } : {}) });
  }
  for (const w of preview.warnings) {
    if (/base place/i.test(w) || /no (map )?pin|no coordinates/i.test(w)) continue; // said above in our own words
    if (/^Same as the start/i.test(w)) continue; // the stop row says it, with Tick it
    out.push({ text: w });
  }
  if (preview.plan?.source === "estimate") out.push({ text: "No routing key — the times are estimates (straight line × road factor).", note: true });
  return out;
}

/** "1 h 30 min" / "45 min" for a time at a stop in the timeline. */
export function stayText(min: number): string {
  return duration(Math.max(0, min));
}

/** A stop item's line: "arrive 09:00 · 1 h 30 · leave 10:30" (the start stop: "leave 07:24"). */
export function stopTimes(s: Extract<TimelineItem, { kind: "stop" }>): string {
  if (s.is_start) return [`leave ${s.planned_leave}`, "passengers get in here"].join(" · ");
  return [`arrive ${s.planned_arrive}`, `${stayText(s.dwell_min)}${s.dwell_source === "place" ? " (usual here)" : ""}`, `leave ${s.planned_leave}`].join(" · ");
}

/** A leg item's line: "42 km · 1 h 5 min · Google traffic". */
export function legText(l: Extract<TimelineItem, { kind: "leg" }>): string {
  const km = Math.round(l.km * 10) / 10;
  return [`${km} km`, driveText(l.minutes), LEG_SOURCE[l.source] ?? l.source].join(" · ");
}

/** A stop's label with the stops before the list counted ("Stop 2 · …" → "Stop 4 · …" with offset 2). */
export function shiftLabel(label: string, n: number, offset: number): string {
  if (!offset) return label;
  return label.replace(/^Stop \d+/, `Stop ${n + offset}`);
}

/** The stop items of a timeline, in order. */
export const timelineStops = (t: PlanTimeline | null | undefined) =>
  (t?.items ?? []).filter((x): x is Extract<TimelineItem, { kind: "stop" }> => x.kind === "stop");

/**
 * Each row's first time at the stop, by row key: the plan preview's answer for that row when the server
 * chose it (the place's usual time, or the default), else the default for the type from the fleet setting.
 * The rows map to the preview's stops in order (empty rows skipped; the start stop is not a row).
 */
export function dwellFallbacks(list: StopDraft[], previewStops: PlannedStop[] | undefined, setting?: Record<string, number> | null): Map<string, DwellFallback> {
  const out = new Map<string, DwellFallback>();
  const planned = (previewStops ?? []).filter((s) => !s.is_start);
  let j = 0;
  for (const s of list) {
    const used = usedRow(s);
    const p = used ? planned[j++] : undefined;
    const fromPlan = p && p.type === s.type && p.dwell_min != null && (p.dwell_source === "place" || p.dwell_source === "default")
      ? { min: p.dwell_min, source: p.dwell_source }
      : null;
    out.set(s.key, fromPlan ?? { min: typeDwell(s.type, setting), source: "default" });
  }
  return out;
}

/** The timeline's number for each used row (rows after the start stop are numbered from 2). */
export function rowStopNumbers(list: StopDraft[], offset = 0): Map<string, number> {
  const out = new Map<string, number>();
  let n = offset;
  for (const s of list) if (usedRow(s)) out.set(s.key, ++n);
  return out;
}
