// Change a task (/tasks/:id/edit, Phase 6): the day and leave-by time (the
// plan shifts with it), the end time, the driver, the vehicle, the title,
// passengers, contact and notes, through update_task with the task's
// plan_version; who is free then beside the picks, and the free drivers of a
// declined task as chips; Cancel with a reason. A task under way takes only
// the words. Typed input is kept as a draft for this task.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { UpdateTaskResult } from "../data/types";
import { cap, plateOf, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { availabilityArgs } from "./availabilityLogic";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { TONE, useBoardQuery, useTask } from "./TaskDetail";

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
}

const EMPTY: EditForm = { driver: "", vehicle: "", date: "", time: "", end: "", title: "", passengers: "", contactName: "", contactPhone: "", notes: "", reason: "" };

/** The form as the task is now (the driver and vehicle selects start at "Keep"). */
const fromTask = (t: { date?: string; time?: string; end_by?: string; title: string; passengers?: number | null; contact?: { name?: string | null; phone?: string | null }; notes?: string | null }): EditForm => ({
  ...EMPTY,
  date: t.date ?? "",
  time: t.time ?? "",
  end: t.end_by ?? "",
  title: t.title,
  passengers: t.passengers == null ? "" : String(t.passengers),
  contactName: t.contact?.name ?? "",
  contactPhone: t.contact?.phone ?? "",
  notes: t.notes ?? "",
});
const untouched = (f: EditForm) => JSON.stringify(f) === JSON.stringify(EMPTY);

/** update_task takes only what differs from the task. Pure. */
export function updateTaskInput(id: string, version: number, f: EditForm, t: { date?: string; time?: string; end_by?: string; title: string; passengers?: number | null; contact?: { name?: string | null; phone?: string | null }; notes?: string | null }): { error: string } | { input: Record<string, unknown> } {
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
  if (Object.keys(input).length === 2) return { error: "Nothing changed." };
  return { input };
}

export function TaskEdit() {
  const { id = "" } = useParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
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
  // The fields start from the task once it is loaded (a draft resumed later replaces them).
  useEffect(() => {
    if (p && untouched(f)) draft.reset(fromTask(p.task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.task.id, p?.task.plan_version]);

  if (err) return <><PageTop title="Task" backTo={back} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Task" backTo={back} /><Loading>Loading the task…</Loading></>;
  const t = p.task;
  const declined = t.status === "declined";
  const running = t.status === "in_progress";
  const canChange = (t.status === "assigned" || declined || running) && me.tools.includes("update_task");
  const canCancel = (t.status === "assigned" || running || declined) && me.tools.includes("cancel_task");
  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const currentDriver = drivers.find((d) => d.name === t.driver);
  const pickedDriver = f.driver || currentDriver?.username || "";
  const availArgs = running ? null : availabilityArgs(f.date, f.time, f.end);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const v = updateTaskInput(id, t.plan_version ?? 0, f, t);
    if ("error" in v) {
      if (declined && !f.driver) {
        setMsg("Choose the driver first.");
        return;
      }
      if (!declined) {
        setMsg(v.error === "Nothing changed." ? "Choose what to change first." : v.error);
        return;
      }
    }
    const input = "input" in v ? v.input : { task_id: id, plan_version: t.plan_version ?? 0, driver: f.driver };
    setBusy(true);
    try {
      const out = await transport.call<UpdateTaskResult>("update_task", input);
      draft.clear();
      toast(declined && f.driver ? "Task sent to the driver" : "Task changed");
      void store.invalidate();
      navigate(back, { state: { warnings: warnList(out) } });
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
      navigate(`/tasks${q}`);
    } catch (e) {
      setCxMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <section className="view" data-testid="task-edit">
      <PageTop title={t.title || "Task"} sub={<><Pill tone={TONE[t.status] ?? ""}>{cap(t.status)}</Pill> <span className="mono">{t.start}</span></>} backTo={back} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        {t.declined && (
          <Notice tone="bad">
            Declined{t.declined.after_accept ? " after accepting" : ""}{t.declined.at ? ` at ${t.declined.at}` : ""}: {t.declined.reason_text ?? t.declined.reason ?? "no reason given"}
            {t.declined.note ? ` · “${t.declined.note}”` : ""}. Give it to another driver, or cancel it.
          </Notice>
        )}
        {p.suggestions && canChange && (
          <div className="card card-b" data-testid="suggestions" style={{ display: "grid", gap: 8 }}>
            <b>Free at that time</b>
            <div className="chips">
              {p.suggestions.drivers.length
                ? p.suggestions.drivers.map((d) => (
                  <button type="button" key={d.username ?? d.name} className="chip" aria-pressed={!!d.username && f.driver === d.username} title={d.availability} onClick={() => set("driver", d.username ?? "")}>{d.name}</button>
                ))
                : <span className="muted small">No driver is free then.</span>}
            </div>
            <div className="chips">
              {p.suggestions.vehicles.length
                ? p.suggestions.vehicles.map((v) => (
                  <button type="button" key={v.reg_no} className="chip" aria-pressed={f.vehicle === v.reg_no} title={v.availability} onClick={() => set("vehicle", v.reg_no)}>{v.reg_no}</button>
                ))
                : <span className="muted small">No vehicle is free then.</span>}
            </div>
          </div>
        )}
        {canChange && (
          <form className="card card-b form" onSubmit={save}>
            <h2>{declined ? "Give it to a driver" : running ? "Change the words (the task is under way)" : "Change the task"}</h2>
            {!running && (
              <div className="grid2">
                <div className="field"><label htmlFor="ra-driver">Driver</label>
                  <select id="ra-driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}><option value="">Keep{t.driver ? ` (${t.driver})` : ""}</option>{drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}</select></div>
                <div className="field"><label htmlFor="ra-vehicle">Vehicle</label>
                  <select id="ra-vehicle" value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)}><option value="">Keep{t.vehicle ? ` (${plateOf(t.vehicle)})` : ""}</option>{(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}</select></div>
                <div className="field"><label htmlFor="ra-date">Day</label><input type="date" id="ra-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
                <div className="field"><label htmlFor="ra-time">Leave by</label><input type="time" id="ra-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
                <div className="field"><label htmlFor="ra-end">Vehicle free again by</label><input type="time" id="ra-end" value={f.end} onChange={(e) => set("end", e.target.value)} /></div>
              </div>
            )}
            <div className="grid2">
              <div className="field"><label htmlFor="ra-title">Title</label><input id="ra-title" maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-pax">Passengers</label><input type="number" id="ra-pax" min={0} max={80} inputMode="numeric" value={f.passengers} onChange={(e) => set("passengers", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-contact">Contact name</label><input id="ra-contact" maxLength={120} value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-phone">Contact phone</label><input id="ra-phone" maxLength={30} value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="ra-notes">Notes for the driver</label><textarea id="ra-notes" maxLength={1000} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
            {msg && <Notice tone="bad">{msg}</Notice>}
            <StickyActions><button className="btn dark" type="submit" disabled={busy}>{declined ? "Reassign" : "Save changes"}</button></StickyActions>
          </form>
        )}
        {canChange && !running && <AvailabilityPanel args={availArgs} picked={pickedDriver} onPick={(d) => { if (d.username) set("driver", d.username); }} />}
        {canCancel && (
          <div className="confirm" id="cancel">
            <div className="field"><label htmlFor="cx-reason">Cancel this task</label><input id="cx-reason" maxLength={300} placeholder="Reason the driver will see" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></div>
            {cxMsg && <Notice tone="bad">{cxMsg}</Notice>}
            <button type="button" className="btn danger" onClick={() => void cancel()} disabled={busy}>Cancel task</button>
          </div>
        )}
        {!canChange && !canCancel && <Notice tone="info">This task can no longer be changed.</Notice>}
      </div>
    </section>
  );
}
