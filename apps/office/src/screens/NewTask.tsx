// Assign a task, as a page (/tasks/new): the stops as rows (type, place,
// arrive-by on each; numbered within the type), the start place, Return to
// office and No expressway, the date and the leave-by time (typed, or planned
// from the stops' deadlines), the plan in one line above Save with the exact
// reason when there is none (1.5 s after the last edit, or Plan now), the
// driver and vehicle, the project split. Everything typed is kept as a draft.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { CreateTaskResult, FindProject, PlanPreview } from "../data/types";
import { num, plateOf, splitEqually, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { Icon } from "../ui/icons";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { type AssignFields, driverWhatsApp, emptyAssign, planInput, type ProjectRow, splitTotal, validateAssign } from "./assignLogic";
import { PlanPanel } from "./PlanPanel";
import { planReasons } from "./planLogic";
import { StopsRows } from "./StopsEditor";
import { defaultStops } from "./stopsLogic";

const SPLIT_COLORS = ["var(--accent)", "var(--live)", "var(--ok)", "var(--bad)", "var(--muted)"];
/** The plan preview is computed this long after the last edit (or at once with Plan now): every call may count against a daily cap. */
export const PLAN_DEBOUNCE_MS = 1500;

interface Form {
  f: AssignFields;
  rows: ProjectRow[];
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function NewTask() {
  const { me, store, transport } = useFleet();
  const toast = useToast();
  const lists = useLists();
  const [params] = useSearchParams();
  const date = isDate(params.get("date")) ? params.get("date")! : today();
  const [state, setState, draft] = useFormDraft<Form>("task-new", null, () => ({ f: emptyAssign(date), rows: [] }));
  const { f, rows } = state;
  const setF = (patch: Partial<AssignFields> | ((x: AssignFields) => AssignFields)) =>
    setState((s) => ({ ...s, f: typeof patch === "function" ? patch(s.f) : { ...s.f, ...patch } }));
  const setRows = (fn: (rs: ProjectRow[]) => ProjectRow[]) => setState((s) => ({ ...s, rows: fn(s.rows) }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "" | "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The plan preview follows the form, 1.5 s after the last change; Plan now skips the wait.
  const planKey = JSON.stringify(planInput(f));
  const runPlan = async (key: string) => {
    const input = JSON.parse(key) as Record<string, unknown> | null;
    if (!input) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    setPlanning(true);
    try {
      const p = await transport.call<PlanPreview>("plan_task", input);
      setPreview(p);
      setPreviewErr(null);
    } catch (e) {
      setPreviewErr(errText(e as FleetError)[0]);
    }
    setPlanning(false);
  };
  useEffect(() => {
    if (planTimer.current) clearTimeout(planTimer.current);
    if (!JSON.parse(planKey)) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    planTimer.current = setTimeout(() => void runPlan(planKey), PLAN_DEBOUNCE_MS);
    return () => { if (planTimer.current) clearTimeout(planTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, transport]);
  const planNow = () => {
    if (planTimer.current) clearTimeout(planTimer.current);
    void runPlan(planKey);
  };

  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const vehicles = lists.vehicles ?? [];
  const set = <K extends keyof AssignFields>(k: K, v: AssignFields[K]) => setF({ [k]: v } as Partial<AssignFields>);

  function pickDriver(username: string) {
    const d = drivers.find((x) => x.username === username);
    setF((x) => ({ ...x, driver: username, vehicle: d?.current_vehicle && !x.vehicle ? plateOf(d.current_vehicle) : x.vehicle }));
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
    const v = validateAssign(f, rows, me.name);
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<CreateTaskResult>("create_task", v.input);
      const drv = drivers.find((x) => x.username === v.input.driver);
      const wa = f.whatsapp && drv?.phone ? driverWhatsApp(v.input, drv.phone, p.leave_by ? `Leave by ${p.leave_by}` : undefined) : "";
      draft.clear();
      setMsg({
        tone: "ok",
        warnings: warnList(p),
        text: (
          <>
            <b>Sent to {drv ? drv.name : String(v.input.driver)}.</b> Leave by {p.leave_by?.slice(-5) ?? "—"}. The task is in their Fame Driver app.{" "}
            {p.task_id && <Link className="btn small" to={`/tasks/${p.task_id}`}>Open task</Link>}{" "}
            <Link className="btn small" to={`/tasks${v.input.date !== today() ? `?date=${v.input.date}` : ""}`}>The board</Link>{" "}
            {wa ? <a className="btn small" href={wa} target="_blank" rel="noopener">WhatsApp the driver</a>
              : f.whatsapp ? <span className="small">No phone number saved for this driver, so no WhatsApp link.</span> : null}
          </>
        ),
      });
      setState({ f: { ...f, title: "", notes: "", cname: "", cphone: "", pax: "", end: "", leaveBy: "", stops: defaultStops() }, rows: [] });
      setPreview(null);
      toast("Task sent");
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  const total = splitTotal(rows);
  const reasons = planReasons({ date: f.date, stops: f.stops, leaveBy: f.leaveBy, start: f.start, returnToBase: f.returnToBase }, preview, previewErr);
  const backTo = `/tasks${date !== today() ? `?date=${date}` : ""}`;

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
            <div className="field"><label htmlFor="af-date">Date</label><input type="date" id="af-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="field"><label htmlFor="af-leave">Leave by</label><input type="time" id="af-leave" value={f.leaveBy} onChange={(e) => set("leaveBy", e.target.value)} /><span className="hint">Empty: planned from the stops’ arrive-by times.</span></div>
          </div>
        </div>

        <div className="card card-b form">
          <div className="field"><label htmlFor="af-start">Start from</label><input id="af-start" list="st-places" maxLength={160} placeholder="The base place (Settings → Fleet)" value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
          <span className="lab">Stops</span>
          <StopsRows list={f.stops} onChange={(stops) => set("stops", stops)} places={lists.places ?? []} />
          <div className="grid2">
            <span className="check"><input type="checkbox" id="af-return" checked={f.returnToBase} onChange={(e) => set("returnToBase", e.target.checked)} /> <label htmlFor="af-return">Return to office</label></span>
            <span className="check"><input type="checkbox" id="af-noexp" checked={f.avoidExpressway} onChange={(e) => set("avoidExpressway", e.target.checked)} /> <label htmlFor="af-noexp">No expressway</label></span>
          </div>
        </div>

        <div className="card card-b form" data-testid="plan-card">
          <div className="row" style={{ padding: 0 }}>
            <b className="grow">Plan</b>
            <button type="button" className="btn small" onClick={planNow} disabled={planning || !JSON.parse(planKey)}>{planning ? "Planning…" : "Plan now"}</button>
          </div>
          <PlanPanel preview={preview} reasons={reasons} />
        </div>

        <div className="card card-b form">
          <div className="grid2">
            <div className="field">
              <label htmlFor="af-driver">Driver</label>
              <select id="af-driver" value={f.driver} onChange={(e) => pickDriver(e.target.value)}>
                <option value="">{lists.drivers ? "Choose a driver" : lists.error ? "Couldn’t load" : "Loading…"}</option>
                {drivers.map((d) => <option key={d.username} value={d.username}>{d.name}{d.current_vehicle ? ` · ${d.current_vehicle}` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="af-vehicle">Vehicle</label>
              <select id="af-vehicle" value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)}>
                <option value="">{lists.vehicles ? "Choose a vehicle" : lists.error ? "Couldn’t load" : "Loading…"}</option>
                {vehicles.map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}{v.make_model ? ` · ${v.make_model}` : ""}{v.status ? ` · ${v.status}` : ""}</option>)}
              </select>
            </div>
          </div>
          {lists.error && (!lists.drivers || !lists.vehicles) && <Notice>Couldn’t load the {!lists.drivers && !lists.vehicles ? "drivers and vehicles" : !lists.drivers ? "drivers" : "vehicles"}: {lists.error} <button type="button" className="btn small" onClick={lists.reload}>Try again</button></Notice>}
          <div className="grid2">
            <div className="field"><label htmlFor="af-end">Vehicle free by</label><input type="time" id="af-end" value={f.end} onChange={(e) => set("end", e.target.value)} /></div>
            <div className="field"><label htmlFor="af-pax">Passengers</label><input type="number" id="af-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
          </div>
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
          <div className="field">
            <span className="lab">Send to driver</span>
            <span className="check"><input type="checkbox" checked disabled id="af-app" /> <label htmlFor="af-app">Fame Driver app (always)</label></span>
            <span className="check"><input type="checkbox" id="af-wa" checked={f.whatsapp} onChange={(e) => set("whatsapp", e.target.checked)} /> <label htmlFor="af-wa">Also give me a WhatsApp message with the details</label></span>
          </div>
        </div>

        {msg && (
          <div>
            <Notice tone={msg.tone}>{msg.text}</Notice>
            {msg.warnings && <WarningsNote warnings={msg.warnings} />}
          </div>
        )}
        <StickyActions>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Assign & send"}</button>
        </StickyActions>
      </form>
    </section>
  );
}
