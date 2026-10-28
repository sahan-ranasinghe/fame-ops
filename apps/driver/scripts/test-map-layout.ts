// Round 48 (items 2 and 3): the map screens' layout and markers, without a phone. The pure parts (lib/cluster.ts: the grid
// clustering by zoom; lib/mapLayout.ts: the map's height, the Layers filter; office/routeMarks.ts: the start and end pins,
// the gap markers, what clusters; office/routeInfo.ts: the ⓘ sheet's legend, notes and credits), the rules through
// office/driversLogic.ts and office/liveRouteLogic.ts with a made-up driver_route answer, then the screens and all four
// engines read as text (the map fixed outside the scroll, the playback bar under it, the credits still on the map, both
// languages).
//   npm run test:map-layout          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLUSTER_MAX_ZOOM, CLUSTER_ZOOM_STEP, clusterMarkers, clusterZoom, MAX_ZOOM, projectPx, zoomFromRegion } from '../src/lib/cluster';
import { LAYERS_FILTER_KEY, MAP_MIN_HEIGHT, MAP_SHARE, mapHeight, NO_ROUTE_LAYERS, routeLayerDefs, routeLayerOptions, routeLayersOf } from '../src/lib/mapLayout';
import { endLine, gapLine, gapMarks, routeEnds, routePoints } from '../src/office/driversLogic';
import { liveFilterDefs, liveLayersOf, type Words } from '../src/office/liveLogic';
import { drawingOf, routeOf } from '../src/office/liveRouteLogic';
import { mapInfo } from '../src/office/routeInfo';
import { endsOf, gapMarksOf, pointAt, routeMarkerPoints, visibleGaps } from '../src/office/routeMarks';
import type { DriverRoute } from '../src/office/types';

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

console.log('\n== The cluster helper (Google Maps\' marker clustering, grid based) ==');
{
  const p = projectPx(0, 0, 0);
  check(Math.abs(p.x - 128) < 1e-9 && Math.abs(p.y - 128) < 1e-9, 'the equator at Greenwich is the middle of the one tile at zoom 0', p);
  check(projectPx(0, 0, 1).x === 256 && projectPx(0, 180, 0).x === 256, 'the world doubles with each zoom; 180° east is the right edge');
  const a = { key: 'a', lat: 6.9, lng: 79.86 };
  const b = { key: 'b', lat: 6.9005, lng: 79.8605 }; // about 75 m away
  const c = { key: 'c', lat: 7.3, lng: 80.6 }; // Kandy: far away
  const low = clusterMarkers([a, b, c], 10);
  check(low.clusters.length === 1 && low.clusters[0].count === 2 && same(low.clusters[0].keys, ['a', 'b']) && low.singles.length === 1 && low.singles[0].key === 'c',
    'two markers 75 m apart at zoom 10 are one numbered circle; the far one stays single', low);
  check(Math.abs(low.clusters[0].lat - 6.90025) < 1e-9 && Math.abs(low.clusters[0].lng - 79.86025) < 1e-9, 'the cluster sits at the mean of its markers');
  const high = clusterMarkers([a, b, c], 18);
  check(high.clusters.length === 0 && high.singles.length === 3, 'zoomed in past the limit every marker is drawn on its own');
  check(clusterMarkers([a, b, c], null).clusters.length === 0 && clusterMarkers([a], 5).singles.length === 1, 'no zoom known yet, or one marker: nothing clusters');
  check(clusterMarkers([a, b], 16, { cellPx: 1 }).clusters.length === 0 && clusterMarkers([a, b], 16).clusters.length === 1, 'at zoom 16 (75 m ≈ 30 px) a tiny cell keeps them apart, the real cell still joins them');
  check(CLUSTER_MAX_ZOOM === 17 && CLUSTER_ZOOM_STEP === 2 && MAX_ZOOM === 20, 'the limits: clusters until 17, two steps in, never past 20');
  check(clusterZoom(10) === 17 && clusterZoom(16) === 18 && clusterZoom(19.5) === 20 && clusterZoom(null) === 17, 'a tap zooms two steps in, at least to where the markers come apart, never past 20');
  const z = zoomFromRegion(0.0439, 412);
  check(z !== null && Math.abs(z - Math.log2((360 * 412) / (256 * 0.0439))) < 1e-9 && zoomFromRegion(0, 412) === null, "Google's region → the zoom from the longitude span and the width");
}

console.log('\n== The map\'s height and the Layers filter ==');
{
  check(MAP_SHARE === 0.45 && MAP_MIN_HEIGHT === 300, '45 % of the window, at least 300 px');
  check(mapHeight(800) === 360 && mapHeight(915) === 412 && mapHeight(1080) === 486, 'a phone (800, 915) and a desktop window (1080)');
  check(mapHeight(600) === 300 && mapHeight(0) === 300 && mapHeight(Number.NaN) === 300, 'a small or unknown window gives the minimum');
  const defs = routeLayerDefs(t);
  check(defs.length === 1 && defs[0].key === LAYERS_FILTER_KEY && defs[0].kind === 'multi' && defs[0].label === 'dayRoute.layersSection'
    && same(defs[0].options.map((o) => o.value), ['events', 'stopTimes']) && same(routeLayerOptions(t).map((o) => o.label), ['dayRoute.layerEvents', 'dayRoute.layerStopTimes']),
    'one Layers section of tick boxes: the gap markers and the stop times');
  check(same(routeLayersOf({}), NO_ROUTE_LAYERS) && same(routeLayersOf({ layers: ['events'] }), { events: true, stopTimes: false }) && same(routeLayersOf({ layers: ['events', 'stopTimes'] }), { events: true, stopTimes: true }),
    'nothing ticked by default; the values read back');
  const live = liveFilterDefs(undefined, t, { trails: true });
  check(live.length === 2 && live[1].key === 'show' && same(live[1].options.map((o) => o.value), ['trails', 'events', 'stopTimes']), "Live's Map section: the trails, then the two layers (one sheet, no new section)");
  check(same(liveLayersOf({ show: ['trails', 'stopTimes'] }), { events: false, stopTimes: true }) && same(liveLayersOf({}), NO_ROUTE_LAYERS), "Live's layers read from the Map section");
}

// ---- A made-up day: 19 October 2026, Colombo times ---------------------------------------------------------------------
const DATE = '2026-10-19';
const atMs = (hhmm: string) => Date.parse(`${DATE}T${hhmm}:00+05:30`);
const iso = (hhmm: string) => new Date(atMs(hhmm)).toISOString();
const clock = (ms: number) => { const d = new Date(ms + 5.5 * 3600_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const answer: DriverRoute = {
  driver: 'Sunil Perera', date: DATE, recorded_points: 40, first_point: '08:00', last_point: '08:26', km: 8.4,
  stops_over_10_min: [{ from: '08:11', to: '08:25', minutes: 14, near: 'Kadawatha', lat: 6.951, lng: 79.951 }],
  gaps: [{ from: '08:04', to: '08:10', minutes: 6, kind: 'no_gps' }],
  holes: [{ from_at: iso('08:04'), to_at: iso('08:10'), minutes: 6, kind: 'no_gps', text: 'Stopped · no GPS signal · 6 min' }],
  timeline: [
    { kind: 'driving', from: '08:00', to: '08:04', from_at: iso('08:00'), to_at: iso('08:04'), minutes: 4, km: 1.6, text: 'Driving' },
    { kind: 'no_gps', from: '08:04', to: '08:10', from_at: iso('08:04'), to_at: iso('08:10'), minutes: 6, text: 'Stopped · no GPS signal' },
    { kind: 'driving', from: '08:10', to: '08:11', from_at: iso('08:10'), to_at: iso('08:11'), minutes: 1, text: 'Driving' },
    { kind: 'stopped', from: '08:11', to: '08:25', from_at: iso('08:11'), to_at: iso('08:25'), minutes: 14, near: 'Kadawatha', lat: 6.951, lng: 79.951, text: 'Stopped' },
    { kind: 'no_data', from: '08:26', to: '09:00', from_at: iso('08:26'), to_at: iso('09:00'), minutes: 34, text: 'App not running' },
  ],
  route: { columns: ['time', 'lat', 'lng', 'km/h', 'at'], points: [
    ['08:00', 6.9, 79.9, 0, iso('08:00')], ['08:02', 6.905, 79.905, 35, iso('08:02')], ['08:04', 6.912, 79.912, 65, iso('08:04')],
    ['08:10', 6.95, 79.95, 40, iso('08:10')], ['08:11', 6.951, 79.951, 2, iso('08:11')], ['08:26', 6.955, 79.955, 25, iso('08:26')],
  ] },
};

console.log('\n== The route\'s markers (office/routeMarks.ts) ==');
{
  const pts = [{ at: 1, lat: 6.9, lng: 79.9, time: '08:00' }, { at: 2, lat: 6.95, lng: 79.95, time: '08:10' }];
  const ends = endsOf(pts, clock)!;
  check(ends.start.kind === 'start' && ends.start.time === '08:00' && ends.end?.kind === 'end' && ends.end.time === '08:10' && ends.end.lat === 6.95, 'the first point is the start pin, the last the end pin');
  check(endsOf([], clock) === null && endsOf([pts[0]], clock)!.end === null, 'no point: no pins; one point: the start only');
  check(endsOf([{ at: atMs('08:00'), lat: 6.9, lng: 79.9 }], clock)!.start.time === '08:00', 'a point without clock words gets them from the clock');
  check(pointAt(pts, 1)?.at === 1 && pointAt(pts, 1.5)?.at === 1 && pointAt(pts, 0)?.at === 1 && pointAt(pts, 9)?.at === 2 && pointAt([], 1) === null, 'the last point at or before a moment, else the first after');
  const marks = gapMarksOf([{ kind: 'no_gps', fromAt: atMs('08:04'), toAt: atMs('08:10'), minutes: 6 }, { kind: 'no_data', fromAt: atMs('08:26'), toAt: atMs('09:00') }, { kind: 'no_gps', fromAt: atMs('08:04'), toAt: atMs('08:12') }],
    [{ at: atMs('08:00'), lat: 6.9, lng: 79.9 }, { at: atMs('08:04'), lat: 6.912, lng: 79.912 }, { at: atMs('08:26'), lat: 6.955, lng: 79.955 }], clock);
  check(marks.length === 2 && marks[0].kind === 'no_gps' && marks[0].lat === 6.912 && marks[0].from === '08:04' && marks[0].to === '08:10' && marks[0].minutes === 6
    && marks[1].kind === 'no_data' && marks[1].lat === 6.955 && marks[1].minutes === 34, 'one marker per gap at the last point before the signal went; a repeat start is one; the minutes from the span when not given', marks);
  check(gapMarksOf([{ kind: 'no_gps', fromAt: atMs('08:04'), toAt: atMs('08:03') }], [{ at: 1, lat: 1, lng: 1 }], clock).length === 0 && gapMarksOf([{ kind: 'no_gps', fromAt: 1, toAt: 2 }], [], clock).length === 0, 'a gap that ends before it starts, or no point to stand on: no marker');
  const stops = [{ key: 's1', lat: 6.951, lng: 79.951 }];
  const off = routeMarkerPoints(ends, stops, marks, NO_ROUTE_LAYERS, null);
  check(same(off.map((m) => `${m.kind}:${m.key}`), ['start:start', 'end:end', 'stop:s1']), 'what clusters with the layers off: the ends and the stops, never a gap');
  const on = routeMarkerPoints(ends, stops, marks, { events: true, stopTimes: false }, null);
  check(on.length === 5 && on.filter((m) => m.kind === 'gap').length === 2, 'the Gaps layer on: the gap markers join');
  check(!routeMarkerPoints(ends, stops, marks, { events: true, stopTimes: false }, 's1').some((m) => m.key === 's1'), 'the selected marker is left out (drawn on its own, never inside a circle)');
  check(visibleGaps(marks, NO_ROUTE_LAYERS, null).length === 0 && visibleGaps(marks, NO_ROUTE_LAYERS, marks[1].key).length === 1 && visibleGaps(marks, { events: true, stopTimes: false }, null).length === 2,
    'the gap markers drawn: all with the layer on; only the tapped one with it off (a gap row still highlights its spot)');
}

console.log('\n== Through the day\'s rules and Live\'s ==');
{
  const points = routePoints(answer);
  const ends = routeEnds(points)!;
  check(ends.start.time === '08:00' && ends.end?.time === '08:26' && routeEnds([]) === null, "a driver's day: the start and end pins with their clock");
  const gaps = gapMarks(answer, points);
  check(gaps.length === 2 && gaps[0].kind === 'no_gps' && gaps[0].from === '08:04' && gaps[0].lat === 6.912 && gaps[1].kind === 'no_data' && gaps[1].from === '08:26', "the day's gap markers from the timeline's no-GPS and no-app rows", gaps);
  check(gapMarks({ holes: answer.holes }, points).length === 1 && gapMarks({ holes: answer.holes }, points)[0].kind === 'no_gps', 'an older answer without a timeline: the holes');
  check(gapLine(gaps[0], t) === 'dayRoute.gapNoGps(08:04–08:10,dur.minutes(6))' && gapLine(gaps[1], t) === 'dayRoute.gapNoData(08:26–09:00,dur.minutes(34))' && gapLine({ kind: 'no_gps', from: '08:04', to: '08:04', minutes: 0 }, t) === 'dayRoute.gapNoGps(08:04,dur.minutes(0))',
    'a gap\'s card: "No GPS signal · 08:04–08:10 · 6 min", "App not running · …", one time within a minute');
  check(endLine(ends.start, t) === 'dayRoute.start(08:00)' && endLine(ends.end!, t) === 'dayRoute.end(08:26)', 'the pins\' words: "Start · 08:00", "End · 08:26"');
  const d = drawingOf(routeOf('sunil', answer), t)!;
  check(d.ends?.start.time === '08:00' && d.ends?.end?.time === '08:26' && d.gaps.length === 2 && d.gaps[1].kind === 'no_data' && d.gaps[0].lat === 6.912, "Live's shown route carries the same ends and gap markers", { ends: d.ends, gaps: d.gaps });
}

console.log('\n== The ⓘ sheet (office/routeInfo.ts) ==');
{
  const google = mapInfo({ googleMap: true, estimated: true, estimatedGaps: 2, kmNote: 'Km from GPS, drift filtered.', estimatedNote: 'Dashed lines are estimates.' }, t);
  check(same(google.legend.map((e) => e.key), ['standing', 'slow', 'mid', 'fast', 'gap', 'estimated', 'stop', 'event', 'cluster']), 'the legend: the four bands, no data, the estimated road, the dot, the gap marker, the cluster (the pins need no row: Sahan, Checkpoint 48)');
  check(google.legend[0].mark === 'line' && google.legend[4].mark === 'dashed' && google.legend[6].mark === 'dot' && google.legend[7].mark === 'gap' && google.legend[8].mark === 'cluster' && !google.legend.some((l) => l.mark === 'pinStart' || l.mark === 'pinEnd'), 'each entry drawn as it is on the map');
  check(same(google.notes, ['dayRoute.estimatedNote(2)', 'Dashed lines are estimates.', 'Km from GPS, drift filtered.']), 'the sentences that stood under the map: the estimated roads over N gaps, then the server\'s notes as given');
  check(same(google.credits, ['Google Maps', 'Route © openrouteservice.org by HeiGIT · map data © OpenStreetMap contributors']), "Google's map with an estimated road: its name and openrouteservice's full line");
  const open = mapInfo({ googleMap: false, estimated: false, estimatedGaps: 0 }, t);
  check(!open.legend.some((e) => e.key === 'estimated') && open.notes.length === 0 && same(open.credits, ['© OpenStreetMap contributors · OpenFreeMap']), 'the free map with no estimated road: no estimated entry, no note, OpenStreetMap and OpenFreeMap');
}

console.log('\n== The screens: the map fixed, the playback bar under it, the content scrolling, the credits on the map ==');
{
  const day = read('src/components/office/DayRoute.tsx');
  const mapAt = day.indexOf('testID="driver-route-map"');
  const barAt = day.indexOf('<PlaybackBar playback={playback} cursor={marker} />');
  const scrollAt = day.indexOf('<ScrollView');
  const summaryAt = day.indexOf('testID="day-summary"');
  check(mapAt > 0 && barAt > mapAt && scrollAt > barAt && summaryAt > scrollAt, 'DayRoute: the map, then the playback bar, then the ScrollView with the summary card inside it (the map never inside the scroll)');
  check(/\{ height: mapHeight\(height\) \}/.test(day) && /useWindowDimensions\(\)/.test(day), 'the map\'s height from the window (lib/mapLayout.ts)');
  check(/testID="route-about"/.test(day) && /<Sheet visible=\{aboutOpen\} title=\{t\('dayRoute\.about'\)\}/.test(day) && /info\.legend\.map\(\(e\) => <LegendRow/.test(day) && /info\.credits\.map/.test(day) && !/LegendItem/.test(day),
    'the ⓘ button opens the one Sheet with the legend, the notes and the map data (no legend row under the map any more)');
  check(/<FilterBar defs=\{routeLayerDefs\(t\)\} values=\{values\} onApply=\{setValues\} testID="route-filter" \/>/.test(day) && /routeLayersOf\(values\)/.test(day) && /visibleGaps\(gaps, layers, selected\)/.test(day),
    'one Filter button with the Layers section; the gap markers drawn by its choice (plus the tapped one)');
  check(/ends=\{ends\} gaps=\{shownGaps\} layers=\{layers\} selected=\{selected\} onGap=\{pickGap\}/.test(day) && /testID="day-gaps-button"/.test(day) && /<Sheet visible=\{gapsOpen\} title=\{t\('dayRoute\.gapsTitle'\)\}/.test(day) && /testID="route-gap-row"/.test(day),
    'the map gets the ends, the gaps and the selection; the summary\'s gaps line opens the gaps sheet, a row highlights its spot');
  check(!/data\?\.km_note\}/.test(day) && /kmNote: data\?\.km_note/.test(day), "the server's km note moved into the sheet");
  for (const [file, before, after] of [
    ['src/app/office/driver/[username]/route.tsx', '<DayRoute', 'testID="history-tasks"'],
    ['src/app/office/task/[id].tsx', 'testID="task-map"', '<Screen '],
    ['src/app/office/task/[id]/plan.tsx', 'testID="plan-map"', '<Screen '],
  ] as const) {
    const s = read(file);
    check(s.indexOf(before) > 0 && s.indexOf(before) < s.indexOf(after), `${file}: the map before the scrolling part`);
  }
  check(/\{ height: mapHeight\(height\) \}/.test(read('src/app/office/task/[id].tsx')) && /\{ height: mapHeight\(height\) \}/.test(read('src/app/office/task/[id]/plan.tsx')), 'the task and plan maps take the same height rule');
  check(/Math\.round\(height \* 0\.5\)/.test(read('src/app/task/[id].tsx')), "the driver's running task keeps its approved half-screen map outside the sheet (mockup 6)");
  // The credits the licences require stay on the map (never moved into the sheet).
  check(/testID="route-map-credit"/.test(read('src/components/RouteMap.tsx')) && /testID="route-map-credit"/.test(read('src/components/RouteMap.web.tsx'))
    && /testID="drivers-map-credit"/.test(read('src/components/DriversMap.tsx')) && /testID="drivers-map-credit"/.test(read('src/components/DriversMap.web.tsx'))
    && /testID="map-credit"/.test(read('src/components/TaskMap.tsx')) && /testID="map-credit"/.test(read('src/components/TaskMap.web.tsx')),
    'the credit line (OpenStreetMap / OpenFreeMap, openrouteservice) is still drawn on every map, both engines, phone and browser');
  check(/export const OSM_CREDIT = '© OpenStreetMap contributors · OpenFreeMap';/.test(read('src/components/taskMapLogic.ts')) && /accessibilityLanguage="en">Google Maps/.test(read('src/components/GoogleCredit.tsx')), 'the credit texts unchanged');
}

console.log('\n== All four engines draw the markers the same ==');
{
  const files = ['src/components/GoogleRouteMap.tsx', 'src/components/OpenRouteMap.tsx', 'src/components/RouteMap.web.tsx', 'src/components/GoogleDriversMap.tsx', 'src/components/OpenDriversMap.tsx', 'src/components/DriversMap.web.tsx'];
  for (const f of files) {
    const s = read(f);
    check(/clusterMarkers\(points, zoom\)/.test(s) && /routeMarkerPoints\(/.test(s) && /clusterZoom\(zoom\)/.test(s) && /<ClusterPin count=\{c\.count\} \/>/.test(s) && /<RouteEndPin end=\{ends\.start\} \/>/.test(s) && /<GapPin gap=\{g\}/.test(s) && /single\.has\('start'\)/.test(s),
      `${f}: the ends, the gap markers, the clusters from the one helper at the engine's zoom; a tap zooms in`);
  }
  check(/setZoom\(typeof c\.zoom === 'number'/.test(read('src/components/GoogleRouteMap.tsx')) && /setZoom\(typeof c\.zoom === 'number'/.test(read('src/components/GoogleDriversMap.tsx')), "Google's native map reads the zoom from its camera after each move");
  check(/setZoom\(Number\.isFinite\(e\.nativeEvent\.zoom\)/.test(read('src/components/OpenRouteMap.tsx')) && /setZoom\(Number\.isFinite\(e\.nativeEvent\.zoom\)/.test(read('src/components/OpenDriversMap.tsx')), 'the free map reads the zoom it reports');
  check(/moved: \(_c, z\) => setZoom/.test(read('src/components/RouteMap.web.tsx')) && /moved: \(_c, z\) => setZoom/.test(read('src/components/DriversMap.web.tsx')) && /on\.moved\?\.\(\{ lat: c\.lat, lng: c\.lng \}, m\.getZoom\(\)\)/.test(read('src/components/web/adapters.ts')),
    'the browser engines say their zoom with each move');
  check(/<RouteStopDot time=\{s\.time\} labelled=\{labelled\} open=\{open\} \/>/.test(read('src/components/GoogleRouteMap.tsx')) && /<RouteStopDot time=\{s\.time\} labelled=\{labelled\} open=\{open\} \/>/.test(read('src/components/OpenRouteMap.tsx')) && /<RouteStopDot time=\{s\.time\} labelled=\{labelled\} open=\{open\} \/>/.test(read('src/components/RouteMap.web.tsx')),
    'a stop is a dot; its time shows when tapped or with the Stop times layer');
  check(/labelled=\{labelled\}/.test(read('src/components/GoogleDriversMap.tsx')) && /labelled=\{labelled\}/.test(read('src/components/OpenDriversMap.tsx')) && /labelled=\{labelled\}/.test(read('src/components/DriversMap.web.tsx')), "Live's stop dots take the Stop times layer too");
  check(/zIndex=\{9\}/.test(read('src/components/GoogleRouteMap.tsx')) && /id="route-playback"/.test(read('src/components/OpenRouteMap.tsx')) && /anchor="center" z=\{9\}/.test(read('src/components/RouteMap.web.tsx')), 'the gliding playback marker stays on top on every engine');
  check(/show: liveLayersOf\(values\)|const show = useMemo\(\(\) => liveLayersOf\(values\)/.test(read('src/app/office/(tabs)/live.tsx')), "Live hands the Map section's layers to the map");
}

console.log('\n== Strings ==');
{
  type Tree = { [k: string]: string | Tree };
  const en = JSON.parse(read('src/i18n/en.json')) as { dayRoute: Record<string, string> };
  const si = JSON.parse(read('src/i18n/si.json')) as { dayRoute: Record<string, string> };
  const src = ['src/components/office/DayRoute.tsx', 'src/components/GoogleRouteMap.tsx', 'src/components/OpenRouteMap.tsx', 'src/components/RouteMap.web.tsx', 'src/components/GoogleDriversMap.tsx', 'src/components/OpenDriversMap.tsx', 'src/components/DriversMap.web.tsx', 'src/office/driversLogic.ts', 'src/office/routeInfo.ts', 'src/lib/mapLayout.ts'].map(read).join('\n');
  const asked = [...new Set([...src.matchAll(/t\('dayRoute\.(\w+)'/g)].map((m) => m[1]))];
  const dynamic = ['gapNoGps', 'gapNoData', 'start', 'end'];
  const missing = [...asked, ...dynamic].filter((k) => !en.dayRoute[k] || !si.dayRoute[k]);
  check(asked.length >= 12 && missing.length === 0, `every dayRoute key the code asks for is in en and si (${asked.length})`, missing);
  const keys = [...asked, ...dynamic];
  check(keys.every((k) => /[඀-෿]/.test(si.dayRoute[k]) || si.dayRoute[k] === en.dayRoute[k]), 'in real Sinhala', keys.filter((k) => !/[඀-෿]/.test(si.dayRoute[k])));
  check(keys.every((k) => !/[෦-෯]/.test(si.dayRoute[k])), 'Latin digits only in the Sinhala strings');
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  check(keys.every((k) => ph(en.dayRoute[k]) === ph(si.dayRoute[k])), 'the same placeholders in both languages', keys.filter((k) => ph(en.dayRoute[k]) !== ph(si.dayRoute[k])));
  void (null as unknown as Tree);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll map layout checks passed.');
process.exit(failed ? 1 : 0);
