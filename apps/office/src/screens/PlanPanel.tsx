// The plan panel: the leave-by time, each stop's planned times, the legs that
// use the expressway, the total drive time, where the road time came from, and
// the warnings. Shown on the Assign form (a preview from plan_task) and in the
// task drawer (the stored plan).
import type { PlanPreview, PlanSummary, PlannedStop } from "../data/types";
import { num } from "../lib/format";
import { Notice } from "../ui/basics";
import { driveText } from "./stopsLogic";

export function PlanPanel({ preview, plan, stops, compact }: { preview?: PlanPreview | null; plan?: PlanSummary | null; stops?: PlannedStop[]; compact?: boolean }) {
  const p = plan ?? preview?.plan;
  const rows = stops ?? preview?.stops ?? [];
  const warnings = preview?.warnings ?? p?.warnings ?? [];
  if (!p && !preview) return null;
  const leaveBy = preview?.leave_by ?? p?.leave_by;
  const source = preview?.leave_by_source ?? p?.leave_by_source;
  const viaLegs = (p?.legs ?? []).filter((l) => l.via_expressway);
  return (
    <div className="plan" data-testid="plan-panel">
      <div className="plan-head">
        <div><div className="eyebrow">Leave by</div><b className="num" style={{ fontSize: 24 }}>{leaveBy?.slice(-5) ?? "—"}</b> <span className="muted">{source === "plan" ? "planned from the deadlines" : "as typed"}</span></div>
        {p && <div className="muted small">{driveText(p.total_drive_min)} driving · {num(p.total_km)} km · {p.source_label ?? p.source}</div>}
      </div>
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
      {viaLegs.length > 0 && <div className="small">Via expressway: {viaLegs.map((l) => `${l.from} → ${l.to}`).join(", ")}</div>}
      {warnings.map((w, i) => <Notice key={i} tone={/not set|cannot|already|past/i.test(w) ? "bad" : ""}>{w}</Notice>)}
    </div>
  );
}
