// The day's board (/tasks), the detail beside it (/tasks/:id: a panel on a
// desktop, a full screen on a phone), Assign a task at /tasks/new.
// Phase 7 (§19): the tasks that need a driver (today and later) above the
// columns; /tasks?filter=needs_driver shows only them, with the way back.
// §33: the day's proposed tasks waiting for an approver as the first column.
// §13: a card tags a trip the driver started ("Driver-started") and a personal one ("Personal").
// Hotfix 3 (L3): each column holds 25 cards (task_board's limit), its count is
// every card of the column (totals), and "Load more" under it asks that column's
// next cards (task_board(date, column, limit, cursor)), refreshed with the board.
import { cursorAt, MAX_LIMIT } from "@fleet/paging";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Board, BoardCard } from "../data/types";
import { useQuery } from "../data/useQuery";
import { cap, longDate, statusTone, today } from "../lib/format";
import { Avatar, Dot, ErrBox, Plate, StaleNote, Updated, VehicleThumb } from "../ui/basics";
import { Icon } from "../ui/icons";
import { DayStrip } from "../ui/DayPicker";
import { LoadMore, PAGE_SIZE, type PagedList, SkeletonRows } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { decidedText } from "./approversLogic";
import { LateReportLine } from "./LateReport";
import { NeedsDriverList } from "./NeedsDriverList";
import { TripTags } from "./TripPurpose";
import { WaitingApprovalColumn } from "./WaitingApprovalColumn";
import { duration } from "@fleet/durations";

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
          {t.late_min ? <span className="status bad"> · late by {duration(t.late_min)}</span> : null}
        </span>
      )}
      {/* Part 3b (H4): the driver's own word. */}
      <LateReportLine late={t.late_report} testId="card-late-report" />
      <span className="who"><Avatar name={t.driver} src={t.driver_photo_url} small /><span className="grow">{t.driver || ""}</span><VehicleThumb src={t.vehicle_thumb_url} />{t.vehicle ? <Plate v={t.vehicle} /> : t.vehicle_text ? <span className="muted small" data-testid="vehicle-text">{t.vehicle_text}</span> : null}</span>
      <span className={`status ${statusTone(col, t.status)}`}>{t.status || ""}</span>
      {/* Hotfix 2 (K): who sent it to the driver. */}
      {t.approved_by && <span className="muted small" data-testid="card-approved-by">{decidedText("approved", t.approved_by)}</span>}
      {/* Phase 7: finished far under the plan (the odometer or the time); the words on hover and on the task. */}
      {t.finish_flag && <span><span className="pill warn" title={t.finish_flag.text}>{t.finish_flag.kind === "completed_early" ? "Completed early" : cap(t.finish_flag.kind)}</span></span>}
    </button>
  );
}

type ColumnKey = "assigned" | "in_progress" | "completed" | "declined";
type Tone = "warn" | "live" | "bad" | "";

/** task_board's arguments for the day: 25 cards a column (every column's count in `totals`). */
const boardArgs = (date: string) => ({ date, limit: PAGE_SIZE });

/**
 * One column of the board: the board's first 25 cards, and with "Load more" the column's next ones
 * (task_board(date, column, limit, cursor) from the 26th card on, the limit growing a page at a time, fetched again
 * with the board every 30 s), merged under them. Its count is every card of the column.
 */
function BoardColumn({ b, k, label, dot, onOpen }: { b: Board; k: ColumnKey; label: string; dot: Tone; onOpen: (id: string) => void }) {
  const base = b[k] ?? [];
  const [extra, setExtra] = useState(0);
  const more = useQuery<Board>(
    "boardColumn",
    "task_board",
    extra > 0 ? { date: b.date, column: k, limit: Math.min(MAX_LIMIT, PAGE_SIZE * extra), cursor: cursorAt(PAGE_SIZE) } : null,
    { keep: true, every: 30000 },
  );
  const seen = new Set(base.map((c) => c.id));
  const cards = [...base, ...(extra > 0 ? (more.data?.[k] ?? []).filter((c) => !seen.has(c.id)) : [])];
  const total = Math.max(b.totals?.[k] ?? base.length, cards.length);
  const list: PagedList<BoardCard, Board> = {
    items: cards,
    total,
    mode: "more",
    hasMore: cards.length < total && cards.length < PAGE_SIZE + MAX_LIMIT,
    loadMore: () => setExtra((n) => n + 1),
    page: 1,
    pages: 1,
    setPage: () => {},
    answer: more.data,
    query: more,
  };
  return (
    <div className="col" data-testid={`board-col-${k}`}>
      <div className="col-h"><span><Dot tone={dot} />{label}</span><span className="num" data-testid="col-count">{total}</span></div>
      {cards.length ? cards.map((t) => <TaskCard key={t.id} t={t} col={k} onOpen={onOpen} />) : <p className="col-empty">No tasks</p>}
      <LoadMore list={list} />
    </div>
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
    store.watch("board", "task_board", boardArgs(date), 30000);
    return () => store.unwatch("board");
  }, [store, date, noConnector]);

  const b = board.data && board.data.date === date ? board.data : undefined;
  // needs_driver covers today and later whatever the day: any answer will do.
  const needs = board.data?.needs_driver ?? [];
  const cols: [ColumnKey, string, Tone][] = [
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
            <div className="ph-actions"><Link className="btn" to={`/tasks${q}`}>The whole board</Link></div>
          </div>
          {!board.data && !noConnector && (
            <>
              <ErrBox entry={board} onRetry={() => void store.load("board", "task_board", boardArgs(date))} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!board.err && <SkeletonRows rows={4} label="Loading tasks…" />}
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
            {/* Phase 7 (§8): Tasks → History, the tasks over a range of days. */}
            {me.tools.includes("list_tasks") && <Link className="btn" to="/tasks/history">History</Link>}
            {canAssign && <Link className="btn primary" to={`/tasks/new${q}`}><Icon name="plus" />Assign a task</Link>}
          </div>
        </div>
        {needs.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <NeedsDriverList tasks={needs} linked={canChange} />
          </div>
        )}
        {/* The board's day: the week strip (docs/ui-patterns.md §3), any day (tomorrow's tasks too). */}
        <div style={{ marginBottom: 18 }}><DayStrip value={date} onChange={setDate} label="Board day" testId="board-day" /></div>
        <div className="board">
          {!b && !noConnector && (
            <div style={{ gridColumn: "1/-1" }}>
              <ErrBox entry={board} onRetry={() => void store.load("board", "task_board", boardArgs(date))} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!board.err && <SkeletonRows rows={4} label="Loading tasks…" />}
            </div>
          )}
          {b && board.err && <div style={{ gridColumn: "1/-1" }}><StaleNote entry={board} /></div>}
          {/* Proposed tasks of the day that wait for an approver (§33): first, shown only when there is one. */}
          {b?.waiting_approval?.length ? <WaitingApprovalColumn cards={b.waiting_approval} /> : null}
          {b && cols.map(([k, label, dot]) => <BoardColumn key={`${date}:${k}`} b={b} k={k} label={label} dot={dot} onOpen={openTask} />)}
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
