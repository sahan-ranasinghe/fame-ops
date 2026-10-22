// The Overview's other rows (Hotfix 3, L1): a request waiting for a decision (with Decide) and one of the person's trips
// with its live state. Compact: two lines each, so five rows (three on a phone) keep a section short. A task that needs a
// driver is NeedsDriverRow (../NeedsDriverList.tsx), the site's one needs-a-driver row, compact here.
import { Link } from "react-router";
import type { RequestCard } from "../../data/types";
import { joinDots } from "../../lib/format";
import { Pill } from "../../ui/basics";
import { LATE_BADGE, proposalLine } from "../approvalLogic";
import { liveTone, liveWord } from "../myTripsLogic";
import type { TripRow } from "./overviewLogic";

export function RequestLine({ q, decide }: { q: RequestCard; decide: boolean }) {
  const proposal = q.kind === "task";
  return (
    <div className="row ov-row" data-testid="request-row">
      <div className="grow">
        <div className="name">
          {proposal
            ? <><Pill tone="live">Task</Pill> <Link to={`/requests/${q.id}`}>{q.title || "Proposed task"}</Link></>
            : <><Link to={`/requests/${q.id}`}>{q.requested_by}</Link>{q.on_behalf_of && <span className="muted"> · for {q.on_behalf_of}</span>}</>}
          {q.status === "changed" && <Pill tone="warn">Changed</Pill>}
          {q.late && <Pill tone="bad">{LATE_BADGE}</Pill>}
        </div>
        <div className="sub">
          {joinDots([q.when, q.route, proposal ? null : q.need])}
          {proposal && <>{q.when || q.route ? " · " : ""}<span data-testid="proposal-line">{proposalLine(q)}</span></>}
        </div>
      </div>
      {decide && <Link className="btn small dark" to={`/requests/${q.id}/decide`}>Decide</Link>}
    </div>
  );
}

export function TripLine({ r }: { r: TripRow }) {
  return (
    <Link className="row ov-row link-row" to={r.to} data-testid="trip-row">
      <span className="grow">
        <span className="name">{r.title}</span>
        {r.sub && <span className="sub" style={{ display: "block" }}>{r.sub}</span>}
        <span className="sub" style={{ display: "block" }}>{r.live.text}</span>
      </span>
      <Pill tone={liveTone(r.live.state)}>{liveWord(r.live.state)}</Pill>
    </Link>
  );
}
