// The plan in one line, and the exact reason when there is none: what the page
// shows above Save as the stops change (pure, tested).
import type { PlanPreview } from "../data/types";
import { driveText, hasDeadline, type StopDraft, stopsInput } from "./stopsLogic";

export const SOURCE_LABEL: Record<string, string> = { ors: "OpenRouteService", google: "Google", estimate: "estimate" };

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
}

/**
 * Why there is no plan (or what to know about it): missing pieces in the form first, then the
 * server's answer. Each reason says what to do.
 */
export function planReasons(f: PlanFields, preview: PlanPreview | null | undefined, err: string | null | undefined): PlanReason[] {
  const out: PlanReason[] = [];
  if (!f.date.trim()) out.push({ text: "Add a date." });
  const stops = stopsInput(f.stops);
  if ("error" in stops) out.push({ text: stops.error === "Add at least one stop." ? "Add at least one stop with a place." : stops.error });
  if (!f.leaveBy.trim() && !hasDeadline(f.stops)) out.push({ text: "Add a leave-by time, or an arrive-by time on a stop, so it can be planned." });
  if (out.length) return out;
  if (err) return [{ text: err }];
  if (!preview) return [];
  for (const s of preview.stops) {
    if (s.pin === "none") out.push({ text: `${s.place ?? `Stop ${s.seq}`} has no pin — add one.` });
  }
  if (!preview.start?.has_pin && (f.returnToBase || !f.start.trim()) && preview.warnings.some((w) => /base place/i.test(w))) {
    // With a plan the trip simply starts from the first stop: a note; without one it is the reason.
    out.push({ text: "No base place set — pick it in Settings → Fleet.", ...(preview.leave_by ? { note: true } : {}) });
  }
  for (const w of preview.warnings) {
    if (/base place/i.test(w) || /no (map )?pin|no coordinates/i.test(w)) continue; // said above in our own words
    out.push({ text: w });
  }
  if (preview.plan?.source === "estimate") out.push({ text: "No routing key — the times are estimates (straight line × road factor).", note: true });
  return out;
}
