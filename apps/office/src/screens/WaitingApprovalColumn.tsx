// The board's first column, "Waiting for approval" (Phase 7, §33): the day's
// tasks proposed by someone without approve, not sent to any driver yet. A card
// shows the leave-by, the title, the stops, the proposed driver and vehicle,
// who proposed it and its status line ("Leave-by passed" when late); it opens
// the decide page for someone who decides, one's own proposal otherwise, or
// nothing. Shown only when there is one. The design pass (pilot f): the card
// says its state as a chip like the board's other cards (Waiting, or Waiting ·
// late past its leave-by: amber, docs/design-pass.md §3), the sentence under it.
import { useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { WaitingApprovalCard } from "../data/types";
import { Dot, Pill } from "../ui/basics";
import { DriverLine, VehicleChip } from "../ui/DriverRow";
import { vehicleChipWords } from "../ui/driverRowLogic";
import { waitingTarget } from "./approvalLogic";
import { waitingChip } from "./taskStateLogic";

function WaitingCard({ c, to }: { c: WaitingApprovalCard; to: string | null }) {
  const navigate = useNavigate();
  const chip = waitingChip(c.late);
  const body = (
    <>
      <span className="top"><b>{c.time}</b><span>{c.label || ""}</span></span>
      <span className="title">{c.title}</span>
      <span className="route">From {c.from || "—"}<br />To {c.to || "—"}{c.stops_count > 2 ? ` · ${c.stops_count} stops` : ""}</span>
      <span className="leave"><span className="num">Leave by {c.leave_by || c.time}</span><span className="muted"> · proposed by {c.proposed_by}</span></span>
      {/* Round 3: the proposed driver as the driver-first card (the vehicle chip under the name), as on the board's cards. */}
      <span className="who">
        {c.driver
          ? <DriverLine name={c.driver} vehicle={vehicleChipWords(c.vehicle, { text: c.vehicle_text })} />
          : <><span className="grow muted">No driver proposed</span>{c.vehicle || c.vehicle_text ? <VehicleChip chip={vehicleChipWords(c.vehicle, { text: c.vehicle_text })} /> : null}</>}
      </span>
      <span className="tstate" data-testid="task-state"><Pill tone={chip.tone}>{chip.label}</Pill></span>
      <span className="sub" data-testid="card-status">{c.status}</span>
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
      <div className="col-h"><span><Dot tone="warn" />Waiting for approval</span><span className="num">{cards.length}</span></div>
      {cards.map((c) => <WaitingCard key={c.request_id} c={c} to={waitingTarget(c, me)} />)}
    </div>
  );
}
