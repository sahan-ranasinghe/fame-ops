// Office mode (Phase 8, O2): the Live tab's route rules (src/office/liveRouteLogic.ts: today's trails, the shown route by
// speed band, the holes, the merge by time, the playback cursor) with a made-up driver_route answer, and how the screen and
// its two map engines draw them, without a phone. Pure code, no stack needed:
//   npx tsx scripts/test-live-route.ts          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Words } from '../src/office/liveLogic';
import {
  advance, BAND_COLORS, canPlay, clockS, creditWithOrs, cursorAt, drawingOf, ESTIMATED_COLOR, gapWindowsOf, HOLE_COLOR, holesOf, indexAt, insertByTime,
  MAX_FRAME_MS, mergeRoute, nextIndex, ORS_CREDIT_FULL, playbackPath, PLAYBACK_TICK_MS, positionOn, ROUTE_ARGS, routeArgs, routeOf, routeSummary, runsOf,
  sharingNow, sliderFraction, speedAtTime, speedBand, SPEEDS, STOP_PIN, stopLabel, stopPinAnchorY, timeAtFraction, TRAIL_COLORS, TRAILS_CAP, trailsLoading,
  trailsOf, trailsPlan, type Route, type RoutePoint,
} from '../src/office/liveRouteLogic';
import { ORS_CREDIT } from '../src/components/taskMapLogic';
import type { DriverRoute, LiveDriver } from '../src/office/types';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The words as "key(var,var)": the test reads which key was asked with what. */
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

// ---- A made-up day: 19 October 2026, Colombo times (UTC+05:30) -------------------------------------------------------
const DATE = '2026-10-19';
/** "08:04" → Unix ms on the day. */
const atMs = (hhmm: string, s = 0) => Date.parse(`${DATE}T${hhmm}:${String(s).padStart(2, '0')}+05:30`);
const iso = (hhmm: string) => new Date(atMs(hhmm)).toISOString();
type Row = [string, number, number, number, string, number | null];
const rows: Row[] = [
  ['08:00', 6.9, 79.9, 0, iso('08:00'), 10],
  ['08:01', 6.901, 79.901, 10, iso('08:01'), 12],
  ['08:02', 6.905, 79.905, 35, iso('08:02'), 8],
  ['08:03', 6.91, 79.91, 70, iso('08:03'), 9],
  ['08:04', 6.912, 79.912, 65, iso('08:04'), 9],
  ['08:10', 6.95, 79.95, 40, iso('08:10'), 11],
  ['08:11', 6.951, 79.951, 2, iso('08:11'), 10],
  ['08:25', 6.951, 79.951, 0, iso('08:25'), 10],
  ['08:26', 6.955, 79.955, 25, iso('08:26'), null],
];
const answer: DriverRoute = {
  driver: 'Sunil Perera',
  date: DATE,
  recorded_points: 40,
  points_shown: 9,
  first_point: '08:00',
  last_point: '08:26',
  km: 8.4,
  driving_minutes: 7,
  stopped_minutes: 14,
  stops_count: 1,
  stops_over_10_min: [{ from: '08:11', to: '08:25', minutes: 14, near: 'Kadawatha', lat: 6.951, lng: 79.951 }, { from: '09:00', to: '09:12', minutes: 12 }],
  holes: [{ from_at: iso('08:04'), to_at: iso('08:10'), minutes: 6, kind: 'no_gps', text: 'Stopped · no GPS signal · 6 min' }],
  estimated: [{ from_at: iso('08:04'), to_at: iso('08:10'), from: '08:04', to: '08:10', km_road: 5.2, points: [[6.912, 79.912], [6.93, 79.93], [6.95, 79.95]] }],
  timeline: [
    { kind: 'driving', from: '08:00', to: '08:04', from_at: iso('08:00'), to_at: iso('08:04'), minutes: 4, km: 1.6, text: 'Driving' },
    { kind: 'no_gps', from: '08:04', to: '08:10', from_at: iso('08:04'), to_at: iso('08:10'), minutes: 6, text: 'Stopped · no GPS signal' },
    { kind: 'driving', from: '08:10', to: '08:11', from_at: iso('08:10'), to_at: iso('08:11'), minutes: 1, text: 'Driving' },
    { kind: 'stopped', from: '08:11', to: '08:25', from_at: iso('08:11'), to_at: iso('08:25'), minutes: 14, near: 'Kadawatha', lat: 6.951, lng: 79.951, text: 'Stopped' },
    { kind: 'driving', from: '08:25', to: '08:26', from_at: iso('08:25'), to_at: iso('08:26'), minutes: 1, text: 'Driving' },
  ],
  route: { columns: ['time', 'lat', 'lng', 'km/h', 'at', 'acc'], points: rows },
};
const route = routeOf('sunil', answer);
const p = route.points;

console.log('\n== The tool: what is asked, never snap ==');
{
  check(same(routeArgs('sunil'), { driver: 'sunil', line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true }), 'driver_route { driver, tolerance 0, 3,000 points, the estimated roads }', routeArgs('sunil'));
  check(!('snap' in routeArgs('sunil')) && !('snap' in ROUTE_ARGS) && !('date' in routeArgs('sunil')), 'no snap (the free map must not get Google\'s roads; a Roads call costs) and no date (today)');
}

console.log('\n== The answer on the phone (routeOf) ==');
{
  check(p.length === 9 && p.every((x, i) => i === 0 || x.at > p[i - 1].at), 'nine points in time order', p.length);
  check(p[0].at === atMs('08:00') && p[8].at === atMs('08:26') && p[0].kmh === 0 && p[3].kmh === 70 && p[0].acc === 10 && p[8].acc === undefined, 'the ISO time, the speed and the accuracy of each point (none → absent)');
  check(route.username === 'sunil' && route.date === DATE && route.km === 8.4 && route.count === 40 && route.shown === 9 && route.first === '08:00' && route.last === '08:26', 'the day\'s facts');
  check(route.drivingMinutes === 7 && route.stoppedMinutes === 14 && route.stopsCount === 1, 'driving, stopped and the stops count');
  check(route.stops.length === 1 && route.stops[0].near === 'Kadawatha' && route.stops[0].lat === 6.951, 'the stops with a pin only (one had none)');
  check(route.holes.length === 1 && route.holes[0].fromAt === atMs('08:04') && route.holes[0].toAt === atMs('08:10') && route.holes[0].kind === 'no_gps', 'the hole in ms with its kind');
  check(route.estimated.length === 1 && route.estimated[0].points.length === 3 && route.estimated[0].points[1].lat === 6.93 && route.estimated[0].km === 5.2, 'the estimated road: [lat, lng] pairs → points, its km');
  check(route.timeline.length === 5 && route.timeline[1].kind === 'no_gps' && route.timeline[3].toAt === atMs('08:25'), 'the timeline rows in ms');
  check(route.lineEndAt === atMs('08:26'), 'the end of the tool\'s line');
  const old = routeOf('sunil', { driver: 'Sunil', date: DATE, recorded_points: 2, route: { columns: ['time', 'lat', 'lng', 'km/h'], points: [['08:00', 6.9, 79.9, 0], ['08:05', 'x', 79.9, 0], ['08:10', 6.91, 79.91, 30]] } });
  check(old.points.length === 2 && old.points[0].at === atMs('08:00') && old.points[1].at === atMs('08:10') && old.holes.length === 0 && old.estimated.length === 0 && old.stops.length === 0,
    'an older answer (four columns, no timeline): the time from HH:MM on the day; a point with a bad lat is skipped', old.points);
}

console.log('\n== The speed bands and their colours ==');
{
  check(speedBand(0) === 'standing' && speedBand(2.9) === 'standing' && speedBand(3) === 'slow' && speedBand(19.9) === 'slow', 'under 3 standing, under 20 slow');
  check(speedBand(20) === 'mid' && speedBand(59.9) === 'mid' && speedBand(60) === 'fast' && speedBand(120) === 'fast', '20–60 mid, over 60 fast');
  check(speedBand(Number.NaN) === 'standing', 'no speed: standing');
  check(BAND_COLORS.standing === '#8d9096' && BAND_COLORS.slow === '#f2a900' && BAND_COLORS.mid === '#1e4fa0' && BAND_COLORS.fast === '#0f2d66', 'grey, amber, blue, dark blue (the driver page\'s)');
  check(HOLE_COLOR === '#8d9096' && ESTIMATED_COLOR === '#5d646c' && !Object.values(BAND_COLORS).includes(ESTIMATED_COLOR), 'a hole grey, an estimated road slate (never a band\'s colour)');
}

console.log('\n== The line as runs of one band ==');
{
  const runs = runsOf(p);
  check(runs.map((r) => r.band).join() === 'slow,mid,fast,mid,standing,mid', 'the bands in order (each step takes the speed that reached its end)', runs.map((r) => r.band));
  check(runs[2].points.length === 3 && runs[4].points.length === 3, 'steps of one band join into one run');
  check(runs.every((r, i) => i === 0 || r.points[0] === runs[i - 1].points[runs[i - 1].points.length - 1]), 'each run shares its first point with the run before (no break in the line)');
  check(runs.every((r) => r.color === BAND_COLORS[r.band]), 'the colour of its band');
  const cut = runsOf(p, new Set([`${p[4].at}|${p[5].at}`]));
  check(cut.map((r) => r.band).join() === 'slow,mid,fast,standing,mid' && !cut.some((r) => r.points.includes(p[4]) && r.points.includes(p[5])), 'a step drawn dashed (a hole or an estimated road) is left out and breaks the run', cut.map((r) => r.band));
  check(runsOf([p[0]]).length === 0 && runsOf([]).length === 0, 'one point or none: nothing to draw');
}

console.log('\n== The holes (dashed) ==');
{
  const holes = holesOf(route, p);
  check(holes.length === 1 && holes[0].fromAt === p[4].at && holes[0].toAt === p[5].at && holes[0].kind === 'no_gps' && holes[0].from.lat === 6.912 && holes[0].to.lat === 6.95, 'the tool\'s hole between the two line points around it');
  const mid: RoutePoint = { at: atMs('08:07'), lat: 6.93, lng: 79.93, kmh: 0 };
  const cutHoles = holesOf(route, insertByTime(p, mid));
  check(cutHoles.length === 2 && cutHoles[0].toAt === mid.at && cutHoles[1].fromAt === mid.at, 'a point merged inside cuts it in two');
  const near: RoutePoint = { at: atMs('08:05'), lat: 6.92, lng: 79.92, kmh: 0 };
  const short = holesOf(route, insertByTime(p, near));
  check(short.length === 1 && short[0].fromAt === near.at, 'a piece under 2 minutes is no hole');
  const tail = [...p, { at: atMs('08:30'), lat: 6.96, lng: 79.96, kmh: 20 }, { at: atMs('08:40'), lat: 6.97, lng: 79.97, kmh: 20 }];
  const tailHoles = holesOf(route, tail);
  check(tailHoles.length === 3 && tailHoles[1].fromAt === atMs('08:26') && tailHoles[2].fromAt === atMs('08:30') && tailHoles[1].kind === null && tailHoles[2].kind === null,
    'after the tool\'s line: over 2 minutes between two places is a hole of no kind (8:26→8:30 and 8:30→8:40, after the tool\'s own)', tailHoles.map((h) => [h.fromAt, h.toAt]));
  const still = [...p, { at: atMs('08:40'), lat: 6.955, lng: 79.955, kmh: 0 }];
  check(holesOf(route, still).length === 1, 'the same place later is no hole');
}

console.log('\n== What the map draws for the shown route (drawingOf) ==');
{
  check(drawingOf(null, t) === null && drawingOf({ ...route, points: [] }, t) === null, 'nothing without a route or a point');
  const d = drawingOf(route, t)!;
  check(d.key === `sunil:${DATE}` && d.username === 'sunil', 'the key: the driver and the day (the map frames it once per key)');
  check(d.estimated.length === 1 && d.holes.length === 0, 'a hole covered by an estimated road is drawn as that road, not dashed grey');
  check(!d.runs.some((r) => r.points.includes(p[4]) && r.points.includes(p[5])), 'the runs do not cross the estimated gap');
  check(d.stops.length === 1 && d.stops[0].key === 'stop:0:08:11' && d.stops[0].label === '08:11–08:25 · dur.minutes(14)', 'a stop: its key and "08:11–08:25 · 14 min"', d.stops[0]);
  check(d.frame.kind === 'box' && d.frame.sw.lat === 6.9 && d.frame.ne.lat === 6.955 && d.frame.ne.lng === 79.955, 'the frame around the line and the estimated roads', d.frame);
  const bare = drawingOf({ ...route, estimated: [] }, t)!;
  check(bare.holes.length === 1 && bare.estimated.length === 0 && !bare.runs.some((r) => r.points.includes(p[4]) && r.points.includes(p[5])), 'no estimated road: the hole dashed grey, the runs broken there');
  check(stopLabel({ from: '08:11', to: '08:11', minutes: 0 }, t) === '08:11 · dur.minutes(0)', 'a stop within one minute: one time');
  check(stopPinAnchorY(false) === 0.5 && Math.abs(stopPinAnchorY(true) - (STOP_PIN.labelHeight + STOP_PIN.gap + STOP_PIN.size / 2) / (STOP_PIN.labelHeight + STOP_PIN.gap + STOP_PIN.size)) < 1e-9,
    'Google\'s anchor: the circle\'s centre, under the label when it is open');
}

console.log('\n== Merging by time (never replacing) ==');
{
  const extra: RoutePoint = { at: atMs('08:02', 30), lat: 6.907, lng: 79.907, kmh: 0 };
  const grown = insertByTime(p, extra);
  check(grown.length === 10 && grown[3].at === extra.at && grown[3].lat === extra.lat && grown[2].at < extra.at && grown[4].at > extra.at, 'a point lands by its time');
  check(grown[3].kmh > 0 && grown[4].kmh > 0 && grown[4] !== p[3], 'the speeds of the step reaching it and of the one leaving it follow');
  check(insertByTime(p, { ...p[3], lat: 0 }) === p, 'a point at a time the line has is ignored (the same array)');
  const thin = routeOf('sunil', { ...answer, km: 9.1, points_shown: 5, route: { columns: answer.route!.columns, points: [rows[0], rows[2], rows[4], rows[5], rows[8]] } });
  const merged = mergeRoute(route, thin);
  check(merged.points.length === 9 && merged.points.every((x, i) => i === 0 || x.at > merged.points[i - 1].at) && merged.km === 9.1 && merged.shown === 5,
    'a thinner fresh answer merged: every point kept in time order; the km and the facts from the fresh one', merged.points.length);
  check(merged.lineEndAt === atMs('08:26'), 'the line\'s end follows');
  const other = routeOf('kamal', answer);
  check(mergeRoute(route, other) === other, 'another driver\'s answer replaces it');
}

console.log('\n== Today\'s trails ==');
{
  const d = (over: Partial<LiveDriver> & Pick<LiveDriver, 'username'>): LiveDriver => ({ driver: over.username, state: 'sharing', ...over }) as LiveDriver;
  check(sharingNow(d({ username: 'a', signal: { sharing: true, point_at: null, heartbeat_at: null, location_on: null, permission: null, location_off_since: null }, state: 'not_sharing' })), 'the signal says sharing: sharing (the signal wins)');
  check(!sharingNow(d({ username: 'a', state: 'not_sharing' })) && sharingNow(d({ username: 'a', state: 'stale' })), 'no signal field: the card\'s state (stale still shares)');
  const many = [...Array.from({ length: 12 }, (_, i) => d({ username: `d${i}` })), d({ username: 'off', state: 'not_sharing' })];
  const plan = trailsPlan(many);
  check(TRAILS_CAP === 10 && plan.draw.length === 10 && plan.draw[0] === 'd0' && plan.draw[9] === 'd9' && plan.notDrawn === 2, 'at most 10 trails, the first in the server\'s order; "+2 not drawn"; the one not sharing left out', plan);
  check(same(trailsPlan(many.slice(0, 3)), { draw: ['d0', 'd1', 'd2'], notDrawn: 0 }), 'under the cap: everyone, none counted');
  const routes = new Map<string, Route>([['d0', route], ['d1', routeOf('d1', answer)], ['d2', { ...routeOf('d2', answer), points: [p[0]] }]]);
  const lines = trailsOf(routes, plan.draw, null);
  check(lines.map((l) => l.username).join() === 'd0,d1' && lines[0].color === TRAIL_COLORS[0] && lines[1].color === TRAIL_COLORS[1] && lines[0].holes.length === 1 && lines[0].points.length === 9,
    'a trail per loaded driver with two points or more, its colour by its place, its holes', lines.map((l) => [l.username, l.color]));
  check(trailsOf(routes, plan.draw, 'd0').map((l) => l.username).join() === 'd1', 'the driver whose route is shown in full colour has no trail');
  check(TRAIL_COLORS.length >= TRAILS_CAP && !TRAIL_COLORS.some((c) => Object.values(BAND_COLORS).includes(c)), 'a colour per trail, never a band\'s');
  check(trailsLoading(plan.draw, routes) && !trailsLoading(['d0', 'd1'], routes) && !trailsLoading([], routes), '"Loading trails…" until every planned trail has come');
}

console.log('\n== The credits ==');
{
  const osm = '© OpenStreetMap contributors · OpenFreeMap';
  check(creditWithOrs(null, true, false) === null && creditWithOrs(osm, false, false) === osm, 'no estimated road: the map\'s own credit (none on Google\'s)');
  check(creditWithOrs(null, true, true) === ORS_CREDIT_FULL && ORS_CREDIT_FULL === 'Route © openrouteservice.org by HeiGIT · map data © OpenStreetMap contributors', 'Google\'s map with an estimated road: openrouteservice\'s full line');
  check(creditWithOrs(osm, false, true) === `${osm} · ${ORS_CREDIT}`, 'the free map with an estimated road: its credit plus openrouteservice\'s (OpenStreetMap already named)');
}

console.log('\n== The card\'s numbers ==');
{
  check(routeSummary(route, t) === 'office.live.routeToday(8.4) · office.live.routeDriving(dur.minutes(7)) · office.live.routeStopped(dur.minutes(14)) · office.live.routeStopsOne',
    '"Today: 8.4 km · driving 7 min · stopped 14 min · 1 stop"', routeSummary(route, t));
  check(routeSummary({ ...route, km: 61.4, stopsCount: 3, drivingMinutes: 130 }, t) === 'office.live.routeToday(61) · office.live.routeDriving(dur.hours(2,10)) · office.live.routeStopped(dur.minutes(14)) · office.live.routeStops(3)',
    'whole km over 10; hours and minutes; "3 stops"');
  check(routeSummary({ ...route, drivingMinutes: undefined, stoppedMinutes: undefined, stopsCount: undefined }, t) === 'office.live.routeToday(8.4) · office.live.routeStopsOne', 'an older answer without the minutes: those parts left out, the stops counted from the list');
  check(routeSummary(null, t) === null && routeSummary({ ...route, points: [] }, t) === null, 'no points: nothing');
}

console.log('\n== Playback: the path, the position at a time, the clock ==');
{
  const path = playbackPath(p, route.estimated);
  check(path.length === 10 && path.every((x, i) => i === 0 || x.at > path[i - 1].at), 'the line plus the estimated road\'s inside point, in time order', path.length);
  const inner = path[5];
  check(inner.est === true && inner.lat === 6.93 && inner.at > p[4].at && inner.at < p[5].at && path[6].est === true && !path[4].est, 'the road\'s inside point timed along it, the gap\'s end marked estimated');
  const ties = playbackPath([{ at: 10, lat: 6.9, lng: 79.9 }, { at: 20, lat: 6.91, lng: 79.91 }, { at: 20, lat: 6.92, lng: 79.92 }, { at: 30, lat: 6.93, lng: 79.93 }]);
  check(ties.length === 4 && ties[1].at > 10 && ties[1].at < 20 && ties[2].at === 20, 'points sharing a time are spread over the time before (the last stays)', ties.map((x) => x.at));
  check(indexAt(path, p[2].at) === 2 && indexAt(path, p[2].at + 1) === 2 && indexAt(path, p[0].at - 1) === 0 && indexAt(path, p[8].at + 999) === 9 && indexAt([], 0) === -1, 'the index for a time: the last point at or before it');
  check(nextIndex(path, 2) === 3 && nextIndex(path, 9) === 9, 'the next index, never past the end');
  const half = positionOn(path, (p[1].at + p[2].at) / 2)!;
  check(Math.abs(half.lat - (p[1].lat + p[2].lat) / 2) < 1e-9 && Math.abs(half.lng - (p[1].lng + p[2].lng) / 2) < 1e-9 && !half.estimated && half.heading !== null, 'halfway in time between two points: halfway between them, headed along the path');
  check(positionOn(path, p[0].at - 5000)!.lat === p[0].lat && positionOn(path, p[8].at + 5000)!.lat === p[8].lat, 'before the start and past the end: the ends');
  const windows = gapWindowsOf(route);
  check(windows.length === 3 && windows.every((w) => w.fromAt === atMs('08:04') && w.toAt === atMs('08:10')), 'the windows with no real position: the hole, the estimated road, the no-GPS row', windows);
  check(positionOn(path, atMs('08:06'), windows)!.estimated && !positionOn(path, atMs('08:02'), windows)!.estimated, 'inside a gap the marker is estimated (hollow)');
  check(advance(0, 100, 60, 1e9) === 6000 && advance(0, 5000, 60, 1e9) === MAX_FRAME_MS * 60 && advance(90, 100, 5, 100) === 100, 'the clock: real ms × the speed, a long tick capped, never past the end');
  check(same(SPEEDS, [1, 5, 20, 60]) && PLAYBACK_TICK_MS === 125, '1× 5× 20× 60×, eight ticks a second');
  check(speedAtTime(p, atMs('08:02', 30)) === 70 && speedAtTime(p, p[0].at - 1) === 0 && speedAtTime(p, p[8].at) === 0 && speedAtTime(p, p[2].at) === 70, 'the speed under way: the step\'s that reaches the next point');
  check(clockS(Date.parse('2026-10-19T02:30:05Z')) === '08:00:05' && clockS(Date.parse('2026-10-18T18:30:00Z')) === '00:00:00', '"HH:MM:SS" in Colombo time');
  const c = cursorAt(route, path, windows, atMs('08:02', 30))!;
  check(c.time === '08:02:30' && c.kmh === 70 && !c.estimated && c.heading !== null, 'the cursor: the time and the speed', c);
  const g = cursorAt(route, path, windows, atMs('08:06'))!;
  check(g.estimated && g.kmh === null, 'in a gap: estimated, no speed');
  check(cursorAt(null, path, windows, atMs('08:06')) === null && cursorAt(route, [], windows, 0) === null, 'no route or no path: no cursor');
  check(sliderFraction(p[0].at, p[0].at, p[8].at) === 0 && sliderFraction(p[8].at, p[0].at, p[8].at) === 1 && sliderFraction(5, 0, 0) === 0, 'the slider: 0 at the start, 1 at the end, 0 with no span');
  check(timeAtFraction(0.5, 100, 300) === 200 && timeAtFraction(2, 100, 300) === 300 && timeAtFraction(-1, 100, 300) === 100, 'a place on the slider → the time, clamped');
  check(canPlay(path) && !canPlay([path[0]]) && !canPlay([{ at: 1, lat: 0, lng: 0 }, { at: 1, lat: 1, lng: 1 }]), 'playback needs two points and a span');
}

console.log('\n== The screen and the two engines ==');
{
  // The bar and its clock moved to the shared components/office/PlaybackBar.tsx (Stage 1: one playback bar everywhere).
  const screen = read('src/app/office/(tabs)/live.tsx') + read('src/components/office/PlaybackBar.tsx');
  const calls = (screen.match(/api\.call<DriverRoute>\('driver_route'/g) ?? []).length;
  const withArgs = (screen.match(/api\.call<DriverRoute>\('driver_route', routeArgs\(\w+\)\)/g) ?? []).length;
  check(calls === 3 && withArgs === 3 && !/snap/.test(screen), 'every driver_route call (the shown route, a trail, the refresh) with routeArgs(username); never snap', { calls, withArgs });
  check(/const routes = me\.tools\.includes\('driver_route'\);/.test(screen) && /const trails = routes && trailsOn\(values\);/.test(screen) && /route=\{routes \? \{/.test(screen),
    'the trails control and the route only for a person who may call driver_route');
  // Stage 1 (O3 item 4f): the screen's control sits in the map's one cluster (zoom in, zoom out, the trails, fit), which
  // DriversMap draws after the mounted engine, never over "Map not available".
  check(/controls=\{controls\}/.test(screen) && /testID="drivers-map-controls">\s*\{controls\}\s*<MapButton icon=\{Maximize\}/.test(read('src/components/DriversMap.tsx')) && /controls\?: ReactNode;/.test(read('src/components/DriversMap.tsx')),
    'the control is DriversMap\'s slot: shown only while a map is mounted, never over "Map not available"');
  for (const f of ['src/components/DriversMap.tsx', 'src/components/DriversMap.web.tsx']) {
    const src = read(f);
    check(!/map-zoom-in|map-zoom-out/.test(src) && /testID="map-fit"/.test(src) && /<MapCompass /.test(src + read('src/components/OpenDriversMap.tsx') + read('src/components/GoogleDriversMap.tsx')), `${f}: no zoom buttons (pinch zooms); fit; the compass only while turned`);
  }
  check(/if \(trails\) return;\s*trailGen\.current \+= 1;\s*trailBusy\.current\.clear\(\);\s*setTrailMap\(new Map\(\)\);/.test(screen) && /gen === trailGen\.current && setTrailMap/.test(screen) && /trailsPlan\(all\)/.test(screen) && /trailsOf\(trailMap, plan\.draw, drawing\?\.username \?\? null\)/.test(screen),
    'trails off: the lines go (a trail landing after that is dropped); the plan caps them; the shown driver\'s trail is left out');
  check(/\}, ROUTE_REFRESH_MS\);/.test(screen) && (screen.match(/mergeRoute\(/g) ?? []).length >= 3 && /if \(!focused \|\| !routes \|\| \(!trails && shownUser === null\)\) return;/.test(screen),
    'every 60 s while in front: the trails and the shown route fetched again and merged, never replaced');
  check(/trailsLoading\(plan\.draw, trailMap\)/.test(screen) && /office\.live\.trailsLoading/.test(screen) && /office\.live\.trailsNotDrawn/.test(screen), '"Loading trails…" and "+N not drawn"');
  check(/<DriversMap markers=\{markers\} fit=\{fit\} focus=\{focus\} onPressMarker=\{select\} mapPackage=\{me\.map\?\.package\} layers=\{layers\} controls=\{controls\} \/>/.test(screen), 'the map gets the layers and the controls');
  check(/allMarkers\.filter\(\(m\) => m\.username !== drawing\.username\)/.test(screen) && /playback\.active \? cursorAt\(/.test(screen), 'the driver\'s live marker is hidden while the playback marker stands for them');
  check(/usePlayback\(path, focused\)/.test(screen) && /setInterval\(\(\) => \{[\s\S]*?advance\(tRef\.current, now - last, speedRef\.current, endRef\.current\)/.test(screen) && /if \(next >= endRef\.current\) setPlaying\(false\);/.test(screen),
    'the clock on a timer, stopping at the end');
  check(/if \(!focused\) setPlaying\(false\);/.test(screen) && /\}, \[start\]\);/.test(screen), 'leaving the tab pauses; a new route starts over, paused');
  check(/canPlay\(path\) \? playback : null/.test(screen) && /SPEEDS\.map\(/.test(screen) && /testID="live-play"/.test(screen) && /PanResponder\.create\(/.test(screen) && !/@react-native-community\/slider/.test(screen),
    'the bar: Play / Pause, the speed chips, the slider built with a PanResponder (no slider module)');
  check(/accessibilityRole="adjustable"/.test(screen) && /onAccessibilityAction/.test(screen), 'the slider is adjustable for TalkBack');
  check(/paddingBottom: chosen \? Math\.max\(240, cardH \+ 16\) : 24/.test(screen) && /onLayout=\{\(e\) => setCardH\(e\.nativeEvent\.layout\.height\)\}/.test(screen), 'the list makes room under the card, whatever its height');
  check(/<SkeletonRows rows=\{1\} lines=\{1\} testID="live-route-skeleton"/.test(screen) && /office\.live\.routeFailed/.test(screen) && /office\.common\.tryAgain/.test(screen) && /office\.live\.routeNone/.test(screen) && /routeSummary\(route\.route, t\)/.test(screen),
    'the card: loading, failed with Try again, no positions, or today\'s numbers');

  const map = read('src/components/DriversMap.tsx');
  check(/creditWithOrs\(mapCredit\(mount\.engine === 'google', \[\]\), mount\.engine === 'google', \(layers\.route\?\.estimated\.length \?\? 0\) > 0\)/.test(map), 'openrouteservice\'s credit under the map when an estimated road is drawn');
  check(/layers = NO_LAYERS/.test(map) && /pins: PINS/.test(map) && /export interface LiveLayerProps/.test(map) && /function StopDot/.test(map) && /function CursorPin/.test(map),
    'DriversMap hands both engines the layers and the same two pins');
  check(/office\.live\.estimated/.test(map) && /office\.live\.kmh/.test(map), 'the playback marker says the time with the speed, or "estimated"');

  const google = read('src/components/GoogleDriversMap.tsx');
  const open = read('src/components/OpenDriversMap.tsx');
  for (const [name, src] of [['Google', google], ['free', open]] as const) {
    check(/: DriversEngineProps & LiveLayerProps\)/.test(src) && /import type \{ LiveLayerProps \} from '\.\/DriversMap'/.test(src), `the ${name} map takes the layers (a type-only import: no runtime cycle)`);
    check(/<pins\.Stop stop=\{s\} open=\{open\} \/>/.test(src) && /<pins\.Cursor cursor=\{cursor\} \/>/.test(src) && /setOpenStop\(\(o\) => \(o === s\.key \? null : s\.key\)\)/.test(src),
      `the ${name} map: the stops' circles open their times on a tap, the playback marker`);
    check(/const routeKey = route\?\.key \?\? null;/.test(src) && /\}, \[(ready, )?routeKey\]\);/.test(src), `the ${name} map frames the shown route once per driver and day`);
  }
  check(/trails\.map\(\(tr\) => \([\s\S]*?<Polyline key=\{`trail:\$\{tr\.username\}`\} coordinates=\{tr\.coords\} strokeColor=\{tr\.color\} strokeWidth=\{3\}/.test(google)
    && /tr\.holeCoords\.map\([\s\S]*?lineDashPattern=\{\[6, 8\]\}/.test(google), "Google's map: a trail per driver in its colour, its holes dashed");
  check(/holes\.map\(\(h\) => \([\s\S]*?strokeColor=\{HOLE_COLOR\}[\s\S]*?lineDashPattern=\{\[8, 8\]\}/.test(google) && /estimated\.map\(\(e\) => \([\s\S]*?strokeColor=\{ESTIMATED_COLOR\}[\s\S]*?lineDashPattern=\{\[4, 8\]\}/.test(google)
    && /runs\.map\(\(r\) => \([\s\S]*?strokeColor=\{r\.color\} strokeWidth=\{5\}/.test(google), "Google's map: the holes dashed grey, the estimated roads dashed slate, the runs by band");
  check(/anchor=\{\{ x: 0\.5, y: stopPinAnchorY\(open\) \}\}/.test(google) && /key=\{`\$\{s\.key\}:\$\{open\}`\}/.test(google) && /<GoogleMarker coordinate=\{at\(cursor\)\} anchor=\{\{ x: 0\.5, y: stopPinAnchorY\(true\) \}\} tracksViewChanges zIndex=\{10\}>/.test(google),
    "Google's map: a stop's picture taken again when it opens; the playback marker keeps tracking its view");
  check(/id="live-trails"/.test(open) && /id="live-trail-holes"/.test(open) && /id="live-route-holes"/.test(open) && /id="live-route-estimated"/.test(open) && /id="live-route"/.test(open),
    'the free map: a source for the trails, their holes, the route\'s holes, the estimated roads and the runs');
  check(/'line-color': \['get', 'color'\], 'line-width': 3/.test(open) && /'line-color': \['get', 'color'\], 'line-width': 5/.test(open), 'the free map: the colour from each feature (a trail\'s, a run\'s band)');
  check(/id="live-trail-holes-line"[\s\S]*?'line-dasharray'/.test(open) && /id="live-route-holes-line"[\s\S]*?'line-color': HOLE_COLOR[\s\S]*?'line-dasharray': \[2, 2\]/.test(open)
    && /id="live-route-estimated-line"[\s\S]*?'line-color': ESTIMATED_COLOR[\s\S]*?'line-dasharray': \[1, 2\]/.test(open), 'the free map: the dashed lines on layers of their own');
  check(/anchor="bottom"\s+offset=\{\[0, STOP_PIN\.size \/ 2\]\}/.test(open) && /<Marker id="live-cursor" lngLat=\{\[cursor\.lng, cursor\.lat\]\} anchor="bottom" offset=\{\[0, STOP_PIN\.size \/ 2\]\}>/.test(open),
    'the free map: the circle\'s centre on the position whatever the label\'s height');
  const openOrder = ['id="live-trails"', 'id="live-route-holes"', 'id="live-route"', 'route?.stops', 'markers.map', 'id="live-cursor"'].map((s) => open.indexOf(s));
  check(openOrder.every((i, k) => i >= 0 && (k === 0 || i > openOrder[k - 1])), 'the free map: the trails under the route, the pins above the lines, the playback marker on top');
  check(!/snap|route_snapped|google_place|PROVIDER_GOOGLE|google_pins/.test(read('src/office/liveRouteLogic.ts').replace(/^\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '')),
    'nothing Google-specific in the rules (no snapped line, no Google place): the points are ours, so both engines draw the same');
}

console.log('\n== Strings: the keys the code asks for ==');
{
  type Tree = { [k: string]: string | Tree };
  const flat = (tree: Tree, prefix = ''): [string, string][] =>
    Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));
  const en = new Map(flat((JSON.parse(read('src/i18n/en.json')) as { office: { live: Tree } }).office.live));
  // The O2 strings (the trails, the route, the playback), merged into en.json and si.json; each one asked for somewhere.
  const O2_KEYS = ['trails', 'trailsLoading', 'trailsNotDrawn', 'routeFailed', 'routeNone', 'routeToday', 'routeDriving', 'routeStopped', 'routeStops', 'routeStopsOne', 'play', 'pause', 'slider', 'estimated'];
  const si = new Map(flat((JSON.parse(read('src/i18n/si.json')) as { office: { live: Tree } }).office.live));
  const src = read('src/app/office/(tabs)/live.tsx') + read('src/components/office/PlaybackBar.tsx') + read('src/components/DriversMap.tsx') + read('src/office/liveRouteLogic.ts') + read('src/office/liveLogic.ts');
  const asked = [...new Set([...src.matchAll(/t\('office\.live\.([\w.]+)'/g)].map((m) => m[1]))];
  const missing = asked.filter((k) => !en.has(k) || !si.has(k));
  check(asked.length > 0 && missing.length === 0, 'every office.live.* key the code asks for is in en.json and si.json', missing);
  check(O2_KEYS.every((k) => asked.includes(k) && en.has(k) && si.has(k)), 'every O2 key is asked for somewhere and present in both languages', O2_KEYS.filter((k) => !asked.includes(k) || !en.has(k) || !si.has(k)));
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Live route checks passed.');
process.exit(failed ? 1 : 0);
