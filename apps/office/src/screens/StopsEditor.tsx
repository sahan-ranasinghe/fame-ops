// The stops as rows on the page. Fix B (29 October 2026): From / To / Add stop, Uber's and Google Maps' route form. One
// route card: a vertical line joins From (the start: the form gives it as `from`), the stops in order and To (the last
// row). Each row is the place (the location search box of Part 4: our places and sites, the places used before, the map,
// Google, a pasted pin; free text still works for a town or an address) with a drag handle, a small line under it with
// its name by its place in the order ("Stop 2 · Visit · Kalutara": the type follows the row's place until it is chosen),
// ⋯ Options and ✕. ⋯ Options (the site's one sheet, docs/ui-patterns.md §6: a bottom sheet on a phone, a popover on a
// desktop) holds what happens there (People get in / People get out / Visit · wait / Goods), the stay, the arrive-by time
// and, under More details, what is carried, a pin and a note for the driver, with Move up / Move down for the keyboard and
// screen readers. What is set shows on the row ("Arrive by 09:30 · Stay 15 min"). + Add stop puts a row before To; ✕ on
// To makes the row before it To. A first pickup at the start says so, with Tick it. The rules: stopsLogic.ts.
import { type DragEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { joinDots } from "../lib/format";
import { Icon } from "../ui/icons";
import { LocationSearch } from "../ui/LocationSearch";
import { pinText } from "../ui/locationLogic";
import { ChoiceChip } from "../ui/Select";
import { Sheet } from "../ui/Sheet";
import { TimeField } from "../ui/TimeField";
import { type DwellFallback, DwellPicker } from "./DwellPicker";
import {
  addStop, dwellText, moveStopTo, parseDwell, pickupAtStart, removeStop, roleOf, START_ROLES, type StartFields, type StartPoint, type StartRole,
  startRoleOf, type StopDraft, stopLabel, stopNumber, type StopRole, STOP_ROLES, type What, WHAT_LABEL, withRole, withStartRole,
} from "./stopsLogic";

/** What happens at a stop, in the words of ⋯ Options. */
export const ROLE_WORD: Record<StopRole, string> = { in: "People get in", out: "People get out", visit: "Visit · wait", goods: "Goods" };
/** What happens at the start, in the words of From's ⋯ Options. */
export const START_ROLE_WORD: Record<StartRole, string> = { leave: "Leave from here", in: "People get in", goods: "Goods" };

/** The row's options that are set, in one line ("People get in · Arrive by 09:30 · Stay 15 min"); "" when none. */
export function stopSummary(s: StopDraft): string {
  const dwell = parseDwell(s.dwell);
  return joinDots([
    s.typeSet ? ROLE_WORD[roleOf(s)] : "",
    s.arriveBy ? `Arrive by ${s.arriveBy}` : "",
    typeof dwell === "number" ? `Stay ${dwellText(dwell)}` : "",
    s.what === "documents" || s.what === "other" ? WHAT_LABEL[s.what] : "",
    s.pin.trim() ? "Pin" : "",
    s.note.trim() ? "Note for the driver" : "",
  ]);
}

/** The ⋯ button that opens a row's options. */
function OptionsButton({ btn, name, onClick }: { btn: RefObject<HTMLButtonElement | null>; name: string; onClick: () => void }) {
  return (
    <button ref={btn} type="button" className="btn small icon-btn" aria-label={`Options for ${name}`} aria-haspopup="dialog" title="Options" onClick={onClick}>
      <Icon name="more" />
    </button>
  );
}

export function StopsRows({ list, onChange, idPrefix = "st", offset = 0, fallbacks, start, startIsStop = false, onTickStart, note, from, after }: {
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
  /** The From row: the start (StartFrom), first on the line. */
  from?: ReactNode;
  /** Under the line, after + Add stop: "Then back to the office" and No expressway. */
  after?: ReactNode;
}) {
  const [optsFor, setOptsFor] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const atStart = onTickStart ? pickupAtStart(list, start, startIsStop) : -1;

  // + Add stop opens the new row's search box.
  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`${idPrefix}-place-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, idPrefix]);

  const add = () => {
    const r = addStop(list);
    onChange(r.list);
    setFocusKey(r.key);
  };
  // Drag by the handle (HTML5 drag and drop): the row lands where it is dropped; Move up / down in ⋯ Options do the same.
  const drop = (to: number) => {
    const fromIndex = dragFrom.current;
    dragFrom.current = null;
    setOver(null);
    if (fromIndex !== null && fromIndex !== to) onChange(moveStopTo(list, fromIndex, to));
  };

  return (
    <div className="route-card" data-testid="stops-editor">
      <ol className="route-line">
        {from && <li className="route-row" data-kind="from" data-testid="route-from">{from}</li>}
        {list.map((s, i) => (
          <StopRow key={s.key} list={list} i={i} onChange={onChange} idPrefix={idPrefix} offset={offset} fallback={fallbacks?.get(s.key) ?? null}
            sameAsStart={i === atStart} onTickStart={onTickStart} note={note} open={optsFor === s.key} setOpen={(o) => setOptsFor(o ? s.key : null)}
            over={over === i}
            drag={{
              start: (ev) => {
                dragFrom.current = i;
                ev.dataTransfer?.setData("text/plain", s.key);
                if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
              },
              over: (ev) => {
                if (dragFrom.current === null) return;
                ev.preventDefault();
                if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
                setOver(i);
              },
              drop: (ev) => {
                ev.preventDefault();
                drop(i);
              },
              end: () => {
                dragFrom.current = null;
                setOver(null);
              },
            }} />
        ))}
      </ol>
      <div className="route-add">
        <button type="button" className="btn small" onClick={add}><Icon name="plus" />Add stop</button>
      </div>
      {after && <div className="route-after">{after}</div>}
    </div>
  );
}

interface DragHandlers {
  start: (ev: DragEvent) => void;
  over: (ev: DragEvent) => void;
  drop: (ev: DragEvent) => void;
  end: () => void;
}

function StopRow({ list, i, onChange, idPrefix, offset, fallback, sameAsStart, onTickStart, note, open, setOpen, over, drag }: {
  list: StopDraft[];
  i: number;
  onChange: (list: StopDraft[]) => void;
  idPrefix: string;
  offset: number;
  fallback: DwellFallback | null;
  sameAsStart: boolean;
  onTickStart?: (i: number) => void;
  note?: (s: StopDraft, i: number) => ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
  over: boolean;
  drag: DragHandlers;
}) {
  const { me } = useFleet();
  const btn = useRef<HTMLButtonElement>(null);
  const s = list[i];
  const last = i === list.length - 1;
  const num = stopNumber(i, offset);
  // The row's name in the buttons and its label: To for the last row, else its number.
  const name = last ? "To" : num;
  const set = (patch: Partial<StopDraft>) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const summary = stopSummary(s);
  const after = note?.(s, i);
  return (
    <li className={`route-row${over ? " is-over" : ""}`} data-kind={last ? "to" : "stop"} data-mark={last ? undefined : String(offset + i + 1)} data-testid="stop-row"
      onDragOver={drag.over} onDrop={drag.drop}>
      <label className="route-lab" htmlFor={`${idPrefix}-place-${s.key}`}>{name}</label>
      <div className="route-field">
        {list.length > 1 && (
          // The handle is for the mouse; the keyboard and screen readers move a row with Move up / Move down in ⋯ Options.
          <span className="route-grip" draggable aria-hidden="true" title={`Drag ${name} to move it (or Move up / Move down in Options)`}
            onDragStart={drag.start} onDragEnd={drag.end} data-testid="stop-grip">
            <i /><i /><i />
          </span>
        )}
        <div className="grow">
          <LocationSearch id={`${idPrefix}-place-${s.key}`} value={s.place} google placeholder={last ? "Where to? A place, site id, town, address or link" : "Place, site id, town, address or link"}
            onText={(text) => set({ place: text, placeId: undefined, placePinned: undefined, googlePlaceId: undefined, lat: undefined, lng: undefined })}
            onPick={(p) => set(p.googlePlaceId
              // A Google place: its pin stays Google's (the server's, kept 30 days), never typed into the pin field.
              ? { place: p.name, placeId: undefined, placePinned: undefined, googlePlaceId: p.googlePlaceId, pin: "", lat: undefined, lng: undefined }
              : { place: p.name, placeId: p.placeId, placePinned: p.placeId ? p.pinned : undefined, googlePlaceId: undefined, lat: p.lat, lng: p.lng, pin: !p.placeId && p.lat !== undefined && p.lng !== undefined ? pinText({ lat: p.lat, lng: p.lng }) : s.pin })} />
        </div>
        <OptionsButton btn={btn} name={name} onClick={() => setOpen(!open)} />
        {list.length > 1 && (
          <button type="button" className="btn small icon-btn" aria-label={`Remove ${name}`} onClick={() => onChange(removeStop(list, i))}><Icon name="close" /></button>
        )}
      </div>
      <span className="route-cap" data-testid="stop-label">{stopLabel(list, i, offset)}</span>
      {summary && <button type="button" className="linkish route-sum" data-testid="stop-summary" onClick={() => setOpen(true)}>{summary}</button>}
      {s.googlePlaceId && <div className="sub" data-testid="google-stop">Google place: its pin is Google's, kept 30 days</div>}
      {s.placeId && s.placePinned === false && (
        <div className="sub" style={{ color: "var(--bad)" }} data-testid="no-pin-warning">
          {s.place} has no pin — the plan skips this leg; {me.tools.includes("update_place") ? <Link to={`/places/${s.placeId}`}>set it on the place page</Link> : "ask the fleet admin to set it"}.
        </div>
      )}
      {sameAsStart && (
        <div className="sub" data-testid="same-as-start" style={{ color: "var(--warn)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Same as the start. Make it From’s ‘People get in’ instead.</span>
          <button type="button" className="btn small" onClick={() => onTickStart?.(i)}>Tick it</button>
        </div>
      )}
      {/* The departure check under the row while its options are closed (inside them, under Arrive by, when open). */}
      {!open && after}
      <StopOptions open={open} onClose={() => setOpen(false)} anchor={btn} list={list} i={i} onChange={onChange} idPrefix={idPrefix} offset={offset} fallback={fallback} note={after} />
    </li>
  );
}

/** A row's ⋯ Options: what happens there, the stay, the arrive-by, More details (what, pin, note), Move up / Move down. */
function StopOptions({ open, onClose, anchor, list, i, onChange, idPrefix, offset, fallback, note }: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  list: StopDraft[];
  i: number;
  onChange: (list: StopDraft[]) => void;
  idPrefix: string;
  offset: number;
  fallback: DwellFallback | null;
  note?: ReactNode;
}) {
  const s = list[i];
  const [more, setMore] = useState(false);
  if (!open || !s) return null;
  const set = (patch: Partial<StopDraft>) => onChange(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const role = roleOf(s);
  const details = more || s.what === "documents" || s.what === "other" || s.pin !== "" || s.note !== "";
  return (
    <Sheet open onClose={onClose} anchor={anchor} width={380} title={`${stopLabel(list, i, offset)} · Options`} testId="stop-options"
      footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
      <div className="form">
        <div className="field">
          <span className="lab" id={`${idPrefix}-role-${s.key}`}>What happens there</span>
          <div className="chips" role="group" aria-labelledby={`${idPrefix}-role-${s.key}`}>
            {STOP_ROLES.map((r) => <ChoiceChip key={r} selected={role === r} onClick={() => set(withRole(s, r))}>{ROLE_WORD[r]}</ChoiceChip>)}
          </div>
        </div>
        <DwellPicker id={`${idPrefix}-dwell-${s.key}`} value={s.dwell} fallback={fallback} onChange={(dwell) => set({ dwell })} />
        <div className="field">
          <label htmlFor={`${idPrefix}-by-${s.key}`}>Arrive by</label>
          <TimeField id={`${idPrefix}-by-${s.key}`} value={s.arriveBy} onCommit={(arriveBy) => set({ arriveBy })} />
          {note}
        </div>
        {details ? (
          <div className="grid2" data-testid="stop-more">
            <div className="field"><label htmlFor={`${idPrefix}-what-${s.key}`}>What carried</label>
              <select id={`${idPrefix}-what-${s.key}`} value={s.what} onChange={(e) => set({ what: e.target.value as What })}>
                <option value="">—</option>
                {(Object.keys(WHAT_LABEL) as Exclude<What, "">[]).map((w) => <option key={w} value={w}>{WHAT_LABEL[w]}</option>)}
              </select></div>
            <div className="field"><label htmlFor={`${idPrefix}-pin-${s.key}`}>Pin (lat, lng)</label>
              <input id={`${idPrefix}-pin-${s.key}`} placeholder="optional, e.g. 6.9344, 79.8428" value={s.pin} onChange={(e) => set({ pin: e.target.value, lat: undefined, lng: undefined })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`${idPrefix}-note-${s.key}`}>Note for the driver</label>
              <input id={`${idPrefix}-note-${s.key}`} maxLength={300} value={s.note} onChange={(e) => set({ note: e.target.value })} /></div>
          </div>
        ) : (
          <button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => setMore(true)}>More details: what carried, pin, note</button>
        )}
        {list.length > 1 && (
          <div className="acts">
            <button type="button" className="btn small" disabled={i === 0} onClick={() => onChange(moveStopTo(list, i, i - 1))}>Move up</button>
            <button type="button" className="btn small" disabled={i === list.length - 1} onClick={() => onChange(moveStopTo(list, i, i + 1))}>Move down</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * From's ⋯ Options: Leave from here (the start only) / People get in / Goods; with People get in or Goods the start is
 * Stop 1, a pickup, with what gets in, the note at the start and its stay (Tick it moves them here from the pickup).
 */
export function StartOptions({ id, value, onChange, name }: {
  id: string;
  value: Pick<StartFields, "startPax" | "startWhat" | "startNote" | "startDwell">;
  onChange: (patch: Partial<StartFields>) => void;
  /** The start's name, for the sheet's title. */
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const role = startRoleOf(value);
  return (
    <>
      <OptionsButton btn={btn} name="From" onClick={() => setOpen((o) => !o)} />
      <Sheet open={open} onClose={() => setOpen(false)} anchor={btn} width={380} title={`From · ${name || "the start"} · Options`} testId="start-options"
        footer={<button type="button" className="btn primary" onClick={() => setOpen(false)}>Done</button>}>
        <div className="form">
          <div className="field">
            <span className="lab" id={`${id}-role`}>What happens there</span>
            <div className="chips" role="group" aria-labelledby={`${id}-role`}>
              {START_ROLES.map((r) => <ChoiceChip key={r} selected={role === r} onClick={() => onChange(withStartRole(value, r))}>{START_ROLE_WORD[r]}</ChoiceChip>)}
            </div>
          </div>
          {value.startPax && (
            <>
              <div className="grid2">
                <div className="field">
                  <label htmlFor={`${id}-what`}>What gets in</label>
                  <select id={`${id}-what`} value={value.startWhat ?? ""} onChange={(e) => onChange({ startWhat: e.target.value as StartFields["startWhat"] })}>
                    <option value="">People</option>
                    {Object.entries(WHAT_LABEL).filter(([k]) => k !== "people").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-note`}>Note at the start</label>
                  <input id={`${id}-note`} maxLength={300} value={value.startNote ?? ""} onChange={(e) => onChange({ startNote: e.target.value })} />
                </div>
              </div>
              <DwellPicker id={`${id}-dwell`} value={value.startDwell ?? ""} fallback={null} onChange={(text) => onChange({ startDwell: text })} />
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** A read-only stop on the line: its name, and what goes under it (times, a stay picker). */
export interface RouteLineStop {
  key: string;
  label: ReactNode;
  extra?: ReactNode;
}

/**
 * The same From → stops → To line, read only (the approval pages): From with the start's words, each stop by its name,
 * the last as To, and "Then back to the office" / "No expressway" under it when they apply. `offset`: the stops before
 * these (the start when people get in there).
 */
export function RouteLine({ from, stops, back, noExpressway, offset = 0, rowTestId = "route-stop", testId = "route-line" }: {
  from: ReactNode;
  stops: RouteLineStop[];
  back?: boolean;
  noExpressway?: boolean;
  offset?: number;
  rowTestId?: string;
  testId?: string;
}) {
  return (
    <div className="route-card is-read" data-testid={testId}>
      <ol className="route-line">
        <li className="route-row" data-kind="from"><span className="route-lab">From</span><span>{from}</span></li>
        {stops.map((s, i) => {
          const last = i === stops.length - 1;
          return (
            <li key={s.key} className="route-row" data-kind={last ? "to" : "stop"} data-mark={last ? undefined : String(offset + i + 1)} data-testid={rowTestId}>
              <span className="route-lab">{last ? "To" : stopNumber(i, offset)}</span>
              <b data-testid="stop-label">{s.label}</b>
              {s.extra}
            </li>
          );
        })}
      </ol>
      {(back || noExpressway) && (
        <p className="muted small route-after" style={{ margin: 0 }} data-testid="route-after">{joinDots([back ? "Then back to the office" : "", noExpressway ? "No expressway" : ""])}</p>
      )}
    </div>
  );
}
