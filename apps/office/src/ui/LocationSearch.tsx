// The location search box (Part 4): one box for a task's stops and start and a
// request's From and To. As the person types (300 ms after the last key, from
// 2 characters) it asks search_places and lists our places (offices, saved
// places, the Dialog and Mobitel sites), the places used before, then the map's
// public places (from 3 characters), each with its badge. A pasted "lat, lng"
// or Google Maps link (short links are resolved on the server) offers its pin.
// Picking a Map result or a pin shows it on a small map to confirm (drag the
// pin or type the numbers) and saves it as one of our places, so it is in the
// list next time. Free text stays allowed: the server still reads towns.
import { useEffect, useId, useRef, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { PastedPin, PlaceDetail, SearchAnswer, SearchResult } from "../data/types";
import { PinMap } from "../map/PinMap";
import type { FleetError } from "../transport/types";
import { errText } from "../transport/errors";
import { Pill } from "./basics";
import { badgeTone, DEBOUNCE_MS, inLanka, looksPasted, type Picked, pickedOf, shouldSearch } from "./locationLogic";

interface Confirming {
  name: string;
  lat: number;
  lng: number;
  from: "map" | "link" | "pin";
  ref?: string;
  attribution?: string;
  address?: string;
}

export function LocationSearch({ id, value, onText, onPick, placeholder, label }: {
  id: string;
  value: string;
  /** Every key: the text (a typed name is free text until a row is picked). */
  onText: (text: string) => void;
  /** A row was picked (and, for the map or a pin, saved). */
  onPick: (picked: Picked) => void;
  placeholder?: string;
  /** The accessible name when the field has no visible label. */
  label?: string;
}) {
  const { me, transport } = useFleet();
  const canSearch = me.tools.includes("search_places");
  const canSave = me.tools.includes("save_place");
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!canSearch || !typed.current) return;
    const text = value.trim();
    if (!shouldSearch(text)) {
      setAnswer(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      transport.call<SearchAnswer>("search_places", { text })
        .then((a) => {
          if (seq.current !== mine) return;
          setAnswer(a);
          setErr(null);
          setActive(-1);
          setOpen(true);
        })
        .catch((e) => { if (seq.current === mine) setErr(errText(e as FleetError)[0]); })
        .finally(() => { if (seq.current === mine) setBusy(false); });
    }, looksPasted(text) ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, canSearch, transport]);

  const pin = answer?.pin;
  const rows: (SearchResult | { layer: "pin"; pin: PastedPin })[] = [...(pin ? [{ layer: "pin" as const, pin }] : []), ...(answer?.results ?? [])];
  const credits = [...new Set((answer?.results ?? []).filter((r) => r.layer === "map" && r.attribution).map((r) => r.attribution!))];

  function choose(i: number) {
    const row = rows[i];
    if (!row) return;
    setOpen(false);
    typed.current = false;
    if (row.layer === "pin") {
      const looksLikeText = !looksPasted(value);
      setConfirming({ name: row.pin.name ?? (looksLikeText ? value.trim() : ""), lat: row.pin.lat, lng: row.pin.lng, from: row.pin.from === "link" ? "link" : "pin" });
      return;
    }
    if (row.layer === "map" && row.lat !== undefined && row.lng !== undefined) {
      setConfirming({ name: row.name, lat: row.lat, lng: row.lng, from: "map", ref: row.ref, attribution: row.attribution, address: row.detail });
      return;
    }
    onPick(pickedOf(row));
  }

  async function save() {
    if (!confirming) return;
    const name = confirming.name.trim();
    if (!name) return setErr("Give the place a name.");
    if (!canSave) {
      onPick({ name, lat: confirming.lat, lng: confirming.lng, pinned: true });
      setConfirming(null);
      return;
    }
    setSaving(true);
    try {
      const r = await transport.call<{ place: PlaceDetail; existing: boolean }>("save_place", {
        name, lat: confirming.lat, lng: confirming.lng, from: confirming.from,
        ...(confirming.address ? { address: confirming.address.slice(0, 240) } : {}),
        ...(confirming.ref ? { ref: confirming.ref } : {}),
        ...(confirming.attribution ? { attribution: confirming.attribution } : {}),
      });
      onPick({ name: r.place.name, placeId: r.place.id, lat: r.place.lat, lng: r.place.lng, pinned: true, badge: r.place.badge });
      setConfirming(null);
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? rows.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && canSearch && (rows.length > 0 || busy || !!err || !!answer?.map_note);
  return (
    <div className="ls" data-testid="location-search">
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={500}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { typed.current = true; setOpen(true); onText(e.target.value); }}
        onFocus={() => { if (answer) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {showList && (
        <ul className="ls-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {rows.map((row, i) => (
            <li key={row.layer === "pin" ? "pin" : `${row.layer}-${row.id ?? row.ref ?? row.name}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={`ls-row${i === active ? " on" : ""}`} onClick={() => choose(i)}>
              {row.layer === "pin" ? (
                <>
                  <div className="ls-main"><b>{row.pin.name ?? (row.pin.from === "link" ? "The place in the link" : "This pin")}</b><span className="sub mono">{row.pin.lat.toFixed(5)}, {row.pin.lng.toFixed(5)}</span></div>
                  <Pill tone="warn">{row.pin.from === "link" ? "Link" : "Pin"}</Pill>
                </>
              ) : (
                <>
                  <div className="ls-main"><b>{row.name}</b>{row.detail && <span className="sub">{row.detail}</span>}</div>
                  {!row.pinned && <Pill tone="bad">no pin</Pill>}
                  <Pill tone={badgeTone(row.badge)}>{row.badge}</Pill>
                </>
              )}
            </li>
          ))}
          {busy && rows.length === 0 && <li className="ls-note">Searching…</li>}
          {!busy && rows.length === 0 && !err && !answer?.map_note && <li className="ls-note">Nothing found. Keep typing, or paste a Google Maps link or "lat, lng".</li>}
          {answer?.map_note && <li className="ls-note" data-testid="map-note">{answer.map_note}</li>}
          {err && <li className="ls-note bad">{err}</li>}
          {credits.length > 0 && <li className="ls-credit">Map results: {credits.join(" · ")}</li>}
        </ul>
      )}
      {confirming && (
        <div className="ls-confirm card card-b" data-testid="pin-confirm">
          <div className="sub">{confirming.from === "map" ? "Check the pin, move it if needed, then save the place." : "Check the pin, name the place, then save it."}</div>
          <PinMap lat={confirming.lat} lng={confirming.lng} onMove={(lat, lng) => setConfirming((c) => (c ? { ...c, lat, lng } : c))} />
          <div className="grid2">
            <div className="field"><label htmlFor={`${id}-pin-name`}>Name</label>
              <input id={`${id}-pin-name`} maxLength={120} value={confirming.name} onChange={(e) => setConfirming({ ...confirming, name: e.target.value })} /></div>
            <div className="field"><label htmlFor={`${id}-pin-ll`}>Pin (lat, lng)</label>
              <input id={`${id}-pin-ll`} className="mono" value={`${confirming.lat.toFixed(6)}, ${confirming.lng.toFixed(6)}`} onChange={(e) => {
                const m = e.target.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
                if (m) setConfirming({ ...confirming, lat: Number(m[1]), lng: Number(m[2]) });
              }} /></div>
          </div>
          {!inLanka(confirming.lat, confirming.lng) && <div className="sub bad-text">This pin is outside Sri Lanka.</div>}
          {confirming.attribution && <div className="ls-credit">{confirming.attribution}</div>}
          <div className="acts">
            <button type="button" className="btn dark" disabled={saving} onClick={() => void save()}>{canSave ? "Save place" : "Use this pin"}</button>
            <button type="button" className="btn" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
