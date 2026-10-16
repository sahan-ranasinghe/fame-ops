// Drivers → Duty log (/drivers/duty, Phase 7 §1; assign_tasks or vehicles): one
// row per duty period from duty_log, newest first, for the chosen range
// (?range=… , default today) and driver (?driver=<username>). A desktop shows a
// table; on a phone each period is a card (the table's phone layout). The
// previous rows stay on screen, marked "Updating…", while another range loads.
import { Link, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import { useLists, useWatch } from "../data/hooks";
import type { DutyLog as DutyLogData, DutyPeriod } from "../data/types";
import { cap, num } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import { DateRange, useDateRange } from "../ui/DateRange";
import { colomboDay } from "../ui/dateRange";
import { Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { PageTop } from "../ui/Page";
import { answerFor, clockOut, dutyArgs, emptyText, vehicleLine } from "./dutyLogic";

/** duty_log answers up to 62 days at a time (GPS km up to 7). */
const MAX_DAYS = 62;

export function DutyLog() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const dates = useDateRange("today", { maxDays: MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const driver = params.get("driver") || "";
  const setDriver = (d: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (d) next.set("driver", d);
    else next.delete("driver");
    return next;
  }, { replace: true });
  const { from, to } = dates;
  const today = colomboDay();
  const args = dutyArgs(from, to, driver || undefined);
  // A range that reaches today is watched (people clock in and out); a past one is loaded once.
  const every = to >= today ? 60000 : 30 * 60000;
  const entry = useWatch<DutyLogData>("dutyLog", "duty_log", args, every, !noConnector && !dates.error);
  const routes = can(me, ...ROUTES_NEED);

  const d = entry.data;
  const driverName = lists.drivers?.find((x) => x.username === driver)?.name;
  const current = d ? answerFor(d, { from, to, driver: driver || undefined, driverName }) : false;
  const updating = !!d && !current && !entry.err && !dates.error;
  const retry = () => void store.load("dutyLog", "duty_log", args);
  const taskLink = (p: DutyPeriod, id: string) => `/tasks/${id}${p.day !== today ? `?date=${p.day}` : ""}`;

  return (
    <section className="view" data-testid="duty-log">
      <PageTop title="Duty log" sub="Drivers · Start work to Finish work" backTo="/drivers" />
      <div className="stack">
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <DateRange value={dates} />
          <div className="filters" style={{ marginBottom: 0 }}>
            <label className="field"><span>Driver</span>
              <select aria-label="Driver" value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="">All drivers</option>
                {driver && !lists.drivers?.some((x) => x.username === driver) && <option value={driver}>{driver}</option>}
                {(lists.drivers ?? []).map((x) => <option key={x.username} value={x.username}>{x.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {dates.error ? null : !d && !noConnector ? (
          <>
            <ErrBox entry={entry} onRetry={retry} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!entry.err && <Loading>Loading the duty log…</Loading>}
          </>
        ) : d && !current && entry.err ? (
          // The rows on screen are another range's: say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={retry}>Try again</button>}>{errText(entry.err)[0]}</Notice>
        ) : d ? (
          <div style={updating ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
            {updating ? <div className="updated" style={{ paddingBottom: 10 }}>Updating…</div> : <StaleNote entry={entry} />}
            <div className="card">
              {d.periods.length ? (
                <div className="tbl-wrap">
                  <table data-testid="duty-table">
                    <thead><tr><th>Driver</th><th>Clock in</th><th>Clock out</th><th className="r">Hours</th><th>Vehicles</th><th>Tasks</th><th className="r">Task km</th><th className="r">GPS km</th></tr></thead>
                    <tbody>
                      {d.periods.map((p, i) => {
                        const out = clockOut(p);
                        return (
                          <tr key={`${p.username ?? p.driver}-${p.clock_in}-${i}`} data-testid="duty-row">
                            <td data-label="Driver"><div className="name">{p.username && routes ? <Link to={`/drivers/${p.username}`}>{p.driver ?? p.username}</Link> : p.driver ?? p.username ?? "—"}</div></td>
                            <td data-label="Clock in">
                              <div><span className="mono">{p.clock_in}</span>{p.opened_by_server && <div className="sub">opened by the server: a task was running</div>}{p.phone && <div className="sub">{p.phone}</div>}</div>
                            </td>
                            <td data-label="Clock out">
                              {out.onDuty ? <div><Pill tone="live">On duty</Pill></div> : <div><span className="mono">{out.time}</span>{out.how && <div className="sub">{out.how}</div>}</div>}
                            </td>
                            <td data-label="Hours" className="r num">{num(p.hours)} h</td>
                            <td data-label="Vehicles">
                              {p.vehicles.length ? (
                                <div style={{ display: "grid", gap: 6 }}>
                                  {p.vehicles.map((v, j) => {
                                    const line = vehicleLine(v, p.driver);
                                    return <div key={j}><Plate v={v.vehicle} /> <span className="mono small">{line.times}</span> <span className="sub">· {line.how}</span></div>;
                                  })}
                                </div>
                              ) : <span className="muted">No vehicle</span>}
                            </td>
                            <td data-label="Tasks">
                              {p.tasks.length ? (
                                <div style={{ display: "grid", gap: 6 }}>
                                  <span className="sub">{p.tasks.length} task{p.tasks.length > 1 ? "s" : ""}</span>
                                  {p.tasks.map((t) => (
                                    <div key={t.task_id}>
                                      <Link to={taskLink(p, t.task_id)}>{t.title}</Link>{" "}
                                      <span className="mono small">{t.started}–{t.completed ?? ""}</span>
                                      <span className="sub">{t.km != null ? ` · ${num(t.km)} km` : ""}{t.status !== "completed" ? ` · ${cap(t.status)}` : ""}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : <span className="muted">None</span>}
                            </td>
                            <td data-label="Task km" className="r num">{num(p.task_km)} km</td>
                            <td data-label="GPS km" className="r num">{p.gps_km != null ? `${num(p.gps_km)} km` : "—"}</td>
                          </tr>
                        );
                      })}
                      <tr data-testid="duty-totals" style={{ fontWeight: 700 }}>
                        <td data-label="Total"><div>{d.totals.periods} period{d.totals.periods === 1 ? "" : "s"}</div></td>
                        <td></td>
                        <td></td>
                        <td data-label="Hours" className="r num">{num(d.totals.hours)} h</td>
                        <td></td>
                        <td></td>
                        <td data-label="Task km" className="r num">{num(d.totals.task_km)} km</td>
                        <td data-label="GPS km" className="r num">{d.totals.gps_km != null ? `${num(d.totals.gps_km)} km` : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>{emptyText(d, today)}</Empty>
              )}
            </div>
            {d.gps_note && <p className="muted small" style={{ margin: "10px 0 0" }}>{d.gps_note}</p>}
          </div>
        ) : null}
      </div>
    </section>
  );
}
