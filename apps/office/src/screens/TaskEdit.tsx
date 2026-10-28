// Change a task (/tasks/:id/edit, Phase 6): the driver first and the vehicle
// they bring (Phase 7, §3; changeable), the day and leave-by time (the plan
// shifts with it, checked at once against the stops' arrive-by times), the end
// time, the title, passengers, contact and notes, through update_task with the
// task's plan_version; Who's available with the best match beside the picks;
// Cancel with a reason. A task under way takes only the words. Typed input is
// kept as a draft for this task. With ?driver=1 (the push for a task that needs
// a driver, §19) the reason is at the top and the driver field is focused.
// Hotfix 4 (b): with ?driver=1 it is Give it a driver, one page: the task on top (TaskSummary: time, stops with arrive-by,
// who asked, notes, the map), Who can take it below, "Give to <driver> · <plate>"; Open task and Change the time or the trip
// go forward and say so; back returns to wherever the person came from (the Overview when opened from a push).
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { flashConflicts, flashWarnings } from "../data/flash";
import { useLists } from "../data/hooks";
import type { Conflict, Passenger, TaskDetail, UpdateTaskResult } from "../data/types";
import { cap, joinDots, plateOf, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import { changeOutcome } from "./approvalLogic";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { firstName } from "../ui/driverRowLogic";
import { cameFromTask, PageTop, StickyActions, useAfterSave } from "../ui/Page";
import { TimeField } from "../ui/TimeField";
import { useToast } from "../ui/Toast";
import { linkedDriver } from "./asks/askLogic";
import { availabilityArgs, driverVehicle, floorTo5, planEndOf, vehicleWindowWords } from "./availabilityLogic";
import { driverOptions } from "../ui/driverPickerLogic";
import { AvailabilityPanel, useAvailability, vehicleFor } from "./AvailabilityPanel";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DepartureNote, DriverSelect, useFleetSettings, VehicleSelect, vehicleOnTheDay } from "./dispatchParts";
import { knownDef, ON_THE_DAY, vehicleDefault } from "./vehicleChoiceLogic";
import { useBoardQuery, useTask } from "./TaskDetail";
import { taskTone } from "./taskDetailLogic";
import { leaveIn, TaskSummary } from "./TaskSummary";
import { TripDayPicker } from "../ui/DayPicker";
import { ChoiceChip } from "../ui/Select";
import { whenText } from "../lib/when";
import { PassengersField } from "../ui/PassengersField";
import { passengersOn, type Rider, ridersEdit, ridersFrom } from "./passengersLogic";

interface EditForm {
  driver: string;
  vehicle: string;
  date: string;
  time: string;
  end: string;
  title: string;
  passengers: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  reason: string;
  /** Round 4–7 (6): who rides, by name; absent = not on the form (switched off, an older draft). */
  riders?: Rider[];
}

const EMPTY: EditForm = { driver: "", vehicle: "", date: "", time: "", end: "", title: "", passengers: "", contactName: "", contactPhone: "", notes: "", reason: "" };

type TaskFields = { date?: string; time?: string; end_by?: string; title: string; passengers?: number | null; contact?: { name?: string | null; phone?: string | null }; notes?: string | null; passengers_list?: Passenger[] };

/** The form as the task is now (the driver and vehicle selects start at "Keep"). */
const fromTask = (t: TaskFields): EditForm => ({
  ...EMPTY,
  date: t.date ?? "",
  time: t.time ?? "",
  end: t.end_by ?? "",
  title: t.title,
  passengers: t.passengers == null ? "" : String(t.passengers),
  contactName: t.contact?.name ?? "",
  contactPhone: t.contact?.phone ?? "",
  notes: t.notes ?? "",
  riders: ridersFrom(t.passengers_list),
});
const untouched = (f: EditForm) => JSON.stringify(f) === JSON.stringify(EMPTY);

/** Part 3b (H3): the form with the driver a link names (?driver=<username>); as it was without one. Pure. */
export const withLinkedDriver = (f: EditForm, driver: string): EditForm => (driver ? { ...f, driver } : f);

/** update_task takes only what differs from the task. Pure. */
export function updateTaskInput(id: string, version: number, f: EditForm, t: TaskFields): { error: string } | { input: Record<string, unknown> } {
  const s = (x: string) => x.trim();
  const input: Record<string, unknown> = { task_id: id, plan_version: version };
  if (s(f.driver)) input.driver = s(f.driver);
  if (s(f.vehicle)) input.vehicle = s(f.vehicle);
  if (s(f.date) && s(f.date) !== t.date) input.date = s(f.date);
  if (s(f.time) && s(f.time) !== t.time) input.time = s(f.time);
  if (s(f.end) !== (t.end_by ?? "")) input.end_time = s(f.end) || null;
  if (s(f.title) && s(f.title) !== t.title) input.title = s(f.title);
  const pax = s(f.passengers);
  if (pax !== (t.passengers == null ? "" : String(t.passengers))) input.passengers = pax === "" ? null : Math.max(0, Math.min(80, parseInt(pax, 10) || 0));
  if (s(f.contactName) !== (t.contact?.name ?? "")) input.contact_name = s(f.contactName);
  if (s(f.contactPhone) !== (t.contact?.phone ?? "")) input.contact_phone = s(f.contactPhone);
  if (s(f.notes) !== (t.notes ?? "")) input.notes = s(f.notes);
  // Round 4–7 (6): the names when they changed (names alone: only the ids and the list; with other changes the count too).
  const named = ridersEdit(input, f.riders, ridersFrom(t.passengers_list), { key: "passengers", was: t.passengers ?? null }, ["task_id", "plan_version"]);
  if (Object.keys(named).length === 2) return { error: "Nothing changed." };
  return { input: named };
}

/** Why the task needs a driver, in one sentence (§19): declined with the reason, or not accepted in time. */
export function needsDriverText(t: TaskDetail["task"]): string | null {
  const who = t.driver ?? "The driver";
  if (t.declined || t.needs_driver?.reason === "declined") {
    const d = t.declined;
    const reason = d?.reason_text ?? t.needs_driver?.reason_text ?? d?.reason ?? "no reason given";
    return `${who} declined${d?.after_accept ? " after accepting" : ""}${d?.at ? ` ${whenText(d.at, { inline: true })}` : ""}: ${reason}${d?.note ? ` · “${d.note}”` : ""}. Give it to another driver, or cancel it.`;
  }
  if (t.needs_driver) {
    return `${who} hasn’t accepted it${t.needs_driver.since ? ` (needs a driver since ${whenText(t.needs_driver.since, { inline: true })})` : ""}. Give it to another driver, or call ${who.split(" ")[0]}.`;
  }
  return null;
}

export function TaskEdit() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const driverMode = params.get("driver") === "1";
  // Part 3b (H3): Assign on a driver's Yes opens the page with ?driver=<username>: the form loaded from the task takes them.
  const linked = linkedDriver(params);
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const afterSave = useAfterSave();
  // Opened from the task's own page: a save goes back to it (with any warnings waiting there).
  const openedFromTask = cameFromTask(useLocation().state);
  const toast = useToast();
  const lists = useLists();
  const { p, err } = useTask(id);
  const q = useBoardQuery();
  const back = `/tasks/${id}${q}`;
  const [f, setF, draft] = useFormDraft<EditForm>("task-edit", id, EMPTY);
  const [msg, setMsg] = useState<string | null>(null);
  const [cxMsg, setCxMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (location.hash === "#cancel") setTimeout(() => document.getElementById("cx-reason")?.focus(), 50);
  }, []);
  // The fields start from the task once it is loaded, with the linked driver unless it is under way (it takes only the
  // words then); a draft resumed later replaces them.
  useEffect(() => {
    if (p && untouched(f)) draft.reset(withLinkedDriver(fromTask(p.task), p.task.status === "in_progress" ? "" : linked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.task.id, p?.task.plan_version]);

  const t = p?.task;
  const running = t?.status === "in_progress";
  const first = p?.stops.find((s) => s.status !== "removed");
  // Round 48: the task's plan bounds the window when it has no end time (its window, never the rest of the day).
  const availArgs = !t || running ? null : availabilityArgs(f.date || t.date || "", floorTo5(f.time || t.time || ""), f.end || t.end_by, undefined, undefined,
    first?.lat != null && first.lng != null && !first.google ? { lat: first.lat, lng: first.lng } : first?.place ? { place: first.place } : null, planEndOf(p));
  const avail = useAvailability(availArgs);
  const settings = useFleetSettings();
  const riding = passengersOn(settings.data);

  const fallback = driverMode ? "/" : back;
  if (err) return <><PageTop title="Task" backTo={fallback} /><Notice tone="bad">{err}</Notice></>;
  if (!p || !t) return <><PageTop title="Task" backTo={fallback} /><Loading>Loading the task…</Loading></>;
  const declined = t.status === "declined";
  const needsDriver = declined || !!t.needs_driver;
  const canChange = (t.status === "assigned" || declined || running) && me.tools.includes("update_task");
  const canCancel = (t.status === "assigned" || running || declined) && me.tools.includes("cancel_task");
  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const currentDriver = drivers.find((d) => d.name === t.driver);
  const pickedDriver = f.driver || currentDriver?.username || "";
  const currentPlate = t.vehicle ? plateOf(t.vehicle) : "";
  // A new driver brings their vehicle (today's, else the regular one) unless one is picked.
  const def = f.driver ? driverVehicle(vehicleFor(avail.data, f.driver), drivers.find((d) => d.username === f.driver), drivers.map((d) => d.name)) : null;
  // Hotfix 2 (J): with vehicle_on_the_day on, a new driver on a later day (or one who brings none today) leaves the vehicle
  // to the day, unless the task already does.
  const onDay = vehicleOnTheDay(settings.data);
  // Round 3: the driver cards for the picker (Who's available's rows first, then the list; the one picked always there).
  const pickOptions = driverOptions({ avail: avail.data?.drivers, list: drivers, picked: f.driver, pickedName: avail.data?.drivers.find((d) => d.username === f.driver)?.name });
  const dflt = f.driver ? vehicleDefault({ on: onDay, date: f.date || t.date || "", today: today(), driver: f.driver, def: knownDef(def, !!avail.data || !me.tools.includes("availability")) }) : null;
  const dayDefault = dflt?.kind === "on_the_day";
  const keepsDay = t.vehicle_mode === "driver_day";
  const vehicleToSend = f.vehicle || (dayDefault ? (keepsDay ? "" : ON_THE_DAY) : def && def.reg_no !== currentPlate ? def.reg_no : "");
  // "Keep (WP CAB-4521)", or the task's words while it has no vehicle ("Keep (Vehicle: on the day)").
  const keepLabel = `Keep${currentPlate ? ` (${currentPlate})` : t.vehicle_text ? ` (${t.vehicle_text})` : ""}`;
  const reason = needsDriverText(t);
  // The leave-by checked at once against the stops' arrive-by times (the task's plan shifted).
  const check = running || settings.data?.settings.planner_suggestions === false ? null : checkDeparture(f.time, departurePlan(p.timeline, p.plan?.buffer_min));
  // A driver picked in the list keeps a vehicle picked by hand; Use suggestion and a row of Who's available take the
  // driver with the vehicle they bring.
  const pickDriver = (username: string) => setF((x) => ({ ...x, driver: username }));
  const takeSuggestion = (username: string) => setF((x) => ({ ...x, driver: username, vehicle: "" }));

  async function save(ev: FormEvent) {
    ev.preventDefault();
    // The passengers switch off: the names are left as they are.
    const v = updateTaskInput(id, t!.plan_version ?? 0, { ...f, vehicle: vehicleToSend, ...(riding ? {} : { riders: undefined }) }, t!);
    if ("error" in v) {
      if (needsDriver && !f.driver) {
        setMsg("Choose the driver first.");
        return;
      }
      if (!declined) {
        setMsg(v.error === "Nothing changed." ? "Choose what to change first." : v.error);
        return;
      }
    }
    // Give it a driver sends the driver and the vehicle only (a draft resumed from the change page never adds its fields).
    const input = driverMode && needsDriver && f.driver
      ? { task_id: id, plan_version: t!.plan_version ?? 0, driver: f.driver, ...(vehicleToSend ? { vehicle: vehicleToSend } : {}) }
      : "input" in v ? v.input : { task_id: id, plan_version: t!.plan_version ?? 0, driver: f.driver };
    setBusy(true);
    try {
      // Round 4–7 (7): update_task answers the overlaps as cards too (who holds the driver or the vehicle then).
      const out = await transport.call<UpdateTaskResult & { conflicts?: Conflict[] }>("update_task", input);
      draft.clear();
      const vehicleWords = !f.vehicle && def && input.vehicle === def.reg_no ? ` · ${def.reg_no} (${def.why})` : "";
      // Round 48 (item 1): without approve the change waits for the fleet admin; the task is as it was.
      const outcome = changeOutcome(out, (needsDriver && f.driver ? `Task sent to ${out.driver ?? "the driver"}` : "Task changed") + vehicleWords);
      toast(outcome.toast);
      void store.invalidate();
      setBusy(false);
      if (outcome.waiting) {
        afterSave(back);
        return;
      }
      const warnings = warnList(out);
      // Back to where the person came from. New warnings must be read on the task page: from it, they wait there (data/flash);
      // from anywhere else, the task page takes this page's place so they are seen.
      flashWarnings(id, warnings);
      const conflicts = out.conflicts ?? [];
      flashConflicts(id, conflicts);
      if ((warnings.length || conflicts.length) && !openedFromTask) navigate(back, { replace: true, state: { warnings, conflicts } });
      else afterSave(back);
      return;
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  async function cancel() {
    if (!f.reason.trim()) {
      setCxMsg("Write the reason first. The driver sees it.");
      return;
    }
    setBusy(true);
    try {
      await transport.call("cancel_task", { task_id: id, reason: f.reason.trim() });
      draft.clear();
      toast("Task cancelled");
      void store.invalidate();
      setBusy(false);
      afterSave(`/tasks${q}`);
    } catch (e) {
      setCxMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  const cancelBox = canCancel && (
    <div className="confirm" id="cancel">
      <div className="field"><label htmlFor="cx-reason">Cancel this task</label><input id="cx-reason" maxLength={300} placeholder="Reason the driver will see" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></div>
      {cxMsg && <Notice tone="bad">{cxMsg}</Notice>}
      <button type="button" className="btn danger" onClick={() => void cancel()} disabled={busy}>Cancel task</button>
    </div>
  );

  // Hotfix 4 (b): Give it a driver, while the task still needs one; once it has a driver again (given on another page, or
  // the driver accepted before the push was opened) the page says so.
  if (driverMode && canChange && !running && !needsDriver) {
    return (
      <section className="view" data-testid="give-driver-done">
        <PageTop title={t.title || "Task"} sub="Has a driver" backTo="/"
          actions={<Link className="btn small" to={`/tasks/${id}${q}`} data-testid="open-task">Open task →</Link>} />
        <Notice tone="ok">{t.driver ? `${t.driver} has this task now.` : "This task has a driver now."} Nothing to do here.</Notice>
      </section>
    );
  }
  if (driverMode && canChange && !running) {
    const pickedName = f.driver ? (avail.data?.drivers.find((d) => d.username === f.driver)?.name ?? drivers.find((d) => d.username === f.driver)?.name ?? f.driver) : null;
    // The vehicle the task will have: the one sent, the day's choice, or the one it keeps.
    const plate = vehicleToSend === ON_THE_DAY ? "vehicle on the day" : vehicleToSend || (keepsDay ? t.vehicle_text ?? "" : currentPlate);
    return (
      <section className="view" data-testid="give-driver">
        <PageTop title={t.title || "Task"} sub={joinDots(["Needs a driver", leaveIn(t.date, t.leave_by, Date.now())])} backTo="/"
          actions={<Link className="btn small" to={`/tasks/${id}${q}`} data-testid="open-task">Open task →</Link>} />
        <DraftBanner draft={draft} />
        <div className="page-form">
          {reason && <Notice tone="bad"><span data-testid="needs-driver-reason">{reason}</span></Notice>}
          <TaskSummary p={p} />
          <AvailabilityPanel title="Who can take it" args={availArgs} askFor={{ task: id }} picked={f.driver}
            onPick={(d) => { if (d.username) takeSuggestion(d.username); }} onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />
          <form className="card card-b form" onSubmit={save} data-testid="give-form">
            <div className="grid2">
              <DriverSelect id="ra-driver" value={f.driver} drivers={pickOptions} onChange={pickDriver} loading={!lists.drivers && !lists.error} onTheDay={onDay}
                emptyLabel={`Choose a driver${t.driver ? ` (now ${t.driver})` : ""}`} />
              <VehicleSelect id="ra-vehicle" value={f.vehicle} def={def} vehicles={lists.vehicles ?? []} onChange={(reg) => set("vehicle", reg)}
                emptyLabel={keepLabel} choices={onDay} dayDefault={dayDefault} forTrip={vehicleWindowWords(avail.data?.vehicles.groups)}
                hint={f.driver && !def && !onDay ? `Keeps ${currentPlate || "the vehicle"}: this driver holds none today and has no regular one.` : undefined} />
            </div>
            {msg && <Notice tone="bad">{msg}</Notice>}
            <StickyActions>
              <button className="btn primary" type="submit" disabled={busy || !f.driver} data-testid="give-to">
                {busy ? "Sending…" : pickedName ? `Give to ${firstName(pickedName)}${plate ? ` · ${plate}` : ""}` : "Pick a driver above"}
              </button>
              <Link className="btn" to={`/tasks/${id}/edit${q}`} data-testid="change-trip">Change the time or the trip →</Link>
            </StickyActions>
          </form>
          {cancelBox}
        </div>
      </section>
    );
  }

  return (
    <section className="view" data-testid="task-edit">
      <PageTop title={t.title || "Task"} sub={<><Pill tone={taskTone(t.status)}>{cap(t.status)}</Pill> <span className="mono">{t.start}</span></>} backTo={back} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        {reason && <Notice tone="bad"><b>Needs a driver.</b> {reason}</Notice>}
        {canChange && (
          <form className="card card-b form" onSubmit={save}>
            <h2>{needsDriver ? "Give it to a driver" : running ? "Change the words (the task is under way)" : "Change the task"}</h2>
            {!running && (
              <>
                <div className="grid2">
                  <DriverSelect id="ra-driver" value={f.driver} drivers={pickOptions} onChange={pickDriver} autoFocus={driverMode} loading={!lists.drivers && !lists.error} onTheDay={onDay}
                    emptyLabel={needsDriver ? `Choose a driver${t.driver ? ` (now ${t.driver})` : ""}` : `Keep${t.driver ? ` (${t.driver})` : ""}`}
                    emptyChoice={needsDriver ? undefined : `Keep${t.driver ? ` (${t.driver})` : ""}`} />
                  <VehicleSelect id="ra-vehicle" value={f.vehicle} def={def} vehicles={lists.vehicles ?? []} onChange={(reg) => set("vehicle", reg)}
                    emptyLabel={keepLabel} choices={onDay} dayDefault={dayDefault} forTrip={vehicleWindowWords(avail.data?.vehicles.groups)}
                    hint={f.driver && !def && !onDay ? `Keeps ${currentPlate || "the vehicle"}: this driver holds none today and has no regular one.` : undefined} />
                </div>
                <div className="grid2">
                  <div className="field"><span className="lab">Day</span><TripDayPicker id="ra-date" label="Day" value={f.date} onChange={(d) => set("date", d)} /></div>
                  <div className="field">
                    <label htmlFor="ra-time">Leave by</label>
                    <TimeField id="ra-time" value={f.time} onCommit={(time) => set("time", time)} />
                    <DepartureNote check={check} onUse={(time) => set("time", time)} />
                  </div>
                  <div className="field"><label htmlFor="ra-end">Vehicle free again by</label><TimeField id="ra-end" value={f.end} onCommit={(end) => set("end", end)} /></div>
                </div>
              </>
            )}
            <div className="grid2">
              <div className="field"><label htmlFor="ra-title">Title</label><input id="ra-title" maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-pax">Passengers</label><input type="number" id="ra-pax" min={0} max={80} inputMode="numeric" value={f.passengers} onChange={(e) => set("passengers", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-contact">Contact name</label><input id="ra-contact" maxLength={120} value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-phone">Contact phone</label><input id="ra-phone" maxLength={30} value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
            </div>
            {riding && <PassengersField id="ra" value={f.riders ?? []} onChange={(r) => set("riders", r)} count={f.passengers} />}
            <div className="field"><label htmlFor="ra-notes">Notes for the driver</label><textarea id="ra-notes" maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            {msg && <Notice tone="bad">{msg}</Notice>}
            <StickyActions><button className="btn dark" type="submit" disabled={busy}>{needsDriver ? "Reassign" : "Save changes"}</button></StickyActions>
          </form>
        )}
        {canChange && !running && (
          <AvailabilityPanel args={availArgs} askFor={{ task: id }} picked={pickedDriver} onPick={(d) => { if (d.username) takeSuggestion(d.username); }}
            onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />
        )}
        {p.suggestions && canChange && (
          <div className="card card-b" data-testid="suggestions" style={{ display: "grid", gap: 8 }}>
            <b>Free at that time</b>
            <div className="chips">
              {p.suggestions.drivers.length
                ? p.suggestions.drivers.map((d) => (
                  <ChoiceChip key={d.username ?? d.name} selected={!!d.username && f.driver === d.username} title={d.availability} onClick={() => pickDriver(d.username ?? "")}>{d.name}</ChoiceChip>
                ))
                : <span className="muted small">No driver is free then.</span>}
            </div>
            <div className="chips">
              {p.suggestions.vehicles.length
                ? p.suggestions.vehicles.map((v) => (
                  <ChoiceChip key={v.reg_no} selected={f.vehicle === v.reg_no} title={v.availability} onClick={() => set("vehicle", v.reg_no)}>{v.reg_no}</ChoiceChip>
                ))
                : <span className="muted small">No vehicle is free then.</span>}
            </div>
          </div>
        )}
        {cancelBox}
        {!canChange && !canCancel && <Notice tone="info">This task can no longer be changed.</Notice>}
      </div>
    </section>
  );
}
