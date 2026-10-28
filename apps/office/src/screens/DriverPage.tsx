// One driver: who they are, their status now, and where they went on a day:
// ONE summary card (§33.6 item 1, Round 4–7; Samsara's driver day, Google Maps
// Timeline: the km, driving and stopped time, the stops, the first and last
// point, "No GPS for 2 h 10 min"), the route on the map (coloured by speed,
// thin where the fix was poor, holes dashed, snapped to roads by default where
// the server allows it, "Recorded points" for the raw line), each stop a pin
// and each gap a marker whose card says what it was (a tap opens the card and
// moves the map to it: §21), and playback (web build: the recorded clock at
// 1×–60×, the marker moving smoothly along the drawn line and across the gaps:
// §22). The day's timeline list and the Gaps list are gone (Sahan's decision).
// Today's line grows as the driver moves: the earlier part of the day is loaded
// from driver_route (full resolution, refreshed every minute for the numbers),
// and on the web every new location point lands at once through Realtime, each
// one put in by its time, so a backlog uploaded after an outage fills its gap.
// Round 48 (items 2 and 3; Airbnb's split view, Google Maps Timeline): on a
// desktop the map is a sticky pane with the playback bar over its bottom edge
// and the details scroll beside it; on a phone the map has a fixed height with
// the playback right under it and the content below (routeLayout.ts). The
// legend is one compact row and the explanations are behind ⓘ (RouteInfo.tsx);
// the first and last point are pins, the stops dots, the event marks a layer
// behind the page's Filter button (map/layers.ts), overlapping marks a cluster.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists, useWatch } from "../data/hooks";
import { useWatchDrivers } from "../data/watchDrivers";
import { positionOf, recordedAtOf, statusLine, statusTone } from "../data/live";
import { type Cursor, drawnLine, insertPoint, mapRouteOf, mergeRoute, minutesText, type Route, routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import { useLiveDrivers } from "../data/useLive";
import { addDays, longDate, num, today, waLink } from "../lib/format";
import { MapView } from "../map/MapView";
import { useGoogleMap } from "../map/google/useGoogleMap";
import { eventsOn, LAYERS_DEF, withEvents } from "../map/layers";
import { snapAllowed } from "../map/mapChoice";
import type { MapMarker, RoutePoint } from "../map/types";
import { Avatar, Chips, ErrBox, Loading, Notice, Pill, Plate, VehicleThumb } from "../ui/basics";
import { useDateRange } from "../ui/DateRangePicker";
import { DayStrip } from "../ui/DayPicker";
import { FilterBar, useUrlFilters } from "../ui/FilterBar";
import { Icon } from "../ui/icons";
import { dayIsEmpty, daySummary } from "./dayLogic";
import { useRouteMarks } from "./GapsList";
import { clockText, gapWindowsOf, playbackPath } from "./playbackLogic";
import { RouteLegend } from "./RouteInfo";
import { useRouteLayout } from "./routeLayout";
import { RouteMapPane } from "./RouteMapPane";
import { type PlaybackSpeed, SPEEDS, usePlayback } from "./usePlayback";

const ROUTE_EVERY_MS = 60000;
const PAST_DAY_MS = 6 * 3600000;

/** The line the map draws: every stored point up to 3,000 (tolerance 0); above that the tool picks the smallest tolerance that fits. */
// Round 48 snap hotfix: `source` names this screen on every snap-to-roads call (routing_usage counts by it).
const LINE_ARGS = { line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true, source: "site_route" };

export function DriverPage() {
  const { username = "" } = useParams();
  const { store, noConnector, realtime } = useFleet();
  const lists = useLists(!noConnector);
  // A route is one day (Phase 7 §8): the date-range control in one-day mode, the day in the URL (?range=yesterday, or
  // ?range=custom&from=YYYY-MM-DD).
  const day = useDateRange("today", { oneDay: true });
  const date = day.from;
  const isToday = date === today();
  const isTodayRef = useRef(isToday);
  isTodayRef.current = isToday;
  const [route, setRoute] = useState<Route | null>(null);
  const [focus, setFocus] = useState<RoutePoint[] | null>(null);
  // Snap to roads only while Google's map is the one drawn, or under the open package (Part 6): never for the free map shown
  // instead of Google's, and never a Roads call for a line that is not drawn.
  const [snapWanted, setSnap] = useState(true);
  const mapChoice = useGoogleMap();
  const snap = snapWanted && snapAllowed(mapChoice);
  const [pointsRt, setPointsRt] = useState<"none" | "connecting" | "live" | "error">("none");

  const key = `route.${username}.${date}.${snap ? "snap" : "raw"}`;
  const entry = useWatch<DriverRoute>(key, "driver_route", { driver: username, date, ...LINE_ARGS, snap }, isToday ? ROUTE_EVERY_MS : PAST_DAY_MS, !noConnector && !!username);
  // Watched mode: today, this driver's phone uploads every 10 s while moving.
  useWatchDrivers(isToday && username ? [username] : []);
  const { live, rt } = useLiveDrivers();
  // A fresh answer for the same day is merged by time into the line drawn (the Realtime points stay); another day or driver
  // replaces it. Switching "Recorded points" keeps the line drawn until the other answer comes (no empty map meanwhile).
  useEffect(() => {
    const fresh = entry.data ? routeOf(username, entry.data) : null;
    setRoute((r) => {
      if (!fresh) return r && r.username === username && r.date === date ? r : null;
      return r && r.username === fresh.username && r.date === fresh.date ? mergeRoute(r, fresh) : fresh;
    });
  }, [entry.data, username, date]);
  // The Events layer (Round 48): the page's Filter button, the value in the URL (?layers=events), off by default.
  const layers = useUrlFilters([LAYERS_DEF]);
  const events = eventsOn(layers.values);
  // The marks (the pins, the stops' dots, the gaps' events) and the open card, kept by its id across refreshes.
  const marks = useRouteMarks(route, snap, setFocus, { events, latest: isToday });
  const { setOpen: setOpenMark } = marks;
  useEffect(() => {
    setOpenMark(null);
    setFocus(null);
  }, [username, date, setOpenMark]);
  const layout = useRouteLayout();

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
  const status = card ? statusLine(card) : info?.location ?? "Off duty";

  // Playback follows the line the map draws (the snapped one when shown) and each gap's estimated line, in recorded time.
  const path = useMemo(() => (route ? playbackPath(drawnLine(route, snap), route.estimated) : []), [route, snap]);
  const windows = useMemo(() => gapWindowsOf(route), [route]);
  const playback = usePlayback(path, windows);
  const webPlayback = __BUILD__ === "web" && !!route && route.points.length > 1;
  const pos = playback.position;
  const cursor: Cursor | null = webPlayback && playback.active && pos
    ? { lat: pos.lat, lng: pos.lng, label: clockText(playback.t, pos.estimated), estimated: pos.estimated, heading: pos.heading }
    : null;
  // The line is built once per answer; during playback only the cursor changes (the line's arrays stay the same objects).
  // The stops are pins with a card (stopPins), not the line's own labelled circles.
  const baseRoute = useMemo(() => {
    const r = mapRouteOf(route, null, snap);
    return r ? { ...r, stops: [] } : r;
  }, [route, snap]);
  const mapRoute = useMemo(() => (baseRoute && cursor ? { ...baseRoute, cursor } : baseRoute), [baseRoute, cursor?.lat, cursor?.lng, cursor?.label, cursor?.estimated, cursor?.heading]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = daySummary(route);
  const noTrips = dayIsEmpty(route);
  const markers = useMemo<MapMarker[]>(() => {
    const pos = card && isToday ? positionOf(card) : null;
    if (!pos || !card) return [];
    const at = recordedAtOf(card);
    return [{ id: card.username, label: card.vehicle ? card.vehicle.split(" · ")[0] : card.driver, title: card.driver, lat: pos.lat, lng: pos.lng, tone, selected: true, heading: card.heading ?? null, at: at ? Date.parse(at) : null }];
  }, [card, isToday, tone]);
  const dayLabel = isToday ? "Today" : date === addDays(today(), -1) ? "Yesterday" : longDate(date, true);
  // The map and its strip (the pane); the playback bar is laid over the map on a desktop, under it on a phone.
  const mapView = (
    <MapView markers={markers} route={mapRoute} focus={focus} onPick={() => undefined} gaps={marks.marks} openGap={marks.open} onGap={marks.onMark} height={layout.mapHeight} />
  );
  const playbackBar = webPlayback && (
    <div className="card card-b play" data-testid="playback">
      <button type="button" className="btn dark" onClick={playback.toggle} aria-label={playback.playing ? "Pause" : "Play"}>
        <Icon name={playback.playing ? "pause" : "play"} />{playback.playing ? "Pause" : "Play"}
      </button>
      <Chips<`${PlaybackSpeed}`> options={SPEEDS.map((s) => [`${s}`, `${s}×`] as [`${PlaybackSpeed}`, string])} value={`${playback.speed}`} onChange={(k) => playback.setSpeed(Number(k) as PlaybackSpeed)} />
      <input type="range" aria-label="Time" min={playback.start} max={playback.end} step={1000} value={Math.round(playback.t)} onChange={(e) => playback.seek(Number(e.target.value))} />
      <span className="mono" data-testid="playback-clock">{clockText(playback.t, !!pos?.estimated)}</span>
    </div>
  );
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

      {/* Round 48: the split view (Airbnb, Google Maps Timeline): the details in this column, the map pane beside it
          (sticky on a desktop; first and at a fixed height on a phone, by CSS order). */}
      <div className={`route-page ${layout.kind}`} data-testid="route-page">
        <div className="stack route-side">
          <div className="card card-b">
            <div className="row" style={{ padding: 0 }}>
              <Avatar name={name} src={card?.photo_url ?? info?.photo_url} large />
              <div className="grow">
                <div className="name" style={{ fontSize: 20 }}>{name} {(card?.vehicle ?? info?.current_vehicle) && <><VehicleThumb src={card?.vehicle_thumb_url} /><Plate v={card?.vehicle ?? info?.current_vehicle} /></>}</div>
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
            <div><div className="eyebrow">{dayLabel}</div><h2 style={{ margin: 0 }}>Route</h2></div>
            {/* The page's one Filter button (docs/ui-patterns.md §1) with the Layers section (§18): the event marks. */}
            <FilterBar filters={[LAYERS_DEF]} values={layers.values} onChange={layers.apply} />
          </div>
          {/* A day of history: the week strip (docs/ui-patterns.md §3); nothing is recorded after today. */}
          <DayStrip value={date} onChange={day.setDay} pastOnly label="Day" />

          {/* §33.6 item 1: the day in one card above the map (the day's numbers, the first and last point, the gaps in one line). */}
          <div className="card card-b day-sum" data-testid="day-summary">
            {/* A day with no position at all: its empty state (what main's "No timeline for this day." said), in the card's words. */}
            {noTrips && <p className="day-empty" data-testid="day-empty">No trips recorded this day.</p>}
            <dl>
              <div><dt>Km (GPS)</dt><dd><b className="num">{summary?.km != null ? num(summary.km) : "—"}</b><small>km</small></dd><span className="sub">{summary ? `from ${num(summary.points)} points` : ""}</span></div>
              <div><dt>Driving time</dt><dd><b>{minutesText(summary?.drivingMinutes)}</b></dd></div>
              <div><dt>Stopped time</dt><dd><b>{minutesText(summary?.stoppedMinutes)}</b></dd></div>
              <div><dt>Stops</dt><dd><b className="num">{summary?.stops ?? "—"}</b></dd><span className="sub">of 10 min or more</span></div>
              <div><dt>First–last point</dt><dd><b className="num" data-testid="day-span">{summary?.first ? `${summary.first}–${summary.last ?? summary.first}` : "—"}</b></dd></div>
            </dl>
            {summary?.noGps && (
              <div className="day-gaps-row">
                <p className="day-gaps" data-testid="day-gaps"><Icon name="alert" />{summary.noGps}{summary.gaps > 1 ? ` · ${summary.gaps} gaps` : ""}</p>
                {/* The event marks are a layer, off by default: one tap turns it on (the same as Filter → Layers → Events). */}
                {!events && marks.rows.length > 0 && <button type="button" className="linkish small" onClick={() => layers.apply(withEvents(layers.values, true))} data-testid="show-events">Show on map</button>}
              </div>
            )}
          </div>

          {!entry.data && !noConnector && (entry.err || !route) && (
            <>
              <ErrBox entry={entry} onRetry={() => void store.load(key, "driver_route", { driver: username, date })} />
              {!entry.err && <Loading>Loading the route…</Loading>}
            </>
          )}
          {route?.note && <Notice tone="info">{route.note}</Notice>}
        </div>

        <RouteMapPane
          layout={layout}
          strip={<RouteLegend route={route} snap={snap} onSnap={(raw) => setSnap(!raw)} events={events} />}
          map={mapView}
          playback={playbackBar || undefined}
        />
      </div>
    </section>
  );
}
