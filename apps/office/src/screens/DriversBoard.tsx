// Part 3b (H5): the Drivers board (/drivers/board, menu Today, for approve or assign_tasks). Every active driver as the one
// driver row (the status now, last seen, the next task, the usual start, Call and WhatsApp), drivers_board watched every
// 30 s; filter chips with their counts (?filter=), a search box (?q=), "New task" on each row (/tasks/new?driver=…).
// Hotfix 4 (c): no tick boxes; "Ask drivers" opens the sheet (asks/AskSheet: its own list, the free ones ticked) and the
// answers come back as chips under the rows; a Yes has Assign → (a new task for that driver at the asked time).
// The week view (?view=week&from=YYYY-MM-DD, this week's Monday by default, ‹ › a week at a time): drivers × 7 days, each
// day's tasks (time and title) and when the driver is not available; "+" adds an entry for that driver and day, an
// entry's chip opens it to change or remove it (the editor sits under the week, no dialog). On a phone the rows are cards
// and the week shows one driver at a time (picked from a list), the days stacked.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { BoardDriver, BoardFilter, DriversBoard as Board, UnavailableEntry } from "../data/types";
import { useQuery } from "../data/useQuery";
import { addDays, today } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import { Avatar, Chips, Loading, Notice, Pill } from "../ui/basics";
import { DriverRow } from "../ui/DriverRow";
import { toPhoneLinks } from "../ui/driverRowLogic";
import { EmptyLine, ListHeader, useUrlFilter } from "../ui/ListKit";
import { useIsPhone } from "../ui/phone";
import { licenceTone } from "./availabilityLogic";
import {
  BOARD_FILTER_KEYS,
  BOARD_FILTERS,
  BOARD_VIEWS,
  boardCounts,
  boardEmpty,
  type BoardView,
  dayHead,
  driverKey,
  filterBoard,
  mondayOf,
  type WeekCell,
  type WeekGrid,
  weekGrid,
  weekLabel,
  weekStart,
  weekTaskText,
} from "./boardLogic";
import { assignLink, countsLine } from "./asks/askLogic";
import { AnswerLine, AskSheet, useAskAnswers, usePageAsk } from "./asks/AskSheet";
import { SearchBox, useSearchBox } from "./listLocal";
import { UnavailabilityEditor } from "./UnavailabilityEditor";
import { entryChip, shortDay } from "./unavailabilityLogic";

/** The board is fetched again this often while it is open. */
export const BOARD_REFRESH_MS = 30_000;

/** What the week's editor is open on: a driver's day (a new entry) or one entry. */
interface Editing {
  driver: string;
  name: string;
  day: string;
  entry?: UnavailableEntry;
}

export function DriversBoard() {
  const { me } = useFleet();
  const [filter, setFilter] = useUrlFilter<BoardFilter>("filter", "all", BOARD_FILTER_KEYS);
  const [view, setView] = useUrlFilter<BoardView>("view", "now", BOARD_VIEWS);
  const [fromParam, setFromParam] = useUrlFilter<string>("from", "");
  const box = useSearchBox();
  const day = today();
  const from = weekStart(fromParam, day);
  const week = view === "week";
  const q = useQuery<Board>("driversBoard", "drivers_board", week ? { week_from: from } : {}, {
    every: BOARD_REFRESH_MS,
    keep: true,
    enabled: me.tools.includes("drivers_board"),
  });
  const all = q.data?.drivers ?? [];
  const counts = boardCounts(all, box.search);
  const shown = filterBoard(all, filter, box.search);
  const [sheet, setSheet] = useState(false);
  const [sent, keepSent] = usePageAsk("board");
  const ask = useAskAnswers(sent);
  const answers = new Map((ask?.drivers ?? []).map((r) => [r.username ?? r.name, r]));
  const canAsk = me.tools.includes("ask_drivers");
  const canTask = can(me, "assign_tasks");
  const goWeek = (f: string) => setFromParam(f === mondayOf(day) ? "" : f);

  return (
    <section className="view" data-testid="drivers-board">
      <div className="ph">
        <div><div className="eyebrow">Who can drive now and this week</div><h1>Drivers board</h1></div>
        <div className="ph-actions">
          {canAsk && q.data && <button type="button" className="btn" onClick={() => setSheet(true)} data-testid="board-ask">Ask drivers</button>}
          {me.tools.includes("ask_answers") && <Link className="btn" to="/drivers/asks">Questions</Link>}
        </div>
      </div>
      <div className="board-tools">
        <div role="group" aria-label="View"><Chips options={[["now", "Now"], ["week", "Week"]]} value={view} onChange={setView} /></div>
        <SearchBox label="Find a driver" placeholder="Name or username" value={box.text} onChange={box.setText} onBlur={box.flush} />
      </div>
      <div className="board-filters" role="group" aria-label="Filter">
        <Chips options={BOARD_FILTERS} value={filter} onChange={setFilter} counts={q.data ? counts : undefined} />
      </div>
      {ask && (
        <p className="ask-status sub" data-testid="board-ask-status">
          <span>{ask.question} · {countsLine(ask)}</span>
          {me.tools.includes("ask_answers") && <Link to={`/drivers/asks/${ask.id}`}>All answers →</Link>}
        </p>
      )}
      {sheet && q.data && (
        <AskSheet
          candidates={all.filter((d) => !!d.username).map((d) => ({ username: d.username!, name: d.name, photo_url: d.photo_url, line: d.status.text, free: d.free_now }))}
          window={{}}
          onSent={keepSent}
          onClose={() => setSheet(false)}
        />
      )}
      {q.loading && <Loading>Loading the drivers…</Loading>}
      {q.err && !q.data && <Notice tone="bad">{errText(q.err)[0]}</Notice>}
      {q.data && !week && (
        <div className="card" data-testid="board-list" aria-busy={q.updating || undefined}>
          <ListHeader title={filter === "all" ? "Drivers" : BOARD_FILTERS.find(([k]) => k === filter)?.[1] ?? "Drivers"} count={shown.length} updating={q.updating} />
          {shown.length ? (
            <div className="rows board-rows">
              {shown.map((d) => {
                const answer = d.username ? answers.get(d.username) : undefined;
                const assign = ask && answer ? assignLink(ask, answer, me.tools) : null;
                return (
                <DriverRow
                  key={driverKey(d)}
                  d={{ ...d, now_status: d.status }}
                  phone={toPhoneLinks(d.links)}
                  right={assign
                    ? <Link className="btn small primary" to={assign} data-testid="board-assign">Assign →</Link>
                    : canTask && d.username ? <Link className="btn small" to={`/tasks/new?driver=${encodeURIComponent(d.username)}`}>New task</Link> : undefined}
                  nameExtra={d.licence.chip === "red" || d.licence.chip === "orange"
                    ? <Pill tone={licenceTone(d.licence.chip)}>licence {d.licence.chip === "red" ? "expired or due" : "expiring"}</Pill>
                    : null}
                  testId="board-row"
                  contactTestId="board-contact"
                >
                  <BoardVehicle d={d} />
                  {answer && <AnswerLine row={answer} testId="board-answer" />}
                </DriverRow>
                );
              })}
            </div>
          ) : <EmptyLine>{boardEmpty(filter, box.search)}</EmptyLine>}
        </div>
      )}
      {q.data && week && <WeekView board={q.data} shown={shown} from={from} today={day} updating={q.updating} onWeek={goWeek} filter={filter} search={box.search} />}
    </section>
  );
}

/** "WP CAB-4521 today" or "WP CAB-4521 regular". */
function BoardVehicle({ d }: { d: BoardDriver }) {
  if (!d.vehicle) return null;
  return <span className="sub drow-line"><span className="plate">{d.vehicle.reg_no}</span> {d.vehicle.source === "on_duty" ? "today" : "regular"}</span>;
}

function WeekView({ board, shown, from, today: day, updating, onWeek, filter, search }: {
  board: Board;
  shown: BoardDriver[];
  from: string;
  today: string;
  updating: boolean;
  onWeek: (from: string) => void;
  filter: BoardFilter;
  search: string;
}) {
  const isPhone = useIsPhone();
  const [editing, setEditing] = useState<Editing | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // The week asked is on screen (not the last week's answer kept while the new one loads).
  const grid = board.week && board.week.from === from ? weekGrid(board, shown, day) : null;
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [editing]);
  const thisWeek = mondayOf(day);
  return (
    <>
      <div className="card" data-testid="board-week" aria-busy={updating || !grid || undefined}>
        <div className="card-h week-h">
          <div className="week-nav">
            <button type="button" className="btn small" aria-label="Previous week" onClick={() => onWeek(addDays(from, -7))}>‹</button>
            <h2 data-testid="week-label">{weekLabel(from)}</h2>
            <button type="button" className="btn small" aria-label="Next week" onClick={() => onWeek(addDays(from, 7))}>›</button>
          </div>
          {from !== thisWeek && <button type="button" className="btn small" onClick={() => onWeek(thisWeek)}>This week</button>}
          {updating && <span className="updated">Updating…</span>}
        </div>
        {!grid && <Loading>Loading the week…</Loading>}
        {grid && grid.rows.length === 0 && <EmptyLine>{boardEmpty(filter, search)}</EmptyLine>}
        {grid && grid.rows.length > 0 && (isPhone
          ? <PhoneWeek grid={grid} onEdit={setEditing} />
          : <WeekTable grid={grid} onEdit={setEditing} />)}
      </div>
      {editing && (
        <div ref={editorRef}>
          <UnavailabilityEditor key={`${editing.driver}|${editing.day}|${editing.entry?.id ?? "new"}`} driver={editing.driver} driverName={editing.name}
            entry={editing.entry} day={editing.day} onDone={() => setEditing(null)} />
        </div>
      )}
    </>
  );
}

type OnEdit = (e: Editing) => void;

function WeekTable({ grid, onEdit }: { grid: WeekGrid; onEdit: OnEdit }) {
  return (
    <div className="wk-wrap">
      <table className="wk" data-testid="week-table">
        <thead>
          <tr>
            <th scope="col">Driver</th>
            {grid.days.map((d) => {
              const h = dayHead(d);
              const isToday = grid.rows[0]?.cells.find((c) => c.date === d)?.today;
              return <th key={d} scope="col" className={isToday ? "wk-today" : undefined}>{h.day}<span className="muted"> {h.month}</span></th>;
            })}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.key} data-testid="week-row">
              <th scope="row"><span className="wk-who"><Avatar name={r.name} src={r.photo_url} small /><span>{r.name}</span></span></th>
              {r.cells.map((c) => (
                <td key={c.date} className={`${c.today ? "wk-today" : ""}${c.past ? " wk-past" : ""}`.trim() || undefined}>
                  <WeekCellView cell={c} driver={r.username} name={r.name} onEdit={onEdit} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhoneWeek({ grid, onEdit }: { grid: WeekGrid; onEdit: OnEdit }) {
  const [pick, setPick] = useState("");
  const row = grid.rows.find((r) => r.key === pick) ?? grid.rows[0];
  return (
    <div className="card-b wk-phone" data-testid="week-phone">
      <div className="field">
        <label htmlFor="wk-driver">Driver</label>
        <select id="wk-driver" value={row.key} onChange={(e) => setPick(e.target.value)}>
          {grid.rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
      </div>
      <ol className="wk-days">
        {row.cells.map((c) => (
          <li key={c.date} className={`wk-day${c.today ? " wk-today" : ""}${c.past ? " wk-past" : ""}`} data-testid="week-day">
            <b>{shortDay(c.date)}{c.today ? " · today" : ""}</b>
            <WeekCellView cell={c} driver={row.username} name={row.name} onEdit={onEdit} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A day of a driver: the tasks (time and title), the not-available chips (open to change), "+" to add one. */
function WeekCellView({ cell, driver, name, onEdit }: { cell: WeekCell; driver?: string; name: string; onEdit: OnEdit }) {
  const { me } = useFleet();
  const canSet = me.tools.includes("set_unavailability") && !!driver;
  const taskLinks = can(me, "assign_tasks");
  const day = shortDay(cell.date);
  return (
    <div className="wk-cell">
      {cell.off.map((e) => (canSet
        ? (
          <button key={e.id} type="button" className="wk-off" title={[e.text, e.note, `Added by ${e.added_by}`].filter(Boolean).join(" · ")}
            aria-label={`${name}, ${day}: ${e.text}. Change or remove`} onClick={() => onEdit({ driver: driver!, name, day: cell.date, entry: e })}>
            {entryChip(e)}
          </button>
        )
        : <span key={e.id} className="wk-off" title={e.text}>{entryChip(e)}</span>))}
      {cell.tasks.map((t) => (taskLinks
        ? <Link key={t.id} className={`wk-task ${t.status}`} to={`/tasks/${t.id}`} title={weekTaskText(t)}><span className="mono">{t.time}</span> {t.title}</Link>
        : <span key={t.id} className={`wk-task ${t.status}`} title={weekTaskText(t)}><span className="mono">{t.time}</span> {t.title}</span>))}
      {canSet && !cell.past && (
        <button type="button" className="wk-add" aria-label={`${name} not available ${day}`} title="Not available this day" onClick={() => onEdit({ driver: driver!, name, day: cell.date })}>+</button>
      )}
    </div>
  );
}
