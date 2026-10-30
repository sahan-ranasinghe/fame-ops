// Edit a task's stops (/tasks/:id/stops): the route card (Fix B, 29 October
// 2026: From / To / Add stop): From is the task's start, read only, with its
// ⋯ Options (People get in there) while the task is not under way; the pending
// stops as rows (named by their place among the stops still on the task: the
// reached stops keep their numbers), each with its ⋯ Options; the leave-by time checked at once
// against the arrive-by times, the plan as a timeline as they change, Save →
// update_task_stops with the loaded plan version (a stale one is refused with
// "changed since you loaded it").
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { flashWarnings } from "../data/flash";
import type { UpdateStopsResult } from "../data/types";
import { hhmm, joinDots, today } from "../lib/format";
import { errText } from "../transport/errors";
import { changeOutcome } from "./approvalLogic";
import type { FleetError } from "../transport/types";
import { Loading, Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { cameFromTask, PageTop, StickyActions, useAfterSave } from "../ui/Page";
import { TimeField } from "../ui/TimeField";
import { useToast } from "../ui/Toast";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DepartureNote, useFleetSettings, usePlanPreview } from "./dispatchParts";
import { dwellFallbacks, planReasons, rowStopNumbers } from "./planLogic";
import { PlanWithMap } from "./PlanMap";
import { StartOptions, StopsRows } from "./StopsEditor";
import { draftsFromStops, dwellText, openStops, type StartFields, startExtras, type StopDraft, stopsInput, tickStart, tidyStops } from "./stopsLogic";
import { useBoardQuery, useTask } from "./TaskDetail";

interface StopsForm extends Pick<StartFields, "startWhat" | "startNote" | "startDwell"> {
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
  const afterSave = useAfterSave();
  const fromTask = cameFromTask(useLocation().state);
  const toast = useToast();
  const { p, err } = useTask(taskId);
  const back = `/tasks/${taskId}${useBoardQuery()}`;
  const settings = useFleetSettings();
  // Fix B: a draft put back opens without its empty rows (openStops; the task's stops already do, draftsFromStops).
  const [form, setForm, draft] = useFormDraft<StopsForm | null>("task-stops.v2", taskId, null, true, (x) => (x ? { ...x, list: openStops(x.list) } : x));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef<number>(0);

  // The task's pending stops become the rows the first time the task loads (a draft wins); the start stop is the tick.
  useEffect(() => {
    if (!p || form !== null) return;
    version.current = p.task.plan_version ?? 0;
    const pending = p.stops.filter((s) => s.status === "pending");
    const own = pending.find((s) => s.is_start);
    draft.reset({
      list: draftsFromStops(pending.filter((s) => !s.is_start)),
      startPax: !!own,
      startWhat: own?.what && own.what !== "people" ? own.what as StartFields["startWhat"] : "",
      startNote: own?.note ?? "",
      startDwell: own?.dwell_source === "chosen" && own.dwell_min != null ? String(own.dwell_min) : "",
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

  // The start for "Passengers get in here": the task's start as task_detail gives it (its place, a Google start by its id,
  // else its pin), with the start stop's own what, note and time there.
  const startArg = (): Record<string, unknown> | undefined => {
    if (!startPax || !form) return undefined;
    return {
      ...(t?.start_place_id ? { place_id: t.start_place_id } : t?.start_google_place_id ? { google_place_id: t.start_google_place_id } : {}),
      ...(t?.start_place ? { place: t.start_place } : {}),
      ...(!t?.start_place_id && !t?.start_google_place_id && t?.start_lat != null && t?.start_lng != null ? { lat: t.start_lat, lng: t.start_lng } : {}),
      passengers: true,
      ...startExtras(form),
    };
  };
  function planArgs(): Record<string, unknown> | null {
    if (!form || !t) return null;
    const s = stopsInput(form.list, offset);
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

  // The task's end time is its back-by: a plan that ends after it says so beside Leave by (§20; it is changed on the task's edit page).
  const dPlan = running ? null : departurePlan(preview?.timeline, preview?.plan?.buffer_min, t?.end_by);
  // The planner advises (21 October 2026): its leave time is a grey suggestion, never filled in; a chosen time is checked.
  const suggestions = settings.data?.settings.planner_suggestions !== false;
  const raw = form && suggestions ? checkDeparture(form.leaveBy, dPlan) : null;
  const check = raw?.kind === "fill" ? null : raw;
  const suggestedLeave = form && !form.leaveBy && raw?.kind === "fill" ? raw.leaveBy : undefined;

  async function save() {
    if (!form) return;
    // Fix B: the rows with nothing in them go once To has one (tidyStops); the form shows what is sent.
    const list = tidyStops(form.list, !!t?.return_to_base);
    if (list !== form.list) setForm((x) => (x ? { ...x, list } : x));
    const v = stopsInput(list, offset);
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
      // Round 48 (item 1): without approve the new stops wait for the fleet admin; the task is as it was.
      const outcome = changeOutcome(out, `Stops saved · leave by ${out.leave_by?.slice(-5) ?? "—"}`);
      toast(outcome.toast);
      void store.invalidate();
      if (outcome.waiting) {
        afterSave(back);
        return;
      }
      // As a change on the task's change page: back to where the person came from, the warnings read on the task page.
      const warnings = out.warnings ?? [];
      flashWarnings(taskId, warnings);
      if (warnings.length && !fromTask) navigate(back, { replace: true, state: { warnings } });
      else afterSave(back);
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
  const lateKey = check?.kind === "late" && !check.back ? keyOf(check.n) : undefined;
  const moveArriveBy = (n: number, time: string) => {
    const key = keyOf(n);
    if (key) set({ list: form.list.map((s) => (s.key === key ? { ...s, arriveBy: time } : s)) });
  };
  const startStop = preview?.stops.find((s) => s.is_start);
  const reasons = planReasons({ date, stops: form.list, leaveBy: form.leaveBy || (t.leave_by ? hhmm(t.leave_by) : ""), start: t.start_place ?? "", returnToBase: !!t.return_to_base, offset }, preview, previewErr);
  return (
    <section className="view" data-testid="task-stops">
      <PageTop title={`Stops · ${t.title}`} sub="In the order the driver visits them" backTo={back} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        <div className="card card-b form">
          {!running && (
            <div className="field">
              <label htmlFor="ts-leave">Leave by</label>
              <TimeField id="ts-leave" value={form.leaveBy} onCommit={(leaveBy) => set({ leaveBy })} suggested={suggestedLeave} />
              {check
                ? <DepartureNote check={check} onUse={(time) => set({ leaveBy: time })} onMove={(n, time) => moveArriveBy(n, time)} />
                : <span className="hint">{suggestedLeave ? `Suggested ${suggestedLeave} from the stops’ arrive-by times. Change it if you like.` : "Empty: planned from the stops’ arrive-by times."}</span>}
            </div>
          )}
          <StopsRows list={form.list} onChange={(list) => set({ list })} idPrefix="ts" offset={offset} back={!!t.return_to_base}
            fallbacks={suggestions ? dwellFallbacks(form.list, preview?.stops, settings.data?.settings.dwell_min) : undefined}
            start={!running && t.start_place ? { name: t.start_place } : null} startIsStop={startPax}
            onTickStart={running ? undefined : (i) => {
              const r = tickStart(form.list, i, !!t.return_to_base);
              set({ list: r.list, startPax: true, ...r.carried });
            }}
            note={(s) => (s.key === lateKey ? <DepartureNote check={check} onUse={(time) => set({ leaveBy: time })} onMove={moveArriveBy} testId="departure-check-stop" /> : null)}
            from={(
              // From is the task's start, read only here (it is changed on the task's edit page); People get in there under ⋯ Options.
              <div className="route-start" data-testid="start-from">
                <span className="route-lab">From</span>
                <div className="route-field">
                  <span className="grow">{t.start_place ?? "The base place"}</span>
                  {!running && <StartOptions id="ts-start" value={form} onChange={(patch) => set(patch as Partial<StopsForm>)} name={t.start_place ?? ""} />}
                </div>
                {startPax
                  ? (
                    <span className="route-cap" data-testid="start-stop">
                      Stop 1 · Pickup · {t.start_place ?? "the start"}{startStop?.dwell_min != null ? ` · ${dwellText(startStop.dwell_min)} there` : ""}. The next stop is Stop 2.
                    </span>
                  )
                  : <span className="route-cap">{running ? (reached ? `Under way · ${reached} stop${reached > 1 ? "s" : ""} reached` : "Under way") : "Leave from here"}</span>}
              </div>
            )}
            after={t.return_to_base || t.avoid_expressway
              ? <p className="muted small" style={{ margin: 0 }} data-testid="route-after">{joinDots([t.return_to_base ? "Then back to the office" : "", t.avoid_expressway ? "No expressway" : ""])}</p>
              : undefined} />
        </div>
        <div className="card card-b form" data-testid="plan-card">
          <div className="row" style={{ padding: 0 }}>
            <b className="grow">Plan</b>
            {plan.fetching && <span className="muted">Planning…</span>}
          </div>
          <PlanWithMap timeline={preview?.timeline} plan={preview?.plan} startName={preview?.start?.name} reasons={reasons} updating={plan.updating} offset={reached}
            stops={preview?.stops} start={preview?.start} />
        </div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>Save stops</button>
        </StickyActions>
      </div>
    </section>
  );
}
