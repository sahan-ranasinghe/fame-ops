// The Overview's other rows (Hotfix 3, L1): a request waiting for a decision (with Decide), a task that needs a driver
// (the soonest first, opening the task's change page with the driver first), and one of the person's trips with its
// live state. Compact: two lines each, so five rows (three on a phone) keep a section short.
import { Link } from "react-router";
import type { NeedsDriverTask, RequestCard } from "../../data/types";
import { joinDots } from "../../lib/format";
import { Pill } from "../../ui/basics";
import { LATE_BADGE, proposalLine } from "../approvalLogic";
import { liveTone, liveWord } from "../myTripsLogic";
import { bestLine, findDriverPath, whenTone } from "../needsDriverLogic";
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

const ROW_LINK = { color: "inherit", textDecoration: "none" } as const;

export function NeedsDriverLine({ t, linked }: { t: NeedsDriverTask; linked: boolean }) {
  const body = (
    <>
      <span className="due bad mono" style={{ minWidth: 52 }}>{t.start}</span>
      <div className="grow">
        <div className="name">{t.title}</div>
        <div className="sub">{joinDots([t.line, t.note && `“${t.note}”`])}</div>
        {bestLine(t.best) && <div className="sub" data-testid="best-match">{bestLine(t.best)}</div>}
      </div>
      <span className={`due ${whenTone(t.minutes_to_start)}`}>{t.when}</span>
    </>
  );
  return linked
    ? <Link className="row ov-row" style={ROW_LINK} to={findDriverPath(t.task_id)} data-testid="needs-driver-row">{body}</Link>
    : <div className="row ov-row" data-testid="needs-driver-row">{body}</div>;
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
