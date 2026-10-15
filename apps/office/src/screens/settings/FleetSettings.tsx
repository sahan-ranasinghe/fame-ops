// Settings → Fleet (the users permission): the dispatch defaults
// (docs/dispatch-plan.md, section 6) and the routing provider's usage.
import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useLists } from "../../data/hooks";
import type { FleetSettings as Values, PlaceWithId, RoutingUsage, SettingsResult } from "../../data/types";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Loading, Notice, Pill } from "../../ui/basics";
import { GenericTable } from "../../ui/GenericTable";
import { useToast } from "../../ui/Toast";

const DWELL_KEYS = ["pickup.people", "pickup.goods", "drop.people", "drop.goods", "visit", "documents", "default"];
const NUMBERS: [keyof Values, string, string][] = [
  ["buffer_min", "Buffer before a deadline (min)", "min"],
  ["avg_speed_kmh", "Estimate: average speed", "km/h"],
  ["road_factor", "Estimate: road factor (× straight line)", "×"],
  ["accept_within_min", "Accept within (min of receiving)", "min"],
  ["accept_before_leave_min", "Accept at the latest (min before leave-by)", "min"],
  ["ors_autocomplete_daily_cap", "Map search calls a day (the openrouteservice dashboard's autocomplete quota)", "calls"],
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function FleetSettings() {
  const { transport } = useFleet();
  const toast = useToast();
  const lists = useLists();
  const [data, setData] = useState<SettingsResult | null>(null);
  const [usage, setUsage] = useState<RoutingUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Values | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [s, u] = await Promise.all([transport.call<SettingsResult>("get_settings", {}), transport.call<RoutingUsage>("routing_usage", { days: 14 })]);
      setData(s);
      setDraft(s.settings);
      setUsage(u);
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save(key: keyof Values, value: unknown) {
    setBusy(key);
    try {
      await transport.call("update_settings", { key, value });
      toast("Setting saved");
      await load();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(null);
  }

  if (err && !data) return <section className="view"><div className="ph"><div><h1>Fleet settings</h1></div></div><Notice tone="bad">{err}</Notice></section>;
  if (!data || !draft) return <section className="view"><div className="ph"><div><h1>Fleet settings</h1></div></div><Loading>Loading settings…</Loading></section>;
  const places = ((lists.places ?? []) as PlaceWithId[]).filter((p) => p.maps);
  const changed = (key: keyof Values) => JSON.stringify(draft[key]) !== JSON.stringify(data.settings[key]);
  const num = (key: keyof Values) => (ev: FormEvent) => {
    ev.preventDefault();
    void save(key, draft[key]);
  };

  return (
    <section className="view" data-testid="fleet-settings">
      <div className="ph"><div><div className="eyebrow">Settings · dispatch defaults</div><h1>Fleet settings</h1></div></div>
      <div className="stack" style={{ maxWidth: 760 }}>
        {err && <Notice tone="bad">{err}</Notice>}
        {data.note && <Notice>{data.note}</Notice>}

        <form className="card card-b form" onSubmit={(ev) => { ev.preventDefault(); void save("base_place_id", draft.base_place_id); }}>
          <h2>Base place</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.base_place_id}. Only saved places with a map pin can be the base.</p>
          <div className="field">
            <label htmlFor="fs-base">Base place</label>
            <select id="fs-base" value={draft.base_place_id ?? ""} onChange={(e) => setDraft({ ...draft, base_place_id: e.target.value || null })}>
              <option value="">None (plans start from the first stop)</option>
              {data.base_place && !places.some((p) => p.id === data.base_place?.id) && <option value={data.base_place.id}>{data.base_place.name}</option>}
              {places.map((p) => p.id ? <option key={p.id} value={p.id}>{p.name}</option> : null)}
            </select>
            {!places.some((p) => p.id) && <span className="hint">The places list carries no ids yet: pick the base with the connector (update_settings base_place_id) until the next update.</span>}
          </div>
          <div><button className="btn dark" type="submit" disabled={busy !== null || !changed("base_place_id")}>Save</button></div>
        </form>

        <form className="card card-b form" onSubmit={(ev) => { ev.preventDefault(); void save("dwell_min", draft.dwell_min); }}>
          <h2>Minutes at a stop</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.dwell_min}. A stop's own minutes override these.</p>
          <div className="settings-grid">
            {DWELL_KEYS.map((k) => (
              <div className="field" key={k}>
                <label htmlFor={`fs-dwell-${k}`}>{k}</label>
                <input id={`fs-dwell-${k}`} type="number" min={0} max={1440} inputMode="numeric" value={draft.dwell_min[k] ?? ""} onChange={(e) => setDraft({ ...draft, dwell_min: { ...draft.dwell_min, [k]: e.target.value === "" ? 0 : parseInt(e.target.value, 10) } })} />
              </div>
            ))}
          </div>
          <div><button className="btn dark" type="submit" disabled={busy !== null || !changed("dwell_min")}>Save</button></div>
        </form>

        <form className="card card-b form" data-testid="shift-settings" onSubmit={(ev) => { ev.preventDefault(); void save("shift_start", draft.shift_start ?? "08:00").then(() => (JSON.stringify(draft.shift_days) !== JSON.stringify(data.settings.shift_days) ? save("shift_days", draft.shift_days ?? []) : undefined)); }}>
          <h2>Shift nudge in the driver app</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.shift_start}. {data.about.shift_days}.</p>
          <div className="grid2">
            <div className="field"><label htmlFor="fs-shift-start">Time</label><input id="fs-shift-start" type="time" value={draft.shift_start ?? "08:00"} onChange={(e) => setDraft({ ...draft, shift_start: e.target.value })} /></div>
            <div className="field"><span className="lab">Days</span>
              <div className="chips">
                {DAYS.map((d, i) => (
                  <label key={d} className="check"><input type="checkbox" checked={(draft.shift_days ?? []).includes(i)} onChange={(e) => setDraft({ ...draft, shift_days: e.target.checked ? [...new Set([...(draft.shift_days ?? []), i])].sort((a, b) => a - b) : (draft.shift_days ?? []).filter((x) => x !== i) })} /> {d}</label>
                ))}
              </div>
            </div>
          </div>
          <div className="acts"><button className="btn dark" type="submit" disabled={busy !== null || (!changed("shift_start") && !changed("shift_days"))}>Save</button></div>
        </form>

        <form className="card card-b form" data-testid="checklist-settings" onSubmit={(ev) => { ev.preventDefault(); void save("fuel_video_checklist", draft.fuel_video_checklist ?? []); }}>
          <h2>Fuel video steps</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.fuel_video_checklist}. The driver shows them in this order, ticking each to move on; Stop opens after the last one. The short word names the bookmark on the Fuel page.</p>
          {(draft.fuel_video_checklist ?? []).map((item, i, list) => {
            const setList = (next: typeof list) => setDraft({ ...draft, fuel_video_checklist: next });
            const patch = (p: Partial<typeof item>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
            const swap = (k: number) => {
              const next = [...list];
              const a = next[i];
              const b = next[k];
              if (!a || !b) return;
              next[i] = b;
              next[k] = a;
              setList(next);
            };
            return (
              <div className="grid2" key={i} data-testid="checklist-row">
                <div className="field"><label htmlFor={`fs-ck-en-${i}`}>Step {i + 1} · English</label>
                  <input id={`fs-ck-en-${i}`} maxLength={60} value={item.en} onChange={(e) => patch({ en: e.target.value, key: item.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) })} /></div>
                <div className="field"><label htmlFor={`fs-ck-si-${i}`}>Sinhala</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input id={`fs-ck-si-${i}`} maxLength={60} value={item.si} onChange={(e) => patch({ si: e.target.value })} style={{ flex: "1 1 160px" }} />
                    <input aria-label={`Short word ${i + 1}`} placeholder="Short word" maxLength={20} value={item.short ?? ""} onChange={(e) => patch({ short: e.target.value })} style={{ width: 110 }} />
                    <button type="button" className="btn small" aria-label={`Move up ${i + 1}`} disabled={i === 0} onClick={() => swap(i - 1)}>↑</button>
                    <button type="button" className="btn small" aria-label={`Move down ${i + 1}`} disabled={i === list.length - 1} onClick={() => swap(i + 1)}>↓</button>
                    <button type="button" className="btn small" aria-label={`Remove step ${i + 1}`} onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="acts">
            <button type="button" className="btn" disabled={(draft.fuel_video_checklist ?? []).length >= 8} onClick={() => setDraft({ ...draft, fuel_video_checklist: [...(draft.fuel_video_checklist ?? []), { key: "", en: "", si: "" }] })}>Add step</button>
            <button className="btn dark" type="submit" disabled={busy !== null || !changed("fuel_video_checklist")}>Save</button>
          </div>
        </form>

        <div className="card card-b form" data-testid="video-settings">
          <h2>Fuel video quality and storage</h2>
          <div className="grid2">
            <div className="field">
              <label htmlFor="fs-video-quality">Recording quality</label>
              <select id="fs-video-quality" value={draft.fuel_video_quality ?? "480p"} disabled={busy !== null} onChange={(e) => { const v = e.target.value as "480p" | "720p"; setDraft({ ...draft, fuel_video_quality: v }); void save("fuel_video_quality", v); }}>
                <option value="480p">480p · about 1.0 Mbps · a 5-minute fill is about 38 MB</option>
                <option value="720p">720p · about 1.5 Mbps · about 56 MB</option>
              </select>
              <span className="hint">{data.about.fuel_video_quality}</span>
            </div>
            <div className="field">
              <label htmlFor="fs-video-keep">Keep videos for</label>
              <select id="fs-video-keep" value={String(draft.fuel_video_keep_months ?? 12)} disabled={busy !== null} onChange={(e) => { const v = Number(e.target.value) as 6 | 12; setDraft({ ...draft, fuel_video_keep_months: v }); void save("fuel_video_keep_months", v); }}>
                <option value="12">12 months</option>
                <option value="6">6 months</option>
              </select>
              <span className="hint">{data.about.fuel_video_keep_months}. 12 vehicles × 8 fills a month at 480p is about 3.5 GB a month: 42 GB over 12 months, 21 GB over 6.</span>
            </div>
          </div>
        </div>

        <div className="card card-b form" data-testid="fleet-bookings">
          <h2>Bookings</h2>
          <label className="row" style={{ padding: 0, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.self_drive_allowed !== false} disabled={busy !== null} onChange={(e) => { setDraft({ ...draft, self_drive_allowed: e.target.checked }); void save("self_drive_allowed", e.target.checked); }} />
            <span className="grow"><span className="name">Self-drive bookings allowed</span><span className="sub" style={{ display: "block" }}>{data.about.self_drive_allowed}</span></span>
          </label>
        </div>

        <div className="card card-b form">
          <h2>Numbers</h2>
          {NUMBERS.map(([key, label, unit]) => (
            <form key={key} className="grid2" style={{ alignItems: "end" }} onSubmit={num(key)}>
              <div className="field">
                <label htmlFor={`fs-${key}`}>{label}</label>
                <input id={`fs-${key}`} type="number" step={key === "road_factor" ? 0.05 : 1} inputMode="decimal" value={draft[key] as number} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
                <span className="hint">{data.about[key]} ({unit}; default {String(data.defaults[key])})</span>
              </div>
              <div><button className="btn dark" type="submit" disabled={busy !== null || !changed(key)}>Save</button></div>
            </form>
          ))}
        </div>

        <form className="card card-b form" onSubmit={(ev) => { ev.preventDefault(); void save("rush_hour", draft.rush_hour); }}>
          <h2>Rush hour</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.rush_hour}</p>
          <div className="grid2">
            <div className="field"><label htmlFor="fs-rh-factor">Factor</label><input id="fs-rh-factor" type="number" step={0.05} min={1} max={3} value={draft.rush_hour.factor} onChange={(e) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, factor: Number(e.target.value) } })} /></div>
            <div className="field"><label htmlFor="fs-rh-radius">Radius around the centre (km)</label><input id="fs-rh-radius" type="number" min={1} max={500} value={draft.rush_hour.radius_km} onChange={(e) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, radius_km: Number(e.target.value) } })} /></div>
          </div>
          <span className="hint">Centre: {draft.rush_hour.centre.lat}, {draft.rush_hour.centre.lng} (Colombo Fort).</span>
          {draft.rush_hour.bands.map((b, i) => (
            <div className="card card-b stop-row" key={i}>
              <div className="grid2">
                <div className="field"><label htmlFor={`fs-b-from-${i}`}>From</label><input id={`fs-b-from-${i}`} type="time" value={b.from} onChange={(e) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) } })} /></div>
                <div className="field"><label htmlFor={`fs-b-to-${i}`}>To</label><input id={`fs-b-to-${i}`} type="time" value={b.to} onChange={(e) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) } })} /></div>
              </div>
              <div className="chips">
                {DAYS.map((d, day) => (
                  <button type="button" key={d} className="chip" aria-pressed={b.days.includes(day)} onClick={() => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.map((x, j) => (j === i ? { ...x, days: x.days.includes(day) ? x.days.filter((y) => y !== day) : [...x.days, day].sort() } : x)) } })}>{d}</button>
                ))}
                <button type="button" className="btn small" onClick={() => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.filter((_, j) => j !== i) } })}>Remove band</button>
              </div>
            </div>
          ))}
          <div className="acts">
            <button type="button" className="btn" onClick={() => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: [...draft.rush_hour.bands, { days: [1, 2, 3, 4, 5], from: "07:00", to: "09:30" }] } })}>Add band</button>
            <button className="btn dark" type="submit" disabled={busy !== null || !changed("rush_hour")}>Save</button>
          </div>
        </form>

        <div className="card card-b" style={{ display: "grid", gap: 10 }}>
          <div className="row" style={{ padding: 0 }}>
            <div className="grow"><h2>Routing</h2><p className="muted small" style={{ margin: "4px 0 0" }}>Road times come from the provider set in the Edge Function secret ROUTING_PROVIDER (with its key); without one every leg is an estimate.</p></div>
            <Pill tone={data.routing_provider === "estimate" ? "warn" : "ok"}>{data.routing_provider === "estimate" ? "estimate — no routing key" : data.routing_provider}</Pill>
          </div>
          {usage && (usage.days.length ? <GenericTable rows={usage.days} /> : <p className="muted small" style={{ margin: 0 }}>No routing calls in the last 14 days. openrouteservice's free plan allows 2,000 a day; the fleet stops at {usage.daily_budget.ors}.</p>)}
        </div>
      </div>
    </section>
  );
}
