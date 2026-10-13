// Assign a task: the stops (inline place names, the full editor in the
// dialog), the start place, the return and expressway toggles, the leave-by
// time (typed, or planned from the stops' deadlines: the plan panel shows the
// preview as the form changes), the driver and vehicle, the project split.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { Lists } from "../data/hooks";
import type { CreateTaskResult, FindProject, PlanPreview } from "../data/types";
import { num, plateOf, splitEqually, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, WarningsNote } from "../ui/basics";
import { useDirty, useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { driverWhatsApp, emptyAssign, planInput, type ProjectRow, splitTotal, validateAssign } from "./assignLogic";
import { PlanPanel } from "./PlanPanel";
import { StopsEditor } from "./StopsEditor";
import { defaultStops, newStop, stopLabel } from "./stopsLogic";

const SPLIT_COLORS = ["var(--accent)", "var(--live)", "var(--ok)", "var(--bad)", "var(--muted)"];
const PLAN_DEBOUNCE_MS = 700;

interface Props {
  date: string;
  lists: Lists;
  onDate: (d: string) => void;
  onOpenTask: (id: string) => void;
}

export function AssignForm({ date, lists, onDate, onOpenTask }: Props) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const location = useLocation();
  const [f, setF] = useState(() => emptyAssign(date));
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "" | "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What a reload would lose (the fields a successful send clears).
  useDirty([f.title, f.notes, f.cname, f.cphone, f.pax, f.end].some((v) => v.trim() !== "") || rows.length > 0 || f.stops.some((s) => s.place.trim() !== ""));

  // The day picked on the board is the form's default day.
  useEffect(() => setF((x) => ({ ...x, date })), [date]);
  useEffect(() => {
    if ((location.state as { focus?: string } | null)?.focus === "title") {
      setTimeout(() => { titleRef.current?.scrollIntoView({ block: "center" }); titleRef.current?.focus(); }, 60);
    }
  }, [location.state]);

  // The plan preview follows the form, a moment after the last change.
  const planKey = JSON.stringify(planInput(f));
  useEffect(() => {
    const input = JSON.parse(planKey) as Record<string, unknown> | null;
    if (!input) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const p = await transport.call<PlanPreview>("plan_task", input);
        if (alive) {
          setPreview(p);
          setPreviewErr(null);
        }
      } catch (e) {
        if (alive) setPreviewErr(errText(e as FleetError)[0]);
      }
    }, PLAN_DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [planKey, transport]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setStop = (i: number, place: string) => setF((x) => ({ ...x, stops: x.stops.map((s, j) => (j === i ? { ...s, place } : s)) }));
  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const vehicles = lists.vehicles ?? [];

  function pickDriver(username: string) {
    set("driver", username);
    const d = drivers.find((x) => x.username === username);
    if (d?.current_vehicle && !f.vehicle) set("vehicle", plateOf(d.current_vehicle));
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
      setMsg({
        tone: "ok",
        warnings: warnList(p),
        text: (
          <>
            <b>Sent to {drv ? drv.name : String(v.input.driver)}.</b> Leave by {p.leave_by?.slice(-5) ?? "—"}. The task is in their Fame Driver app.{" "}
            {p.task_id && <button type="button" className="btn small" onClick={() => onOpenTask(p.task_id)}>Open task</button>}{" "}
            {wa ? <a className="btn small" href={wa} target="_blank" rel="noopener">WhatsApp the driver</a>
              : f.whatsapp ? <span className="small">No phone number saved for this driver, so no WhatsApp link.</span> : null}
          </>
        ),
      });
      setF((x) => ({ ...x, title: "", notes: "", cname: "", cphone: "", pax: "", end: "", leaveBy: "", stops: defaultStops() }));
      setRows([]);
      setPreview(null);
      if (v.input.date !== date) onDate(String(v.input.date));
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  const total = splitTotal(rows);
  const openEditor = () => drawer.open(<StopsEditor stops={f.stops} places={lists.places ?? []} onSave={(stops) => set("stops", stops)} />);

  return (
    <div className="card" id="assign-card">
      <div className="card-h"><h2>Assign a task</h2></div>
      <form className="card-b form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="af-title">Task</label>
          <input id="af-title" ref={titleRef} maxLength={120} placeholder="Team drop · Matara sites" value={f.title} onChange={(e) => set("title", e.target.value)} />
        </div>
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
          <span className="lab">Stops</span>
          {f.stops.map((s, i) => (
            <div className="field" key={s.key}>
              <label htmlFor={`af-stop-${s.key}`}>{stopLabel(i, s.type, f.stops.length)}{s.arriveBy ? <span className="muted"> · by {s.arriveBy}</span> : null}</label>
              <input id={`af-stop-${s.key}`} list="places-list" maxLength={160} placeholder={i === 0 ? "Head office, Colombo 05" : "Saved place, town or address"} value={s.place} onChange={(e) => setStop(i, e.target.value)} />
            </div>
          ))}
          <datalist id="places-list">{(lists.places ?? []).map((p) => <option key={p.name} value={p.name} />)}</datalist>
          <div className="acts">
            <button type="button" className="btn" onClick={() => set("stops", [...f.stops, newStop("drop")])}><Icon name="plus" />Add stop</button>
            <button type="button" className="btn" onClick={openEditor}>Stops in detail</button>
          </div>
          <span className="hint">Stops in detail: order, what is carried, minutes there, arrive-by deadlines, notes, map pins.</span>
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="af-date">Date</label><input type="date" id="af-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="field"><label htmlFor="af-leave">Leave by</label><input type="time" id="af-leave" value={f.leaveBy} onChange={(e) => set("leaveBy", e.target.value)} /><span className="hint">Empty: planned from the stops’ arrive-by times.</span></div>
        </div>
        <div className="field"><label htmlFor="af-start">Start from</label><input id="af-start" list="places-list" maxLength={160} placeholder="The base place (Settings)" value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
        <div className="grid2">
          <span className="check"><input type="checkbox" id="af-return" checked={f.returnToBase} onChange={(e) => set("returnToBase", e.target.checked)} /> <label htmlFor="af-return">Return to office</label></span>
          <span className="check"><input type="checkbox" id="af-noexp" checked={f.avoidExpressway} onChange={(e) => set("avoidExpressway", e.target.checked)} /> <label htmlFor="af-noexp">No expressway</label></span>
        </div>
        {(preview || previewErr) && (
          <div>
            {previewErr ? <Notice>{previewErr}</Notice> : <PlanPanel preview={preview} />}
          </div>
        )}
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
        <div className="field">
          <span className="lab">Send to driver</span>
          <span className="check"><input type="checkbox" checked disabled id="af-app" /> <label htmlFor="af-app">Fame Driver app (always)</label></span>
          <span className="check"><input type="checkbox" id="af-wa" checked={f.whatsapp} onChange={(e) => set("whatsapp", e.target.checked)} /> <label htmlFor="af-wa">Also give me a WhatsApp message with the details</label></span>
        </div>
        {msg && (
          <div>
            <Notice tone={msg.tone}>{msg.text}</Notice>
            {msg.warnings && <WarningsNote warnings={msg.warnings} />}
          </div>
        )}
        <button className="btn primary wide" type="submit" disabled={busy}>{busy ? "Sending…" : "Assign & send"}</button>
      </form>
    </div>
  );
}
