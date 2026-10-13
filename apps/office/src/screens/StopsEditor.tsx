// The stops editor, in the form dialog: every stop with its type, what is
// carried, the place (a saved place, a town or an address, with an optional
// pin), the minutes there, an arrive-by deadline and a note; add, remove,
// move up and down. Save hands the list back to the form that opened it.
import type { Place } from "../data/types";
import { Notice } from "../ui/basics";
import { DrawerTop, useDraft, useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { moveStop, newStop, type StopDraft, type StopType, stopLabel, stopsInput, TYPE_LABEL, type What, WHAT_LABEL } from "./stopsLogic";

export function StopsEditor({ stops, places, onSave, title = "Stops" }: { stops: StopDraft[]; places: Place[]; onSave: (stops: StopDraft[]) => void; title?: string }) {
  const drawer = useDrawer();
  const [list, setList, markClean] = useDraft<StopDraft[]>(stops.length ? stops : [newStop("pickup")]);
  const set = (i: number, patch: Partial<StopDraft>) => setList((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const check = stopsInput(list);
  const error = "error" in check ? check.error : null;

  function save() {
    if (error) return;
    markClean();
    onSave(list);
    drawer.close();
  }

  return (
    <>
      <DrawerTop title={title} sub="In the order the driver visits them" />
      <div className="form" data-testid="stops-editor">
        {list.map((s, i) => (
          <div className="card card-b stop-row" key={s.key}>
            <div className="row" style={{ padding: 0 }}>
              <b className="grow">{stopLabel(i, s.type, list.length)}</b>
              <div className="acts">
                <button type="button" className="btn small icon-btn" aria-label={`Move stop ${i + 1} up`} disabled={i === 0} onClick={() => setList((l) => moveStop(l, i, -1))}>↑</button>
                <button type="button" className="btn small icon-btn" aria-label={`Move stop ${i + 1} down`} disabled={i === list.length - 1} onClick={() => setList((l) => moveStop(l, i, 1))}>↓</button>
                <button type="button" className="btn small icon-btn" aria-label={`Remove stop ${i + 1}`} disabled={list.length === 1} onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Icon name="close" /></button>
              </div>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor={`st-type-${s.key}`}>Type</label>
                <select id={`st-type-${s.key}`} value={s.type} onChange={(e) => set(i, { type: e.target.value as StopType })}>
                  {(Object.keys(TYPE_LABEL) as StopType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select></div>
              <div className="field"><label htmlFor={`st-what-${s.key}`}>What</label>
                <select id={`st-what-${s.key}`} value={s.what} onChange={(e) => set(i, { what: e.target.value as What })}>
                  <option value="">—</option>
                  {(Object.keys(WHAT_LABEL) as Exclude<What, "">[]).map((w) => <option key={w} value={w}>{WHAT_LABEL[w]}</option>)}
                </select></div>
            </div>
            <div className="field"><label htmlFor={`st-place-${s.key}`}>Place</label>
              <input id={`st-place-${s.key}`} list="stops-places" maxLength={160} placeholder="Saved place, town or address" value={s.place} onChange={(e) => set(i, { place: e.target.value })} /></div>
            <div className="grid2">
              <div className="field"><label htmlFor={`st-pin-${s.key}`}>Pin (lat, lng)</label>
                <input id={`st-pin-${s.key}`} placeholder="optional, e.g. 6.9344, 79.8428" value={s.pin} onChange={(e) => set(i, { pin: e.target.value })} /></div>
              <div className="field"><label htmlFor={`st-dwell-${s.key}`}>Minutes there</label>
                <input id={`st-dwell-${s.key}`} type="number" min={0} max={1440} inputMode="numeric" placeholder="default" value={s.dwell} onChange={(e) => set(i, { dwell: e.target.value })} /></div>
              <div className="field"><label htmlFor={`st-by-${s.key}`}>Arrive by</label>
                <input id={`st-by-${s.key}`} type="time" value={s.arriveBy} onChange={(e) => set(i, { arriveBy: e.target.value })} /></div>
              <div className="field"><label htmlFor={`st-note-${s.key}`}>Note for the driver</label>
                <input id={`st-note-${s.key}`} maxLength={300} value={s.note} onChange={(e) => set(i, { note: e.target.value })} /></div>
            </div>
          </div>
        ))}
        <datalist id="stops-places">{places.map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setList((l) => [...l, newStop(l.length ? "drop" : "pickup")])}><Icon name="plus" />Add stop</button>
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="acts">
          <button type="button" className="btn primary" onClick={save} disabled={!!error}>Save stops</button>
          <button type="button" className="btn" onClick={drawer.requestClose}>Cancel</button>
        </div>
      </div>
    </>
  );
}
