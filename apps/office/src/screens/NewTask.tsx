// Assign a task, as a page (/tasks/new): the route card (Fix B, 29 October
// 2026: From / To / Add stop; From is the base place by default and People get
// in under its ⋯ Options makes it Stop 1; each stop's ⋯ Options hold what
// happens there, the stay, the arrive-by, what, pin and note), Then back to the
// office and No expressway, the date and the leave-by time
// (typed, or the plan's as a grey suggestion, checked at once against the arrive-by
// times), the plan as a timeline with the exact reason when there is none
// (1.5 s after the last edit) and the overlaps as cards, then the
// driver first and the vehicle they bring (changeable), Who's available with
// the best match, the project split. Everything typed is kept as a draft; a
// refresh never resets a choice (Phase 7, §3, §10, §11, §17). The trip part is
// the trip editor's (§34). Someone without the approve permission, while new
// tasks need the fleet admin's OK, proposes the task instead: it waits in the
// approval queue and nothing goes to the driver yet (§33).
// Round 4–7 (6): Who rides (ui/PassengersField) beside the passenger count, sent as passenger_list on create_task; hidden
// with the passengers switch off.
// Round 3: "Who drives?" (ui/WhoDrives): a driver (picked from the driver cards, ui/DriverPicker), I'll drive myself, or
// someone else (a name and a phone). The last two need a plate (the reason under the button) and send nothing.
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { flashWarnings } from "../data/flash";
import { useLists } from "../data/hooks";
import type { Conflict, CreateTaskResult, FindProject } from "../data/types";
import { hhmm, num, splitEqually, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { driverOptions } from "../ui/driverPickerLogic";
import { Icon } from "../ui/icons";
import { WhoDrives } from "../ui/WhoDrives";
import { PassengersField } from "../ui/PassengersField";
import { passengersOn } from "./passengersLogic";
import { emptyWho, plateReason } from "../ui/whoDrivesLogic";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { type AssignFields, assignOutcome, assignWho, driverWhatsApp, emptyAssign, planInput, type ProjectRow, splitTotal, validateAssign } from "./assignLogic";
import { linkedDriver, linkedTime } from "./asks/askLogic";
import { availabilityArgs, driverVehicle, floorTo5, planEndOf, vehicleWindowWords } from "./availabilityLogic";
import { AvailabilityPanel, scrollToAvailability, useAvailability, vehicleFor } from "./AvailabilityPanel";
import { ConflictCards } from "./ConflictCards";
import { basePlace, DriverSelect, useFleetSettings, VehicleSelect, vehicleOnTheDay } from "./dispatchParts";
import { defaultStops, firstStopOf, openStops, tidyStops } from "./stopsLogic";
import { BackByField, LeaveByField, TripPlanCard, TripRoute, useTrip } from "./TripEditor";
import { isChoice, knownDef, vehicleArg, vehicleDefault } from "./vehicleChoiceLogic";
import { TripDayPicker } from "../ui/DayPicker";

const SPLIT_COLORS = ["var(--accent)", "var(--live)", "var(--ok)", "var(--bad)", "var(--muted)"];
export { PLAN_DEBOUNCE_MS } from "./dispatchParts";

interface Form {
  f: AssignFields;
  rows: ProjectRow[];
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function NewTask() {
  const { me, store, transport } = useFleet();
  const toast = useToast();
  const navigate = useNavigate();
  const lists = useLists();
  const settings = useFleetSettings();
  const base = basePlace(settings.data);
  const [params] = useSearchParams();
  const date = isDate(params.get("date")) ? params.get("date")! : today();
  // Part 3b (H3): Assign on a driver's Yes opens this page with ?driver= and the trip's ?time= (the fresh form takes
  // them; a draft is still offered and, resumed, wins).
  // Fix B: a draft put back opens without its empty rows (openStops).
  const [state, setState, draft] = useFormDraft<Form>("task-new", null, () => ({
    f: { ...emptyAssign(date), driver: linkedDriver(params), leaveBy: linkedTime(params) },
    rows: [],
  }), true, (x) => ({ ...x, f: { ...x.f, stops: openStops(x.f.stops, x.f.returnToBase) } }));
  const { f, rows } = state;
  const setF = (patch: Partial<AssignFields> | ((x: AssignFields) => AssignFields)) =>
    setState((s) => ({ ...s, f: typeof patch === "function" ? patch(s.f) : { ...s.f, ...patch } }));
  const setRows = (fn: (rs: ProjectRow[]) => ProjectRow[]) => setState((s) => ({ ...s, rows: fn(s.rows) }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "" | "bad" | "ok"; text: React.ReactNode; warnings?: string[]; conflicts?: Conflict[] } | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Without approve, while new tasks need the fleet admin's OK (on unless switched off), the task is proposed (§33).
  const proposes = settings.data?.settings.tasks_need_approval !== false && !me.permissions.includes("approve");
  // Round 3: who drives (always a driver while self-drive is off); the person or someone else = no app, a plate.
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  // Round 4–7 (6): the passengers switch off: no Who rides field, and no names sent.
  const riding = passengersOn(settings.data);
  const who = selfDrive ? assignWho(f) : emptyWho();
  const noApp = who.by !== "driver";

  // The trip: the plan follows the form, 1.5 s after the last change; Plan now skips the wait. The plan shown stays while
  // the next comes. The departure check fills an empty leave-by, else says what a typed one does; "Vehicle free by" is
  // the back-by (§20).
  const trip = useTrip(f, (fn) => setF(fn), { base, settings: settings.data, planInput: planInput({ ...f, who }, base), backLabel: "free by" });
  const preview = trip.preview;

  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const vehicles = lists.vehicles ?? [];
  const set = <K extends keyof AssignFields>(k: K, v: AssignFields[K]) => setF({ [k]: v } as Partial<AssignFields>);

  // Who's available from the leave-by rounded down to 5 minutes (a plan moving by a minute does not ask again), near the first stop.
  const leave = f.leaveBy || hhmm(preview?.leave_by);
  const first = firstStopOf(f.stops, f.startPax ? { name: f.start || base?.name || "", lat: f.startLat, lng: f.startLng } : null);
  // Round 48: the plan's end bounds the window when no end time is typed (the trip's window, never the rest of the day).
  const availArgs = availabilityArgs(f.date, leave ? floorTo5(leave) : "", f.end, undefined, undefined, first, planEndOf(preview));
  const avail = useAvailability(availArgs);
  const pickedDriver = drivers.find((d) => d.username === f.driver);
  const def = f.driver ? driverVehicle(vehicleFor(avail.data, f.driver), pickedDriver, drivers.map((d) => d.name)) : null;
  // Hotfix 2 (J): with vehicle_on_the_day on, a later day (or a driver who brings none today) leaves the vehicle to the day.
  const onDay = vehicleOnTheDay(settings.data);
  const dflt = noApp ? null : vehicleDefault({ on: onDay, date: f.date, today: today(), driver: f.driver, def: knownDef(def, !!avail.data || !me.tools.includes("availability")) });
  const dayDefault = dflt?.kind === "on_the_day";
  // Assign & send waits for a plate when nobody of ours drives (the reason under the button).
  const plateWhy = noApp && (!f.vehicle.trim() || isChoice(f.vehicle)) ? plateReason(who) : null;

  /** Picking a driver in the list: the vehicle follows them (their vehicle today, else their regular one) unless one was picked. */
  function pickDriver(username: string) {
    setF((x) => ({ ...x, driver: username }));
  }
  /** Use suggestion, or a row of Who's available: that driver and the vehicle they bring. */
  function takeSuggestion(username: string) {
    setF((x) => ({ ...x, driver: username, vehicle: "" }));
  }
  function setRow(i: number, patch: Partial<ProjectRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function lookup(i: number, text: string) {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(async () => {
      if (!text.trim()) return;
      try {
        const p = await transport.call<FindProject>("find_project", { text: text.trim() });
        const list = p.projects || [];
        if (!list.length) setRow(i, { match: "No project found. Import projects from Zoho Books first, or check the number.", bad: true });
        else {
          const x = list[0];
          const head = list.length > 1 && p.matched_by === "contains" ? "Several match, first: " : "✓ ";
          setRow(i, { match: head + [x.job_no, x.short_name, x.name, x.customer_name].filter(Boolean).join(" · "), bad: false });
        }
      } catch (e) {
        setRow(i, { match: errText(e as FleetError)[0], bad: true });
      }
    }, 450);
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    // The driver's vehicle: known (Who's available, else the driver list), known to be none, or not known yet (the server decides).
    const known = def?.reg_no ?? (avail.data || !me.tools.includes("availability") ? null : undefined);
    // Fix B: the rows with nothing in them go once To has one (tidyStops); the form shows what is sent.
    const stops = tidyStops(f.stops, f.returnToBase);
    if (stops !== f.stops) setF((x) => ({ ...x, stops }));
    // "on the day" is named when it is the default (Hotfix 2, J): never held up for a vehicle.
    const v = validateAssign({ ...f, stops, who, vehicle: noApp ? f.vehicle : vehicleArg(f.vehicle, dflt), ...(riding ? {} : { riders: undefined }) }, rows, me.name, { defaultVehicle: known, base });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<CreateTaskResult>("create_task", v.input);
      const drv = noApp ? undefined : drivers.find((x) => x.username === v.input.driver);
      const out = assignOutcome(p, who.by === "other" ? who.name.trim() : drv ? drv.name : String(v.input.driver ?? me.name), who.by);
      // A proposed task is not with the driver yet: no WhatsApp message either (nor for a trip with no app).
      const wa = !out.waiting && !noApp && f.whatsapp && drv?.phone ? driverWhatsApp(v.input, drv.phone, p.leave_by ? `Leave by ${p.leave_by}` : undefined) : "";
      draft.clear();
      // Hotfix O2-H2, Part 1b (Gmail's "Sent"): the form closes, the task (or the request it waits as) opens in its place,
      // a toast says what happened (WhatsApp the driver as its action when asked for), the warnings wait on the task.
      if (out.link) {
        const notice = [...warnList(p), ...(p.conflicts ?? []).map((c) => c.text)];
        if (!out.waiting && p.task_id) flashWarnings(p.task_id, notice);
        void store.invalidate();
        navigate(out.link.to, { replace: true, state: out.waiting ? undefined : { warnings: notice } });
        toast(out.toast, wa ? { label: "WhatsApp the driver", href: wa } : undefined);
        return;
      }
      setMsg({
        tone: "ok",
        warnings: warnList(p),
        conflicts: p.conflicts,
        text: (
          <>
            <b data-testid={out.waiting ? "waiting-for-approval" : undefined}>{out.head}</b> Leave by {p.leave_by?.slice(-5) ?? "—"}.{out.waiting ? " " : " The task is in their Fame Driver app. "}
            {p.vehicle_changed ? <span data-testid="vehicle-used">{p.vehicle_changed}. </span>
              : p.vehicle_used ? <span data-testid="vehicle-used">Vehicle: {p.vehicle_used.reg_no} · {p.vehicle_used.why === "chosen" ? "as picked" : p.vehicle_used.why}. </span>
              : p.vehicle ? <span data-testid="vehicle-used">Vehicle: {p.vehicle}. </span> : null}
            <Link className="btn small" to={`/tasks${v.input.date !== today() ? `?date=${v.input.date}` : ""}`}>The board →</Link>{" "}
            {wa ? <a className="btn small" href={wa} target="_blank" rel="noopener">WhatsApp the driver</a>
              : f.whatsapp && !out.waiting ? <span className="small">No phone number saved for this driver, so no WhatsApp link.</span> : null}
          </>
        ),
      });
      setState({ f: { ...f, title: "", notes: "", cname: "", cphone: "", pax: "", riders: [], end: "", leaveBy: "", startPax: false, startWhat: "", startNote: "", startDwell: "", stops: defaultStops(f.returnToBase) }, rows: [] });
      toast(out.toast);
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  const total = splitTotal(rows);
  const backTo = `/tasks${date !== today() ? `?date=${date}` : ""}`;
  const focusVehicle = () => document.getElementById("af-vehicle")?.focus();

  return (
    <section className="view" data-testid="new-task">
      <PageTop title="Assign a task" sub="Tasks" backTo={backTo} />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        <div className="card card-b form">
          <div className="field">
            <label htmlFor="af-title">Task</label>
            <input id="af-title" maxLength={120} placeholder="Team drop · Matara sites" value={f.title} onChange={(e) => set("title", e.target.value)} data-focus />
          </div>
          <div className="grid2">
            <div className="field"><span className="lab">Date</span><TripDayPicker id="af-date" label="Date" value={f.date} onChange={(d) => set("date", d)} /></div>
            <LeaveByField trip={trip} id="af-leave" />
          </div>
        </div>

        <div className="card card-b form">
          <TripRoute trip={trip} prefix="af" />
        </div>

        <TripPlanCard trip={trip}>
          <ConflictCards conflicts={preview?.conflicts} onPickVehicle={focusVehicle} onPickDriver={scrollToAvailability} wanted={{ date: f.date, from: leave, until: f.end }} />
        </TripPlanCard>

        <div className="card card-b form">
          <WhoDrives id="af" value={who} onChange={(w) => set("who", w)} hidden={!selfDrive || transport.kind === "claude"} picksVehicle />
          <div className="grid2">
            {!noApp && (
              <DriverSelect id="af-driver" value={f.driver} onTheDay={onDay} loading={!lists.drivers && !lists.error} onChange={pickDriver}
                drivers={driverOptions({ avail: avail.data?.drivers, list: drivers, picked: f.driver, pickedName: avail.data?.drivers.find((d) => d.username === f.driver)?.name })}
                emptyLabel={lists.error && !lists.drivers ? "Couldn’t load" : "Choose a driver"} />
            )}
            <VehicleSelect id="af-vehicle" value={noApp && isChoice(f.vehicle) ? "" : f.vehicle} def={noApp ? null : def} vehicles={vehicles} onChange={(reg) => set("vehicle", reg)}
              emptyLabel={!lists.vehicles && lists.error ? "Couldn’t load" : noApp ? "Pick the vehicle" : f.driver ? "Pick a vehicle" : "Choose the driver first"}
              choices={onDay && !noApp} dayDefault={dayDefault} forTrip={vehicleWindowWords(avail.data?.vehicles.groups)}
              hint={noApp ? "Nobody confirms a vehicle on the day: pick its plate." : f.driver && !def && !onDay ? "This driver holds no vehicle today and has no regular one." : undefined} />
          </div>
          {lists.error && (!lists.drivers || !lists.vehicles) && <Notice>Couldn’t load the {!lists.drivers && !lists.vehicles ? "drivers and vehicles" : !lists.drivers ? "drivers" : "vehicles"}: {lists.error} <button type="button" className="btn small" onClick={lists.reload}>Try again</button></Notice>}
          {!noApp && (
            <AvailabilityPanel args={availArgs} picked={f.driver} onPick={(d) => { if (d.username) takeSuggestion(d.username); }}
              onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />
          )}
          <div className="grid2">
            <BackByField trip={trip} id="af-end" label="Vehicle free by" />
            <div className="field"><label htmlFor="af-pax">Passengers</label><input type="number" id="af-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
          </div>
          {riding && <PassengersField id="af" value={f.riders ?? []} onChange={(r) => set("riders", r)} count={f.pax} />}
          <div className="grid2">
            <div className="field"><label htmlFor="af-cname">Contact name</label><input id="af-cname" maxLength={120} value={f.cname} onChange={(e) => set("cname", e.target.value)} /></div>
            <div className="field"><label htmlFor="af-cphone">Contact phone</label><input id="af-cphone" maxLength={30} inputMode="tel" value={f.cphone} onChange={(e) => set("cphone", e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="af-notes">Notes for the driver</label><textarea id="af-notes" maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>

        <div className="card card-b form">
          <div className="field">
            <span className="lab">Charge to projects <span className="muted" style={{ fontWeight: 400 }}>· from Zoho Books projects</span></span>
            <div className="form">
              {rows.map((r, i) => (
                <div className="prow" key={i}>
                  <input value={r.project} placeholder="Job no. or DU ID, e.g. 13021 or TRKAN1" aria-label={`Project ${i + 1}`} onChange={(e) => { setRow(i, { project: e.target.value }); lookup(i, e.target.value); }} />
                  <input type="number" min={1} max={100} inputMode="decimal" value={r.percent} aria-label={`Percent for project ${i + 1}`} onChange={(e) => setRow(i, { percent: e.target.value })} />
                  <button type="button" className="btn icon-btn" aria-label="Remove project" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Icon name="close" /></button>
                  <span className={`match ${r.bad ? "bad" : ""}`}>{r.match || ""}</span>
                </div>
              ))}
            </div>
            {rows.length > 0 && (
              <div>
                <div className="splitbar">
                  {rows.map((r, i) => <i key={i} style={{ width: `${Math.max(0, Math.min(100, Number(r.percent) || 0))}%`, background: SPLIT_COLORS[i % SPLIT_COLORS.length] }} />)}
                </div>
                <div className="split-foot" style={{ marginTop: 8 }}>
                  <button type="button" className="linkish" onClick={() => { const p = splitEqually(rows.length); setRows((rs) => rs.map((r, i) => ({ ...r, percent: p[i] }))); }}>Split equally</button>
                  <span className={Math.abs(total - 100) < 0.01 ? "status live" : "status bad"}>Total {num(total)}%</span>
                </div>
              </div>
            )}
            <button type="button" className="btn" onClick={() => setRows((rs) => [...rs, { project: "", percent: rs.length ? "" : 100 }])}>+ Add a project</button>
            <span className="hint">Km, fuel and driver costs from this task are split across these projects by the percentages. Leave empty for Fame internal.</span>
          </div>
          {noApp
            ? (
              <div className="field">
                <span className="lab">Send to driver</span>
                <span className="hint" data-testid="no-app">{who.by === "self" ? "You drive it yourself" : `${who.name.trim() || "Someone else"} drives it`}: no app, so nothing is sent.</span>
                {proposes && <span className="hint" data-testid="needs-approval">New tasks need the fleet admin’s OK: this one waits for it.</span>}
              </div>
            )
            : (
              <div className="field">
                <span className="lab">Send to driver</span>
                <span className="check"><input type="checkbox" checked disabled id="af-app" /> <label htmlFor="af-app">Fame Driver app (always)</label></span>
                <span className="check"><input type="checkbox" id="af-wa" checked={f.whatsapp} onChange={(e) => set("whatsapp", e.target.checked)} /> <label htmlFor="af-wa">Also give me a WhatsApp message with the details</label></span>
                {proposes && <span className="hint" data-testid="needs-approval">New tasks need the fleet admin’s OK: this one waits for it, then goes to the driver.</span>}
              </div>
            )}
        </div>

        {msg && (
          <div style={{ display: "grid", gap: 10 }}>
            <Notice tone={msg.tone}>{msg.text}</Notice>
            {msg.warnings && <WarningsNote warnings={msg.warnings} />}
            <ConflictCards conflicts={msg.conflicts} />
          </div>
        )}
        <StickyActions>
          <button className="btn primary" type="submit" disabled={busy || !!plateWhy}>{busy ? "Sending…" : proposes ? "Send for approval" : noApp ? "Save the task" : "Assign & send"}</button>
          {plateWhy && <p className="hint btn-why" data-testid="save-why">{plateWhy}</p>}
        </StickyActions>
      </form>
    </section>
  );
}
