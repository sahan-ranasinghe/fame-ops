// One driver: who they are, their status now, and where they went on a day:
// the route on the map (coloured by speed, thin where the fix was poor, stops
// and holes marked, snapped to roads when a provider is set), the day's
// numbers, the timeline beside the map, and playback (web build). Today's line
// grows as the driver moves: the earlier part of the day is loaded from
// driver_route (full resolution, refreshed every minute for the numbers), and
// on the web every new location point lands at once through Realtime, each one
// put in by its time, so a backlog uploaded after an outage fills its gap.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists, useWatch } from "../data/hooks";
import { useWatchDrivers } from "../data/watchDrivers";
import { positionOf, recordedAtOf, statusLine, statusTone } from "../data/live";
import { focusOf, insertPoint, KIND_LABEL, mapRouteOf, mergeRoute, minutesText, type Route, routeOf, snapLegend, type TimelineRow } from "../data/route";
import type { DriverRoute } from "../data/types";
import { useLiveDrivers } from "../data/useLive";
import { addDays, clock, longDate, num, today, waLink } from "../lib/format";
import { MapView } from "../map/MapView";
import { type MapMarker, type RoutePoint, SPEED_COLORS } from "../map/types";
import { Avatar, Chips, Empty, ErrBox, Loading, Notice, Pill, Plate, Tile } from "../ui/basics";
import { Icon } from "../ui/icons";
import { type PlaybackSpeed, SPEEDS, usePlayback } from "./usePlayback";

const ROUTE_EVERY_MS = 60000;
const PAST_DAY_MS = 6 * 3600000;

/** The line the map draws: every stored point up to 3,000 (tolerance 0); above that the tool picks the smallest tolerance that fits. */
const LINE_ARGS = { line_tolerance_m: 0, max_line_points: 3000 };

export function DriverPage() {
  const { username = "" } = useParams();
  const { store, noConnector, realtime } = useFleet();
  const lists = useLists(!noConnector);
  const [date, setDate] = useState(today());
  const isToday = date === today();
  const isTodayRef = useRef(isToday);
  isTodayRef.current = isToday;
  const [route, setRoute] = useState<Route | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<RoutePoint[] | null>(null);
  const [snap, setSnap] = useState(true);
  const [pointsRt, setPointsRt] = useState<"none" | "connecting" | "live" | "error">("none");

  const key = `route.${username}.${date}.${snap ? "snap" : "raw"}`;
  const entry = useWatch<DriverRoute>(key, "driver_route", { driver: username, date, ...LINE_ARGS, snap }, isToday ? ROUTE_EVERY_MS : PAST_DAY_MS, !noConnector && !!username);
  // Watched mode: today, this driver's phone uploads every 10 s while moving.
  useWatchDrivers(isToday && username ? [username] : []);
  const { live, rt } = useLiveDrivers();
  // A fresh answer for the same day is merged by time into the line drawn (the Realtime points stay); another day or driver replaces it.
  useEffect(() => {
    const fresh = entry.data ? routeOf(username, entry.data) : null;
    setRoute((r) => (r && fresh && r.username === fresh.username && r.date === fresh.date ? mergeRoute(r, fresh) : fresh));
  }, [entry.data, username]);
  useEffect(() => {
    setSelected(null);
    setFocus(null);
  }, [username, date]);

  const card = live.data?.drivers.find((d) => d.username === username);
  const employeeId = card?.employee_id;
  // Web: every new point of this driver lands at once, in its place by time; the 60-second refetch is the fallback.
  useEffect(() => {
    if (!isToday || !employeeId || !realtime?.driverPoints) return;
    let alive = true;
    const stop = realtime.driverPoints(employeeId, (row) => {
      if (alive && isTodayRef.current) setRoute((r) => (r ? insertPoint(r, row) : r));
    }, (s) => { if (alive) setPointsRt(s); });
    return () => { alive = false; setPointsRt("none"); stop(); };
  }, [isToday, employeeId, realtime]);
  const info = lists.drivers?.find((d) => d.username === username);
  const name = card?.driver ?? info?.name ?? username;
  const phone = info?.phone;
  const call = card?.links?.call ?? info?.call ?? (phone ? `tel:${phone}` : undefined);
  const whatsapp = card?.links?.whatsapp ?? info?.whatsapp ?? (phone ? waLink(phone) : undefined);
  const tone = card ? statusTone(card.status, card.state) : "bad";
  const status = card ? statusLine(card) : info?.location ?? "Not sharing";

  const playback = usePlayback(route?.points ?? []);
  const webPlayback = __BUILD__ === "web" && !!route && route.points.length > 1;
  // The marker sits on the point the playback is at (every point of the line in turn, nothing interpolated).
  const cursor = useMemo(() => {
    if (!webPlayback || !route) return null;
    const p = route.points[playback.index];
    return p ? { lat: p.lat, lng: p.lng, label: `${clock(p.at)} · ${p.kmh} km/h` } : null;
  }, [webPlayback, route, playback.index]);
  const mapRoute = useMemo(() => mapRouteOf(route, playback.playing || (webPlayback && playback.index > 0) ? cursor : null, snap), [route, cursor, playback.playing, playback.index, webPlayback, snap]);
  const markers = useMemo<MapMarker[]>(() => {
    const pos = card && isToday ? positionOf(card) : null;
    if (!pos || !card) return [];
    const at = recordedAtOf(card);
    return [{ id: card.username, label: card.vehicle ? card.vehicle.split(" · ")[0] : card.driver, title: card.driver, lat: pos.lat, lng: pos.lng, tone, selected: true, heading: card.heading ?? null, at: at ? Date.parse(at) : null }];
  }, [card, isToday, tone]);
  const snapNote = snapLegend(route, snap);

  function pickRow(i: number, row: TimelineRow) {
    setSelected(i);
    if (route) setFocus(focusOf(route, row));
  }

  const dayLabel = isToday ? "Today" : date === addDays(today(), -1) ? "Yesterday" : longDate(date, true);
  return (
    <section className="view" data-testid="driver-page">
      <div className="ph">
        <div>
          <div className="eyebrow"><Link to="/drivers">Drivers</Link> · {info?.code ?? username}</div>
          <h1>{name}</h1>
        </div>
        <div className="ph-actions">
          {call && <a className="btn" href={call}><Icon name="phone" />Call</a>}
          {whatsapp && <a className="btn" href={whatsapp} target="_blank" rel="noopener"><Icon name="chat" />WhatsApp</a>}
          {card?.links?.maps && <a className="btn dark" href={card.links.maps} target="_blank" rel="noopener">Open in Google Maps</a>}
        </div>
      </div>

      <div className="stack">
        <div className="card card-b">
          <div className="row" style={{ padding: 0 }}>
            <Avatar name={name} />
            <div className="grow">
              <div className="name" style={{ fontSize: 20 }}>{name} {(card?.vehicle ?? info?.current_vehicle) && <Plate v={card?.vehicle ?? info?.current_vehicle} />}</div>
              <div className="sub">{[phone, card?.task ? `On task: ${card.task}` : card ? "No task" : null, card?.near ? `near ${card.near}` : null].filter(Boolean).join(" · ") || "—"}</div>
              {info?.last_30_days && <div className="sub">Last 30 days: {info.last_30_days.accepted} accepted · {info.last_30_days.declined} declined</div>}
            </div>
            <Pill tone={tone}>{status}</Pill>
          </div>
          <dl className="facts">
            <div><dt>Last position</dt><dd>{card?.last_position_time ?? card?.last_position_at ?? route?.last ?? "—"}</dd></div>
            <div><dt>{card?.on_duty_since ?? info?.on_duty_since ? "On duty since" : "Off duty"}</dt><dd>{card?.on_duty_since ?? info?.on_duty_since ?? (info?.off_duty_since ? `since ${info.off_duty_since}` : "—")}</dd></div>
            <div><dt>Vehicle</dt><dd>{card?.vehicle ?? info?.current_vehicle ?? "—"}</dd></div>
            <div><dt>Task</dt><dd>{card?.task ?? "—"}</dd></div>
            <div><dt>Live updates</dt><dd>{pointsRt === "live" ? <span className="status live">On · point by point</span> : rt === "live" ? <span className="status live">On</span> : isToday ? "Every 60 s" : "—"}</dd></div>
          </dl>
        </div>

        <div className="ph" style={{ marginBottom: 0 }}>
          <div><div className="eyebrow">{dayLabel}{route?.first ? ` · ${route.first}–${route.last}` : ""}</div><h2 style={{ margin: 0 }}>Route</h2></div>
          <div className="datebar" role="group" aria-label="Day">
            <button type="button" className="chip" aria-pressed={isToday} onClick={() => setDate(today())}>Today</button>
            <button type="button" className="chip" aria-pressed={date === addDays(today(), -1)} onClick={() => setDate(addDays(today(), -1))}>Yesterday</button>
            <input type="date" aria-label="Date" value={date} max={today()} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} />
          </div>
        </div>

        <div className="tiles">
          <Tile label="Km (GPS)" value={route?.km != null ? num(route.km) : "—"} unit="km" sub={route ? `from ${num(route.count)} points` : ""} />
          <Tile label="Driving time" value={minutesText(route?.drivingMinutes)} unit="" sub={route?.first ? `first point ${route.first}` : ""} />
          <Tile label="Stopped time" value={minutesText(route?.stoppedMinutes)} unit="" sub={route?.gaps.length ? `${route.gaps.length} gap${route.gaps.length > 1 ? "s" : ""} with no position` : "no gaps"} tone={route?.gaps.length ? "warn" : ""} />
          <Tile label="Stops" value={route?.stopsCount ?? "—"} unit="of 10 min or more" sub={route?.last ? `last point ${route.last}` : ""} />
        </div>

        {!entry.data && !noConnector && (
          <>
            <ErrBox entry={entry} onRetry={() => void store.load(key, "driver_route", { driver: username, date })} />
            {!entry.err && <Loading>Loading the route…</Loading>}
          </>
        )}
        {route?.note && <Notice tone="info">{route.note}</Notice>}

        <div className="driver-layout">
          <div className="stack">
            <MapView markers={markers} route={mapRoute} focus={focus} onPick={() => undefined} />
            <div className="legend" aria-label="Legend">
              <span><i style={{ background: SPEED_COLORS.stopped }} />Standing</span>
              <span><i style={{ background: SPEED_COLORS.slow }} />Under 20 km/h</span>
              <span><i style={{ background: SPEED_COLORS.normal }} />20–60 km/h</span>
              <span><i style={{ background: SPEED_COLORS.fast }} />Over 60 km/h</span>
              <span><i className="thin" />Poor fix (over 30 m)</span>
              <span><i className="dashed" />No GPS / app not running</span>
              <span><i className="ring" />Stop</span>
            </div>
            {snapNote && (
              <div className="legend" data-testid="snap-legend">
                <label><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to roads</label>
                <span>{snapNote}</span>
              </div>
            )}
            {webPlayback && (
              <div className="card card-b play" data-testid="playback">
                <button type="button" className="btn dark" onClick={playback.toggle} aria-label={playback.playing ? "Pause" : "Play"}>
                  <Icon name={playback.playing ? "pause" : "play"} />{playback.playing ? "Pause" : "Play"}
                </button>
                <Chips<`${PlaybackSpeed}`> options={SPEEDS.map((s) => [`${s}`, `×${s}`] as [`${PlaybackSpeed}`, string])} value={`${playback.speed}`} onChange={(k) => playback.setSpeed(Number(k) as PlaybackSpeed)} />
                <input type="range" aria-label="Time" min={playback.start} max={playback.end} step={1000} value={playback.t} onChange={(e) => playback.seek(Number(e.target.value))} />
                <span className="mono">{clock(playback.t)}{cursor ? ` · ${cursor.label.split(" · ")[1]}` : ""}</span>
              </div>
            )}
          </div>
          <div className="card timeline" data-testid="timeline">
            {route && route.timeline.length ? route.timeline.map((row, i) => (
              <button type="button" key={i} className={`tl-row ${row.kind}${selected === i ? " sel" : ""}`} onClick={() => pickRow(i, row)}>
                <span className="bar" />
                <span className="when">{row.from}–{row.to}</span>
                <span className="grow">
                  <span className="what">
                    {KIND_LABEL[row.kind]}{row.kind === "driving" && row.km != null ? ` · ${num(row.km)} km` : ""}
                    {row.uploaded ? <span className="late"> · Offline here · uploaded {row.uploaded}</span> : null}
                  </span>
                  <span className="sub">{row.kind === "stopped" ? (row.near ? `near ${row.near} · ` : "") + minutesText(row.minutes) : minutesText(row.minutes)}</span>
                </span>
              </button>
            )) : <Empty>{route ? "No timeline for this day." : entry.err ? "The route could not load." : "Loading…"}</Empty>}
          </div>
        </div>
        {route?.km != null && <p className="muted small">Km from GPS, drift filtered: fixes worse than 50 m, jumps and drift while standing still are left out. The odometer is the true figure.{route.shown != null ? ` Line: ${num(route.shown)} of ${num(route.count)} points.` : ""}</p>}
      </div>
    </section>
  );
}
