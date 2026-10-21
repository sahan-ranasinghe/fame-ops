// Phase 8, O4: the mobile website's maps (components/web, the four .web.tsx maps). The browser's rules (which engine, the
// tab's counted Google maps, the camera, the dashes, the layer order, the anchors) and how the files are wired (the same
// names as the phones' maps, Google's content only on Google's map, the credits, nothing temporary), without a browser.
//   npm run test:web-maps
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  anchorShift, browserEngine, cameraFor, COUNTRY_ZOOM, createGooglePool, DASH, dashKey, googleDash, layerBefore, libreDash, type MapLoadAnswer,
  SRI_LANKA, withinLimit, withLayer,
} from '../src/components/web/browserMapLogic';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

async function main() {
  console.log('\n== Which map in the browser ==');
  check(browserEngine('google', false) === 'google', "the google package: Google's map (the key comes from the server, counted)");
  check(browserEngine('open', false) === 'open', 'the open package: the free map');
  check(browserEngine(undefined, false) === 'open', 'no package in /me yet: the free map');
  check(browserEngine('google', true) === 'open', 'Google failed in this tab: the free map until the page loads again');

  console.log('\n== The tab\'s Google maps: counted before each one is made ==');
  {
    let counted = 0;
    let scripts = 0;
    const pool = createGooglePool<{ n: number }>({
      count: async (): Promise<MapLoadAnswer> => { counted++; return { allowed: true, key: 'k' }; },
      loadScript: async () => { scripts++; },
      make: () => ({ n: counted }),
    });
    const a = await pool.take();
    const b = await pool.take();
    check(a.state === 'ready' && b.state === 'ready' && counted === 2 && pool.made() === 2, 'two maps shown at once: two loads counted, two maps made', { counted, made: pool.made() });
    check(scripts === 1, "Google's script loads once per tab", scripts);
    if (a.state === 'ready') pool.give(a.map);
    const c = await pool.take();
    check(c.state === 'ready' && c.reused && counted === 2, 'a map a page gave back is used again: no new load counted', { counted });
    if (a.state === 'ready') { pool.give(a.map); pool.give(a.map); }
    check(pool.kept() === 1, 'a map given back twice is kept once', pool.kept());
  }
  {
    let made = 0;
    const pool = createGooglePool<number>({
      count: async () => ({ allowed: false, note: 'Map loads reached today\'s cap' }),
      loadScript: async () => undefined,
      make: () => ++made,
    });
    const g = await pool.take();
    check(g.state === 'refused' && g.note.includes('cap') && made === 0, 'refused at a cap: no map made, the free map with the note', g);
    check(pool.failed() === null, 'a refusal is not kept as a failure (a later page asks again)');
  }
  {
    let made = 0;
    const pool = createGooglePool<number>({
      count: async () => { throw { code: 'network', message: 'No connection to Fame Fleet.' }; },
      loadScript: async () => undefined,
      make: () => ++made,
    });
    const g = await pool.take();
    check(g.state === 'refused' && made === 0 && pool.failed() === null, 'our server not answering: nothing counted, nothing made, not Google\'s failure', g);
  }
  {
    let made = 0;
    let counted = 0;
    const pool = createGooglePool<number>({
      count: async () => { counted++; return { allowed: true, key: 'k' }; },
      loadScript: async () => { throw new Error("Google's map could not load"); },
      make: () => ++made,
    });
    const g = await pool.take();
    const again = await pool.take();
    check(g.state === 'failed' && made === 0, 'the script blocked: failed, no map made', g);
    check(again.state === 'failed' && counted === 1, 'kept for the tab: no second load counted after a failure', { counted });
  }
  {
    const pool = createGooglePool<number>({ count: async () => ({ allowed: true, key: 'k' }), loadScript: async () => undefined, make: () => 1 });
    const g = await pool.take();
    if (g.state === 'ready') pool.give(g.map);
    pool.fail('Google refused the map key');
    const next = await pool.take();
    check(next.state === 'failed' && pool.kept() === 0, 'Google refused the key after a map showed: no kept map is used again', next);
  }
  {
    const fakeTimers = { set: ((fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; }) as unknown as typeof setTimeout, clear: (() => undefined) as typeof clearTimeout };
    let err = '';
    await withinLimit(new Promise<void>(() => undefined), 15_000, "Google's map did not load in time", fakeTimers).catch((e: Error) => { err = e.message; });
    check(err === "Google's map did not load in time", 'a script that never answers fails at its time limit', err);
    const ok = await withinLimit(Promise.resolve(7), 15_000, 'x');
    check(ok === 7, 'a script in time passes through');
    // As in a browser: setTimeout called with any `this` but the window throws "Illegal invocation" (21 October 2026).
    const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
    const strict = <F extends (...a: never[]) => unknown>(f: F) => function (this: unknown, ...a: Parameters<F>) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return (f as (...x: Parameters<F>) => unknown)(...a);
    };
    globalThis.setTimeout = strict(real.set) as unknown as typeof setTimeout;
    globalThis.clearTimeout = strict(real.clear) as unknown as typeof clearTimeout;
    let browserErr = '';
    const inBrowser = await withinLimit(Promise.resolve(8), 15_000, 'x').catch((e: Error) => { browserErr = e.message; return 0; });
    globalThis.setTimeout = real.set;
    globalThis.clearTimeout = real.clear;
    check(inBrowser === 8 && browserErr === '', 'the time limit calls the browser\'s setTimeout as a function (never "Illegal invocation")', browserErr);
  }

  console.log('\n== The camera ==');
  {
    const box = cameraFor({ kind: 'box', sw: { lat: 6.9, lng: 79.8 }, ne: { lat: 7.3, lng: 80.6 } }, 14);
    check(box.kind === 'bounds' && box.sw.lat === 6.9 && box.ne.lng === 80.6, 'a box frames its bounds', box);
    const one = cameraFor({ kind: 'point', center: { lat: 7, lng: 80 } }, 15);
    check(one.kind === 'center' && one.zoom === 15 && one.center.lat === 7, 'one place at the page\'s zoom', one);
    const none = cameraFor({ kind: 'none' }, 15);
    check(none.kind === 'center' && none.zoom === COUNTRY_ZOOM && none.center === SRI_LANKA, 'nothing to show: the island', none);
  }

  console.log('\n== Dashes and layers ==');
  check(JSON.stringify(libreDash(DASH.task, 4)) === '[3.5,2.5]', "MapLibre's dashes are in line widths (14 px / 4 = 3.5)", libreDash(DASH.task, 4));
  check(JSON.stringify(libreDash([6, 8], 0)) === '[6,8]', 'a zero width never divides by zero');
  check(googleDash(DASH.route).scale === 6 && googleDash(DASH.route).repeat === '22px', "Google's dash: a 2-unit stroke scaled to the dash, repeated every dash + gap", googleDash(DASH.route));
  check(dashKey(null) === 'solid' && dashKey(DASH.hole) === 'd8-8' && dashKey(DASH.hole) !== dashKey(DASH.estimated), 'one free-map layer per dash');
  {
    let order: { id: string; z: number }[] = [];
    const add = (id: string, z: number) => { const before = layerBefore(order, z); order = withLayer(order, id, z); return before; };
    check(add('route', 3) === undefined, 'the first layer goes on top');
    check(add('trails', 1) === 'route', 'a lower layer goes under the higher one', order);
    check(add('holes', 2) === 'route', 'a middle layer goes between', order);
    check(add('trail-holes', 1) === 'holes', 'the same z keeps the order added (after the earlier one, under the next z)', order);
    check(order.map((l) => l.id).join(',') === 'trails,trail-holes,holes,route', 'the list follows what MapLibre was told', order);
  }

  console.log('\n== Anchors (Google places an overlay by its top-left corner) ==');
  check(anchorShift('center') === 'translate(-50%, -50%)', 'centre');
  check(anchorShift('bottom') === 'translate(-50%, -100%)', 'bottom');
  check(anchorShift('bottom', 9) === 'translate(-50%, calc(-100% + 9px))', 'bottom moved down by half a ring (the free map\'s offset)');
  check(anchorShift('top', -9) === 'translate(-50%, calc(0% + -9px))', 'top moved up by half a circle');

  console.log('\n== The files ==');
  const files = ['src/components/TaskMap.web.tsx', 'src/components/RouteMap.web.tsx', 'src/components/DriversMap.web.tsx', 'src/components/office/PinAdjust.web.tsx'];
  const src = Object.fromEntries(files.map((f) => [f, read(f)]));
  check(files.every((f) => !/TEMPORARY/.test(src[f])), 'no placeholder left');
  check(files.every((f) => !/react-native-maps|@maplibre\/maplibre-react-native/.test(src[f])), 'no native map module in the web build');
  check(/export function TaskMap\b/.test(src[files[0]]) && /export function useMapEngine\b/.test(src[files[0]]), 'TaskMap and useMapEngine, as the phones\' file');
  check(/export function RouteMap\b/.test(src[files[1]]) && /export function useRouteMapEngine\b/.test(src[files[1]]), 'RouteMap and useRouteMapEngine');
  check(/export function DriversMap\b/.test(src[files[2]]), 'DriversMap');
  check(/export function PinAdjust\b/.test(src[files[3]]) && /export const roundPin\b/.test(src[files[3]]) && /export interface PinPoint\b/.test(src[files[3]]), 'PinAdjust, roundPin and PinPoint');
  // Rule 10: what the task map draws follows the engine mounted, never the one wanted.
  check(/const google = mount\.engine === 'google';/.test(src[files[0]]) && /mapStops\(task, google\)/.test(src[files[0]]) && /mapLines\(task, google, stops, start\)/.test(src[files[0]]) && /startPoint\(task, google\)/.test(src[files[0]]),
    "the task map's stops, start and lines are taskMapLogic's for the engine mounted (Google's content on Google's map only)");
  check(/googleNotOnMap/.test(src[files[0]]) && /mapCredit\(google, lines\)/.test(src[files[0]]), 'the free map says a Google place is not on it, and the credits follow the lines drawn');
  check(/MapUnavailable/.test(src[files[0]]) && /route-map-unavailable/.test(src[files[1]]) && /drivers-map-unavailable/.test(src[files[2]]) && /office\.pin\.mapFailed/.test(src[files[3]]),
    'every map has its "Map not available"');
  check(/routeCredit\(mount\.engine === 'google', lines\)/.test(src[files[1]]) && /creditWithOrs\(mapCredit\(google, \[\]\), google/.test(src[files[2]]) && /OSM_CREDIT/.test(src[files[3]]),
    "the credits as the phones' maps show them");
  check((src[files[2]].match(/<MapButton /g) ?? []).length === 1, 'Live: one button of its own (fit; no zoom buttons, pinch and the wheel zoom) beside the screen\'s controls');

  const adapters = read('src/components/web/adapters.ts');
  const google = read('src/components/web/googleWeb.ts');
  check(/tiles\.openfreemap\.org\/styles\/liberty/.test(adapters) && /attributionControl: false/.test(adapters), "the free map: OpenFreeMap's Liberty style, the page's own credit line");
  check(/register_map_load/.test(google) && !/mapId/.test(google + adapters), "Google's map: each load counted by register_map_load, no map id");
  check(/gm_authFailure/.test(google) && /GOOGLE_SCRIPT_TIMEOUT_MS/.test(google), "Google refusing the key, or a script not ready in 15 s, is Google's failure");
  check(/disableDefaultUI: true/.test(google) && /gestureHandling: 'greedy'/.test(google), "none of Google's buttons; one finger moves the map");

  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  const site = JSON.parse(read('../office/package.json')) as { dependencies: Record<string, string> };
  check(pkg.dependencies['maplibre-gl'] === site.dependencies['maplibre-gl'], 'maplibre-gl at the office site\'s version', { app: pkg.dependencies['maplibre-gl'], site: site.dependencies['maplibre-gl'] });

  console.log('\n== Strings ==');
  {
    const en = JSON.parse(read('src/i18n/en.json')) as Record<string, unknown>;
    const si = JSON.parse(read('src/i18n/si.json')) as Record<string, unknown>;
    const at = (o: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
    const keys = [...new Set(Object.values(src).concat(read('src/components/web/BrowserMap.tsx'), read('src/components/web/pins.tsx')).flatMap((s) => [...s.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1])))];
    const missing = keys.filter((k) => typeof at(en, k) !== 'string' || typeof at(si, k) !== 'string');
    check(keys.length > 10 && missing.length === 0, `every string the browser maps use is in English and Sinhala (${keys.length} keys)`, missing);
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll web map checks passed.');
  process.exit(failed ? 1 : 0);
}

void main();
