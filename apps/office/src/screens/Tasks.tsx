// The day's board (/tasks), the detail beside it (/tasks/:id: a panel on a
// desktop, a full screen on a phone), Assign a task at /tasks/new.
// Phase 7 (§19): the tasks that need a driver (today and later) above the
// columns; /tasks?filter=needs_driver shows only them, with the way back.
// §33: the day's proposed tasks waiting for an approver as the first column.
// §13: a card tags a trip the driver started ("Driver-started") and a personal one ("Personal").
import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Board, BoardCard } from "../data/types";
import { addDays, cap, longDate, statusTone, today } from "../lib/format";
import { Avatar, Dot, ErrBox, Loading, Plate, StaleNote, Updated, VehicleThumb } from "../ui/basics";
import { Icon } from "../ui/icons";
import { ListWithDetail } from "../ui/Page";
import { NeedsDriverList } from "./NeedsDriverList";
import { TripTags } from "./TripPurpose";
import { WaitingApprovalColumn } from "./WaitingApprovalColumn";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function TaskCard({ t, col, onOpen }: { t: BoardCard; col: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="tcard" onClick={() => onOpen(t.id)}>
      <span className="top"><b>{t.time}</b><span>{t.label || ""}</span></span>
      <span className="title">{t.title}</span>
      {/* Phase 7 (§13): a trip the driver started in the app, a personal one. */}
      <TripTags t={t} />
      <span className="route">From {t.from || "—"}<br />To {t.to || "—"}{t.stops_count && t.stops_count > 2 ? ` · ${t.stops_count} stops` : ""}</span>
      {(t.leave_by || t.late_min || t.eta_final) && (
        <span className="leave">
          {t.leave_by && <span className="num">Leave by {t.leave_by}</span>}
          {t.eta_final && <span className="muted"> · ETA {t.eta_final}</span>}
          {t.late_min ? <span className="status bad"> · late by {t.late_min} min</span> : null}
        </span>
      )}
      <span className="who"><Avatar name={t.driver} src={t.driver_photo_url} small /><span className="grow">{t.driver || ""}</span><VehicleThumb src={t.vehicle_thumb_url} /><Plate v={t.vehicle} /></span>
      <span className={`status ${statusTone(col, t.status)}`}>{t.status || ""}</span>
      {/* Phase 7: finished far under the plan (the odometer or the time); the words on hover and on the task. */}
      {t.finish_flag && <span><span className="pill warn" title={t.finish_flag.text}>{t.finish_flag.kind === "completed_early" ? "Completed early" : cap(t.finish_flag.kind)}</span></span>}
    </button>
  );
}

export function Tasks() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const date = isDate(params.get("date")) ? params.get("date")! : today();
  const q = date === today() ? "" : `?date=${date}`;
  // Only the tasks that need a driver (the banner's and the Overview block's link).
  const onlyNeeds = params.get("filter") === "needs_driver";
  const setDate = (d: string) => setParams(d === today() ? {} : { date: d }, { replace: true });
  const board = useEntry<Board>("board");
  const canAssign = me.tools.includes("create_task");
  // A needs-a-driver row opens the task's change page.
  const canChange = me.tools.includes("update_task") || me.tools.includes("reassign_task");

  useEffect(() => {
    if (noConnector) return;
    store.reset("board");
    store.watch("board", "task_board", { date }, 30000);
    return () => store.unwatch("board");
  }, [store, date, noConnector]);

  const b = board.data && board.data.date === date ? board.data : undefined;
  // needs_driver covers today and later whatever the day: any answer will do.
  const needs = board.data?.needs_driver ?? [];
  const cols: [keyof Pick<Board, "assigned" | "in_progress" | "completed" | "declined">, string, "warn" | "live" | "bad" | ""][] = [
    ["assigned", "Assigned", "warn"], ["in_progress", "In progress", "live"], ["completed", "Completed", ""],
    // Declined by the driver, waiting for the office (Phase 5): shown only when there is one.
    ...(b?.declined?.length ? [["declined", "Needs a driver", "bad"] as ["declined", string, "bad"]] : []),
  ];
  const openTask = (id: string) => navigate(`/tasks/${id}${q}`);
  // /tasks?task=<id> (a notification's link) opens that task.
  const linked = params.get("task");
  useEffect(() => {
    if (!linked) return;
    navigate(`/tasks/${linked}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  if (onlyNeeds) {
    return (
      <section className="view">
        <ListWithDetail>
          <div className="ph">
            <div><div className="eyebrow">Today and later</div><h1>Tasks that need a driver</h1></div>
            <div className="ph-actions"><Link className="btn" to={`/tasks${q}`}>Back to the board</Link></div>
          </div>
          {!board.data && !noConnector && (
            <>
              <ErrBox entry={board} onRetry={() => void store.load("board", "task_board", { date })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!board.err && <Loading>Loading tasks…</Loading>}
            </>
          )}
          {board.data && board.err && <StaleNote entry={board} />}
          {board.data && (
            <div className="stack">
              <NeedsDriverList tasks={needs} linked={canChange} headerLink={false} />
              <p className="muted small" style={{ margin: 0 }}>
                Declined by the driver, or not accepted within the accept window. Open one to give it to a driver; the best match is offered there.{" "}
                <Updated entry={board} />
              </p>
            </div>
          )}
        </ListWithDetail>
      </section>
    );
  }

  return (
    <section className="view">
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">{(date === today() ? "Today · " : "") + longDate(date, true)}</div><h1>Tasks</h1></div>
          <div className="ph-actions">
            {canAssign && <Link className="btn primary" to={`/tasks/new${q}`}><Icon name="plus" />Assign a task</Link>}
          </div>
        </div>
        {needs.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <NeedsDriverList tasks={needs} linked={canChange} />
          </div>
        )}
        <div className="daynav" style={{ marginBottom: 18 }}>
          <button type="button" className="btn" onClick={() => setDate(addDays(date, -1))}>‹ Yesterday</button>
          <button type="button" className="btn dark" onClick={() => setDate(today())}>Today</button>
          <button type="button" className="btn" onClick={() => setDate(addDays(date, 1))}>Tomorrow ›</button>
          <input type="date" aria-label="Pick a day" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} />
        </div>
        <div className="board">
          {!b && !noConnector && (
            <div style={{ gridColumn: "1/-1" }}>
              <ErrBox entry={board} onRetry={() => void store.load("board", "task_board", { date })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!board.err && <Loading>Loading tasks…</Loading>}
            </div>
          )}
          {b && board.err && <div style={{ gridColumn: "1/-1" }}><StaleNote entry={board} /></div>}
          {/* Proposed tasks of the day that wait for an approver (§33): first, shown only when there is one. */}
          {b?.waiting_approval?.length ? <WaitingApprovalColumn cards={b.waiting_approval} /> : null}
          {b && cols.map(([k, label, dot]) => (
            <div className="col" key={k}>
              <div className="col-h"><span><Dot tone={dot} />{label}</span><span className="num">{(b[k] ?? []).length}</span></div>
              {b[k]?.length ? b[k].map((t) => <TaskCard key={t.id} t={t} col={k} onOpen={openTask} />) : <p className="col-empty">No tasks</p>}
            </div>
          ))}
          {b && (
            <div className="muted small" style={{ alignSelf: "end" }}>
              {b.counts.cancelled ? `${b.counts.cancelled} cancelled · ` : ""}<Updated entry={board} />
            </div>
          )}
        </div>
      </ListWithDetail>
    </section>
  );
}
