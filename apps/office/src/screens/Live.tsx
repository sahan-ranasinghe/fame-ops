// Live locations: every driver's marker (driver_latest over Realtime, the
// tool every 30 s), the selected driver's route today, and "Show today's
// trails". A trail is loaded once from driver_route and then grows point by
// point from ONE Realtime channel on location_points filtered to the drivers
// currently sharing (each point put in by its time, so a backlog lands in its
// place); every 60 s the trails and the shown route are fetched again (at
// tolerance 0, like the driver page) and merged by time into the line already drawn, as the
// fallback, so the line never depends on one point per upload.
// Phase 7: the list has every active driver with a duty chip (on a task, on
// duty, off duty); the map draws the drivers on duty. From the detail card the
// office moves a driver to another vehicle or clocks them out (a second step
// on the card itself).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import {
  canClockOut,
  canMoveVehicle,
  clockOutLine,
  type ClockOutResult,
  dutyLine,
  dutyOf,
  filterCounts,
  inFilter,
  LIVE_FILTERS,
  type LiveFilter,
  liveTone,
  onMap,
  positionOf,
  recordedAtOf,
  statusLine,
  statusTone,
} from "../data/live";
import { megabytes } from "./fuelLogic";
import { insertPoint, mapRouteOf, mergeRoute, type Route, routeOf, trailOf } from "../data/route";
import { useWatchDrivers } from "../data/watchDrivers";
import type { DriverRoute, LiveDriver } from "../data/types";
import { useLiveDrivers } from "../data/useLive";
import { joinDots, num, plateOf } from "../lib/format";
import { MapView } from "../map/MapView";
import type { MapMarker, MapRoute } from "../map/types";
import { ROUTES_NEED } from "../app/nav";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { Avatar, Chips, Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";

/** The trails and the shown route are fetched again this often (the fallback when Realtime is not delivering). */
const TRAIL_REFRESH_MS = 60000;
/** The shown route of one driver: every point the tool kept with a 3 m tolerance. */
/** The line the maps draw: every stored point up to 3,000 (tolerance 0); above that the tool picks the smallest tolerance that fits. */
const ROUTE_ARGS = { line_tolerance_m: 0, max_line_points: 3000 };
/** The shown route also asks for its gaps' estimated road lines (Part 5b); the light trails do not. */
const SHOWN_ARGS = { ...ROUTE_ARGS, estimate_gaps: true };

const sharingNow = (x: LiveDriver) => (x.signal ? x.signal.sharing : x.state !== "not_sharing");

export function Live() {
  const { me, store, transport, noConnector, managePermissions, realtime } = useFleet();
  const routes = can(me, ...ROUTES_NEED);
  const [filter, setFilter] = useState<LiveFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  // "Show today's trails": every sharing driver's line today, loaded once each, then grown from the Realtime rows.
  const [trails, setTrails] = useState(false);
  const [trailMap, setTrailMap] = useState<Map<string, Route>>(new Map());
  const [pointsRt, setPointsRt] = useState<"none" | "connecting" | "live" | "error">("none");
  const loading = useRef(new Set<string>());
  const driversRef = useRef<LiveDriver[]>([]);
  const trailMapRef = useRef(trailMap);
  trailMapRef.current = trailMap;
  const routeRef = useRef(route);
  routeRef.current = route;

  const { live, rt } = useLiveDrivers();
  const d = live.data;
  const all = useMemo(() => d?.drivers ?? [], [d]);
  driversRef.current = all;

  // The drivers whose points are watched: everyone sharing while the trails are on, else only the driver whose route is shown.
  const watchKey = useMemo(() => {
    const who = trails ? all.filter(sharingNow) : all.filter((x) => route && x.username === route.username && sharingNow(x));
    return who.map((x) => x.employee_id).filter((id): id is string => !!id).sort().join(",");
  }, [all, trails, route]);
  useEffect(() => {
    if (!watchKey || !realtime?.driversPoints) return;
    let alive = true;
    const stop = realtime.driversPoints(watchKey.split(","), (row) => {
      if (!alive) return;
      const who = driversRef.current.find((x) => x.employee_id === row.employee_id);
      if (!who) return;
      setTrailMap((m) => {
        const r = m.get(who.username);
        if (!r) return m;
        const next = new Map(m);
        next.set(who.username, insertPoint(r, row));
        return next;
      });
      setRoute((r) => (r && r.username === who.username ? insertPoint(r, row) : r));
    }, (s) => { if (alive) setPointsRt(s); });
    return () => { alive = false; setPointsRt("none"); stop(); };
  }, [watchKey, realtime]);

  // The fallback: every 60 s the trails and the shown route are fetched again from the tool.
  useEffect(() => {
    if (!trails && !route) return;
    const timer = setInterval(() => {
      for (const x of driversRef.current) {
        if (!trails || !sharingNow(x) || !trailMapRef.current.has(x.username) || loading.current.has(x.username)) continue;
        loading.current.add(x.username);
        void transport.call<DriverRoute>("driver_route", { driver: x.username, ...ROUTE_ARGS })
          .then((p) => setTrailMap((m) => {
            const cur = m.get(x.username);
            const fresh = routeOf(x.username, p);
            return new Map(m).set(x.username, cur ? mergeRoute(cur, fresh) : fresh);
          }))
          .catch(() => undefined)
          .finally(() => loading.current.delete(x.username));
      }
      const shown = routeRef.current;
      if (shown) {
        void transport.call<DriverRoute>("driver_route", { driver: shown.username, ...SHOWN_ARGS })
          .then((p) => setRoute((r) => (r && r.username === shown.username ? mergeRoute(r, routeOf(shown.username, p)) : r)))
          .catch(() => undefined);
      }
    }, TRAIL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [trails, !!route, transport]);
  const shown = filter === "all" ? all : all.filter((x) => inFilter(x, filter));
  const sel = all.find((x) => x.username === selected) ?? all[0];
  useEffect(() => { if (!selected && all[0]) setSelected(all[0].username); }, [all, selected]);
  // Watched mode: the selected driver (every sharing driver while the trails are on) uploads every 10 s while moving.
  useWatchDrivers(trails ? all.filter(sharingNow).map((x) => x.username) : sel && sharingNow(sel) ? [sel.username] : []);

  // Trails on: load today's route of every sharing driver that has none yet.
  useEffect(() => {
    if (!trails || !routes) return;
    for (const x of all) {
      if (!sharingNow(x) || trailMap.has(x.username) || loading.current.has(x.username)) continue;
      loading.current.add(x.username);
      void transport.call<DriverRoute>("driver_route", { driver: x.username, ...ROUTE_ARGS })
        .then((p) => setTrailMap((m) => new Map(m).set(x.username, routeOf(x.username, p))))
        .catch(() => undefined)
        .finally(() => loading.current.delete(x.username));
    }
  }, [trails, routes, all, trailMap, transport]);

  // Only the drivers on duty or on a task are drawn; off duty is the list only.
  const markers = useMemo<MapMarker[]>(() => all.flatMap((x) => {
    const pos = onMap(x) ? positionOf(x) : null;
    if (!pos) return [];
    const at = recordedAtOf(x);
    return [{ id: x.username, label: plateOf(x.vehicle) || x.driver, sub: x.last_position_time ? `position ${x.last_position_time}` : undefined, title: x.driver, lat: pos.lat, lng: pos.lng, tone: statusTone(x.status, x.state), selected: x.username === sel?.username, heading: x.heading ?? null, at: at ? Date.parse(at) : null }];
  }), [all, sel?.username]);
  const mapRoute = useMemo<MapRoute | null>(() => (route && route.username === sel?.username ? mapRouteOf(route) : null), [route, sel?.username]);
  const mapTrails = useMemo<MapRoute[]>(() => (trails ? [...trailMap.values()].filter((r) => !(mapRoute && r.username === sel?.username)).map(trailOf) : []), [trails, trailMap, mapRoute, sel?.username]);

  async function showRoute(username: string) {
    setRouteBusy(true);
    setRouteErr(null);
    try {
      const p = await transport.call<DriverRoute>("driver_route", { driver: username, ...SHOWN_ARGS });
      setRoute(routeOf(username, p));
    } catch (e) {
      setRouteErr(errText(e as FleetError)[0]);
      setRoute(null);
    }
    setRouteBusy(false);
  }

  const counts = useMemo(() => (d ? filterCounts(all) : undefined), [d, all]);
  return (
    <section className="view">
      <div className="ph">
        <div>
          <div className="eyebrow">
            Shared by drivers from the Fame Driver app ·{" "}
            <span data-testid="rt-status" className={rt === "live" ? "status live" : "status muted"}>{rt === "live" ? "Live updates" : "Refreshes every 30 s"}</span>
            {(trails || route) && pointsRt === "live" && <span className="status live"> · lines point by point</span>}
          </div>
          <h1>Live locations</h1>
        </div>
        {d && (
          <div className="ph-actions">
            <Chips options={LIVE_FILTERS} value={filter} onChange={setFilter} counts={counts} />
            {routes && <button type="button" className="chip" aria-pressed={trails} onClick={() => setTrails((t) => !t)}><Icon name="route" />Show today’s trails</button>}
          </div>
        )}
      </div>
      <div className="live-layout">
        <div className="card llist">
          {!d && !noConnector && (
            <>
              <ErrBox entry={live} onRetry={() => void store.load("live", "live_drivers", { filter: "all" })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
              {!live.err && <Loading>Finding drivers…</Loading>}
            </>
          )}
          {d && <StaleNote entry={live} />}
          {d && (shown.length ? shown.map((x) => {
            const working = dutyOf(x) !== "off_duty";
            return (
              <button type="button" key={x.username} className={`lrow ${x.username === sel?.username ? "sel" : ""}`} onClick={() => { setSelected(x.username); setRouteErr(null); }}>
                <span className={`dot ${liveTone(x)}`} />
                <span className="grow">
                  <span className="name">{x.driver} <Plate v={x.vehicle} />{x.vehicle_since && <span className="muted small"> since {x.vehicle_since}</span>}</span>
                  <span className="duty-lines">
                    <DutyChip x={x} />
                    {working && <span className="sub">{joinDots([x.task, x.near && "near " + x.near]) || "No task"}</span>}
                  </span>
                  {x.vehicle_note && <span className="sub" style={{ display: "block" }}>{x.vehicle_note}</span>}
                  {x.app_stops_text && <span className="small" style={{ display: "block" }}><span className="app-stops">{x.app_stops_text}</span>{x.phone && <span className="muted"> · {x.phone}</span>}</span>}
                </span>
                {working && <span className={`age status ${liveTone(x)}`}>{statusLine(x).replace(/^Live · /, "")}</span>}
              </button>
            );
          }) : <Empty>{all.length ? "Nobody in this group right now." : "No active driver yet."}</Empty>)}
        </div>
        <div className="stack live-map">
          <MapView markers={markers} route={mapRoute} trails={mapTrails} onPick={(id) => setSelected(id)} />
          {sel && <Detail key={sel.username} x={sel} routes={routes} route={route && route.username === sel.username ? route : null} busy={routeBusy} err={routeErr} onRoute={() => void showRoute(sel.username)} onHide={() => setRoute(null)} />}
        </div>
      </div>
    </section>
  );
}

/** The duty chip: On a task (blue), On duty, Off duty (grey), with since when (and how an off duty began). */
function DutyChip({ x }: { x: LiveDriver }) {
  return <span className={`duty ${dutyOf(x)}`} data-testid="duty-chip">{dutyLine(x)}</span>;
}

function Detail({ x, routes, route, busy, err, onRoute, onHide }: { x: LiveDriver; routes: boolean; route: Route | null; busy: boolean; err: string | null; onRoute: () => void; onHide: () => void }) {
  const { me, store, transport } = useFleet();
  const links = x.links ?? {};
  const working = dutyOf(x) !== "off_duty";
  const first = x.driver.split(" ")[0];
  // Clock out is a second step on the card itself: "Clock out Kamal?" with Clock out / Keep on duty.
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const clockOut = me.tools.includes("clock_out_driver") && canClockOut(x);
  const move = me.tools.includes("move_driver_vehicle") && canMoveVehicle(x);

  async function doClockOut() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await transport.call<ClockOutResult>("clock_out_driver", { driver: x.username });
      setMsg({ tone: r.clocked_out === false ? "info" : "ok", text: clockOutLine(r) });
      setArmed(false);
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setSaving(false);
  }

  return (
    <div className="card card-b" data-testid="live-detail">
      <div className="row" style={{ padding: 0 }}>
        <Avatar name={x.driver} />
        <div className="grow">
          <div className="name" style={{ fontSize: 20 }}>{routes ? <Link to={`/drivers/${x.username}`}>{x.driver}</Link> : x.driver}</div>
          <div className="sub">{joinDots([x.vehicle && (x.vehicle_since ? `${x.vehicle} · since ${x.vehicle_since}` : x.vehicle), x.task, x.going_to && "to " + x.going_to])}</div>
        </div>
        {working && <Pill tone={liveTone(x)}>{statusLine(x)}</Pill>}
      </div>
      <div className="duty-lines" style={{ marginTop: 12 }}>
        <DutyChip x={x} />
        {x.vehicle_note && <span className="sub duty-note" data-testid="vehicle-note">{x.vehicle_note}</span>}
        {x.app_stops_text && <span className="small app-stops duty-note" data-testid="app-stops">{x.app_stops_text}</span>}
        {x.phone && <span className="muted small duty-note">{x.phone}</span>}
      </div>
      <dl className="facts">
        <div><dt>Last position</dt><dd className="mono" data-testid="live-position">{x.last_position_time ?? x.last_position_at ?? (x.updated ? String(x.updated).slice(-5) : "—")}</dd></div>
        <div><dt>On duty since</dt><dd>{x.on_duty_since ?? "—"}</dd></div>
        <div><dt>Near</dt><dd>{x.near || "—"}</dd></div>
        <div><dt>Speed</dt><dd>{x.speed_kmh != null && (x.status ?? "live") === "live" ? num(x.speed_kmh) + " km/h" : "—"}</dd></div>
        <div><dt>Battery</dt><dd>{x.battery_pct != null ? x.battery_pct + "%" : "—"}</dd></div>
      </dl>
      {(x.eta_next || x.eta_final) && (
        <p className="small" style={{ margin: "0 0 12px" }} data-testid="eta-line">
          ETA{x.next_stop ? ` ${x.next_stop}` : " next"} {x.eta_next ?? "—"} · final {x.eta_final ?? "—"} (live){x.late_min ? <span className="status bad"> · running late by {x.late_min} min</span> : null}
        </p>
      )}
      {x.heartbeat_at && (
        <p className="muted small" style={{ margin: "0 0 12px" }} data-testid="phone-line">
          Phone {String(x.heartbeat_at).slice(-5)}: Location {x.location_on === false ? "off" : "on"} · permission {x.permission ?? "?"}
          {x.app_version ? ` · app ${x.app_version}` : ""}{x.queued_points ? ` · ${x.queued_points} points waiting on the phone` : ""}
          {x.video_uploads_waiting ? ` · ${x.video_uploads_waiting} video${x.video_uploads_waiting === 1 ? "" : "s"} waiting${x.video_bytes_waiting ? ` (${megabytes(x.video_bytes_waiting)})` : ""}` : ""}
        </p>
      )}
      <div className="acts">
        {routes && <Link className="btn dark" to={`/drivers/${x.username}`}><Icon name="route" />Driver page</Link>}
        {links.maps && <a className="btn" href={links.maps} target="_blank" rel="noopener">Open in Google Maps</a>}
        {links.whatsapp && <a className="btn" href={links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
        {links.call && <a className="btn" href={links.call}>Call</a>}
        {routes && <button type="button" className="btn" onClick={onRoute} disabled={busy}>Today’s route</button>}
        {move && <Link className="btn" to={`/drivers/${x.username}/vehicle`}>Move to vehicle</Link>}
        {clockOut && !armed && <button type="button" className="btn" disabled={saving} onClick={() => { setArmed(true); setMsg(null); }}>Clock out</button>}
      </div>
      {clockOut && armed && (
        <div className="confirm" style={{ marginTop: 14 }} data-testid="clock-out-confirm">
          <div>
            <b>Clock out {first}?</b>
            <p className="muted small" style={{ margin: "4px 0 0" }}>Their location stops being recorded.</p>
          </div>
          <div className="acts">
            <button type="button" className="btn danger" disabled={saving} onClick={() => void doClockOut()}>Clock out</button>
            <button type="button" className="btn" disabled={saving} onClick={() => setArmed(false)}>Keep on duty</button>
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 14 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {(busy || err || route) && (
        <div style={{ marginTop: 14 }}>
          {busy && <Loading>Loading today’s route…</Loading>}
          {!busy && err && <Notice>{err}</Notice>}
          {!busy && !err && route && (
            <Notice tone="info" action={<button type="button" className="btn small" onClick={onHide}>Hide route</button>}>
              <b>Today: {num(route.km)} km</b> from {route.count} points{route.first ? `, ${route.first}–${route.last}` : ""}. {route.stops.length ? "Stops over 10 min: " + route.stops.map((s) => s.text).join("; ") : "No stops over 10 minutes."}
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
