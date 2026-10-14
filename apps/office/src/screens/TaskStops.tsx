// Edit a task's stops (/tasks/:id/stops): the pending stops as rows, the
// plan in one line as they change, Save → update_task_stops with the loaded
// plan version (a stale one is refused with "changed since you loaded it").
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { PlanPreview, UpdateStopsResult } from "../data/types";
import { hhmm, today } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { PLAN_DEBOUNCE_MS } from "./NewTask";
import { PlanPanel } from "./PlanPanel";
import { planReasons } from "./planLogic";
import { StopsRows } from "./StopsEditor";
import { draftsFromStops, type StopDraft, stopsInput } from "./stopsLogic";
import { useBoardQuery, useTask } from "./TaskDetail";

export function TaskStops() {
  const { id = "" } = useParams();
  const { store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const lists = useLists();
  const { p, err } = useTask(id);
  const back = `/tasks/${id}${useBoardQuery()}`;
  const [list, setList, draft] = useFormDraft<StopDraft[] | null>("task-stops", id, null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef<number>(0);

  // The task's pending stops become the rows the first time the task loads (a draft wins).
  useEffect(() => {
    if (!p || list !== null) return;
    version.current = p.task.plan_version ?? 0;
    setList(draftsFromStops(p.stops.filter((s) => s.status === "pending")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  useEffect(() => {
    if (p) version.current = p.task.plan_version ?? 0;
  }, [p]);

  const t = p?.task;
  const date = t?.leave_by && /^\d{4}-\d{2}-\d{2}/.test(t.leave_by) ? t.leave_by.slice(0, 10) : today();
  const planFields = { date, stops: list ?? [], leaveBy: t?.leave_by_source === "manual" ? hhmm(t.leave_by) : "", start: t?.start_place ?? "", returnToBase: !!t?.return_to_base };
  const planKey = JSON.stringify(list && t ? planArgs() : null);
  function planArgs(): Record<string, unknown> | null {
    if (!list || !t) return null;
    const s = stopsInput(list);
    if ("error" in s) return null;
    const input: Record<string, unknown> = { date, stops: s.stops };
    if (t.leave_by_source === "manual" && t.leave_by) input.leave_by = hhmm(t.leave_by);
    if (t.start_place) input.start = { place: t.start_place };
    if (t.return_to_base) input.return_to_base = true;
    if (t.avoid_expressway) input.avoid_expressway = true;
    return input;
  }
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const input = JSON.parse(planKey) as Record<string, unknown> | null;
    if (!input) {
      setPreview(null);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setPreview(await transport.call<PlanPreview>("plan_task", input));
        setPreviewErr(null);
      } catch (e) {
        setPreviewErr(errText(e as FleetError)[0]);
      }
    }, PLAN_DEBOUNCE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [planKey, transport]);

  async function save() {
    if (!list) return;
    const v = stopsInput(list);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      const out = await transport.call<UpdateStopsResult>("update_task_stops", { task_id: id, plan_version: version.current, stops: v.stops });
      draft.clear();
      toast(`Stops saved · leave by ${out.leave_by?.slice(-5) ?? "—"}`);
      void store.invalidate();
      navigate(back);
    } catch (e) {
      const text = errText(e as FleetError)[0];
      setMsg(/changed since/i.test(text) ? `${text} Go back to the task and open the stops again.` : text);
      setBusy(false);
    }
  }

  if (err) return <><PageTop title="Stops" backTo={back} /><Notice tone="bad">{err}</Notice></>;
  if (!p || list === null) return <><PageTop title="Stops" backTo={back} /><Loading>Loading the task…</Loading></>;
  const reasons = planReasons(planFields, preview, previewErr);
  return (
    <section className="view" data-testid="task-stops">
      <PageTop title={`Stops · ${p.task.title}`} sub="In the order the driver visits them" backTo={back} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        <div className="card card-b form">
          <StopsRows list={list} onChange={setList} places={lists.places ?? []} idPrefix="ts" />
        </div>
        <div className="card card-b form"><b>Plan</b><PlanPanel preview={preview} reasons={reasons} /></div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>Save stops</button>
        </StickyActions>
      </div>
    </section>
  );
}
