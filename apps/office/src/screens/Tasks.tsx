// The day's board (/tasks), the detail beside it (/tasks/:id: a panel on a
// desktop, a full screen on a phone), Assign a task at /tasks/new.
// Phase 7 (§19): the tasks that need a driver (today and later) above the
// columns; /tasks?filter=needs_driver shows only them, with the way back.
// §33: the day's proposed tasks waiting for an approver as the first column.
// §13: a card tags a trip the driver started ("Driver-started") and a personal one ("Personal").
// Round 3: each card's driver is the one-line driver card (ui/DriverRow DriverLine) with the vehicle chip.
// Hotfix 3 (L3): each column holds 25 cards (task_board's limit), its count is
// every card of the column (totals), and "Load more" under it asks that column's
// next cards (task_board(date, column, limit, cursor)), refreshed with the board.
// The design pass (pilot f, docs/design-pass.md §3): one vocabulary: the columns
// are Sent, On the way and Done; each card says its state as a chip
// (taskStateLogic.ts: Sent, Seen, Accepted, On the way, Late beside it, Done,
// Needs a driver) with the server's sentence as the muted line under it; a task
// that needs a driver is in the red block on top only, never also a column (a
// past day's declined task, which that block does not list, keeps its column);
// an empty column is the shared empty line.
import { cursorAt, MAX_LIMIT } from "@fleet/paging";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Board, BoardCard } from "../data/types";
import { useQuery } from "../data/useQuery";
import { longDate, type Tone, today } from "../lib/format";
import { Dot, ErrBox, Pill, StaleNote, Updated, VehicleThumb } from "../ui/basics";
import { DriverLine } from "../ui/DriverRow";
import { vehicleChipWords } from "../ui/driverRowLogic";
import { Icon } from "../ui/icons";
import { DayStrip } from "../ui/DayPicker";
import { EmptyLine, LoadMore, PAGE_SIZE, type PagedList, SkeletonRows } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { decidedText } from "./approversLogic";
import { LateReportLine } from "./LateReport";
import { NeedsDriverList } from "./NeedsDriverList";
import { boardCardChips } from "./taskStateLogic";
import { TripTags } from "./TripPurpose";
import { WaitingApprovalColumn } from "./WaitingApprovalColumn";

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function TaskCard({ t, col, needsDriver, onOpen }: { t: BoardCard; col: ColumnKey; needsDriver: boolean; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="tcard" onClick={() => onOpen(t.id)}>
      <span className="top"><b>{t.time}</b><span>{t.label || ""}</span></span>
      <span className="title">{t.title}</span>
      {/* Phase 7 (§13): a trip the driver started in the app, a personal one. */}
      <TripTags t={t} />
      <span className="route">From {t.from || "—"}<br />To {t.to || "—"}{t.stops_count && t.stops_count > 2 ? ` · ${t.stops_count} stops` : ""}</span>
      {(t.leave_by || t.eta_final) && (
        <span className="leave">
          {t.leave_by && <span className="num">Leave by {t.leave_by}</span>}
          {t.eta_final && <span className="muted">{t.leave_by ? " · " : ""}ETA {t.eta_final}</span>}
        </span>
      )}
      {/* Part 3b (H4): the driver's own word. */}
      <LateReportLine late={t.late_report} testId="card-late-report" />
      {/* Round 3: the driver-first card: the photo, the name, the vehicle chip under it ("Drives themselves" / "Someone else" on a trip with no app). */}
      <span className="who">
        <DriverLine name={t.driver} photo={t.driver_photo_url} drivenBy={t.driven_by} vehicle={vehicleChipWords(t.vehicle, { text: t.vehicle_text })}
          extra={t.vehicle ? <VehicleThumb src={t.vehicle_thumb_url} /> : undefined} />
      </span>
      {/* The state as its chip (Late beside it; a finish flag, its words on hover), the server's sentence under it. */}
      <span className="tstate" data-testid="task-state">
        {boardCardChips(col, t, needsDriver).map((c) => <Pill key={c.label} tone={c.tone} title={c.title}>{c.label}</Pill>)}
      </span>
      {t.status && <span className="sub" data-testid="card-status">{t.status}</span>}
      {/* Hotfix 2 (K): who sent it to the driver. */}
      {t.approved_by && <span className="muted small" data-testid="card-approved-by">{decidedText("approved", t.approved_by)}</span>}
    </button>
  );
}

type ColumnKey = "assigned" | "in_progress" | "completed" | "declined";

/** The columns (§3's words and tones): Sent grey, On the way blue, Done green; what an empty one says. */
const COLUMNS: [ColumnKey, string, Tone, string][] = [
  ["assigned", "Sent", "", "No tasks sent"],
  ["in_progress", "On the way", "live", "No tasks on the way"],
  ["completed", "Done", "ok", "No tasks done"],
];
/** A past day's declined tasks: the red block lists today and later only, so they keep a column of their own. */
const DECLINED: [ColumnKey, string, Tone, string] = ["declined", "Needs a driver", "bad", ""];

/** task_board's arguments for the day: 25 cards a column (every column's count in `totals`). */
const boardArgs = (date: string) => ({ date, limit: PAGE_SIZE });

/**
 * One column of the board: the board's first 25 cards, and with "Load more" the column's next ones
 * (task_board(date, column, limit, cursor) from the 26th card on, the limit growing a page at a time, fetched again
 * with the board every 30 s), merged under them. Its count is every card of the column.
 */
function BoardColumn({ b, k, label, dot, empty, needs, onOpen }: {
  b: Board;
  k: ColumnKey;
  label: string;
  dot: Tone;
  /** What the column says with no card. */
  empty: string;
  /** The tasks in the red block (the board's needs_driver): their chip says so, and the declined column leaves them out. */
  needs: ReadonlySet<string>;
  onOpen: (id: string) => void;
}) {
  const base = b[k] ?? [];
  const [extra, setExtra] = useState(0);
  const more = useQuery<Board>(
    "boardColumn",
    "task_board",
    extra > 0 ? { date: b.date, column: k, limit: Math.min(MAX_LIMIT, PAGE_SIZE * extra), cursor: cursorAt(PAGE_SIZE) } : null,
    { keep: true, every: 30000 },
  );
  const seen = new Set(base.map((c) => c.id));
  const all = [...base, ...(extra > 0 ? (more.data?.[k] ?? []).filter((c) => !seen.has(c.id)) : [])];
  // Never a task twice: the declined column shows only what the red block above does not.
  const cards = k === "declined" ? all.filter((c) => !needs.has(c.id)) : all;
  const total = Math.max((b.totals?.[k] ?? base.length) - (all.length - cards.length), cards.length);
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
      {cards.length ? cards.map((t) => <TaskCard key={t.id} t={t} col={k} needsDriver={needs.has(t.id)} onOpen={onOpen} />) : <EmptyLine>{empty}</EmptyLine>}
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
  const needIds = new Set(needs.map((n) => n.task_id));
  // Needs a driver is the red block on top; a column only for declined tasks it does not list (a past day's).
  const cols = b?.declined?.some((c) => !needIds.has(c.id)) ? [...COLUMNS, DECLINED] : COLUMNS;
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
          {b && cols.map(([k, label, dot, empty]) => <BoardColumn key={`${date}:${k}`} b={b} k={k} label={label} dot={dot} empty={empty} needs={needIds} onOpen={openTask} />)}
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
