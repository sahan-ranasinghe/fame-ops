// Change a task before it starts (/tasks/:id/edit): the driver, the vehicle,
// the day and the leave-by time (reassign_task), with who is free at that
// time for a declined task; and Cancel with a reason. Typed input is kept as
// a draft for this task.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import { cap, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { TONE, useBoardQuery, useTask } from "./TaskDetail";

interface EditForm {
  driver: string;
  vehicle: string;
  date: string;
  time: string;
  reason: string;
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
  const [f, setF, draft] = useFormDraft<EditForm>("task-edit", id, { driver: "", vehicle: "", date: "", time: "", reason: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [cxMsg, setCxMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (location.hash === "#cancel") setTimeout(() => document.getElementById("cx-reason")?.focus(), 50);
  }, []);

  if (err) return <><PageTop title="Task" backTo={back} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Task" backTo={back} /><Loading>Loading the task…</Loading></>;
  const t = p.task;
  const declined = t.status === "declined";
  const canChange = (t.status === "assigned" || declined) && me.tools.includes("reassign_task");
  const canCancel = (t.status === "assigned" || t.status === "in_progress" || declined) && me.tools.includes("cancel_task");
  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);

  async function reassign(ev: FormEvent) {
    ev.preventDefault();
    const input: Record<string, unknown> = { task_id: id };
    if (f.driver) input.driver = f.driver;
    if (f.vehicle) input.vehicle = f.vehicle;
    if (f.date) input.date = f.date;
    if (f.time) input.start_time = f.time;
    if (Object.keys(input).length === 1) {
      if (!declined) {
        setMsg("Choose what to change first.");
        return;
      }
      input.driver = t.driver ?? "";
      if (!input.driver) {
        setMsg("Choose the driver first.");
        return;
      }
    }
    setBusy(true);
    try {
      const out = await transport.call("reassign_task", input);
      draft.clear();
      toast("Task changed");
      void store.invalidate();
      // Back to the task; its warnings (the vehicle is busy, a document expired, …) are shown there.
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
          <form className="card card-b form" onSubmit={reassign}>
            <h2>{declined ? "Give it to a driver" : "Change before it starts"}</h2>
            <div className="grid2">
              <div className="field"><label htmlFor="ra-driver">Driver</label>
                <select id="ra-driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}><option value="">Keep{t.driver ? ` (${t.driver})` : ""}</option>{drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-vehicle">Vehicle</label>
                <select id="ra-vehicle" value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)}><option value="">Keep{t.vehicle ? ` (${t.vehicle})` : ""}</option>{(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-date">Day</label><input type="date" id="ra-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
              <div className="field"><label htmlFor="ra-time">Leave by</label><input type="time" id="ra-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
            </div>
            {msg && <Notice tone="bad">{msg}</Notice>}
            <StickyActions><button className="btn dark" type="submit" disabled={busy}>{declined ? "Reassign" : "Save changes"}</button></StickyActions>
          </form>
        )}
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
