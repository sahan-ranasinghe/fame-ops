// The red "Needs a driver" block (Phase 7, §19), on Overview and on Tasks: one
// row per task declined or not accepted in time, today and later, the soonest
// first: the start, the title, who declined or didn't accept and why, the time
// to the start and the best match. A row opens the task's change page with the
// driver field first; the header opens the Tasks page filtered to these tasks.
// Without assign_tasks (an approver only) the rows are text: the pages behind
// them need it.
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { NeedsDriverTask } from "../data/types";
import { joinDots } from "../lib/format";
import { Empty } from "../ui/basics";
import { bestLine, findDriverPath, NEEDS_DRIVER_LIST, needsDriverCount, sortNeedsDriver, whenTone } from "./needsDriverLogic";

const ROW_LINK = { color: "inherit", textDecoration: "none" } as const;

export function NeedsDriverList({ tasks, linked, headerLink = true, action }: {
  tasks: NeedsDriverTask[];
  /** Rows and the header are links (assign_tasks). */
  linked: boolean;
  /** The header opens the filtered Tasks page (not on that page itself). */
  headerLink?: boolean;
  /** Something on the right of the header (the way back to the board). */
  action?: ReactNode;
}) {
  const list = sortNeedsDriver(tasks);
  const title = `Needs a driver · ${list.length}`;
  return (
    <div className="card" style={{ borderColor: "var(--bad)" }} data-testid="needs-driver">
      <div className="card-h">
        <h2 style={{ color: "var(--bad)" }}>
          {linked && headerLink ? <Link to={NEEDS_DRIVER_LIST} style={{ color: "inherit" }}>{title}</Link> : title}
        </h2>
        {action ?? <span className="muted small">{needsDriverCount(list.length)}</span>}
      </div>
      <div className="rows">
        {list.length ? list.map((t) => {
          const body = (
            <>
              <span className="due bad mono" style={{ minWidth: 52 }}>{t.start}</span>
              <div className="grow">
                <div className="name">{t.title}</div>
                <div className="sub">{joinDots([t.line, t.note && `“${t.note}”`])}</div>
                {bestLine(t.best) && <div className="sub" data-testid="best-match">{bestLine(t.best)}</div>}
                {/* Round 48 (item 1): a reassignment proposed by someone without approve, waiting for the fleet admin. */}
                {t.pending_change && <div className="sub" data-testid="pending-change">{t.pending_change.text}</div>}
              </div>
              <span className={`due ${whenTone(t.minutes_to_start)}`}>{t.when}</span>
            </>
          );
          return linked
            ? <Link key={t.task_id} className="row" style={ROW_LINK} to={findDriverPath(t.task_id)} data-testid="needs-driver-row">{body}</Link>
            : <div key={t.task_id} className="row" data-testid="needs-driver-row">{body}</div>;
        }) : <Empty>Every task has a driver.</Empty>}
      </div>
    </div>
  );
}
