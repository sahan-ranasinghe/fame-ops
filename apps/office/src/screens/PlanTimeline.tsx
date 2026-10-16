// The plan as a timeline (Phase 7, §17), on Approve, Assign a task and Task
// stops (and the task detail once wired): "Leave by 07:24" big at the top; one
// row per stop ("Stop 2 · Drop · Kurunegala site", then "arrive 09:00 · 1 h 30
// · leave 10:30", the arrive-by red when missed, "usual here" for the place's
// usual time); one row per leg between them (km, drive time and where the road
// time came from), the rush-hour factor and "via expressway" on lines of their
// own; the totals at the bottom. Above it, the exact reason when there is no
// plan (planLogic), and the server's warnings as today.
import type { PlanSummary, PlanTimeline as Timeline } from "../data/types";
import { num } from "../lib/format";
import { Notice } from "../ui/basics";
import { legText, type PlanReason, shiftLabel, stopTimes } from "./planLogic";
import { driveText } from "./stopsLogic";

export function PlanTimeline({ timeline, plan, startName, reasons = [], warnings = [], offset = 0, updating, compact, leaveNote }: {
  timeline?: Timeline | null;
  /** The plan summary: where the road times came from, the buffer. */
  plan?: PlanSummary | null;
  /** The start's name, for the first leg ("from Head office"). */
  startName?: string;
  /** Why there is no plan, or what to know about it (planReasons). */
  reasons?: PlanReason[];
  /** The server's warnings, shown as today (only when there is no reason to show). */
  warnings?: string[];
  /** Stops before the timeline's first (already reached): the numbers follow the task's. */
  offset?: number;
  /** A new plan is on its way: the one shown stays. */
  updating?: boolean;
  /** Only the leave-by and the totals. */
  compact?: boolean;
  /** Where a leave time given by hand came from ("as typed" by default; "the time asked for" on a request). */
  leaveNote?: string;
}) {
  const missing = reasons.filter((r) => !r.note);
  const notes = reasons.filter((r) => r.note);
  if (!timeline && !reasons.length) return null;
  const leave = timeline?.items.find((x) => x.kind === "leave");
  const estimate = plan?.source === "estimate" || timeline?.items.some((x) => x.kind === "leg" && x.source === "estimate");
  const name = (n: number | "start" | "base") => n === "start" ? (startName ? `${startName} (start)` : "the start") : n === "base" ? "the base" : `Stop ${n + offset}`;
  return (
    <div className="plan" data-testid="plan-timeline" aria-busy={updating || undefined}>
      {missing.length > 0 && (
        <ul className="reasons" data-testid="plan-reasons">
          {missing.map((r, i) => <li key={i}>{r.text}</li>)}
        </ul>
      )}
      {timeline && leave && leave.kind === "leave" && (
        <div className="plan-head" style={updating ? { opacity: 0.75 } : undefined}>
          <div className="plan-line" data-testid="plan-line">
            <b className="num" style={{ fontSize: 24 }}>Leave by {leave.at}</b>{" "}
            <span className="muted">· {leave.source === "plan" ? "planned from the arrive-by times" : leaveNote ?? "as typed"}{estimate ? " · estimated times" : ""}</span>
          </div>
          {updating && <span className="updated" data-testid="plan-updating">Updating…</span>}
        </div>
      )}
      {timeline && !compact && (
        <ol className="plan-stops" style={{ listStyle: "none", margin: 0, padding: 0, ...(updating ? { opacity: 0.75 } : {}) }}>
          {timeline.items.map((x, i) => {
            if (x.kind === "stop") {
              const late = x.late_min != null && x.late_min > 0;
              return (
                <li key={`s${x.n}`} className="plan-stop" data-testid="plan-stop" style={{ display: "grid", gap: 2, padding: "6px 0" }}>
                  <b>{shiftLabel(x.label, x.n, offset)}</b>
                  <span className="num small">
                    {stopTimes(x)}
                    {x.arrive_by && (
                      <span className={late ? "status bad" : "muted"} style={{ fontSize: 13 }}> · by {x.arrive_by}{late ? ` · ${x.late_min} min late` : ""}</span>
                    )}
                  </span>
                </li>
              );
            }
            if (x.kind === "leg") {
              return (
                <li key={`l${i}`} className="muted small" data-testid="plan-leg" style={{ paddingLeft: 14, borderLeft: "2px solid var(--line-strong)", display: "grid", gap: 2 }}>
                  <span>{x.from_n === "start" ? `From ${name("start")} · ` : x.to_n === "base" ? "Back to the base · " : ""}{legText(x)}</span>
                  {x.rush_factor && x.rush_factor !== 1 && <span>Rush hour ×{x.rush_factor}</span>}
                  {x.via_expressway && <span>Via expressway</span>}
                </li>
              );
            }
            return null;
          })}
        </ol>
      )}
      {timeline && (
        <div className="muted small" data-testid="plan-totals">
          {driveText(timeline.totals.drive_min)} driving · {num(timeline.totals.km)} km · ends {timeline.totals.ends}
        </div>
      )}
      {notes.length > 0 && <ul className="reasons">{notes.map((r, i) => <li key={i} className="note">{r.text}</li>)}</ul>}
      {!reasons.length && warnings.map((w, i) => <Notice key={i} tone={/not set|cannot|already|past/i.test(w) ? "bad" : ""}>{w}</Notice>)}
    </div>
  );
}
