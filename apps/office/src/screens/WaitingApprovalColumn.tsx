// The board's first column, "Waiting for approval" (Phase 7, §33): the day's
// tasks proposed by someone without approve, not sent to any driver yet. A card
// shows the leave-by, the title, the stops, the proposed driver and vehicle,
// who proposed it and its status line ("Leave-by passed" when late); it opens
// the decide page for someone who decides, one's own proposal otherwise, or
// nothing. Shown only when there is one, like "Needs a driver".
import { useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { WaitingApprovalCard } from "../data/types";
import { Avatar, Dot, Plate } from "../ui/basics";
import { LATE_BADGE, waitingTarget } from "./approvalLogic";

function WaitingCard({ c, to }: { c: WaitingApprovalCard; to: string | null }) {
  const navigate = useNavigate();
  const body = (
    <>
      <span className="top"><b>{c.time}</b><span>{c.label || ""}</span></span>
      <span className="title">{c.title}</span>
      <span className="route">From {c.from || "—"}<br />To {c.to || "—"}{c.stops_count > 2 ? ` · ${c.stops_count} stops` : ""}</span>
      <span className="leave"><span className="num">Leave by {c.leave_by || c.time}</span><span className="muted"> · proposed by {c.proposed_by}</span></span>
      <span className="who"><Avatar name={c.driver} small /><span className="grow">{c.driver || "No driver proposed"}</span>{c.vehicle ? <Plate v={c.vehicle} /> : c.vehicle_text ? <span className="muted">{c.vehicle_text}</span> : null}</span>
      <span className={`status ${c.late ? "bad" : "muted"}`}>{c.status}</span>
      {c.late && <span><span className="pill bad">{LATE_BADGE}</span></span>}
    </>
  );
  // Nowhere to open (someone else's proposal, no decide permission): the card is read only.
  return to
    ? <button type="button" className="tcard" data-testid="waiting-card" onClick={() => navigate(to)}>{body}</button>
    : <div className="tcard" data-testid="waiting-card" style={{ cursor: "default" }}>{body}</div>;
}

export function WaitingApprovalColumn({ cards }: { cards: WaitingApprovalCard[] }) {
  const { me } = useFleet();
  return (
    <div className="col" data-testid="waiting-approval">
      <div className="col-h"><span><Dot tone={cards.some((c) => c.late) ? "bad" : ""} />Waiting for approval</span><span className="num">{cards.length}</span></div>
      {cards.map((c) => <WaitingCard key={c.request_id} c={c} to={waitingTarget(c, me)} />)}
    </div>
  );
}
