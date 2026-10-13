import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { Board, BoardCard } from "../data/types";
import { addDays, longDate, statusTone, today } from "../lib/format";
import { Avatar, Dot, ErrBox, Loading, Plate, StaleNote, Updated } from "../ui/basics";
import { useDrawer } from "../ui/Drawer";
import { AssignForm } from "./AssignForm";
import { TaskDrawer } from "./TaskDrawer";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function TaskCard({ t, col, onOpen }: { t: BoardCard; col: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="tcard" onClick={() => onOpen(t.id)}>
      <span className="top"><b>{t.time}</b><span>{t.label || ""}</span></span>
      <span className="title">{t.title}</span>
      <span className="route">From {t.from || "—"}<br />To {t.to || "—"}{t.stops_count && t.stops_count > 2 ? ` · ${t.stops_count} stops` : ""}</span>
      {(t.leave_by || t.late_min || t.eta_final) && (
        <span className="leave">
          {t.leave_by && <span className="num">Leave by {t.leave_by}</span>}
          {t.eta_final && <span className="muted"> · ETA {t.eta_final}</span>}
          {t.late_min ? <span className="status bad"> · late by {t.late_min} min</span> : null}
        </span>
      )}
      <span className="who"><Avatar name={t.driver} small /><span className="grow">{t.driver || ""}</span><Plate v={t.vehicle} /></span>
      <span className={`status ${statusTone(col, t.status)}`}>{t.status || ""}</span>
    </button>
  );
}

export function Tasks() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const [params, setParams] = useSearchParams();
  const date = isDate(params.get("date")) ? params.get("date")! : today();
  const setDate = (d: string) => setParams(d === today() ? {} : { date: d }, { replace: true });
  const board = useEntry<Board>("board");
  const lists = useLists(!noConnector);
  const canAssign = me.tools.includes("create_task");

  useEffect(() => {
    if (noConnector) return;
    store.reset("board");
    store.watch("board", "task_board", { date }, 30000);
    return () => store.unwatch("board");
  }, [store, date, noConnector]);

  const b = board.data && board.data.date === date ? board.data : undefined;
  const cols: [keyof Pick<Board, "assigned" | "in_progress" | "completed" | "declined">, string, "warn" | "live" | "bad" | ""][] = [
    ["assigned", "Assigned", "warn"], ["in_progress", "In progress", "live"], ["completed", "Completed", ""],
    // Declined by the driver, waiting for the office (Phase 5): shown only when there is one.
    ...(b?.declined?.length ? [["declined", "Needs a driver", "bad"] as ["declined", string, "bad"]] : []),
  ];
  const openTask = (id: string) => drawer.open(<TaskDrawer id={id} />);

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">{(date === today() ? "Today · " : "") + longDate(date, true)}</div><h1>Tasks</h1></div>
        <div className="daynav">
          <button type="button" className="btn" onClick={() => setDate(addDays(date, -1))}>‹ Yesterday</button>
          <button type="button" className="btn dark" onClick={() => setDate(today())}>Today</button>
          <button type="button" className="btn" onClick={() => setDate(addDays(date, 1))}>Tomorrow ›</button>
          <input type="date" aria-label="Pick a day" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} />
        </div>
      </div>
      <div className={canAssign ? "tasks-layout" : ""}>
        <div className="board">
          {!b && !noConnector && (
            <div style={{ gridColumn: "1/-1" }}>
              <ErrBox entry={board} onRetry={() => void store.load("board", "task_board", { date })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!board.err && <Loading>Loading tasks…</Loading>}
            </div>
          )}
          {b && board.err && <div style={{ gridColumn: "1/-1" }}><StaleNote entry={board} /></div>}
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
        {canAssign && <AssignForm date={date} lists={lists} onDate={setDate} onOpenTask={openTask} />}
      </div>
    </section>
  );
}
