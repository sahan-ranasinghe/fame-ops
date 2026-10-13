// One driver: who they are, their status now, and where they went on a day:
// the route on the map (coloured by speed, stops and data gaps marked), the
// day's numbers, the timeline beside the map, and playback (web build). Today's
// line grows as the driver moves: the earlier part of the day is loaded once
// from driver_route (refreshed every minute for the numbers), new positions
// come from the driver_latest rows the live page already receives.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists, useWatch } from "../data/hooks";
import { positionOf, statusLine, statusTone } from "../data/live";
import { appendLive, focusOf, KIND_LABEL, mapRouteOf, minutesText, positionAt, type Route, routeOf, type TimelineRow } from "../data/route";
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

export function DriverPage() {
  const { username = "" } = useParams();
  const { store, noConnector } = useFleet();
  const lists = useLists(!noConnector);
  const [date, setDate] = useState(today());
  const isToday = date === today();
  const isTodayRef = useRef(isToday);
  isTodayRef.current = isToday;
  const [route, setRoute] = useState<Route | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<RoutePoint[] | null>(null);
  const employeeId = useRef<string | undefined>(undefined);

  const key = `route.${username}.${date}`;
  const entry = useWatch<DriverRoute>(key, "driver_route", { driver: username, date }, isToday ? ROUTE_EVERY_MS : PAST_DAY_MS, !noConnector && !!username);
  const { live, rt } = useLiveDrivers((row) => {
    if (isTodayRef.current && employeeId.current && row.employee_id === employeeId.current) setRoute((r) => (r ? appendLive(r, row) : r));
  });
  useEffect(() => {
    setRoute(entry.data ? routeOf(username, entry.data) : null);
    setSelected(null);
    setFocus(null);
  }, [entry.data, username]);

  const card = live.data?.drivers.find((d) => d.username === username);
  employeeId.current = card?.employee_id;
  const info = lists.drivers?.find((d) => d.username === username);
  const name = card?.driver ?? info?.name ?? username;
  const phone = info?.phone;
  const call = card?.links?.call ?? info?.call ?? (phone ? `tel:${phone}` : undefined);
  const whatsapp = card?.links?.whatsapp ?? info?.whatsapp ?? (phone ? waLink(phone) : undefined);
  const tone = card ? statusTone(card.status, card.state) : "bad";
  const status = card ? statusLine(card) : info?.location ?? "Not sharing";

  const playback = usePlayback(route?.points ?? []);
  const webPlayback = __BUILD__ === "web" && !!route && route.points.length > 1;
  const cursor = useMemo(() => {
    if (!webPlayback || !route) return null;
    const p = positionAt(route.points, playback.t);
    return p ? { lat: p.lat, lng: p.lng, label: `${clock(playback.t)} · ${p.kmh} km/h` } : null;
  }, [webPlayback, route, playback.t]);
  const mapRoute = useMemo(() => mapRouteOf(route, playback.playing || (webPlayback && playback.t > playback.start) ? cursor : null), [route, cursor, playback.playing, playback.t, playback.start, webPlayback]);
  const markers = useMemo<MapMarker[]>(() => {
    const pos = card && isToday ? positionOf(card) : null;
    if (!pos || !card) return [];
    return [{ id: card.username, label: card.vehicle ? card.vehicle.split(" · ")[0] : card.driver, title: card.driver, lat: pos.lat, lng: pos.lng, tone, selected: true }];
  }, [card, isToday, tone]);

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
            </div>
            <Pill tone={tone}>{status}</Pill>
          </div>
          <dl className="facts">
            <div><dt>Last position</dt><dd>{card?.last_position_at ?? route?.last ?? "—"}</dd></div>
            <div><dt>Vehicle</dt><dd>{card?.vehicle ?? info?.current_vehicle ?? "—"}</dd></div>
            <div><dt>Task</dt><dd>{card?.task ?? "—"}</dd></div>
            <div><dt>Live updates</dt><dd>{rt === "live" ? <span className="status live">On</span> : isToday ? "Every 30 s" : "—"}</dd></div>
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
          <Tile label="Stopped time" value={minutesText(route?.stoppedMinutes)} unit="" sub={route?.gaps.length ? `${route.gaps.length} gap${route.gaps.length > 1 ? "s" : ""} with no data` : "no data gaps"} tone={route?.gaps.length ? "warn" : ""} />
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
              <span><i className="dashed" />No data</span>
              <span><i className="ring" />Stop</span>
            </div>
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
                  <span className="what">{KIND_LABEL[row.kind]}{row.kind === "driving" && row.km != null ? ` · ${num(row.km)} km` : ""}</span>
                  <span className="sub">{row.kind === "stopped" ? (row.near ? `near ${row.near} · ` : "") + minutesText(row.minutes) : minutesText(row.minutes)}</span>
                </span>
              </button>
            )) : <Empty>{route ? "No timeline for this day." : entry.err ? "The route could not load." : "Loading…"}</Empty>}
          </div>
        </div>
        {route?.km != null && <p className="muted small">Km from GPS, drift filtered: fixes worse than 50 m, jumps and drift while standing still are left out. The odometer is the true figure.</p>}
      </div>
    </section>
  );
}
