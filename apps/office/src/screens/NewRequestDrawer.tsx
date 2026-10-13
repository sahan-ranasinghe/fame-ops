import { type FormEvent, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import { today } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import type { FleetError } from "../transport/types";
import { Notice } from "../ui/basics";
import { DrawerTop, useDraft, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { emptyRequest, validateNewRequest } from "./requestLogic";

export function NewRequestDrawer() {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const lists = useLists();
  // Someone who can neither approve nor assign asks in their own name (the server does the same).
  const staff = !can(me, "approve", "assign_tasks");
  const [f, setF, markClean] = useDraft(emptyRequest(today()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewRequest(f, staff ? me.name : undefined);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      await transport.call("create_request", v.input);
      markClean();
      toast("Request saved");
      drawer.close();
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <>
      <DrawerTop title="New vehicle request" sub={staff ? "Ask the fleet office for a vehicle" : "Someone needs a vehicle"} />
      <form className="card card-b form" onSubmit={submit} noValidate>
        {!staff && (
          <div className="field"><label htmlFor="nr-by">Who needs it</label><input id="nr-by" maxLength={120} value={f.by} onChange={(e) => set("by", e.target.value)} data-focus /></div>
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
          <div className="field" style={{ alignContent: "end" }}><span className="check"><input type="checkbox" id="nr-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="nr-tools">Tools or equipment go too</label></span></div>
        </div>
        <div className="field"><label htmlFor="nr-note">Note</label><textarea id="nr-note" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save request"}</button>
      </form>
    </>
  );
}
