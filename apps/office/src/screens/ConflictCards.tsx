// Overlaps as cards (Phase 7, §17): "WP CAB-4521 is on task Team drop
// 08:00–11:00 for Dilini (driver Kamal)", with Open that task, Call / WhatsApp
// the requester and the driver, and Pick another vehicle / Pick another driver.
// The same for a driver busy then and a vehicle in the garage. Never blocks.
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { Conflict, ConflictPerson } from "../data/types";

function Reach({ who, role }: { who?: ConflictPerson; role: string }) {
  if (!who || (!who.call && !who.whatsapp)) return null;
  const first = who.name.split(" ")[0];
  return (
    <>
      {who.call && <a className="btn small" href={who.call} aria-label={`Call ${who.name} (${role})`}>Call {first}</a>}
      {who.whatsapp && <a className="btn small" href={who.whatsapp} target="_blank" rel="noopener" aria-label={`WhatsApp ${who.name} (${role})`}>WhatsApp {first}</a>}
    </>
  );
}

export function ConflictCards({ conflicts, onPickVehicle, onPickDriver }: {
  conflicts?: Conflict[] | null;
  /** Scrolls to where another vehicle is picked. */
  onPickVehicle?: () => void;
  /** Scrolls to Who's available. */
  onPickDriver?: () => void;
}) {
  const { me } = useFleet();
  if (!conflicts?.length) return null;
  const opens = me.tools.includes("task_detail");
  return (
    <div className="form" data-testid="conflicts" style={{ gap: 10 }}>
      {conflicts.map((c, i) => (
        <div key={`${c.kind}-${c.task?.id ?? i}`} className="confirm" data-testid="conflict-card" style={{ gap: 8 }}>
          <b style={{ color: "var(--bad)" }}>{c.text}</b>
          <div className="acts" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {c.task && opens && <Link className="btn small" to={`/tasks/${c.task.id}`}>Open that task</Link>}
            <Reach who={c.requester} role="asked for that task" />
            <Reach who={c.driver} role="driver of that task" />
            {(c.kind === "vehicle" || c.kind === "garage") && onPickVehicle && <button type="button" className="btn small dark" onClick={onPickVehicle}>Pick another vehicle</button>}
            {c.kind === "driver" && onPickDriver && <button type="button" className="btn small dark" onClick={onPickDriver}>Pick another driver</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
