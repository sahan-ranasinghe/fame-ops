// One place (/places/:id, Part 4): the name, the ids, region, district and
// depot, where the pin came from, the credit of a place saved from the map
// search, and the pin on a small map (dragged on the web, typed in both
// builds); Save → update_place. A pin set here is never replaced by an import.
// Phase 7 (§15): Remove (Archive since Round 52, the same tool) with a second step on the page (no dialog; the
// server's reasons and tasks above Remove anyway), and a removed place's page
// read-only with Restore.
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { PinMap } from "../map/PinMap";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { badgeTone, inLanka, pinText } from "../ui/locationLogic";
import { PageTop, useAfterSave } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { parsePin } from "./stopsLogic";
import {
  placeActions, type PlaceDetailWithRemoved, type PlaceInUse, REMOVE_IDLE, removedLine, removedNotice, removeInput, removeStep, type RemovePlaceAnswer,
  type RemoveState, removeTasks, removeWords, taskLine,
} from "./placeRemoveLogic";
import { PLACES_CHANGED } from "./Places";
import { DeleteRecordCard } from "./bin/BinParts";
import { deletedToast } from "./bin/binLogic";

const PIN_FROM: Record<string, string> = {
  manual: "set by hand", dialog: "Dialog site list", mobitel_4g: "Mobitel 4G-LTE", mobitel_ep: "Mobitel EP list", ors: "the map search", link: "a Google Maps link", pin: "a typed or moved pin",
};

export function PlacePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { me, transport, store } = useFleet();
  const toast = useToast();
  const afterSave = useAfterSave();
  const [p, setP] = useState<PlaceDetailWithRemoved | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", address: "", district: "", depot: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const [rm, setRm] = useState<RemoveState>(REMOVE_IDLE);
  const [rmErr, setRmErr] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const backTo = `/places${params.toString() ? `?${params.toString()}` : ""}`;

  const fill = (x: PlaceDetailWithRemoved) => setF({ name: x.name, address: x.address ?? "", district: x.district ?? "", depot: x.depot ?? "", pin: x.lat != null && x.lng != null ? pinText({ lat: x.lat, lng: x.lng }) : "" });
  useEffect(() => {
    let alive = true;
    setP(null);
    setRm(REMOVE_IDLE);
    setRmErr(null);
    setRestored(false);
    transport.call<{ place: PlaceDetailWithRemoved; stops_90_days: number }>("place_detail", { id })
      .then((r) => { if (!alive) return; setP(r.place); setUsed(r.stops_90_days); fill(r.place); setErr(null); })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
  }, [id, transport]);
  // Restored (or removed) from the list while this page is open beside it: follow it, leaving a form being typed alone.
  const loaded = p !== null;
  const isRemoved = !!p?.removed;
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    const again = () => {
      transport.call<{ place: PlaceDetailWithRemoved }>("place_detail", { id })
        .then((r) => {
          if (!alive || !!r.place.removed === isRemoved) return;
          setP(r.place);
          fill(r.place);
          if (!r.place.removed) setRm(REMOVE_IDLE);
        })
        .catch(() => undefined);
    };
    window.addEventListener(PLACES_CHANGED, again);
    return () => { alive = false; window.removeEventListener(PLACES_CHANGED, again); };
  }, [id, transport, loaded, isRemoved]);

  if (err && !p) return <><PageTop title="Place" backTo={backTo} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Place" backTo={backTo} /><Loading>Loading the place…</Loading></>;
  const acts = placeActions(me.tools, !!p.removed, p.active === false);
  const pin = parsePin(f.pin);
  const changed = f.name !== p.name || f.address !== (p.address ?? "") || f.district !== (p.district ?? "") || f.depot !== (p.depot ?? "") ||
    f.pin !== (p.lat != null && p.lng != null ? pinText({ lat: p.lat, lng: p.lng }) : "");

  async function save() {
    if (!p) return;
    if (pin === "bad") return setErr('The pin must be "lat, lng", e.g. 6.9344, 79.8428.');
    setBusy(true);
    try {
      const input: Record<string, unknown> = { id: p.id };
      if (f.name.trim() && f.name !== p.name) input.name = f.name.trim();
      if (f.address !== (p.address ?? "")) input.address = f.address.trim();
      if (f.district !== (p.district ?? "")) input.district = f.district.trim();
      if (f.depot !== (p.depot ?? "")) input.depot = f.depot.trim();
      if (pin && (pin.lat !== p.lat || pin.lng !== p.lng)) Object.assign(input, { lat: pin.lat, lng: pin.lng });
      if (!pin && p.lat != null) input.clear_pin = true;
      const r = await transport.call<{ place: PlaceDetailWithRemoved }>("update_place", input);
      setP(r.place);
      fill(r.place);
      setErr(null);
      toast("Place saved");
      window.dispatchEvent(new Event(PLACES_CHANGED));
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  // The first click reads why removing would ask (place_detail's in_use, nothing written) and shows it above the second
  // button; the second removes (with confirm for what was shown); the server asks again only for reasons that came up since.
  async function remove() {
    if (!p) return;
    setBusy(true);
    setRmErr(null);
    if (rm.step === "idle") {
      const inUse = await transport.call<{ in_use?: PlaceInUse }>("place_detail", { id: p.id }).then((r) => r.in_use).catch(() => undefined);
      setRm(removeStep(rm, { type: "start", inUse }));
      setBusy(false);
      return;
    }
    try {
      const answer = await transport.call<RemovePlaceAnswer>("remove_place", removeInput(p.id, rm));
      setRm(removeStep(rm, { type: "answer", answer }));
      if (!answer.needs_confirm) {
        window.dispatchEvent(new Event(PLACES_CHANGED));
        void store.invalidate();
        // The page turns into the removed place's (Removed by … and Restore); "just now" if the reload fails.
        const again = await transport.call<{ place: PlaceDetailWithRemoved }>("place_detail", { id: p.id }).then((r) => r.place).catch(() => null);
        setP(again ?? { ...p, removed: "just now", active: false });
        if (again) fill(again);
      }
    } catch (e) {
      setRmErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!p) return;
    setBusy(true);
    setRmErr(null);
    try {
      const r = await transport.call<{ place: PlaceDetailWithRemoved }>("restore_place", { id: p.id });
      setP(r.place);
      fill(r.place);
      setRm(REMOVE_IDLE);
      setRestored(true);
      toast("Place restored");
      window.dispatchEvent(new Event(PLACES_CHANGED));
      void store.invalidate();
    } catch (e) {
      setRmErr(errText(e as FleetError)[0]);
    } finally {
      setBusy(false);
    }
  }

  const shown = pin && pin !== "bad" ? pin : null;
  const words = removeWords(p.name, rm);
  const notice = rm.step === "removed" ? removedNotice(rm.baseCleared, me.tools) : null;
  return (
    <div data-testid="place-page">
      <PageTop title={p.name} sub={[p.site_id, p.district].filter(Boolean).join(" · ") || undefined} backTo={backTo} />
      <div className="card card-b stack">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill tone={badgeTone(p.badge)}>{p.badge}</Pill>
          {p.removed && <Pill tone="bad">Archived</Pill>}
          {p.lat == null ? <Pill tone="bad">no pin</Pill> : <Pill tone="ok">Pin from {PIN_FROM[p.pin_source ?? ""] ?? p.pin_source ?? "—"}</Pill>}
          {used != null && <span className="sub">{used ? `${used} stop${used > 1 ? "s" : ""} in the last 90 days` : "Not used in a task in the last 90 days"}</span>}
        </div>
        {p.other_ids?.length ? <div className="sub">Other ids: <span className="mono">{p.other_ids.join(", ")}</span></div> : null}
        {(p.region || p.depot) && <div className="sub">{[p.region && `Region ${p.region}`, p.depot && `Depot ${p.depot}`].filter(Boolean).join(" · ")}</div>}
        {shown ? <PinMap lat={shown.lat} lng={shown.lng} onMove={acts.edit ? (lat, lng) => setF((x) => ({ ...x, pin: pinText({ lat, lng }) })) : undefined} />
          : <Notice tone="info">No pin yet: type "lat, lng", or paste them from Google Maps, and Save. The plan skips the legs to and from a place without a pin.</Notice>}
        {shown && !inLanka(shown.lat, shown.lng) && <div className="sub bad-text">This pin is outside Sri Lanka.</div>}
        {p.attribution && <div className="ls-credit">{p.attribution}</div>}
      </div>
      {notice && (
        <Notice tone="ok">
          {notice.text}
          {notice.base && <> {notice.base.link ? <Link to="/settings/fleet/office">{notice.base.text}</Link> : notice.base.text}</>}
        </Notice>
      )}
      {restored && !p.removed && <Notice tone="ok">Restored. It is back in the searches, lists and pickers.</Notice>}
      {p.removed && (
        <div className="card card-b stack" data-testid="place-removed">
          <div>
            <b>{removedLine(p.removed)}</b>
            <p className="muted small" style={{ margin: "4px 0 0" }}>It is left out of every search, list and picker. Past tasks keep its name.</p>
          </div>
          {rmErr && <Notice tone="bad">{rmErr}</Notice>}
          {acts.restore && <div><button type="button" className="btn dark" disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore"}</button></div>}
        </div>
      )}
      {acts.edit ? (
        <form className="card card-b form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="pl-name">Name</label><input id="pl-name" maxLength={160} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-pin">Pin (lat, lng)</label><input id="pl-pin" className="mono" placeholder="6.9344, 79.8428" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-address">Address</label><input id="pl-address" maxLength={240} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-district">District</label><input id="pl-district" maxLength={80} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></div>
            <div className="field"><label htmlFor="pl-depot">Depot</label><input id="pl-depot" maxLength={80} value={f.depot} onChange={(e) => setF({ ...f, depot: e.target.value })} /></div>
          </div>
          {err && <Notice tone="bad">{err}</Notice>}
          <div className="acts">
            <button className="btn dark" type="submit" disabled={busy || !changed}>Save</button>
            {p.lat != null && <button type="button" className="btn" disabled={busy} onClick={() => setF({ ...f, pin: "" })}>Remove the pin</button>}
          </div>
        </form>
      ) : <div className="card card-b sub">{p.address ?? ""}</div>}
      {acts.remove && words && (
        <div className="confirm" style={rm.step === "idle" ? { borderColor: "var(--line)" } : undefined} data-testid="place-remove">
          <div>
            <b>{words.title}</b>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{words.text}</p>
          </div>
          {removeTasks(rm).length > 0 && (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="place-remove-tasks">
              {removeTasks(rm).map((t) => (
                <li key={t.task_id}>{can(me, "assign_tasks") ? <Link to={`/tasks/${t.task_id}`}>{taskLine(t)}</Link> : taskLine(t)}</li>
              ))}
            </ul>
          )}
          {rmErr && <Notice tone="bad">{rmErr}</Notice>}
          <div className="acts">
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>{busy ? (rm.step === "idle" ? "Checking…" : "Archiving…") : words.button}</button>
            {words.keep && <button type="button" className="btn" disabled={busy} onClick={() => { setRm(removeStep(rm, { type: "cancel" })); setRmErr(null); }}>Keep it</button>}
          </div>
        </div>
      )}
      {/* Round 52 (§40): Delete permanently (users) only for a place no stop, start or request ever used: one confirm. */}
      <DeleteRecordCard key={`delete-${p.id}`} kind="place" refValue={p.id} fallback={backTo} onDeleted={(a) => {
        toast(deletedToast(a.until));
        window.dispatchEvent(new Event(PLACES_CHANGED));
        afterSave(backTo);
      }} />
    </div>
  );
}
