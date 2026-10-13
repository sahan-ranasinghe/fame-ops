// One issue (/issues/:id): the details, the linked task / report / request with
// its photos, the timeline, and the office's actions with the issues permission:
// Take (assign to me), Add note, Resolve with a note, Dismiss, Reopen.
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import type { IssueHistory } from "../data/types";
import { attIcon, cap } from "../lib/format";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { Loading, Notice, Pill, Plate } from "../ui/basics";
import { useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { eventText, kindText, severityTone, statusTone } from "./issuesLogic";
import { TaskDrawer } from "./TaskDrawer";

export default function IssuePage() {
  const { id = "" } = useParams();
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const [h, setH] = useState<IssueHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = me.tools.includes("update_issue");

  async function load() {
    try {
      setH(await transport.call<IssueHistory>("issue_history", { id }));
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function change(input: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("update_issue", { id, ...input });
      toast(done);
      setNote("");
      await load();
      void store.load("issuesAll", "list_issues", { status: "all", limit: 200 });
      void store.load("issues", "list_issues", { status: "active", limit: 10 });
      void store.load("overview", "fleet_overview", {});
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }
  function addNote(ev: FormEvent) {
    ev.preventDefault();
    if (!note.trim()) {
      setMsg("Write the note first.");
      return;
    }
    void change({ note: note.trim() }, "Note added");
  }
  function resolve() {
    if (!note.trim()) {
      setMsg("Write what was done first: it becomes the resolution.");
      return;
    }
    void change({ status: "resolved", note: note.trim() }, "Issue resolved");
  }

  if (err) return <section className="view"><div className="ph"><div><h1>Issue</h1></div></div><Notice tone="bad">{err}</Notice></section>;
  if (!h) return <section className="view"><div className="ph"><div><h1>Issue</h1></div></div><Loading>Loading the issue…</Loading></section>;
  const i = h.issue;
  const active = i.status === "open" || i.status === "in_progress";
  const driverLink = i.driver_username && can(me, ...ROUTES_NEED) ? `/drivers/${i.driver_username}` : null;

  return (
    <section className="view" data-testid="issue-page">
      <div className="ph">
        <div>
          <div className="eyebrow"><Link to="/issues">Issues</Link> · {kindText(i)}</div>
          <h1>{i.title}</h1>
        </div>
        <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill>
      </div>
      <div className="stack" style={{ maxWidth: 820 }}>
        <div className="card card-b">
          <div className="row" style={{ padding: 0 }}>
            <span className={`att-ic ${severityTone(i.severity)}`}><Icon name={attIcon(i.title)} /></span>
            <div className="grow">
              <div className="name">{i.detail || "—"}</div>
              <div className="sub">{[cap(i.severity), i.due, `opened ${i.opened}`, i.assigned_to ? `assigned to ${i.assigned_to.name}` : "nobody assigned"].filter(Boolean).join(" · ")}</div>
            </div>
            {i.vehicle && <Plate v={i.vehicle} />}
          </div>
          {i.resolution_note && <Notice tone="ok">Resolved by {i.resolved_by ?? "?"} {i.resolved ? `at ${i.resolved}` : ""}: {i.resolution_note}</Notice>}
          <div className="chips">
            {h.task && me.tools.includes("task_detail") && <button type="button" className="btn small" onClick={() => drawer.open(<TaskDrawer id={h.task!.id} />)}>Task · {h.task.title}</button>}
            {driverLink && <Link className="btn small" to={driverLink}>Driver · {i.driver}</Link>}
            {i.driver_links?.call && <a className="btn small" href={i.driver_links.call}>Call driver</a>}
            {i.driver_links?.whatsapp && <a className="btn small" href={i.driver_links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
            {h.request && <Link className="btn small" to="/requests">Request · {h.request.requested_by}</Link>}
          </div>
        </div>

        {h.report && (
          <div className="card card-b" data-testid="issue-report">
            <h2>The driver's report</h2>
            <p style={{ margin: 0 }}>{cap(h.report.category)} · {h.report.driver ?? "?"} · reported {h.report.reported} · <b>{h.report.status.replace("_", " ")}</b></p>
            {h.report.note && <p style={{ margin: 0 }}>{h.report.note}</p>}
            {h.report.office_note && <p className="muted" style={{ margin: 0 }}>Office: {h.report.office_note}</p>}
            <div className="photos">{h.report.photos.map((u, n) => <a key={n} className="btn small" href={u} target="_blank" rel="noopener">Photo {n + 1}</a>)}</div>
          </div>
        )}

        {canEdit && (
          <form className="card card-b form" onSubmit={addNote} data-testid="issue-actions">
            <h2>{active ? "Deal with it" : "Reopen"}</h2>
            <div className="field">
              <label htmlFor="issue-note">Note{active ? " (the resolution when you resolve)" : ""}</label>
              <input id="issue-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, or what the driver should know" />
            </div>
            {msg && <Notice tone="bad">{msg}</Notice>}
            <div className="acts">
              {active && !i.assigned_to && <button type="button" className="btn" disabled={busy} onClick={() => void change({ assign_to: "me", status: "in_progress" }, "Taken")}>Take</button>}
              {active && <button className="btn" type="submit" disabled={busy}>Add note</button>}
              {active && <button type="button" className="btn dark" disabled={busy} onClick={resolve}>Resolve</button>}
              {active && <button type="button" className="btn" disabled={busy} onClick={() => void change({ status: "dismissed", ...(note.trim() && { note: note.trim() }) }, "Issue dismissed")}>Dismiss</button>}
              {!active && <button type="button" className="btn dark" disabled={busy} onClick={() => void change({ status: "open", ...(note.trim() && { note: note.trim() }) }, "Issue reopened")}>Reopen</button>}
            </div>
          </form>
        )}

        <div className="card card-b" data-testid="issue-history">
          <h2>History</h2>
          <dl className="kv">
            {h.events.map((e, n) => (
              <div key={n} style={{ gridColumn: "1/-1" }}>
                <dt>{e.at}</dt>
                <dd>{eventText(e)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
