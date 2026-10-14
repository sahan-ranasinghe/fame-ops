// The new-request form (staff ask in their own name; the office may name
// anyone), and for someone who approves the "Assign now" section: the free
// vehicles for that day and time in four groups, the free drivers, and one call
// (book_vehicle) that makes the request and its task together.
import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { BookResult, SuggestedVehicle, Suggestions } from "../data/types";
import { joinDots, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, WarningsNote } from "../ui/basics";
import { DrawerTop, useDraft, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { bookInput, emptyRequest, suggestInput, validateNewRequest } from "./requestLogic";
import { TaskDrawer } from "./TaskDrawer";

export const GROUPS: [keyof NonNullable<Suggestions["groups"]>, string][] = [
  ["free_pool", "Free"],
  ["free_assigned", "Assigned to someone · ask first"],
  ["busy", "Busy"],
  ["in_garage", "In the garage"],
];

/** One vehicle in a group: the plate, what it is, how it stands, the custodian's links. */
export function VehicleOption({ v, name, checked, disabled, onPick }: { v: SuggestedVehicle; name: string; checked: boolean; disabled?: boolean; onPick: () => void }) {
  const tone = v.pick === "no" ? "bad" : v.pick === "possible" ? "warn" : "";
  return (
    <label className="opt" style={disabled ? { opacity: 0.55 } : undefined}>
      <input type="radio" name={name} value={v.reg_no} checked={checked} disabled={disabled} onChange={onPick} />
      <span className="grow">
        <span className="plate">{v.reg_no}</span>
        <span className={`sub ${tone}`} style={{ display: "block", marginTop: 4 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.availability, v.but, v.back])}</span>
        {v.assigned_to && (
          <span className="sub" style={{ display: "block", marginTop: 4 }}>
            {joinDots([`Assigned to ${v.assigned_to}`, v.custodian_note, v.note])}
            {v.call && <> · <a href={v.call} onClick={(e) => e.stopPropagation()}>Call</a></>}
            {v.whatsapp && <> · <a href={v.whatsapp} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>WhatsApp</a></>}
          </span>
        )}
      </span>
    </label>
  );
}

export function NewRequestDrawer() {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const lists = useLists();
  // Someone who can neither approve nor assign asks in their own name (the server does the same).
  const staff = !can(me, "approve", "assign_tasks");
  const books = me.tools.includes("book_vehicle");
  const [f, setF, markClean] = useDraft(emptyRequest(today()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [sugErr, setSugErr] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [booked, setBooked] = useState<BookResult | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // The free vehicles for that day and time, fetched a moment after the fields settle.
  const sugArgs = books ? suggestInput(f) : null;
  const sugKey = JSON.stringify(sugArgs);
  useEffect(() => {
    if (!sugArgs) {
      setSug(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const p = await transport.call<Suggestions>("suggest_vehicles", sugArgs);
          if (!alive) return;
          setSug(p);
          setSugErr(null);
        } catch (e) {
          if (alive) setSugErr(errText(e as FleetError)[0]);
        }
      })();
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugKey, transport]);

  const picked = sug ? [...(sug.groups ? Object.values(sug.groups).flat() : sug.vehicles)].find((v) => v.reg_no === vehicle) : undefined;
  const custodianDrives = !f.driver && !!picked?.assigned_to;
  const freeDrivers = sug?.drivers_free ?? sug?.drivers.filter((d) => /free/.test(d.availability)).map((d) => ({ name: d.name, username: d.username })) ?? [];

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewRequest(f, staff ? me.name : undefined);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      const r = await transport.call<{ next?: string }>("create_request", v.input);
      markClean();
      toast(staff ? r.next ?? "Sent to the fleet admin · you'll be notified" : "Request saved");
      drawer.close();
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  async function book() {
    const v = bookInput(f, { vehicle, driver, hasCustodian: !!picked?.assigned_to });
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await transport.call<BookResult>("book_vehicle", v.input);
      markClean();
      setBooked(r);
      toast("Booked");
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (booked) {
    return (
      <>
        <DrawerTop title="Booked" sub={joinDots([booked.vehicle, booked.driver])} />
        <div className="card card-b" style={{ display: "grid", gap: 12 }} data-testid="booked">
          <Notice tone="ok"><b>Booked.</b> {booked.request.requested_by} has {booked.vehicle} on {booked.when}{booked.leave_by ? ` · leave by ${booked.leave_by}` : ""}.</Notice>
          <WarningsNote warnings={warnList(booked)} />
          <div className="acts">
            {booked.task_id && me.tools.includes("task_detail") && <button type="button" className="btn" onClick={() => drawer.open(<TaskDrawer id={booked.task_id!} />)}>Open task</button>}
            <button type="button" className="btn dark" onClick={() => drawer.close()}>Done</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <DrawerTop title="New vehicle request" sub={staff ? "Ask the fleet office for a vehicle" : books ? "Someone needs a vehicle · book it now or leave it waiting" : "Someone needs a vehicle"} />
      <form className="card card-b form" onSubmit={submit} noValidate>
        {!staff && (
          <div className="field"><label htmlFor="nr-by">Who needs it</label><input id="nr-by" maxLength={120} value={f.by} onChange={(e) => set("by", e.target.value)} data-focus placeholder={books ? "Default: you" : undefined} /></div>
        )}
        <div className="field"><label htmlFor="nr-project">Project or team</label><input id="nr-project" maxLength={200} placeholder="Job no., DU ID, or e.g. HR" value={f.project} onChange={(e) => set("project", e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="nr-date">Day</label><input type="date" id="nr-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="field"><label htmlFor="nr-time">Time</label><input type="time" id="nr-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
          <div className="field"><label htmlFor="nr-back">Back by</label><input type="time" id="nr-back" value={f.back} onChange={(e) => set("back", e.target.value)} /></div>
          <div className="field"><label htmlFor="nr-need">Vehicle</label>
            <select id="nr-need" value={f.need} onChange={(e) => set("need", e.target.value)}>
              <option value="">Any</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="nr-from">From</label><input id="nr-from" maxLength={160} list="nr-places" value={f.from} onChange={(e) => set("from", e.target.value)} /></div>
          <div className="field"><label htmlFor="nr-to">To</label><input id="nr-to" maxLength={160} list="nr-places" value={f.to} onChange={(e) => set("to", e.target.value)} /></div>
        </div>
        <datalist id="nr-places">{(lists.places ?? []).map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <div className="grid2">
          <div className="field"><label htmlFor="nr-pax">Passengers</label><input type="number" id="nr-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
          <div className="field" style={{ alignContent: "end", gap: 8 }}>
            <span className="check"><input type="checkbox" id="nr-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="nr-tools">Tools or equipment go too</label></span>
            <span className="check"><input type="checkbox" id="nr-driver" checked={f.driver} onChange={(e) => set("driver", e.target.checked)} /> <label htmlFor="nr-driver">A driver is needed</label></span>
          </div>
        </div>
        <p className="hint" style={{ margin: "-8px 0 0" }}>Untick "A driver is needed" when the person drives a vehicle assigned to them.</p>
        <div className="field"><label htmlFor="nr-note">Note</label><textarea id="nr-note" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>

        {books && (
          <div className="confirm" style={{ borderColor: "var(--line)" }} data-testid="assign-now">
            <div className="section-t" style={{ marginBottom: 10 }}>Assign now</div>
            {!sugArgs && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the time to see which vehicles are free.</p>}
            {sugArgs && !sug && !sugErr && <Loading>Finding free vehicles…</Loading>}
            {sugErr && <Notice tone="bad">{sugErr}</Notice>}
            {sug && (
              <div className="form">
                {sug.groups
                  ? GROUPS.map(([key, label]) => {
                    const rows = sug.groups![key];
                    if (rows.length === 0) return null;
                    return (
                      <div key={key} className="form" data-testid={`group-${key}`}>
                        <div className="lab">{label}</div>
                        {rows.map((v) => <VehicleOption key={v.reg_no} v={v} name="nr-veh" checked={vehicle === v.reg_no} disabled={key === "in_garage"} onPick={() => setVehicle(v.reg_no)} />)}
                      </div>
                    );
                  })
                  : sug.vehicles.map((v) => <VehicleOption key={v.reg_no} v={v} name="nr-veh" checked={vehicle === v.reg_no} onPick={() => setVehicle(v.reg_no)} />)}
                {sug.vehicles.length === 0 && <Empty>No vehicles registered yet.</Empty>}
                <div className="field">
                  <label htmlFor="nr-driver-pick">Driver</label>
                  {custodianDrives
                    ? <p className="muted small" style={{ margin: 0 }} id="nr-driver-pick">{picked?.assigned_to} drives it (no driver needed).</p>
                    : (
                      <select id="nr-driver-pick" value={driver} onChange={(e) => setDriver(e.target.value)}>
                        <option value="">Pick a free driver</option>
                        {freeDrivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}
                      </select>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="acts">
          <button className={`btn ${books ? "" : "primary"}`} type="submit" disabled={busy}>{busy ? "Saving…" : books ? "Save as waiting" : "Save request"}</button>
          {books && <button type="button" className="btn primary" disabled={busy || !sug} onClick={() => void book()}>Book now</button>}
        </div>
      </form>
    </>
  );
}
