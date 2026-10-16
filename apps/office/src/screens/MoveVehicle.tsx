// Live → driver card → Move to vehicle (/drivers/:username/vehicle, Phase 7 §2): every active
// vehicle with who holds it, or No vehicle → move_driver_vehicle (whoever held the vehicle no
// longer does and is told; the driver gets a push), then back to Live locations. Only for a
// driver on duty without a task; otherwise a short explanation instead of the form. The rows'
// rules are in moveLogic.ts.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import { dutyLine, dutyOf } from "../data/live";
import type { LiveDrivers, VehiclesList } from "../data/types";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { ErrBox, Loading, Notice } from "../ui/basics";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { canMove, currentChoice, moveHint, moveInput, type MoveResult, moveRows, moveSentence, NO_VEHICLE, notMovable } from "./moveLogic";

export function MoveVehicle() {
  const { username = "" } = useParams();
  const { me, store, transport, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  // The same watch as Live locations (key and arguments), so the card is there at once when opened from it.
  const live = useWatch<LiveDrivers>("live", "live_drivers", { filter: "all" }, 30000, !noConnector);
  const veh = useWatch<VehiclesList>("move.vehicles", "list_vehicles", { filter: "all" }, 60000, !noConnector);
  const x = live.data?.drivers.find((d) => d.username === username);
  const rows = useMemo(() => (x && veh.data ? moveRows(veh.data.vehicles, { name: x.driver, vehicle: x.vehicle }, live.data?.drivers) : []), [x, veh.data, live.data]);
  // null = not picked yet: the driver's current vehicle (or No vehicle) is checked.
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onFix = (f: string | null) => { if (f === "perms") void managePermissions?.(); };

  const top = <PageTop title={`Move ${x?.driver ?? username} to a vehicle`} sub={x ? dutyLine(x) : undefined} backTo="/live" />;
  if (!x) {
    return (
      <section className="view">
        {top}
        {live.data ? <Notice tone="bad">There is no active driver “{username}”. <Link to="/live">Back to Live locations</Link></Notice> : (
          <>
            <ErrBox entry={live} onRetry={() => void store.load("live", "live_drivers", { filter: "all" })} onFix={onFix} />
            {!live.err && <Loading>Finding the driver…</Loading>}
          </>
        )}
      </section>
    );
  }
  const why = notMovable(x);
  if (why) {
    return (
      <section className="view" data-testid="move-vehicle">
        {top}
        <div className="page-form">
          <Notice tone="info">{why}</Notice>
          <div className="acts">
            <Link className="btn" to="/live">Back to Live locations</Link>
            {dutyOf(x) === "on_task" && x.task_id && can(me, "assign_tasks") && <Link className="btn" to={`/tasks/${x.task_id}`}>Open the task</Link>}
          </div>
        </div>
      </section>
    );
  }

  const first = x.driver.split(" ")[0];
  const picked = choice ?? currentChoice(rows);
  async function move() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<MoveResult>("move_driver_vehicle", moveInput(username, picked));
      toast(moveSentence(r));
      void store.invalidate();
      navigate("/live");
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <section className="view" data-testid="move-vehicle">
      {top}
      <div className="page-form">
        <div className="card card-b form">
          <h2>Choose the vehicle</h2>
          <p className="muted small" style={{ margin: 0 }}>One vehicle, one driver: whoever holds the vehicle now no longer does and is told. {first}’s phone gets a push.</p>
          {!veh.data ? (
            <>
              <ErrBox entry={veh} onRetry={() => void store.load("move.vehicles", "list_vehicles", { filter: "all" })} onFix={onFix} />
              {!veh.err && <Loading>Loading the vehicles…</Loading>}
            </>
          ) : (
            <div className="move-list" role="radiogroup" aria-label="Vehicle">
              {rows.map((r) => (
                <label key={r.reg_no} className={`opt${r.disabled ? " off" : ""}`}>
                  <input type="radio" name="mv-vehicle" value={r.reg_no} checked={picked === r.reg_no} disabled={r.disabled || busy} onChange={() => setChoice(r.reg_no)} />
                  <span className="grow">
                    <span className="plate">{r.reg_no}</span>
                    {r.what && <span className="sub" style={{ display: "block", marginTop: 4 }}>{r.what}</span>}
                    <span className={`sub ${r.tone}`} style={{ display: "block", fontWeight: r.current ? 600 : undefined }}>{r.note}</span>
                  </span>
                </label>
              ))}
              <label className="opt">
                <input type="radio" name="mv-vehicle" value={NO_VEHICLE} checked={picked === NO_VEHICLE} disabled={busy} onChange={() => setChoice(NO_VEHICLE)} />
                <span className="grow">
                  <b>No vehicle</b>
                  <span className="sub" style={{ display: "block", marginTop: 4, fontWeight: currentChoice(rows) === NO_VEHICLE ? 600 : undefined }}>
                    {currentChoice(rows) === NO_VEHICLE ? "Current: no vehicle" : `${first} stays on duty without a vehicle`}
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
        {veh.data && <p className="muted small" style={{ margin: 0 }} data-testid="move-hint">{moveHint(rows, picked, first)}</p>}
        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button type="button" className="btn dark" disabled={busy || !veh.data || !canMove(rows, picked)} onClick={() => void move()}>Move</button>
          <Link className="btn" to="/live">Cancel</Link>
        </StickyActions>
      </div>
    </section>
  );
}
