// One place (/places/:id, Part 4): the name, the ids, region, district and
// depot, where the pin came from, the credit of a place saved from the map
// search, and the pin on a small map (dragged on the web, typed in both
// builds); Save → update_place. A pin set here is never replaced by an import.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { PlaceDetail } from "../data/types";
import { PinMap } from "../map/PinMap";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { badgeTone, inLanka, pinText } from "../ui/locationLogic";
import { PageTop } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { parsePin } from "./stopsLogic";
import { PLACES_CHANGED } from "./Places";

const PIN_FROM: Record<string, string> = {
  manual: "set by hand", dialog: "Dialog site list", mobitel_4g: "Mobitel 4G-LTE", mobitel_ep: "Mobitel EP list", ors: "the map search", link: "a Google Maps link", pin: "a typed or moved pin",
};

export function PlacePage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { me, transport } = useFleet();
  const toast = useToast();
  const canEdit = me.tools.includes("update_place");
  const [p, setP] = useState<PlaceDetail | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", address: "", district: "", depot: "", pin: "" });
  const [busy, setBusy] = useState(false);
  const backTo = `/places${params.toString() ? `?${params.toString()}` : ""}`;

  const fill = (x: PlaceDetail) => setF({ name: x.name, address: x.address ?? "", district: x.district ?? "", depot: x.depot ?? "", pin: x.lat != null && x.lng != null ? pinText({ lat: x.lat, lng: x.lng }) : "" });
  useEffect(() => {
    let alive = true;
    setP(null);
    transport.call<{ place: PlaceDetail; stops_90_days: number }>("place_detail", { id })
      .then((r) => { if (!alive) return; setP(r.place); setUsed(r.stops_90_days); fill(r.place); setErr(null); })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
  }, [id, transport]);

  if (err && !p) return <><PageTop title="Place" backTo={backTo} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Place" backTo={backTo} /><Loading>Loading the place…</Loading></>;
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
      const r = await transport.call<{ place: PlaceDetail }>("update_place", input);
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

  const shown = pin && pin !== "bad" ? pin : null;
  return (
    <div data-testid="place-page">
      <PageTop title={p.name} sub={[p.site_id, p.district].filter(Boolean).join(" · ") || undefined} backTo={backTo} />
      <div className="card card-b stack">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill tone={badgeTone(p.badge)}>{p.badge}</Pill>
          {p.lat == null ? <Pill tone="bad">no pin</Pill> : <Pill tone="ok">Pin from {PIN_FROM[p.pin_source ?? ""] ?? p.pin_source ?? "—"}</Pill>}
          {used != null && <span className="sub">{used ? `${used} stop${used > 1 ? "s" : ""} in the last 90 days` : "Not used in a task in the last 90 days"}</span>}
        </div>
        {p.other_ids?.length ? <div className="sub">Other ids: <span className="mono">{p.other_ids.join(", ")}</span></div> : null}
        {(p.region || p.depot) && <div className="sub">{[p.region && `Region ${p.region}`, p.depot && `Depot ${p.depot}`].filter(Boolean).join(" · ")}</div>}
        {shown ? <PinMap lat={shown.lat} lng={shown.lng} onMove={canEdit ? (lat, lng) => setF((x) => ({ ...x, pin: pinText({ lat, lng }) })) : undefined} />
          : <Notice tone="info">No pin yet: type "lat, lng", or paste them from Google Maps, and Save. The plan skips the legs to and from a place without a pin.</Notice>}
        {shown && !inLanka(shown.lat, shown.lng) && <div className="sub bad-text">This pin is outside Sri Lanka.</div>}
        {p.attribution && <div className="ls-credit">{p.attribution}</div>}
      </div>
      {canEdit ? (
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
    </div>
  );
}
