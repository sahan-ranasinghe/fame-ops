import { useEffect, useMemo, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import { applyLatest, positionOf, refreshStates, stateTone } from "../data/live";
import type { DriverRoute, LiveDriver, LiveDrivers } from "../data/types";
import { joinDots, num, plateOf } from "../lib/format";
import { MapView } from "../map/MapView";
import type { MapMarker, MapRoute } from "../map/types";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Avatar, Chips, Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";

type Filter = "all" | "sharing" | "stale" | "not_sharing";
const FILTERS: [Filter, string][] = [["all", "All"], ["sharing", "Sharing"], ["stale", "Stale"], ["not_sharing", "Not sharing"]];

export interface Route {
  username: string;
  km?: number;
  count: number;
  first?: string;
  last?: string;
  points: { lat: number; lng: number }[];
  stops: string[];
}

/** The tool's route rows → points and stop sentences. */
export function routeOf(username: string, p: DriverRoute): Route {
  const cols = p.route?.columns ?? ["time", "lat", "lng", "km/h"];
  const la = cols.indexOf("lat"), lo = cols.indexOf("lng");
  const points = (p.route?.points ?? []).map((r) => ({ lat: Number(r[la]), lng: Number(r[lo]) })).filter((q) => isFinite(q.lat) && isFinite(q.lng));
  const stops = (p.stops_over_10_min ?? []).map((s) => joinDots([`${s.from}–${s.to}`, s.near, `${s.minutes} min`]));
  return { username, km: p.km, count: p.recorded_points ?? points.length, first: p.first_point, last: p.last_point, points, stops };
}

export function Live() {
  const { store, transport, noConnector, managePermissions, realtime } = useFleet();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState<string | null>(null);
  const [rt, setRt] = useState<"none" | "connecting" | "live" | "error">(realtime ? "connecting" : "none");
  const live = useWatch<LiveDrivers>("live", "live_drivers", { filter: "all" }, 30000, !noConnector);
  const d = live.data;

  // Realtime: a new position moves the marker at once; the states age every 30 s.
  useEffect(() => {
    // Only this subscription's status reaches the screen: a subscription that was torn
    // down (React runs effects twice in development) must not report "live".
    let alive = true;
    const stop = realtime?.driverLatest((row) => store.patch<LiveDrivers>("live", (data) => {
      const drivers = applyLatest(data.drivers, row, new Date());
      return drivers === data.drivers ? data : { ...data, drivers };
    }), (s) => { if (alive) setRt(s); });
    const tick = setInterval(() => store.patch<LiveDrivers>("live", (data) => {
      const drivers = refreshStates(data.drivers, new Date());
      return drivers === data.drivers ? data : { ...data, drivers };
    }), 30000);
    return () => { alive = false; stop?.(); clearInterval(tick); };
  }, [realtime, store]);

  const all = useMemo(() => d?.drivers ?? [], [d]);
  const shown = filter === "all" ? all : all.filter((x) => x.state === filter);
  const sel = all.find((x) => x.username === selected) ?? all[0];
  useEffect(() => { if (!selected && all[0]) setSelected(all[0].username); }, [all, selected]);

  const markers = useMemo<MapMarker[]>(() => all.flatMap((x) => {
    const pos = positionOf(x);
    if (!pos) return [];
    return [{ id: x.username, label: plateOf(x.vehicle) || x.driver, title: x.driver, lat: pos.lat, lng: pos.lng, tone: stateTone(x.state), selected: x.username === sel?.username }];
  }), [all, sel?.username]);
  const mapRoute = useMemo<MapRoute | null>(() => (route && route.username === sel?.username ? { points: route.points } : null), [route, sel?.username]);

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

  const counts = d?.counts;
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
        {counts && <Chips options={FILTERS} value={filter} onChange={setFilter} counts={counts} />}
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
              <span className={`dot ${stateTone(x.state)}`} />
              <span className="grow">
                <span className="name">{x.driver} <Plate v={x.vehicle} /></span>
                <span className="sub" style={{ display: "block" }}>{joinDots([x.task, x.near && "near " + x.near]) || "No task"}</span>
              </span>
              <span className={`age status ${stateTone(x.state)}`}>{x.state === "not_sharing" ? "Not sharing" : (x.location || "").replace(/^Last seen /, "") || "—"}</span>
            </button>
          )) : <Empty>{all.length ? "Nobody in this group right now." : "No driver is sharing their location or on a task right now."}</Empty>)}
        </div>
        <div className="stack live-map">
          <MapView markers={markers} route={mapRoute} onPick={(id) => setSelected(id)} />
          {sel && <Detail x={sel} route={route && route.username === sel.username ? route : null} busy={routeBusy} err={routeErr} onRoute={() => void showRoute(sel.username)} onHide={() => setRoute(null)} />}
        </div>
      </div>
    </section>
  );
}

function Detail({ x, route, busy, err, onRoute, onHide }: { x: LiveDriver; route: Route | null; busy: boolean; err: string | null; onRoute: () => void; onHide: () => void }) {
  const links = x.links ?? {};
  return (
    <div className="card card-b" data-testid="live-detail">
      <div className="row" style={{ padding: 0 }}>
        <Avatar name={x.driver} />
        <div className="grow"><div className="name" style={{ fontSize: 20 }}>{x.driver}</div><div className="sub">{joinDots([x.vehicle, x.task, x.going_to && "to " + x.going_to])}</div></div>
        <Pill tone={stateTone(x.state)}>{x.updated ? "Updated " + String(x.updated).slice(-5) : x.location || ""}</Pill>
      </div>
      <dl className="facts">
        <div><dt>Near</dt><dd>{x.near || "—"}</dd></div>
        <div><dt>Speed</dt><dd>{x.speed_kmh != null ? num(x.speed_kmh) + " km/h" : "—"}</dd></div>
        <div><dt>Battery</dt><dd>{x.battery_pct != null ? x.battery_pct + "%" : "—"}</dd></div>
        <div><dt>Source</dt><dd>{x.source || "—"}</dd></div>
      </dl>
      <div className="acts">
        {links.maps && <a className="btn dark" href={links.maps} target="_blank" rel="noopener">Open in Google Maps</a>}
        {links.whatsapp && <a className="btn" href={links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
        {links.call && <a className="btn" href={links.call}>Call</a>}
        <button type="button" className="btn" onClick={onRoute} disabled={busy}><Icon name="route" />Today’s route</button>
      </div>
      {(busy || err || route) && (
        <div style={{ marginTop: 14 }}>
          {busy && <Loading>Loading today’s route…</Loading>}
          {!busy && err && <Notice>{err}</Notice>}
          {!busy && !err && route && (
            <Notice tone="info" action={<button type="button" className="btn small" onClick={onHide}>Hide route</button>}>
              <b>Today: {num(route.km)} km</b> from {route.count} points{route.first ? `, ${route.first}–${route.last}` : ""}. {route.stops.length ? "Stops over 10 min: " + route.stops.join("; ") : "No stops over 10 minutes."}
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}
