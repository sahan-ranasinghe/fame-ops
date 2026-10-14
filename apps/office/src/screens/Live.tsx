import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { positionOf, recordedAtOf, statusLine, statusTone } from "../data/live";
import { appendLive, mapRouteOf, type Route, routeOf, trailOf } from "../data/route";
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

type Filter = "all" | "live" | "no_signal" | "location_off" | "not_sharing";
const FILTERS: [Filter, string][] = [["all", "All"], ["live", "Live"], ["no_signal", "No signal"], ["location_off", "Location off"], ["not_sharing", "Not sharing"]];
const tone = (x: LiveDriver) => statusTone(x.status, x.state);
const sharingNow = (x: LiveDriver) => (x.signal ? x.signal.sharing : x.state !== "not_sharing");

export function Live() {
  const { me, store, transport, noConnector, managePermissions } = useFleet();
  const routes = can(me, ...ROUTES_NEED);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  // "Show today's trails": every sharing driver's line today, loaded once each, then grown from the Realtime rows.
  const [trails, setTrails] = useState(false);
  const [trailMap, setTrailMap] = useState<Map<string, Route>>(new Map());
  const loading = useRef(new Set<string>());
  const driversRef = useRef<LiveDriver[]>([]);

  const { live, rt } = useLiveDrivers((row) => {
    const who = driversRef.current.find((x) => x.employee_id === row.employee_id);
    if (!who) return;
    setTrailMap((m) => {
      const r = m.get(who.username);
      if (!r) return m;
      const next = new Map(m);
      next.set(who.username, appendLive(r, row));
      return next;
    });
    setRoute((r) => (r && r.username === who.username ? appendLive(r, row) : r));
  });
  const d = live.data;
  const all = useMemo(() => d?.drivers ?? [], [d]);
  driversRef.current = all;
  const shown = filter === "all" ? all : all.filter((x) => (x.status ?? (x.state === "sharing" ? "live" : x.state === "stale" ? "no_signal" : "not_sharing")) === filter);
  const sel = all.find((x) => x.username === selected) ?? all[0];
  useEffect(() => { if (!selected && all[0]) setSelected(all[0].username); }, [all, selected]);

  // Trails on: load today's route of every sharing driver that has none yet.
  useEffect(() => {
    if (!trails || !routes) return;
    for (const x of all) {
      if (!sharingNow(x) || trailMap.has(x.username) || loading.current.has(x.username)) continue;
      loading.current.add(x.username);
      void transport.call<DriverRoute>("driver_route", { driver: x.username })
        .then((p) => setTrailMap((m) => new Map(m).set(x.username, routeOf(x.username, p))))
        .catch(() => undefined)
        .finally(() => loading.current.delete(x.username));
    }
  }, [trails, routes, all, trailMap, transport]);

  const markers = useMemo<MapMarker[]>(() => all.flatMap((x) => {
    const pos = positionOf(x);
    if (!pos) return [];
    const at = recordedAtOf(x);
    return [{ id: x.username, label: plateOf(x.vehicle) || x.driver, title: x.driver, lat: pos.lat, lng: pos.lng, tone: tone(x), selected: x.username === sel?.username, heading: x.heading ?? null, at: at ? Date.parse(at) : null }];
  }), [all, sel?.username]);
  const mapRoute = useMemo<MapRoute | null>(() => (route && route.username === sel?.username ? mapRouteOf(route) : null), [route, sel?.username]);
  const mapTrails = useMemo<MapRoute[]>(() => (trails ? [...trailMap.values()].filter((r) => !(mapRoute && r.username === sel?.username)).map(trailOf) : []), [trails, trailMap, mapRoute, sel?.username]);

  async function showRoute(username: string) {
    setRouteBusy(true);
    setRouteErr(null);
    try {
      const p = await transport.call<DriverRoute>("driver_route", { driver: username });
      setRoute(routeOf(username, p));
    } catch (e) {
      setRouteErr(errText(e as FleetError)[0]);
      setRoute(null);
    }
    setRouteBusy(false);
  }

  const counts = d?.status_counts ? { all: d.counts.all, ...d.status_counts } : undefined;
  return (
    <section className="view">
      <div className="ph">
        <div>
          <div className="eyebrow">
            Shared by drivers from the Fame Driver app ·{" "}
            <span data-testid="rt-status" className={rt === "live" ? "status live" : "status muted"}>{rt === "live" ? "Live updates" : "Refreshes every 30 s"}</span>
          </div>
          <h1>Live locations</h1>
        </div>
        {d && (
          <div className="ph-actions">
            <Chips options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
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
          {d && (shown.length ? shown.map((x) => (
            <button type="button" key={x.username} className={`lrow ${x.username === sel?.username ? "sel" : ""}`} onClick={() => { setSelected(x.username); setRouteErr(null); }}>
              <span className={`dot ${tone(x)}`} />
              <span className="grow">
                <span className="name">{x.driver} <Plate v={x.vehicle} /></span>
                <span className="sub" style={{ display: "block" }}>{joinDots([x.task, x.near && "near " + x.near]) || "No task"}</span>
              </span>
              <span className={`age status ${tone(x)}`}>{statusLine(x).replace(/^Live · /, "")}</span>
            </button>
          )) : <Empty>{all.length ? "Nobody in this group right now." : "No driver is sharing their location or on a task right now."}</Empty>)}
        </div>
        <div className="stack live-map">
          <MapView markers={markers} route={mapRoute} trails={mapTrails} onPick={(id) => setSelected(id)} />
          {sel && <Detail x={sel} routes={routes} route={route && route.username === sel.username ? route : null} busy={routeBusy} err={routeErr} onRoute={() => void showRoute(sel.username)} onHide={() => setRoute(null)} />}
        </div>
      </div>
    </section>
  );
}

function Detail({ x, routes, route, busy, err, onRoute, onHide }: { x: LiveDriver; routes: boolean; route: Route | null; busy: boolean; err: string | null; onRoute: () => void; onHide: () => void }) {
  const links = x.links ?? {};
  return (
    <div className="card card-b" data-testid="live-detail">
      <div className="row" style={{ padding: 0 }}>
        <Avatar name={x.driver} />
        <div className="grow"><div className="name" style={{ fontSize: 20 }}>{routes ? <Link to={`/drivers/${x.username}`}>{x.driver}</Link> : x.driver}</div><div className="sub">{joinDots([x.vehicle, x.task, x.going_to && "to " + x.going_to])}</div></div>
        <Pill tone={tone(x)}>{statusLine(x)}</Pill>
      </div>
      <dl className="facts">
        <div><dt>Last position</dt><dd>{x.last_position_at ?? (x.updated ? String(x.updated).slice(-5) : "—")}</dd></div>
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
        </p>
      )}
      <div className="acts">
        {routes && <Link className="btn dark" to={`/drivers/${x.username}`}><Icon name="route" />Driver page</Link>}
        {links.maps && <a className="btn" href={links.maps} target="_blank" rel="noopener">Open in Google Maps</a>}
        {links.whatsapp && <a className="btn" href={links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
        {links.call && <a className="btn" href={links.call}>Call</a>}
        {routes && <button type="button" className="btn" onClick={onRoute} disabled={busy}>Today’s route</button>}
      </div>
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
