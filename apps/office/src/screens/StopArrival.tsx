// A reached stop's arrival point (Part 5b): where the driver's own phone was when the stop was
// reached, from our location points (ours, kept for good). A reached Google stop can be saved as
// one of our places there, under a name the office types: never Google's name or address.
import { useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { PlaceDetail, Stop } from "../data/types";
import { joinDots } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { useToast } from "../ui/Toast";

export function StopArrival({ stop, onSaved }: { stop: Stop; onSaved: () => void }) {
  const { me, transport } = useFleet();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = stop.arrival;
  if (!a && !stop.saved_place) return null;
  const canSave = !!stop.id && !!stop.google && !!a && !stop.saved_place && me.tools.includes("save_arrival_place");

  async function save() {
    if (!stop.id || name.trim().length < 2) return setErr("Type a name for the place.");
    setBusy(true);
    try {
      const r = await transport.call<{ place: PlaceDetail; existing: boolean }>("save_arrival_place", { stop_id: stop.id, name: name.trim() });
      toast(`Saved as ${r.place.name}`);
      setOpen(false);
      setErr(null);
      onSaved();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }} data-testid="stop-arrival">
      {a && (
        <div className="sub">
          {joinDots([
            `the driver arrived${a.at ? ` ${a.at}` : ""}${a.near ? ` near ${a.near}` : ""}`,
            a.accuracy_m != null ? `phone ±${a.accuracy_m} m` : null,
          ])}
          {a.maps && <> · <a href={a.maps} target="_blank" rel="noopener">map</a></>}
        </div>
      )}
      {stop.saved_place && (
        <div className="sub">Saved as our place: <Link to={`/places/${stop.saved_place.id}`}>{stop.saved_place.name}</Link></div>
      )}
      {canSave && !open && (
        <div><button type="button" className="btn small" onClick={() => setOpen(true)}>Save as our place</button></div>
      )}
      {canSave && open && (
        <div className="grid2" style={{ alignItems: "end" }}>
          <div className="field">
            <label htmlFor={`arr-${stop.id}`}>Our name for this place</label>
            <input id={`arr-${stop.id}`} maxLength={120} value={name} placeholder="e.g. Kandy client office" onChange={(e) => setName(e.target.value)} />
            <span className="hint">Saved at the driver's arrival point. Google's name and address cannot be kept.</span>
          </div>
          <div className="acts">
            <button type="button" className="btn dark" disabled={busy} onClick={() => void save()}>Save</button>
            <button type="button" className="btn" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
          </div>
          {err && <div className="sub bad-text">{err}</div>}
        </div>
      )}
    </div>
  );
}
