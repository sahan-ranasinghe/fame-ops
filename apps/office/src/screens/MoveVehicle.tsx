// Live → driver card → Move to vehicle (/drivers/:username/vehicle, Phase 7 §2): every active
// vehicle with who holds it, or No vehicle → move_driver_vehicle (whoever held the vehicle no
// longer does and is told; the driver gets a push), then back to Live locations. Off duty: a
// short explanation instead of the form. Part 2 (§2 addition): for a driver on a running task
// the page is "Swap the vehicle during the task" (a breakdown): the vehicle the task goes on in,
// the two odometer readings at the swap (typed here, or the driver enters them on the phone) and
// the reason; afterwards the answer's note and readings. The rows' rules are in moveLogic.ts.
import { type ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import { dutyLine } from "../data/live";
import type { LiveDriver, LiveDrivers, VehiclesList } from "../data/types";
import { joinDots, plateOf } from "../lib/format";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { ErrBox, Loading, Notice } from "../ui/basics";
import { BackButton, PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { SkeletonRows } from "../ui/ListKit";
import {
  canMove,
  canSwap,
  currentChoice,
  moveHint,
  moveInput,
  moveMode,
  type MoveResult,
  type MoveRow,
  moveRows,
  moveSentence,
  NO_VEHICLE,
  notMovable,
  type SwapFields,
  swapHint,
  swapInput,
  swapReadings,
  type SwapResult,
  swapRows,
} from "./moveLogic";

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
  // The swap's answer: shown on the page (the note and the readings), the driver's card stays on the task.
  const [swapped, setSwapped] = useState<SwapResult | null>(null);
  const onFix = (f: string | null) => { if (f === "perms") void managePermissions?.(); };

  const mode = x ? moveMode(x) : "move";
  const top = mode === "swap" || swapped
    ? <PageTop title="Swap the vehicle during the task" sub={joinDots([x?.driver ?? username, x?.task])} backTo="/live" />
    : <PageTop title={`Move ${x?.driver ?? username} to a vehicle`} sub={x ? dutyLine(x) : undefined} backTo="/live" />;
  if (!x) {
    return (
      <section className="view">
        {top}
        {live.data ? <Notice tone="bad" action={<BackButton fallback="/live">Back</BackButton>}>There is no active driver “{username}”.</Notice> : (
          <>
            <ErrBox entry={live} onRetry={() => void store.load("live", "live_drivers", { filter: "all" })} onFix={onFix} />
            {!live.err && <Loading>Finding the driver…</Loading>}
          </>
        )}
      </section>
    );
  }
  const taskId = swapped?.task_id ?? x.task_id;
  const openTask = taskId && can(me, "assign_tasks") ? <Link className="btn" to={`/tasks/${taskId}`}>Open the task →</Link> : null;
  if (swapped) {
    return (
      <section className="view" data-testid="move-vehicle">
        {top}
        <div className="page-form" data-testid="swap-done">
          <Notice tone="ok">{swapped.note ?? `The task goes on in ${plateOf(swapped.vehicle)}.`}</Notice>
          <div className="card card-b">
            <h2>Odometer at the swap</h2>
            <ul className="reasons" style={{ marginTop: 10 }}>
              {swapReadings(swapped).map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div className="acts">
            <BackButton className="btn dark" fallback="/live">Back</BackButton>
            {openTask}
          </div>
        </div>
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
          <div className="acts"><BackButton fallback="/live">Back</BackButton></div>
        </div>
      </section>
    );
  }
  const vehicleList = !veh.data ? (
    <>
      <ErrBox entry={veh} onRetry={() => void store.load("move.vehicles", "list_vehicles", { filter: "all" })} onFix={onFix} />
      {!veh.err && <SkeletonRows rows={3} label="Loading the vehicles…" />}
    </>
  ) : null;

  if (mode === "swap") {
    return (
      <section className="view" data-testid="move-vehicle">
        {top}
        <SwapForm x={x} username={username} rows={swapRows(rows)} loaded={!!veh.data} vehicleList={vehicleList} openTask={openTask} onDone={setSwapped} />
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
      navigate("/live", { replace: true });
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
          {vehicleList ?? (
            <div className="move-list" role="radiogroup" aria-label="Vehicle">
              <VehicleOptions rows={rows} picked={picked} busy={busy} onPick={setChoice} />
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
          <BackButton fallback="/live">Cancel</BackButton>
        </StickyActions>
      </div>
    </section>
  );
}

/** The radio rows: the plate, what it is, and who holds it (or why it can't be picked). */
function VehicleOptions({ rows, picked, busy, onPick }: { rows: MoveRow[]; picked: string | null; busy: boolean; onPick: (reg: string) => void }) {
  return (
    <>
      {rows.map((r) => (
        <label key={r.reg_no} className={`opt${r.disabled ? " off" : ""}`}>
          <input type="radio" name="mv-vehicle" value={r.reg_no} checked={picked === r.reg_no} disabled={r.disabled || busy} onChange={() => onPick(r.reg_no)} />
          <span className="grow">
            <span className="plate">{r.reg_no}</span>
            {r.what && <span className="sub" style={{ display: "block", marginTop: 4 }}>{r.what}</span>}
            <span className={`sub ${r.tone}`} style={{ display: "block", fontWeight: r.current ? 600 : undefined }}>{r.note}</span>
          </span>
        </label>
      ))}
    </>
  );
}

/** The swap during a task: the vehicle the task goes on in, the readings at the swap (optional), the reason, Swap. */
function SwapForm({ x, username, rows, loaded, vehicleList, openTask, onDone }: {
  x: LiveDriver;
  username: string;
  rows: MoveRow[];
  loaded: boolean;
  vehicleList: ReactNode;
  openTask: ReactNode;
  onDone: (r: SwapResult) => void;
}) {
  const { store, transport } = useFleet();
  const toast = useToast();
  const [choice, setChoice] = useState<string | null>(null);
  const [f, setF] = useState<SwapFields>({ oldKm: "", newKm: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const first = x.driver.split(" ")[0];

  async function swap() {
    const v = swapInput(username, choice, f);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<SwapResult>("move_driver_vehicle", v.input);
      toast(`Swapped to ${plateOf(r.vehicle)}`);
      void store.invalidate();
      onDone(r);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  return (
    <div className="page-form" data-testid="swap-form">
      <div className="card card-b form">
        <h2>The task</h2>
        <p style={{ margin: 0 }}><b>{x.task || "The running task"}</b></p>
        <p className="muted small" style={{ margin: 0 }}>
          {x.driver} is on it{x.vehicle ? <> in <span className="plate">{plateOf(x.vehicle)}</span></> : null}. The task goes on in the new vehicle and keeps both
          stretches: the task's km is the two added up, and each vehicle counts its own km. {first}’s phone gets a push.
        </p>
        {openTask && <div className="acts">{openTask}</div>}
      </div>
      <div className="card card-b form">
        <h2>The vehicle the task goes on in</h2>
        {vehicleList ?? (
          <div className="move-list" role="radiogroup" aria-label="Vehicle">
            <VehicleOptions rows={rows} picked={choice} busy={busy} onPick={setChoice} />
          </div>
        )}
      </div>
      <div className="card card-b form">
        <h2>Odometer at the swap</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sw-old">Old vehicle's odometer now (km)</label>
            <input id="sw-old" inputMode="numeric" autoComplete="off" maxLength={12} value={f.oldKm} disabled={busy} onChange={(e) => setF({ ...f, oldKm: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sw-new">New vehicle's odometer now (km)</label>
            <input id="sw-new" inputMode="numeric" autoComplete="off" maxLength={12} value={f.newKm} disabled={busy} onChange={(e) => setF({ ...f, newKm: e.target.value })} />
          </div>
        </div>
        <span className="hint">Leave empty and the driver enters it on the phone.</span>
        <div className="field">
          <label htmlFor="sw-reason">Reason (optional)</label>
          <input id="sw-reason" maxLength={200} placeholder="Breakdown near Kurunegala" value={f.reason} disabled={busy} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </div>
      </div>
      {loaded && <p className="muted small" style={{ margin: 0 }} data-testid="move-hint">{swapHint(rows, choice)}</p>}
      {msg && <Notice tone="bad">{msg}</Notice>}
      <StickyActions>
        <button type="button" className="btn dark" disabled={busy || !loaded || !canSwap(rows, choice)} onClick={() => void swap()}>Swap</button>
        <BackButton fallback="/live">Cancel</BackButton>
      </StickyActions>
    </div>
  );
}
