// Tasks → History (/tasks/history, Phase 7 §8; assign_tasks, the tool
// list_tasks): every task that starts in the chosen days (default this week),
// newest first, narrowed by driver, vehicle, status and kind (the office's
// tasks or the trips drivers started), and by the words searched for. A desktop
// shows a table with page numbers; on a phone each task is a card (the table's
// phone layout, at ui/phone.ts's 768 px) with "Load more" (Hotfix 3, L3: 25 at a
// time, the count in the header, every filter in the URL). A row opens the task
// beside the board of its day. The previous answer stays on screen, marked
// "Updating…", while other days or filters load.
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { HistoryTask, TaskHistory as TaskHistoryData } from "../data/types";
import { num } from "../lib/format";
import { errText } from "../transport/errors";
import { Loading, Notice, Pill, Plate } from "../ui/basics";
import { DateRange, useDateRange } from "../ui/DateRange";
import { colomboDay } from "../ui/dateRange";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, usePagedList, useUrlSearch } from "../ui/ListKit";
import { PageTop } from "../ui/Page";
import { emptyText, historyArgs, type HistoryFilters, KIND_OPTIONS, readFilters, routeText, STATUS_OPTIONS, statusOf, tagsOf, taskLink, totalsLine } from "./taskHistoryLogic";

/** list_tasks answers up to 366 days at a time. */
const MAX_DAYS = 366;

export function TaskHistory() {
  const { me, noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const navigate = useNavigate();
  const dates = useDateRange("week", { maxDays: MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const f = readFilters(params);
  const [search, setSearch] = useUrlSearch();
  const set = (key: keyof HistoryFilters, value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  const { from, to } = dates;
  const today = colomboDay();
  const allowed = me.tools.includes("list_tasks");
  // Days that reach today change while people work: fetched again every minute; past days once.
  const list = usePagedList<HistoryTask, TaskHistoryData>("taskHistory", "list_tasks", historyArgs(from, to, f, search), (a) => a.tasks, {
    enabled: !noConnector && allowed && !dates.error,
    every: to >= today ? 60000 : undefined,
  });
  const q = list.query;
  const d = q.data;
  const narrowed = !!(f.driver || f.vehicle || f.status || f.kind);
  const updating = q.updating || q.stale;

  return (
    <section className="view" data-testid="task-history">
      <PageTop title="Task history" sub="Tasks" backTo="/tasks" />
      <div className="stack">
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <DateRange value={dates} />
          <div className="filters" style={{ marginBottom: 0 }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Title, driver, plate or place" />
            <label className="field"><span>Driver</span>
              <select aria-label="Driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}>
                <option value="">All drivers</option>
                {f.driver && !lists.drivers?.some((x) => x.username === f.driver) && <option value={f.driver}>{f.driver}</option>}
                {(lists.drivers ?? []).map((x) => <option key={x.username} value={x.username}>{x.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Vehicle</span>
              <select aria-label="Vehicle" value={f.vehicle} onChange={(e) => set("vehicle", e.target.value)}>
                <option value="">All vehicles</option>
                {f.vehicle && !lists.vehicles?.some((v) => v.reg_no === f.vehicle) && <option value={f.vehicle}>{f.vehicle}</option>}
                {(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}
              </select>
            </label>
            <label className="field"><span>Status</span>
              <select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
                {STATUS_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span>Kind</span>
              <select aria-label="Kind" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
                {KIND_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {!allowed ? (
          <Notice tone="bad">Task history needs the list_tasks tool, which your account does not have yet. Ask an admin.</Notice>
        ) : dates.error || noConnector ? null : !d ? (
          q.err ? (
            <Notice
              tone="bad"
              action={errText(q.err)[1] === "perms" && managePermissions
                ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
                : <button type="button" className="btn small" onClick={q.refetch}>Try again</button>}
            >
              {errText(q.err)[0]}
            </Notice>
          ) : <Loading>Loading the task history…</Loading>
        ) : q.err && q.stale ? (
          // The rows on screen are other days' or filters': say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
        ) : (
          <div style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
            <div className="muted small" style={{ paddingBottom: 10 }} data-testid="history-totals">
              {totalsLine(d)}{updating ? <span className="updated"> · Updating…</span> : null}
            </div>
            {d.more && <div style={{ marginBottom: 12 }}><Notice tone="info">{d.more}</Notice></div>}
            <div className="card">
              <ListHeader title="Tasks" count={list.total} />
              {list.items.length ? (
                <div className="tbl-wrap">
                  <table data-testid="history-table">
                    <thead><tr><th>When</th><th>Task</th><th>Driver</th><th>Vehicle</th><th>Route</th><th>Status</th><th className="r">Km</th></tr></thead>
                    <tbody>
                      {list.items.map((t) => {
                        const st = statusOf(t);
                        const link = taskLink(t, today);
                        return (
                          <tr key={t.id} className="click" onClick={() => navigate(link)} data-testid="history-row">
                            <td data-label="When"><div><span className="mono">{t.date}</span> <span className="mono">{t.time}</span></div></td>
                            <td data-label="Task">
                              <div>
                                <div className="name"><Link to={link} onClick={(e) => e.stopPropagation()}>{t.title}</Link></div>
                                {(t.label || tagsOf(t).length > 0) && (
                                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                    {t.label && <span className="sub">{t.label}</span>}
                                    {tagsOf(t).map((g) => <Pill key={g.text} tone={g.tone}>{g.text}</Pill>)}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td data-label="Driver">{t.driver ?? "—"}</td>
                            <td data-label="Vehicle">{t.vehicle ? <Plate v={t.vehicle} /> : "—"}</td>
                            <td data-label="Route" className="muted">{routeText(t)}</td>
                            <td data-label="Status"><div><Pill tone={st.tone}>{st.text}</Pill>{st.sub && <div className="sub" style={{ marginTop: 4 }}>{st.sub}</div>}</div></td>
                            <td data-label="Km" className="r num">{t.km != null ? `${num(t.km)} km` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyLine>{q.stale ? "Loading…" : emptyText(d.from, d.to, narrowed, search)}</EmptyLine>
              )}
              <LoadMore list={list} />
              <Pager list={list} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
