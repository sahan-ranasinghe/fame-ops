// Settings → Fleet (the users permission): the dispatch defaults
// (docs/dispatch-plan.md, section 6) and the routing provider's usage.
// Phase 7: the time at a stop by type (pickup, drop, visit, any other) and the
// accept window with the driver's reminder (when it ends, the task needs a driver),
// and (§33) whether a task made without the approve permission waits for an approver; (§13) whether a driver may
// mark a trip they start in the app as personal (driver_personal_trips).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useLists } from "../../data/hooks";
import type { FleetSettings as Values, PlaceWithId, RoutingUsage, SettingsResult } from "../../data/types";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Loading, Notice, Pill } from "../../ui/basics";
import { phoneDisplay } from "../../ui/ContactButtons";
import { GenericTable } from "../../ui/GenericTable";
import { useToast } from "../../ui/Toast";
import { PERSONAL_TRIPS_OPTIONS, personalTripsValue } from "../tripPurposeLogic";
import { officePhoneValue, privacyEmailValue, samePhone } from "./profileLogic";
import { duration } from "@fleet/durations";
import { TimeField } from "../../ui/TimeField";

/** The time at a stop by its type (Phase 7, §17); "default" is any other. */
const DWELL_KEYS: [string, string][] = [["pickup", "Pickup"], ["drop", "Drop"], ["visit", "Visit"], ["default", "Any other"]];
type NumberRow = [keyof Values, string, string];
/** The accept window (Phase 7, §19) and the driver's one reminder. */
const ACCEPT: NumberRow[] = [
  ["accept_within_min", "Accept within (min after sending)", "min"],
  ["accept_before_leave_min", "Accept at the latest (min before leaving)", "min"],
  ["accept_reminder_min", "Reminder to the driver (min after sending)", "min"],
];
/** Used when an older server sends no default for a key. */
const FALLBACK: Partial<Record<keyof Values, number>> = { accept_within_min: 15, accept_before_leave_min: 30, accept_reminder_min: 5 };
const NUMBERS: NumberRow[] = [
  ["buffer_min", "Buffer before a deadline (min)", "min"],
  ["avg_speed_kmh", "Estimate: average speed", "km/h"],
  ["road_factor", "Estimate: road factor (× straight line)", "×"],
  ["ors_autocomplete_daily_cap", "Map search calls a day (under the openrouteservice Geocoding quota, shared with search and reverse)", "calls"],
  ["ors_autocomplete_per_minute", "Map search calls a minute (the dashboard allows 100)", "calls"],
  ["ors_gap_daily_cap", "Estimated lines over GPS gaps: new ones a day (openrouteservice, inside the 1,900 road-time calls)", "calls"],
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
  // The settings as the server last answered: a draft key that differs from them is being edited.
  const server = useRef<Values | null>(null);
  // Hotfix 2 (F): the office's number as typed (null = as saved, shown 011 234 5678) and what is wrong with it.
  const [officePhone, setOfficePhone] = useState<string | null>(null);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [privacyEmail, setPrivacyEmail] = useState<string | null>(null);
  const [privacyMsg, setPrivacyMsg] = useState<string | null>(null);

  async function load(saved?: keyof Values) {
    try {
      const [s, u] = await Promise.all([transport.call<SettingsResult>("get_settings", {}), transport.call<RoutingUsage>("routing_usage", { days: 14 })]);
      const before = server.current;
      server.current = s.settings;
      setData(s);
      // An answer that lands later (a slow line, a save on another card) never wipes what the
      // person is editing: it replaces only the keys they have not changed, and the one just saved.
      setDraft((d) => {
        if (!d || !before) return s.settings;
        const next = { ...s.settings };
        for (const k of Object.keys(d) as (keyof Values)[]) {
          if (k !== saved && JSON.stringify(d[k]) !== JSON.stringify(before[k])) Object.assign(next, { [k]: d[k] });
        }
        return next;
      });
      setUsage(u);
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save(key: keyof Values, value: unknown): Promise<boolean> {
    setBusy(key);
    let ok = false;
    try {
      await transport.call("update_settings", { key, value });
      toast("Setting saved");
      ok = true;
      await load(key);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(null);
    return ok;
  }

  if (err && !data) return <section className="view"><div className="ph"><div><h1>Fleet settings</h1></div></div><Notice tone="bad">{err}</Notice></section>;
  if (!data || !draft) return <section className="view"><div className="ph"><div><h1>Fleet settings</h1></div></div><Loading>Loading settings…</Loading></section>;
  const places = ((lists.places ?? []) as PlaceWithId[]).filter((p) => p.maps);
  const changed = (key: keyof Values) => JSON.stringify(draft[key]) !== JSON.stringify(data.settings[key]);
  const num = (key: keyof Values) => (ev: FormEvent) => {
    ev.preventDefault();
    void save(key, draft[key]);
  };
  const numberRow = ([key, label, unit]: NumberRow) => (
    <form key={key} className="grid2" style={{ alignItems: "end" }} onSubmit={num(key)}>
      <div className="field">
        <label htmlFor={`fs-${key}`}>{label}</label>
        <input id={`fs-${key}`} type="number" step={key === "road_factor" ? 0.05 : 1} inputMode="decimal" value={(draft[key] as number | undefined) ?? ""} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
        <span className="hint">{data.about[key] ? `${data.about[key]} (` : "("}{unit}; default {String(data.defaults[key] ?? FALLBACK[key] ?? "—")})</span>
      </div>
      <div><button className="btn dark" type="submit" disabled={busy !== null || !changed(key)}>Save</button></div>
    </form>
  );
  // The accept window as saved: the help text says when a task needs a driver.
  const within = data.settings.accept_within_min ?? FALLBACK.accept_within_min;
  const beforeLeave = data.settings.accept_before_leave_min ?? FALLBACK.accept_before_leave_min;
  // Stored keys the card does not show (the old "pickup.people" kind, set before Phase 7 or through Claude): they come before the type.
  const otherDwell = Object.entries(draft.dwell_min ?? {}).filter(([k]) => !DWELL_KEYS.some(([d]) => d === k));
  const personalTrips = personalTripsValue(draft.driver_personal_trips, data.defaults.driver_personal_trips);
  const shownOfficePhone = data.settings.office_phone ? phoneDisplay(data.settings.office_phone) : "";

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

        {/* Hotfix 2 (F): the office's own number: Call office on the requester's pages and in the driver app. */}
        <form className="card card-b form" data-testid="office-phone-settings" onSubmit={(ev) => {
          ev.preventDefault();
          const v = officePhoneValue(officePhone ?? shownOfficePhone);
          if ("error" in v) {
            setPhoneMsg(v.error);
            return;
          }
          setPhoneMsg(null);
          void save("office_phone", v.value).then((ok) => { if (ok) setOfficePhone(null); });
        }}>
          <h2>Office phone number</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Call office: drivers and the people who ask for vehicles get it with Call and WhatsApp, where nobody else's number is there to call. Empty and Save
            clears it.
          </p>
          <div className="grid2" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="fs-office-phone">Office phone number</label>
              <input id="fs-office-phone" maxLength={30} inputMode="tel" placeholder="011 234 5678" value={officePhone ?? shownOfficePhone}
                onChange={(e) => { setOfficePhone(e.target.value); setPhoneMsg(null); }} />
              {phoneMsg ? <span className="hint" style={{ color: "var(--bad)" }}>{phoneMsg}</span> : <span className="hint">{data.settings.office_phone ? `Saved: ${phoneDisplay(data.settings.office_phone)}` : "None saved: Call office is not shown."}</span>}
            </div>
            <div><button className="btn dark" type="submit" disabled={busy !== null || officePhone === null || samePhone(officePhone, data.settings.office_phone)}>Save</button></div>
          </div>
        </form>

        {/* Part 6 (store readiness): the public privacy page's contact. */}
        <form className="card card-b form" data-testid="privacy-email-settings" noValidate onSubmit={(ev) => {
          ev.preventDefault();
          const v = privacyEmailValue(privacyEmail ?? data.settings.privacy_email ?? "");
          if ("error" in v) {
            setPrivacyMsg(v.error);
            return;
          }
          setPrivacyMsg(null);
          void save("privacy_email", v.value).then((ok) => { if (ok) setPrivacyEmail(null); });
        }}>
          <h2>Privacy contact e-mail</h2>
          <div className="grid2" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="fs-privacy-email">Privacy contact e-mail</label>
              <input id="fs-privacy-email" type="email" maxLength={254} inputMode="email" autoComplete="off" placeholder="privacy@example.com"
                value={privacyEmail ?? data.settings.privacy_email ?? ""}
                onChange={(e) => { setPrivacyEmail(e.target.value); setPrivacyMsg(null); }} />
              <span className="hint">Shown on the public privacy page. Use Fame's shared address before the store submission.</span>
              {privacyMsg
                ? <span className="hint" style={{ color: "var(--bad)" }}>{privacyMsg}</span>
                : <span className="hint" data-testid="privacy-email-saved">{data.settings.privacy_email ? `Saved: ${data.settings.privacy_email}` : "None saved: the page shows the office phone."}</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn dark" type="submit"
                disabled={busy !== null || privacyEmail === null || privacyEmail.trim().toLowerCase() === (data.settings.privacy_email ?? "")}>Save</button>
              {data.settings.privacy_email && (
                <button className="btn" type="button" disabled={busy !== null}
                  onClick={() => { setPrivacyMsg(null); void save("privacy_email", null).then((ok) => { if (ok) setPrivacyEmail(null); }); }}>Remove</button>
              )}
            </div>
          </div>
        </form>

        <form className="card card-b form" data-testid="dwell-settings" onSubmit={(ev) => { ev.preventDefault(); void save("dwell_min", draft.dwell_min); }}>
          <h2>Time at a stop</h2>
          <p className="muted small" style={{ margin: 0 }}>The minutes a stop takes by its type, when nothing else says. A place's usual time and a stop's own time come first.</p>
          <div className="settings-grid">
            {DWELL_KEYS.map(([k, label]) => (
              <div className="field" key={k}>
                <label htmlFor={`fs-dwell-${k}`}>{label} (min)</label>
                <input id={`fs-dwell-${k}`} type="number" min={0} max={1440} inputMode="numeric" placeholder={data.defaults.dwell_min?.[k] != null ? String(data.defaults.dwell_min[k]) : undefined} value={draft.dwell_min[k] ?? ""} onChange={(e) => setDraft({ ...draft, dwell_min: { ...draft.dwell_min, [k]: e.target.value === "" ? 0 : parseInt(e.target.value, 10) } })} />
              </div>
            ))}
          </div>
          {otherDwell.length > 0 && (
            <span className="hint" data-testid="dwell-other">Also stored, and used before the type: {otherDwell.map(([k, v]) => `${k} ${duration(v)}`).join(", ")}.</span>
          )}
          <div><button className="btn dark" type="submit" disabled={busy !== null || !changed("dwell_min")}>Save</button></div>
        </form>

        <div className="card card-b form" data-testid="accept-settings">
          <h2>Accept window</h2>
          <p className="muted small" style={{ margin: 0 }}>
            A driver accepts or declines each task in the app and gets one reminder. When the window ends ({within} min after sending or {beforeLeave} min before
            leaving, whichever comes first) with no answer, the task needs a driver: it shows in red on Overview and Tasks, and the fleet admins, whoever
            assigned it and the requester are told. It stays with its driver until someone gives it to another.
          </p>
          {ACCEPT.map(numberRow)}
        </div>

        <form className="card card-b form" data-testid="shift-settings" onSubmit={(ev) => { ev.preventDefault(); void save("shift_start", draft.shift_start ?? "08:00").then(() => (JSON.stringify(draft.shift_days) !== JSON.stringify(data.settings.shift_days) ? save("shift_days", draft.shift_days ?? []) : undefined)); }}>
          <h2>Shift nudge in the driver app</h2>
          <p className="muted small" style={{ margin: 0 }}>{data.about.shift_start}. {data.about.shift_days}.</p>
          <div className="grid2">
            <div className="field"><label htmlFor="fs-shift-start">Time</label><TimeField id="fs-shift-start" value={draft.shift_start ?? "08:00"} onCommit={(v) => setDraft({ ...draft, shift_start: v })} /></div>
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

        {/* Phase 7: the server's auto clock-out ("" = off). */}
        <form className="card card-b form" data-testid="cutoff-settings" onSubmit={(ev) => { ev.preventDefault(); void save("duty_cutoff", draft.duty_cutoff ?? ""); }}>
          <h2>End of the working day</h2>
          <p className="muted small" style={{ margin: 0 }}>Drivers still on duty after this time are clocked out (not while a task is running). Leave empty for none.</p>
          <div className="grid2" style={{ alignItems: "end" }}>
            <div className="field">
              <label htmlFor="fs-duty-cutoff">End of the working day</label>
              <TimeField id="fs-duty-cutoff" value={draft.duty_cutoff ?? "21:00"} onCommit={(v) => setDraft({ ...draft, duty_cutoff: v })} />
              <span className="hint">{(draft.duty_cutoff ?? "21:00") === "" ? "Empty: nobody is clocked out by the server." : `Clocked out at ${draft.duty_cutoff ?? "21:00"} (Colombo time).`}</span>
            </div>
            <div><button type="button" className="btn" disabled={busy !== null || draft.duty_cutoff === ""} onClick={() => setDraft({ ...draft, duty_cutoff: "" })}>Leave empty</button></div>
          </div>
          <div className="acts"><button className="btn dark" type="submit" disabled={busy !== null || !changed("duty_cutoff")}>Save</button></div>
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

        {/* Phase 7 (§33): a task made without the approve permission waits for an approver (on by default). */}
        <div className="card card-b form" data-testid="approval-settings">
          <h2>Approval</h2>
          <label className="row" style={{ padding: 0, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.tasks_need_approval !== false} disabled={busy !== null} onChange={(e) => { setDraft({ ...draft, tasks_need_approval: e.target.checked }); void save("tasks_need_approval", e.target.checked); }} />
            <span className="grow">
              <span className="name">New tasks need the fleet admin's OK</span>
              <span className="sub" style={{ display: "block" }}>A task made by someone without the approve permission waits in the Requests queue and is sent to the driver only when approved. Off: every task is sent at once.</span>
            </span>
          </label>
        </div>

        {/* Hotfix 2 (J): a task without a vehicle up front; off until every driver's phone has the update. */}
        <div className="card card-b form" data-testid="vehicle-on-the-day-settings">
          <h2>Vehicle on the day</h2>
          <label className="row" style={{ padding: 0, cursor: "pointer" }}>
            <input type="checkbox" checked={draft.vehicle_on_the_day === true} disabled={busy !== null} onChange={(e) => { setDraft({ ...draft, vehicle_on_the_day: e.target.checked }); void save("vehicle_on_the_day", e.target.checked); }} />
            <span className="grow">
              <span className="name">Tasks may leave the vehicle to the day</span>
              <span className="sub" style={{ display: "block" }}>
                Assign a task, the decide pages and Book now then offer "Driver's vehicle on the day" (the default for a later day, and today when the driver
                holds no vehicle) and "Any van" (or another type) besides a vehicle by its plate. The driver confirms the vehicle they hold, or picks one of
                the type, at Start task. Switch it on only after every driver's phone has the app update: an older app cannot start a task with no vehicle.
              </span>
            </span>
          </label>
        </div>

        {/* Phase 7 (§13): whether a driver may mark a trip they start in the app as personal. */}
        <div className="card card-b form" data-testid="personal-trips-settings">
          <h2>Driver-started trips</h2>
          <p className="muted small" style={{ margin: 0 }}>
            A driver on duty can start a trip in the app (Start a trip). Personal km are counted apart and never charged to a job; the fleet admins are told
            when a personal trip starts.
          </p>
          <div className="field" role="radiogroup" aria-label="Personal trips">
            {PERSONAL_TRIPS_OPTIONS.map(([value, label]) => (
              <label key={value} className="check">
                <input type="radio" name="fs-personal-trips" value={value} checked={personalTrips === value} disabled={busy !== null}
                  onChange={() => { setDraft({ ...draft, driver_personal_trips: value }); void save("driver_personal_trips", value); }} /> {label}
              </label>
            ))}
          </div>
        </div>

        <div className="card card-b form">
          <h2>Numbers</h2>
          {NUMBERS.map(numberRow)}
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
                <div className="field"><label htmlFor={`fs-b-from-${i}`}>From</label><TimeField id={`fs-b-from-${i}`} value={b.from} onCommit={(v) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.map((x, j) => (j === i ? { ...x, from: v } : x)) } })} /></div>
                <div className="field"><label htmlFor={`fs-b-to-${i}`}>To</label><TimeField id={`fs-b-to-${i}`} value={b.to} onCommit={(v) => setDraft({ ...draft, rush_hour: { ...draft.rush_hour, bands: draft.rush_hour.bands.map((x, j) => (j === i ? { ...x, to: v } : x)) } })} /></div>
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

        {data.google && draft.google_caps && (
          <form className="card card-b form" data-testid="google-settings" onSubmit={(ev) => { ev.preventDefault(); void save("google_caps", draft.google_caps); }}>
            <div className="row" style={{ padding: 0 }}>
              <div className="grow">
                <h2>Map package</h2>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  Every Google call is counted before it is made and refused at its daily cap or its month's cap (Colombo time, at most 95 % of
                  Google's free usage); the open package then takes over until tomorrow or the 1st, and a refused map means no map. A day's cap
                  is the month's spread over 22 working days{data.defaults.google_caps ? ` (${data.defaults.google_caps.map_loads.day} and ${data.defaults.google_caps.routes.day} by default)` : ""}, weekends the same; the month's cap is the hard stop. Keys set:
                  map {data.google.configured.js ? "yes" : "no"}, server {data.google.configured.server ? "yes" : "no"}.
                </p>
              </div>
              <Pill tone={data.google.package === "google" ? "ok" : "muted"}>{data.google.package === "google" ? "Google" : "Open"}</Pill>
            </div>
            <div className="field">
              <label htmlFor="fs-package">The package</label>
              <select id="fs-package" value={draft.map_package ?? "google"} disabled={busy !== null}
                onChange={(e) => { const v = e.target.value as "google" | "open"; setDraft({ ...draft, map_package: v }); void save("map_package", v); }}>
                <option value="google">Google, where its keys are set</option>
                <option value="open">Open: OpenFreeMap, openrouteservice, the estimate</option>
              </select>
              <span className="hint">
                The drivers' phones follow it within a minute. A phone whose Google map does not load shows the free map by itself, and an issue says so.
              </span>
            </div>
            <div className="tbl-wrap">
              <table data-testid="google-usage">
                <thead><tr><th>Feature</th><th className="r">Today</th><th className="r">This month</th><th className="r">A day at most</th><th className="r">A month at most</th><th>Now</th></tr></thead>
                <tbody>
                  {data.google.usage.map((u) => {
                    const cap = draft.google_caps![u.feature];
                    const setCap = (k: "day" | "month", v: string) =>
                      setDraft({ ...draft, google_caps: { ...draft.google_caps!, [u.feature]: { ...cap, [k]: v === "" ? 0 : parseInt(v, 10) } } });
                    return (
                      <tr key={u.feature}>
                        <td>{u.label}</td>
                        <td className="r num">{u.today}{u.refused_today ? ` (${u.refused_today} refused)` : ""}</td>
                        <td className="r num">{u.month}</td>
                        <td className="r"><input aria-label={`${u.label}: a day at most`} type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={cap.day} onChange={(e) => setCap("day", e.target.value)} /></td>
                        <td className="r"><input aria-label={`${u.label}: a month at most`} type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={cap.month} onChange={(e) => setCap("month", e.target.value)} /></td>
                        <td>{u.on ? <Pill tone="ok">on</Pill> : <span className="sub">{u.note}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="acts"><button className="btn dark" type="submit" disabled={busy !== null || !changed("google_caps")}>Save caps</button></div>
          </form>
        )}

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
