// The request's facts as one card (the decide pages). Phase 7 (§33): a
// proposed task reads "Task for Kamal · WP CAB-4521 · proposed by Nimal", with
// its passengers, contact and notes; a late one says "Leave-by passed".
// Round 3: who the request asked to drive (AskedWho; the decide pages say it in words beside the driver instead).
import { useFleet } from "../app/FleetContext";
import type { RequestCard } from "../data/types";
import { joinDots } from "../lib/format";
import { requestView } from "./approvalLogic";
import { whenText } from "../lib/when";
import { AskedWho, ChangesList, LateNotice, RequestHead, SelfDriveLicence, Timeline } from "./requestParts";
import { PassengerList } from "./PassengerList";
import { ridersLine } from "./passengersLogic";
import { useSwitch } from "./dispatchParts";

export function RequestDetailCard({ q, compact, hideLate }: { q: RequestCard; compact?: boolean; hideLate?: boolean }) {
  const { me } = useFleet();
  const view = requestView(q, me);
  // Round 4–7: with the switch passengers off, nobody is named (the count stays where the page shows it).
  const ridersOn = useSwitch("passengers").on;
  const p = view.proposal ? q.proposed : undefined;
  return (
    <div className="card card-b">
      <RequestHead q={q} proposal={view.proposal} />
      {q.late && !hideLate && <div style={{ marginTop: 12 }}><LateNotice approver={me.permissions.includes("approve")} /></div>}
      {q.status === "changed" && (
        <div className="notice" style={{ marginTop: 12 }}>
          <p><b>Changed{q.changed?.by ? ` by ${q.changed.by}` : ""}{q.changed?.at ? ` · ${whenText(q.changed.at)}` : ""} · needs re-approval.</b> The booking keeps its old plan until it is decided again.</p>
          <ChangesList changes={q.changes} />
        </div>
      )}
      <dl className="kv" style={{ marginTop: 14 }}>
        <div><dt>When</dt><dd>{q.when}</dd></div>
        <div><dt>Back by</dt><dd>{q.back_by || "—"}</dd></div>
        <div><dt>Route</dt><dd>{joinDots([q.route || "—", q.stops_count && q.stops_count > 2 ? `${q.stops_count} stops` : ""])}</dd></div>
        {q.kind === "task"
          ? <div><dt>Passengers</dt><dd>{p?.passengers ?? "—"}</dd></div>
          : <div><dt>Need</dt><dd>{q.need || "—"}</dd></div>}
          {/* Round 4–7 (6): who rides by name ("Asha, Kamal +3" and a row each; Call / WhatsApp for someone without an account). */}
          {ridersOn && q.passengers_list?.length ? (
            <div style={{ gridColumn: "1/-1" }} data-testid="request-passengers">
              <dt>Who rides</dt>
              <dd style={{ fontWeight: 400 }}>
                <span className="muted">{ridersLine(q.passengers_list.map((x) => x.name), q.kind === "task" ? p?.passengers : q.fields?.pax)}</span>
                <PassengerList list={q.passengers_list} />
              </dd>
            </div>
          ) : null}
          {/* Round 3: who drives, when it is not a driver of ours (the asker, someone else, the custodian). */}
          {!compact && (q.driven_by || q.driver_required === false) && !q.assigned && <div style={{ gridColumn: "1/-1" }}><dt>Who drives</dt><dd style={{ fontWeight: 400 }}><AskedWho q={q} /></dd></div>}
        {(p?.contact_name || p?.contact_phone) && <div><dt>Contact</dt><dd>{joinDots([p.contact_name, p.contact_phone])}</dd></div>}
        {p?.notes && <div style={{ gridColumn: "1/-1" }}><dt>Notes for the driver</dt><dd style={{ fontWeight: 400 }}>{p.notes}</dd></div>}
        {q.note && <div style={{ gridColumn: "1/-1" }}><dt>Note</dt><dd style={{ fontWeight: 400 }}>{q.note}</dd></div>}
      </dl>
      {/* Round 3 (A5): the asker drives it themselves: their licence on file or not (amber; never a block). */}
      <SelfDriveLicence q={q} />
      {!compact && <Timeline q={q} />}
    </div>
  );
}
