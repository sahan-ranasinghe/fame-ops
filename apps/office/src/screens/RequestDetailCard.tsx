// The request's facts as one card (the detail page and the decide page).
import type { RequestCard } from "../data/types";
import { joinDots } from "../lib/format";
import { Timeline } from "./requestParts";

export function RequestDetailCard({ q, compact }: { q: RequestCard; compact?: boolean }) {
  return (
    <div className="card card-b">
      <div className="name" style={{ fontSize: 19 }}>{q.requested_by}</div>
      <div className="sub">{joinDots([q.project, q.asked, q.one_step ? "booked directly by the office" : ""])}</div>
      <dl className="kv" style={{ marginTop: 14 }}>
        <div><dt>When</dt><dd>{q.when}</dd></div>
        <div><dt>Back by</dt><dd>{q.back_by || "—"}</dd></div>
        <div><dt>Route</dt><dd>{q.route || "—"}</dd></div>
        <div><dt>Need</dt><dd>{joinDots([q.need, q.driver_required === false ? "no driver · the custodian drives" : ""]) || "—"}</dd></div>
        {q.note && <div style={{ gridColumn: "1/-1" }}><dt>Note</dt><dd style={{ fontWeight: 400 }}>{q.note}</dd></div>}
      </dl>
      {!compact && <Timeline q={q} />}
    </div>
  );
}
