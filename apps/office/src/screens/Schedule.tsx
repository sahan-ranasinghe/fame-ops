// Round 4–7, feature 7 (22 October 2026): the Timeline (/schedule, menu Today, view): a day per driver or per vehicle as
// Google Calendar's resource view (day_timeline, watched every 60 s). Drivers | Vehicles (?kind=), the week strip with
// Today and the calendar (?date=, days ahead allowed). On a desktop one row per driver or vehicle with the day from 06:00
// to 22:00 as a track: each booking a bar (planned amber, on the way blue, done grey) with its holder's photo, its title
// and time, opening the task for someone who may open tasks; a driver's not-available entries as hatched bars; the "now"
// line today; overlapping bookings one under the other. On a phone one card per row with its bookings as lines. Free rows
// too, so a gap is seen at a glance. With holder_contact off the bars carry no holder.
import { Fragment } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { DayTimeline } from "../data/types";
import { useQuery } from "../data/useQuery";
import { clock, today } from "../lib/format";
import { errText } from "../transport/errors";
import { can, canOpenTask } from "../transport/types";
import { Avatar, Notice, Pill, Plate, Segmented } from "../ui/basics";
import { DayStrip } from "../ui/DayPicker";
import { EmptyLine, SkeletonRows, useUrlFilter } from "../ui/ListKit";
import { useIsPhone } from "../ui/phone";
import { useSwitch } from "./dispatchParts";
import {
  barOf,
  type Booking,
  bookingLabel,
  bookingTime,
  bookingTone,
  busyLine,
  byStart,
  holderWords,
  hourTicks,
  lanesOf,
  notAvailableText,
  nowLeft,
  STATUS_WORD,
  TIMELINE_KINDS,
  type TimelineKind,
  type TimelineRow,
} from "./scheduleLogic";

export const SCHEDULE_EVERY = 60_000;
/** One lane's height on the track (px). */
const LANE_PX = 34;

/** The row's name: a driver's name; a vehicle's plate with what it is and In garage. */
function RowName({ row, kind }: { row: TimelineRow; kind: TimelineKind }) {
  if (kind === "drivers") return <span className="sched-name-t">{row.name}</span>;
  return (
    <span className="sched-name-t">
      <Plate v={row.name} />
      {row.label && <span className="sub"> {row.label}</span>}
      {row.in_garage && <> <Pill tone="warn">In garage</Pill></>}
    </span>
  );
}

/** A booking's bar on the track (a link to its task for someone who may open it). */
function BookingBar({ b, kind, lane, opens }: { b: Booking; kind: TimelineKind; lane: number; opens: boolean }) {
  const bar = barOf(b.from, b.to);
  if (!bar) return null;
  const tone = bookingTone(b.status);
  const label = bookingLabel(b, kind);
  const style = { left: `${bar.left}%`, width: `${bar.width}%`, top: lane * LANE_PX + 3 };
  const cls = `sched-bar ${tone}${bar.open ? " open" : ""}${bar.before ? " before" : ""}${bar.after ? " after" : ""}`;
  const inner = (
    <>
      {b.holder && <Avatar name={b.holder.name} src={b.holder.photo_url} small />}
      <span className="sched-bar-t">{b.title}</span>
      <span className="sched-bar-time">{bookingTime(b)}</span>
    </>
  );
  return opens
    ? <Link className={cls} style={style} to={`/tasks/${b.task_id}`} title={label} aria-label={label} data-testid="sched-bar">{inner}</Link>
    : <span className={cls} style={style} title={label} aria-label={label} role="img" data-testid="sched-bar">{inner}</span>;
}

/** The desktop: the hours across, a row per driver or vehicle. */
function Grid({ data, opens, now }: { data: DayTimeline; opens: boolean; now: number | null }) {
  const ticks = hourTicks();
  return (
    <div className="card sched" data-testid="sched-grid">
      <div className="sched-row sched-head" aria-hidden="true">
        <div className="sched-name">{data.kind === "drivers" ? "Driver" : "Vehicle"}</div>
        <div className="sched-track">
          {ticks.map((t) => <span key={t.label} className="sched-tick" style={{ left: `${t.left}%` }}>{t.label}</span>)}
        </div>
      </div>
      {data.rows.map((row) => {
        const bookings = byStart(row.bookings);
        const { lanes, count } = lanesOf(bookings);
        return (
          <div key={row.id} className="sched-row" data-testid="sched-row" data-busy={bookings.length ? "1" : "0"}>
            <div className="sched-name"><RowName row={row} kind={data.kind} /></div>
            <div className="sched-track" style={{ height: count * LANE_PX + 6 }}>
              {ticks.map((t) => <i key={t.label} className="sched-line" style={{ left: `${t.left}%` }} aria-hidden="true" />)}
              {(row.not_available ?? []).map((u, i) => {
                const bar = barOf(u.from, u.to);
                return bar
                  ? <span key={`na${i}`} className="sched-off" style={{ left: `${bar.left}%`, width: `${bar.width}%` }} title={notAvailableText(u)} aria-label={notAvailableText(u)} role="img" data-testid="sched-off">Not available</span>
                  : null;
              })}
              {bookings.map((b, i) => <BookingBar key={b.task_id} b={b} kind={data.kind} lane={lanes[i]} opens={opens} />)}
              {now !== null && <i className="sched-now" style={{ left: `${now}%` }} aria-hidden="true" />}
              {bookings.length === 0 && !(row.not_available ?? []).length && <span className="sched-free">Free all day</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A phone: one card per driver or vehicle, its bookings as lines. */
function Cards({ data, opens }: { data: DayTimeline; opens: boolean }) {
  return (
    <div className="stack sched-cards" style={{ gap: 10 }} data-testid="sched-cards">
      {data.rows.map((row) => {
        const bookings = byStart(row.bookings);
        return (
          <div key={row.id} className="card sched-card" data-testid="sched-row" data-busy={bookings.length ? "1" : "0"}>
            <div className="sched-card-h"><RowName row={row} kind={data.kind} /><span className="sub">{bookings.length ? `${bookings.length} booked` : "Free all day"}</span></div>
            {(bookings.length > 0 || (row.not_available ?? []).length > 0) && (
              <div className="rows">
                {(row.not_available ?? []).map((u, i) => <div key={`na${i}`} className="row sched-off-line" data-testid="sched-off">{notAvailableText(u)}</div>)}
                {bookings.map((b) => {
                  const tone = bookingTone(b.status);
                  const body = (
                    <>
                      <span className={`sched-dot ${tone}`} aria-hidden="true" />
                      <span className="grow">
                        <span className="name">{b.title}</span>
                        <span className="sub" style={{ display: "block" }}>
                          <span className="mono">{bookingTime(b)}</span> · {STATUS_WORD[tone]}{data.kind === "drivers" ? (b.vehicle ? ` · ${b.vehicle}` : "") : b.driver ? ` · ${b.driver}` : ""}
                        </span>
                      </span>
                      {b.holder && (
                        <span className="sched-holder" title={holderWords(b)}>
                          <Avatar name={b.holder.name} src={b.holder.photo_url} small />
                          <span className="sub">{b.holder.name.split(" ")[0]}</span>
                        </span>
                      )}
                    </>
                  );
                  return (
                    <Fragment key={b.task_id}>
                      {opens
                        ? <Link className="row link-row" to={`/tasks/${b.task_id}`} aria-label={bookingLabel(b, data.kind)} data-testid="sched-booking">{body}</Link>
                        : <div className="row" aria-label={bookingLabel(b, data.kind)} data-testid="sched-booking">{body}</div>}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Schedule() {
  const { me, noConnector } = useFleet();
  const phone = useIsPhone();
  // Round 4–7: the Asks button only while the switch holder_contact is on.
  const holders = useSwitch("holder_contact").on;
  const [kind, setKind] = useUrlFilter<TimelineKind>("kind", "drivers", TIMELINE_KINDS);
  const [date, setDate] = useUrlFilter<string>("date", "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today();
  const q = useQuery<DayTimeline>("dayTimeline", "day_timeline", { date: day, kind }, {
    every: SCHEDULE_EVERY,
    keep: true,
    enabled: !noConnector && me.tools.includes("day_timeline"),
  });
  const data = q.data;
  const opens = canOpenTask(me);
  const now = day === today() ? nowLeft(clock(Date.now())) : null;
  return (
    <section className="view" data-testid="schedule">
      <div className="ph">
        <div><div className="eyebrow">Who has each driver and vehicle, hour by hour</div><h1>Timeline</h1></div>
        {holders && me.tools.includes("holder_asks") && can(me, "request", "approve", "assign_tasks") && <div className="ph-actions"><Link className="btn" to="/tasks/asks">Asks</Link></div>}
      </div>
      <div className="sched-controls">
        <Segmented label="Show" options={[["drivers", "Drivers"], ["vehicles", "Vehicles"]] as const} value={kind} onChange={setKind} />
        {data && !q.stale && <span className="muted small" data-testid="sched-count">{busyLine(data)}</span>}
      </div>
      <DayStrip value={day} onChange={(d) => setDate(d === today() ? "" : d)} label="Day" />
      {q.err && !data && <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>}
      {q.loading && <div className="card"><SkeletonRows label="Loading the day…" /></div>}
      {data && (
        <div aria-busy={q.updating || undefined} style={q.stale ? { opacity: 0.6 } : undefined}>
          {data.rows.length === 0
            ? <div className="card"><EmptyLine>{kind === "drivers" ? "No active drivers." : "No active vehicles."}</EmptyLine></div>
            : phone ? <Cards data={data} opens={opens} /> : <Grid data={data} opens={opens} now={now} />}
        </div>
      )}
    </section>
  );
}
