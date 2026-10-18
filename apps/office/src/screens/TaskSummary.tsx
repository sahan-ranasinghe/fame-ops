// Hotfix 4 (b): the task at the top of Give it a driver (/tasks/:id/edit?driver=1), so the person choosing a driver sees
// what the trip is without leaving the page: the day and the leave-by time, the passengers and the vehicle, the stops with
// their arrive-by and time there, who asked and who approved it, the notes, and the plan on the map.
import type { TaskDetail as TaskDetailData } from "../data/types";
import { hhmm, joinDots } from "../lib/format";
import { Pill } from "../ui/basics";
import { DecisionRow } from "./approvers";
import { useFleetSettings } from "./dispatchParts";
import { PlanWithMap } from "./PlanMap";
import { linksOf } from "../ui/ContactButtons";
import { stopTitle, whatOf } from "./taskDetailLogic";
import { duration } from "@fleet/durations";

/** "leaves in 42 min" / "leave-by passed 10 min ago" / null, from the task's day and leave-by (Colombo). Pure. */
export function leaveIn(date: string | undefined, leaveBy: string | undefined, now: number): string | null {
  const time = hhmm(leaveBy);
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
  const min = Math.round((Date.parse(`${date}T${time}:00+05:30`) - now) / 60_000);
  if (Number.isNaN(min)) return null;
  if (min >= 0) return min < 120 ? `leaves in ${duration(min)}` : null;
  return `leave-by passed ${duration(-min)} ago`;
}

export function TaskSummary({ p }: { p: TaskDetailData }) {
  const t = p.task;
  const settings = useFleetSettings();
  const office = linksOf(settings.data?.settings.office_phone);
  const stops = p.stops.filter((s) => s.status !== "removed");
  return (
    <div className="card card-b" data-testid="task-summary" style={{ display: "grid", gap: 10 }}>
      <div className="name" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="mono" style={{ fontSize: 18 }}>{t.date ? `${t.start.replace(/\s*\d{2}:\d{2}$/, "")} · ` : ""}Leave by {hhmm(t.leave_by) || hhmm(t.start)}</span>
        {t.passengers ? <Pill>{t.passengers} passenger{t.passengers === 1 ? "" : "s"}</Pill> : null}
        {t.vehicle ? <span className="plate">{t.vehicle.split(" · ")[0]}</span> : t.vehicle_text ? <Pill>{t.vehicle_text}</Pill> : null}
      </div>
      <div className="rows">
        {t.start_place && (
          <div className="row" data-testid="summary-start">
            <span className="stop-pin start">S</span>
            <div className="grow"><div className="name">{t.start_place}</div><div className="sub">Start{t.return_to_base ? " · back to the office after" : ""}</div></div>
          </div>
        )}
        {stops.map((s, i) => (
          <div className="row" key={s.seq} data-testid="summary-stop">
            <span className="stop-pin">{i + 1}</span>
            <div className="grow">
              <div className="name">{stopTitle(s)}</div>
              <div className="sub">
                {joinDots([whatOf(s), s.arrive_by ? `arrive by ${s.arrive_by}` : null, s.dwell_min != null ? `${duration(s.dwell_min)} there` : null])}
              </div>
            </div>
          </div>
        ))}
      </div>
      {(p.from_request || t.approved_by) && (
        <div className="sub" data-testid="summary-asker" style={{ display: "grid", gap: 4 }}>
          {p.from_request && <span>Asked by <b>{p.from_request.requested_by}</b>{p.from_request.asked ? ` · ${p.from_request.asked}` : ""}</span>}
          {t.approved_by && <DecisionRow kind="approved" who={t.approved_by} office={office} />}
        </div>
      )}
      {t.contact?.name && <div className="sub">Contact: {joinDots([t.contact.name, t.contact.phone])}</div>}
      {t.notes && <div className="sub" data-testid="summary-notes">Notes: {t.notes}</div>}
      {p.plan && p.timeline && (
        <PlanWithMap timeline={p.timeline} plan={p.plan} startName={t.start_place} stops={p.stops}
          start={{ name: t.start_place, lat: t.start_lat, lng: t.start_lng, google: !!t.start_google_place_id }} />
      )}
    </div>
  );
}
