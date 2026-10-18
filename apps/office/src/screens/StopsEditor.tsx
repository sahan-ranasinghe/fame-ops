// The stops as rows on the page: each with its own type (Pickup / Drop-off /
// Visit), the place (the location search box of Part 4: our places and sites,
// the places used before, the map, a pasted pin; free text still works for a
// town or an address), the arrive-by time and the time at the stop (always
// visible, Phase 7 §17), and under "Details" what is carried, a pin and a note
// for the driver; add, remove, move up and down. Rows are named by their place
// in the order ("Stop 2 · Drop · Kurunegala site"; the start is Stop 1 when
// passengers get in there); a change to one row never changes another row's
// type. A first pickup at the start says so, with Tick it.
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { Icon } from "../ui/icons";
import { LocationSearch } from "../ui/LocationSearch";
import { pinText } from "../ui/locationLogic";
import { TimeInput } from "../ui/TimeInput";
import { type DwellFallback, DwellPicker } from "./DwellPicker";
import { moveStop, newStop, pickupAtStart, type StartPoint, type StopDraft, stopLabel, stopNumber, type StopType, TYPE_LABEL, type What, WHAT_LABEL } from "./stopsLogic";

export function StopsRows({ list, onChange, idPrefix = "st", offset = 0, fallbacks, start, startIsStop = false, onTickStart, note }: {
  list: StopDraft[];
  onChange: (list: StopDraft[]) => void;
  idPrefix?: string;
  /** Stops before these rows (the start stop, stops already reached): the numbers follow the task's. */
  offset?: number;
  /** Each row's first time at the stop (the place's usual time, else the default), by row key. */
  fallbacks?: Map<string, DwellFallback>;
  /** Where the trip starts: a first pickup there says "Same as the start" with Tick it. */
  start?: StartPoint | null;
  startIsStop?: boolean;
  onTickStart?: (i: number) => void;
  /** A line under a row's arrive-by (the departure check). */
  note?: (s: StopDraft, i: number) => ReactNode;
}) {
  const { me } = useFleet();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const set = (i: number, patch: Partial<StopDraft>) => onChange(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggle = (key: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });
  const atStart = onTickStart ? pickupAtStart(list, start, startIsStop) : -1;
  return (
    <div className="form" data-testid="stops-editor">
      {list.map((s, i) => {
        const num = stopNumber(i, offset);
        const details = open.has(s.key) || s.what !== "" || s.pin !== "" || s.note !== "";
        return (
          <div className="stop-card" key={s.key} data-testid="stop-row">
            <div className="stop-h">
              <b data-testid="stop-label">{stopLabel(list, i, offset)}</b>
              <select aria-label={`${num}: type`} value={s.type} onChange={(e) => set(i, { type: e.target.value as StopType })}>
                {(Object.keys(TYPE_LABEL) as StopType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
              <div className="acts">
                <button type="button" className="btn small icon-btn" aria-label={`Move ${num} up`} disabled={i === 0} onClick={() => onChange(moveStop(list, i, -1))}>↑</button>
                <button type="button" className="btn small icon-btn" aria-label={`Move ${num} down`} disabled={i === list.length - 1} onClick={() => onChange(moveStop(list, i, 1))}>↓</button>
                <button type="button" className="btn small icon-btn" aria-label={`Remove ${num}`} disabled={list.length === 1} onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            </div>
            <div className="stop-grid">
              <div className="field">
                <label htmlFor={`${idPrefix}-place-${s.key}`}>{num}</label>
                <LocationSearch id={`${idPrefix}-place-${s.key}`} value={s.place} google placeholder={i === 0 ? "A place, a site id, a town, a Google Maps link" : "Place, site id, town, address or link"}
                  onText={(text) => set(i, { place: text, placeId: undefined, placePinned: undefined, googlePlaceId: undefined, lat: undefined, lng: undefined })}
                  onPick={(p) => set(i, p.googlePlaceId
                    // A Google place: its pin stays Google's (the server's, kept 30 days), never typed into the pin field.
                    ? { place: p.name, placeId: undefined, placePinned: undefined, googlePlaceId: p.googlePlaceId, pin: "", lat: undefined, lng: undefined }
                    : { place: p.name, placeId: p.placeId, placePinned: p.placeId ? p.pinned : undefined, googlePlaceId: undefined, lat: p.lat, lng: p.lng, pin: !p.placeId && p.lat !== undefined && p.lng !== undefined ? pinText({ lat: p.lat, lng: p.lng }) : s.pin })} />
                {s.googlePlaceId && <div className="sub" data-testid="google-stop">Google place: its pin is Google's, kept 30 days</div>}
                {s.placeId && s.placePinned === false && (
                  <div className="sub" style={{ color: "var(--bad)" }} data-testid="no-pin-warning">
                    {s.place} has no pin — the plan skips this leg; {me.tools.includes("update_place") ? <Link to={`/places/${s.placeId}`}>set it on the place page</Link> : "ask the fleet admin to set it"}.
                  </div>
                )}
                {i === atStart && (
                  <div className="sub" data-testid="same-as-start" style={{ color: "var(--warn)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>Same as the start. Tick ‘Passengers get in here’ instead.</span>
                    <button type="button" className="btn small" onClick={() => onTickStart?.(i)}>Tick it</button>
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-by-${s.key}`}>Arrive by</label>
                <TimeInput id={`${idPrefix}-by-${s.key}`} value={s.arriveBy} onCommit={(arriveBy) => set(i, { arriveBy })} />
                {note?.(s, i)}
              </div>
            </div>
            <DwellPicker id={`${idPrefix}-dwell-${s.key}`} value={s.dwell} fallback={fallbacks?.get(s.key) ?? null} onChange={(dwell) => set(i, { dwell })} />
            {details ? (
              <div className="grid2">
                <div className="field"><label htmlFor={`${idPrefix}-what-${s.key}`}>What</label>
                  <select id={`${idPrefix}-what-${s.key}`} value={s.what} onChange={(e) => set(i, { what: e.target.value as What })}>
                    <option value="">—</option>
                    {(Object.keys(WHAT_LABEL) as Exclude<What, "">[]).map((w) => <option key={w} value={w}>{WHAT_LABEL[w]}</option>)}
                  </select></div>
                <div className="field"><label htmlFor={`${idPrefix}-pin-${s.key}`}>Pin (lat, lng)</label>
                  <input id={`${idPrefix}-pin-${s.key}`} placeholder="optional, e.g. 6.9344, 79.8428" value={s.pin} onChange={(e) => set(i, { pin: e.target.value, lat: undefined, lng: undefined })} /></div>
                <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${idPrefix}-note-${s.key}`}>Note for the driver</label>
                  <input id={`${idPrefix}-note-${s.key}`} maxLength={300} value={s.note} onChange={(e) => set(i, { note: e.target.value })} /></div>
              </div>
            ) : (
              <button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => toggle(s.key)}>Details: what, pin, note</button>
            )}
          </div>
        );
      })}
      <div className="acts">
        <button type="button" className="btn" onClick={() => onChange([...list, newStop(list.length || startIsStop ? "drop" : "pickup")])}><Icon name="plus" />Add stop</button>
      </div>
    </div>
  );
}
