// Edit a task's stops (/tasks/:id/stops): the pending stops as rows (named by
// their place among the stops still on the task, with the time at each stop),
// "Passengers get in here" at the start, the leave-by time checked at once
// against the arrive-by times, the plan as a timeline as they change, Save →
// update_task_stops with the loaded plan version (a stale one is refused with
// "changed since you loaded it").
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import type { UpdateStopsResult } from "../data/types";
import { hhmm, today } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DepartureNote, useFleetSettings, usePlanPreview } from "./dispatchParts";
import { dwellFallbacks, planReasons, rowStopNumbers } from "./planLogic";
import { PlanTimeline } from "./PlanTimeline";
import { StopsRows } from "./StopsEditor";
import { draftsFromStops, dwellText, type StopDraft, stopsInput, tickStart } from "./stopsLogic";
import { useBoardQuery, useTask } from "./TaskDetail";

interface StopsForm {
  list: StopDraft[];
  /** Passengers get in at the start: it is Stop 1 (a task not under way). */
  startPax: boolean;
  /** The leave-by time typed; "" = planned from the arrive-by times. */
  leaveBy: string;
}

export function TaskStops() {
  const { id: taskId = "" } = useParams();
  const { store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const { p, err } = useTask(taskId);
  const back = `/tasks/${taskId}${useBoardQuery()}`;
  const settings = useFleetSettings();
  const [form, setForm, draft] = useFormDraft<StopsForm | null>("task-stops.v2", taskId, null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef<number>(0);

  // The task's pending stops become the rows the first time the task loads (a draft wins); the start stop is the tick.
  useEffect(() => {
    if (!p || form !== null) return;
    version.current = p.task.plan_version ?? 0;
    const pending = p.stops.filter((s) => s.status === "pending");
    draft.reset({
      list: draftsFromStops(pending.filter((s) => !s.is_start)),
      startPax: pending.some((s) => s.is_start),
      leaveBy: p.task.leave_by_source === "manual" && p.task.status === "assigned" ? hhmm(p.task.leave_by) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  useEffect(() => {
    if (p) version.current = p.task.plan_version ?? 0;
  }, [p]);

  const t = p?.task;
  const running = t?.status === "in_progress";
  const date = t?.leave_by && /^\d{4}-\d{2}-\d{2}/.test(t.leave_by) ? t.leave_by.slice(0, 10) : t?.date ?? today();
  // Stops already reached (arrived, done, skipped) keep their numbers; the rows come after them.
  const reached = p ? p.stops.filter((s) => s.status !== "pending").length : 0;
  const startPax = !!form?.startPax && !running;
  const offset = reached + (startPax ? 1 : 0);

  const startArg = (): Record<string, unknown> | undefined => (startPax ? { ...(t?.start_place ? { place: t.start_place } : {}), passengers: true } : undefined);
  function planArgs(): Record<string, unknown> | null {
    if (!form || !t) return null;
    const s = stopsInput(form.list);
    if ("error" in s) return null;
    const input: Record<string, unknown> = { date, stops: s.stops };
    if (!running && form.leaveBy) input.leave_by = form.leaveBy;
    else if (!form.list.some((x) => x.arriveBy) && t.leave_by) input.leave_by = hhmm(t.leave_by);
    const start = startArg();
    if (start) input.start = start;
    else if (t.start_place) input.start = { place: t.start_place };
    if (t.return_to_base) input.return_to_base = true;
    if (t.avoid_expressway) input.avoid_expressway = true;
    return input;
  }
  const plan = usePlanPreview(planArgs());
  const preview = plan.err ? null : plan.data ?? null;
  const previewErr = plan.err ? errText(plan.err)[0] : null;

  const dPlan = running ? null : departurePlan(preview?.timeline, preview?.plan?.buffer_min);
  const check = form ? checkDeparture(form.leaveBy, dPlan) : null;
  const fillTo = check?.kind === "fill" && !plan.stale && !plan.updating ? check.leaveBy : null;
  useEffect(() => {
    if (fillTo) setForm((x) => (x && !x.leaveBy ? { ...x, leaveBy: fillTo } : x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillTo]);

  async function save() {
    if (!form) return;
    const v = stopsInput(form.list);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      const input: Record<string, unknown> = { task_id: taskId, plan_version: version.current, stops: v.stops };
      const start = startArg();
      if (start) input.start = start;
      if (!running && form.leaveBy) input.leave_by = form.leaveBy;
      const out = await transport.call<UpdateStopsResult>("update_task_stops", input);
      draft.clear();
      toast(`Stops saved · leave by ${out.leave_by?.slice(-5) ?? "—"}`);
      void store.invalidate();
      navigate(back, { state: { warnings: out.warnings ?? [] } });
    } catch (e) {
      const text = errText(e as FleetError)[0];
      setMsg(/changed since/i.test(text) ? `${text} Go back to the task and open the stops again.` : text);
      setBusy(false);
    }
  }

  if (err) return <><PageTop title="Stops" backTo={back} /><Notice tone="bad">{err}</Notice></>;
  if (!p || !t || form === null) return <><PageTop title="Stops" backTo={back} /><Loading>Loading the task…</Loading></>;
  const set = (patch: Partial<StopsForm>) => setForm((x) => (x ? { ...x, ...patch } : x));
  const numbers = rowStopNumbers(form.list, offset);
  const keyOf = (n: number) => [...numbers].find(([, m]) => m === n + reached)?.[0];
  const lateKey = check?.kind === "late" ? keyOf(check.n) : undefined;
  const moveArriveBy = (n: number, time: string) => {
    const key = keyOf(n);
    if (key) set({ list: form.list.map((s) => (s.key === key ? { ...s, arriveBy: time } : s)) });
  };
  const startStop = preview?.stops.find((s) => s.is_start);
  const reasons = planReasons({ date, stops: form.list, leaveBy: form.leaveBy || (t.leave_by ? hhmm(t.leave_by) : ""), start: t.start_place ?? "", returnToBase: !!t.return_to_base }, preview, previewErr);
  return (
    <section className="view" data-testid="task-stops">
      <PageTop title={`Stops · ${t.title}`} sub="In the order the driver visits them" backTo={back} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        <div className="card card-b form">
          {!running && (
            <div className="grid2">
              <div className="field">
                <span className="lab">Start from</span>
                <span>{t.start_place ?? "The base place"}</span>
                <span className="check">
                  <input type="checkbox" id="ts-start-pax" checked={form.startPax} onChange={(e) => set({ startPax: e.target.checked })} />{" "}
                  <label htmlFor="ts-start-pax">Passengers get in here</label>
                </span>
                {form.startPax && (
                  <span className="hint" data-testid="start-stop">
                    Stop 1 · Pickup · {t.start_place ?? "the start"}{startStop?.dwell_min != null ? ` · ${dwellText(startStop.dwell_min)} there` : ""}. The next stop is Stop 2.
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="ts-leave">Leave by</label>
                <input type="time" id="ts-leave" value={form.leaveBy} onChange={(e) => set({ leaveBy: e.target.value })} />
                {check && check.kind !== "fill"
                  ? <DepartureNote check={check} onUse={(time) => set({ leaveBy: time })} onMove={(n, time) => moveArriveBy(n, time)} />
                  : <span className="hint">Empty: planned from the stops’ arrive-by times.</span>}
              </div>
            </div>
          )}
          <StopsRows list={form.list} onChange={(list) => set({ list })} idPrefix="ts" offset={offset}
            fallbacks={dwellFallbacks(form.list, preview?.stops, settings.data?.settings.dwell_min)}
            start={!running && t.start_place ? { name: t.start_place } : null} startIsStop={startPax}
            onTickStart={running ? undefined : (i) => {
              const r = tickStart(form.list, i);
              set({ list: r.list, startPax: true });
              if (r.note) setMsg(`The pickup's note “${r.note}” is not kept on the start stop. Put it in the task's notes (Change the task).`);
            }}
            note={(s) => (s.key === lateKey ? <DepartureNote check={check} onUse={(time) => set({ leaveBy: time })} onMove={moveArriveBy} testId="departure-check-stop" /> : null)} />
        </div>
        <div className="card card-b form" data-testid="plan-card">
          <div className="row" style={{ padding: 0 }}>
            <b className="grow">Plan</b>
            <button type="button" className="btn small" onClick={plan.refetch} disabled={plan.fetching || !planArgs()}>{plan.fetching ? "Planning…" : "Plan now"}</button>
          </div>
          <PlanTimeline timeline={preview?.timeline} plan={preview?.plan} startName={preview?.start?.name} reasons={reasons} updating={plan.updating} offset={reached} />
        </div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>Save stops</button>
        </StickyActions>
      </div>
    </section>
  );
}
