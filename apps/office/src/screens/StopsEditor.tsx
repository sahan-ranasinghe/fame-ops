// The stops as rows on the page: each with its own type (Pickup / Drop-off /
// Visit), the place (the location search box of Part 4: our places and sites,
// the places used before, the map, a pasted pin; free text still works for a
// town or an address), the arrive-by time, and under "Details" what is
// carried, the minutes there, a pin and a note for the driver; add, remove,
// move up and down. Rows are numbered within their type; a change to one row
// never changes another row's type.
import { useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { Icon } from "../ui/icons";
import { LocationSearch } from "../ui/LocationSearch";
import { pinText } from "../ui/locationLogic";
import { moveStop, newStop, type StopDraft, type StopType, stopLabel, TYPE_LABEL, type What, WHAT_LABEL } from "./stopsLogic";

export function StopsRows({ list, onChange, idPrefix = "st" }: { list: StopDraft[]; onChange: (list: StopDraft[]) => void; idPrefix?: string }) {
  const { me } = useFleet();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (i: number, patch: Partial<StopDraft>) => onChange(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggle = (key: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  return (
    <div className="form" data-testid="stops-editor">
      {list.map((s, i) => {
        const label = stopLabel(list, i);
        const details = open.has(s.key) || s.what !== "" || s.dwell !== "" || s.pin !== "" || s.note !== "";
        return (
          <div className="stop-card" key={s.key} data-testid="stop-row">
            <div className="stop-h">
              <b>{label}</b>
              <select aria-label={`${label}: type`} value={s.type} onChange={(e) => set(i, { type: e.target.value as StopType })}>
                {(Object.keys(TYPE_LABEL) as StopType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
              <div className="acts">
                <button type="button" className="btn small icon-btn" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onChange(moveStop(list, i, -1))}>↑</button>
                <button type="button" className="btn small icon-btn" aria-label={`Move ${label} down`} disabled={i === list.length - 1} onClick={() => onChange(moveStop(list, i, 1))}>↓</button>
                <button type="button" className="btn small icon-btn" aria-label={`Remove ${label}`} disabled={list.length === 1} onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            </div>
            <div className="stop-grid">
              <div className="field">
                <label htmlFor={`${idPrefix}-place-${s.key}`}>{label}</label>
                <LocationSearch id={`${idPrefix}-place-${s.key}`} value={s.place} placeholder={i === 0 ? "A place, a site id, a town, a Google Maps link" : "Place, site id, town, address or link"}
                  onText={(text) => set(i, { place: text, placeId: undefined, placePinned: undefined })}
                  onPick={(p) => set(i, { place: p.name, placeId: p.placeId, placePinned: p.placeId ? p.pinned : undefined, pin: !p.placeId && p.lat !== undefined && p.lng !== undefined ? pinText({ lat: p.lat, lng: p.lng }) : s.pin })} />
                {s.placeId && s.placePinned === false && (
                  <div className="sub bad-text" data-testid="no-pin-warning">
                    {s.place} has no pin — the plan skips this leg; {me.tools.includes("update_place") ? <Link to={`/places/${s.placeId}`}>set it on the place page</Link> : "ask the fleet admin to set it"}.
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-by-${s.key}`}>Arrive by</label>
                <input id={`${idPrefix}-by-${s.key}`} type="time" value={s.arriveBy} onChange={(e) => set(i, { arriveBy: e.target.value })} />
              </div>
            </div>
            {details ? (
              <div className="grid2">
                <div className="field"><label htmlFor={`${idPrefix}-what-${s.key}`}>What</label>
                  <select id={`${idPrefix}-what-${s.key}`} value={s.what} onChange={(e) => set(i, { what: e.target.value as What })}>
                    <option value="">—</option>
                    {(Object.keys(WHAT_LABEL) as Exclude<What, "">[]).map((w) => <option key={w} value={w}>{WHAT_LABEL[w]}</option>)}
                  </select></div>
                <div className="field"><label htmlFor={`${idPrefix}-dwell-${s.key}`}>Minutes there</label>
                  <input id={`${idPrefix}-dwell-${s.key}`} type="number" min={0} max={1440} inputMode="numeric" placeholder="default" value={s.dwell} onChange={(e) => set(i, { dwell: e.target.value })} /></div>
                <div className="field"><label htmlFor={`${idPrefix}-pin-${s.key}`}>Pin (lat, lng)</label>
                  <input id={`${idPrefix}-pin-${s.key}`} placeholder="optional, e.g. 6.9344, 79.8428" value={s.pin} onChange={(e) => set(i, { pin: e.target.value })} /></div>
                <div className="field"><label htmlFor={`${idPrefix}-note-${s.key}`}>Note for the driver</label>
                  <input id={`${idPrefix}-note-${s.key}`} maxLength={300} value={s.note} onChange={(e) => set(i, { note: e.target.value })} /></div>
              </div>
            ) : (
              <button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => toggle(s.key)}>Details: what, minutes there, pin, note</button>
            )}
          </div>
        );
      })}
      <div className="acts">
        <button type="button" className="btn" onClick={() => onChange([...list, newStop(list.length ? "drop" : "pickup")])}><Icon name="plus" />Add stop</button>
      </div>
    </div>
  );
}
