// The plan panel: the plan in one line ("Leave by 07:10 · Kalutara 07:35 · …"),
// or the exact reason there is none; then each stop's planned times, the legs
// that use the expressway, the total drive time, where the road time came
// from, and the warnings. Shown on the task pages (a preview from plan_task)
// and in the task detail (the stored plan).
import type { PlanPreview, PlanSummary, PlannedStop } from "../data/types";
import { num } from "../lib/format";
import { Notice } from "../ui/basics";
import { type PlanReason, planLine } from "./planLogic";
import { driveText } from "./stopsLogic";

export function PlanPanel({ preview, plan, stops, compact, reasons = [] }: { preview?: PlanPreview | null; plan?: PlanSummary | null; stops?: PlannedStop[]; compact?: boolean; reasons?: PlanReason[] }) {
  const p = plan ?? preview?.plan;
  const rows = stops ?? preview?.stops ?? [];
  const warnings = preview?.warnings ?? p?.warnings ?? [];
  const line = planLine(preview);
  const missing = reasons.filter((r) => !r.note);
  const notes = reasons.filter((r) => r.note);
  if (!p && !preview && !reasons.length) return null;
  const leaveBy = preview?.leave_by ?? p?.leave_by;
  const source = preview?.leave_by_source ?? p?.leave_by_source;
  const viaLegs = (p?.legs ?? []).filter((l) => l.via_expressway);
  // A leg slowed by the rush-hour factor (ors and estimate legs; Google's own traffic needs none).
  const rushLegs = (p?.legs ?? []).filter((l) => l.factor && l.factor !== 1);
  return (
    <div className="plan" data-testid="plan-panel">
      {line && !preview?.plan ? null : null}
      {line ? <div className="plan-line" data-testid="plan-line">{line}{source === "manual" ? <span className="muted"> · leave time as typed</span> : null}</div> : null}
      {missing.length > 0 && (
        <ul className="reasons" data-testid="plan-reasons">
          {missing.map((r, i) => <li key={i}>{r.text}</li>)}
        </ul>
      )}
      {(p || preview) && !line && (
        <div className="plan-head">
          <div><div className="eyebrow">Leave by</div><b className="num" style={{ fontSize: 24 }}>{leaveBy?.slice(-5) ?? "—"}</b> <span className="muted">{source === "plan" ? "planned from the deadlines" : "as typed"}</span></div>
          {p && <div className="muted small">{driveText(p.total_drive_min)} driving · {num(p.total_km)} km · {p.source_label ?? p.source}</div>}
        </div>
      )}
      {!compact && rows.length > 0 && (
        <div className="plan-stops">
          {rows.map((s) => (
            <div className="plan-stop" key={s.seq}>
              <span className="when num">{s.planned_arrive ?? "—"}{s.planned_depart && s.planned_depart !== s.planned_arrive ? `–${s.planned_depart}` : ""}</span>
              <span className="grow">{s.place}{s.arrive_by ? <span className="muted"> · by {s.arrive_by}</span> : null}{s.pin === "none" ? <span className="status bad"> · no pin</span> : null}</span>
            </div>
          ))}
        </div>
      )}
      {p && line && <div className="muted small">{num(p.total_km)} km · {p.legs.length} leg{p.legs.length === 1 ? "" : "s"}{p.computed_at ? ` · computed ${p.computed_at}` : ""}</div>}
      {viaLegs.length > 0 && <div className="small">Via expressway: {viaLegs.map((l) => `${l.from} → ${l.to}`).join(", ")}</div>}
      {rushLegs.length > 0 && <div className="small">Rush hour: {rushLegs.map((l) => `${l.from} → ${l.to} ×${l.factor}`).join(", ")}</div>}
      {notes.length > 0 && <ul className="reasons">{notes.map((r, i) => <li key={i} className="note">{r.text}</li>)}</ul>}
      {!reasons.length && warnings.map((w, i) => <Notice key={i} tone={/not set|cannot|already|past/i.test(w) ? "bad" : ""}>{w}</Notice>)}
    </div>
  );
}
