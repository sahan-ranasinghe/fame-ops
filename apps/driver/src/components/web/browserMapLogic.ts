// The mobile website's maps (Phase 8, O4): the rules the browser maps share, apart from the engines. Pure: no React, no DOM
// and no map library, so scripts/test-web-maps.ts runs it.
//   - Which engine a page asks for: Google's when the office's package is google and Google has not failed in this tab
//     (lib/mapEngine.ts engineFor, the build always able to: the browser key comes from register_map_load), else the free map.
//   - The tab's Google maps: every google.maps.Map made is one map load Google bills, so each new one is counted by the server
//     first (register_map_load) and a map no page shows any more is kept for the next page instead of being made again (the
//     site's rule: one load counted per map made, never a map made uncounted). The script loads once, with the first key.
//   - The camera for a frame (the frames are taskMapLogic.ts's), the dashes in pixels for both engines, and the order of the
//     free map's line layers.

import { engineFor, type Engine, type MapPackage } from '../../lib/mapEngine';
import type { Frame, LatLng } from '../taskMapLogic';

export const SRI_LANKA: LatLng = { lat: 7.75, lng: 80.7 };
/** The zoom that shows the whole island (the frame with nothing in it). */
export const COUNTRY_ZOOM = 6.4;
/** A fitted frame never zooms in further than this (a box of two points a few metres apart). */
export const MAX_FIT_ZOOM = 17;
/** Google's map script must be ready this long after its load was counted, or the page shows the free map (the site's rule). */
export const GOOGLE_SCRIPT_TIMEOUT_MS = 15_000;

/** The engine a page asks for in this tab: no package yet (an older /me) is the free map. */
export function browserEngine(mapPackage: MapPackage | undefined, googleFailed: boolean): Engine {
  return engineFor(true, mapPackage ?? 'open', googleFailed);
}

// --- The camera ----------------------------------------------------------------------------------------------------------

export type Camera =
  | { kind: 'bounds'; sw: LatLng; ne: LatLng }
  | { kind: 'center'; center: LatLng; zoom: number };

/** Where the camera goes for a frame: the box, the one place at `pointZoom`, or the island when there is nothing. */
export function cameraFor(frame: Frame, pointZoom: number): Camera {
  if (frame.kind === 'box') return { kind: 'bounds', sw: frame.sw, ne: frame.ne };
  if (frame.kind === 'point') return { kind: 'center', center: frame.center, zoom: pointZoom };
  return { kind: 'center', center: SRI_LANKA, zoom: COUNTRY_ZOOM };
}

// --- Lines ---------------------------------------------------------------------------------------------------------------

/** A dash in screen pixels: the dash's length, then the gap. */
export type Dash = readonly [number, number];

/** The native maps' dashes (react-native-maps' lineDashPattern, in pixels), so both browser engines draw the same. */
export const DASH = {
  /** The task map's straight lines between stops. */
  task: [14, 10],
  /** A driver's day: the holes and the estimated roads (RouteMap). */
  route: [12, 10],
  /** Live: a trail's holes. */
  trailHole: [6, 8],
  /** Live: the shown route's holes. */
  hole: [8, 8],
  /** Live: the estimated roads. */
  estimated: [4, 8],
} as const satisfies Record<string, Dash>;

/** MapLibre measures line-dasharray in line widths, never pixels. */
export function libreDash(dash: Dash, width: number): [number, number] {
  const w = width > 0 ? width : 1;
  return [round2(dash[0] / w), round2(dash[1] / w)];
}

/** Google's polylines have no dash style: a short stroke symbol repeated (the symbol's path is 2 units long, so scale = half the dash). */
export function googleDash(dash: Dash): { scale: number; repeat: string } {
  return { scale: round2(dash[0] / 2), repeat: `${dash[0] + dash[1]}px` };
}

/** The free map's layer key for a set of lines with one dash (line-dasharray is a layer's, never a feature's). */
export function dashKey(dash: Dash | null | undefined): string {
  return dash ? `d${dash[0]}-${dash[1]}` : 'solid';
}

/**
 * The free map's line layers keep their z order: a new layer goes before the first layer drawn above it (MapLibre's
 * beforeId), or on top when none is. Layers of the same z keep the order they were added in.
 */
export function layerBefore(layers: readonly { id: string; z: number }[], z: number): string | undefined {
  return layers.find((l) => l.z > z)?.id;
}

/** The layers' list with a new one in its place (the same order layerBefore gave MapLibre). */
export function withLayer(layers: readonly { id: string; z: number }[], id: string, z: number): { id: string; z: number }[] {
  const next = layers.filter((l) => l.id !== id);
  const i = next.findIndex((l) => l.z > z);
  next.splice(i < 0 ? next.length : i, 0, { id, z });
  return next;
}

// --- Markers -------------------------------------------------------------------------------------------------------------

export type Anchor = 'center' | 'bottom' | 'top';

/** The CSS shift that puts an element's anchor on its point (Google's overlays are placed by their top-left corner). */
export function anchorShift(anchor: Anchor, offsetY = 0): string {
  const y = anchor === 'bottom' ? '-100%' : anchor === 'top' ? '0%' : '-50%';
  return offsetY ? `translate(-50%, calc(${y} + ${offsetY}px))` : `translate(-50%, ${y})`;
}

// --- The tab's Google maps -----------------------------------------------------------------------------------------------

export interface MapLoadAnswer {
  allowed: boolean;
  key?: string;
  note?: string;
}

export type GoogleGrant<M> =
  | { state: 'ready'; map: M; reused: boolean }
  /** The server said no (the open package, the map-load cap, the counter): the free map with its note, nothing kept. */
  | { state: 'refused'; note: string }
  /** Google's script failed or was too slow, or Google refused the key: the free map until the page loads again. */
  | { state: 'failed'; note: string };

export interface GooglePoolDeps<M> {
  /** Count one map load with the server (register_map_load) and get the browser key. */
  count: () => Promise<MapLoadAnswer>;
  /** Load Google's script once with the key (the pool calls it once; a failure is kept). */
  loadScript: (key: string) => Promise<void>;
  /** Make one map (only after a load was counted). */
  make: () => M;
}

const NOT_AVAILABLE = "Google's map is not available";

/**
 * The tab's Google maps: a page takes a map (a kept one when there is one, else a new one counted first) and gives it back
 * when it goes. A failed script is kept for the tab; a refusal or a dropped call to our own server is not (a later page asks
 * again). Pure apart from the deps, so the test drives it with fakes.
 */
export function createGooglePool<M>(deps: GooglePoolDeps<M>) {
  const kept: M[] = [];
  let script: Promise<void> | null = null;
  let failedNote: string | null = null;
  let made = 0;

  return {
    async take(): Promise<GoogleGrant<M>> {
      if (failedNote) return { state: 'failed', note: failedNote };
      const ready = kept.pop();
      if (ready !== undefined) return { state: 'ready', map: ready, reused: true };
      let answer: MapLoadAnswer;
      try {
        answer = await deps.count();
      } catch (e) {
        // Our own server did not answer (offline): not Google's failure, and nothing counted.
        return { state: 'refused', note: errorText(e) };
      }
      if (!answer.allowed || !answer.key) return { state: 'refused', note: answer.note ?? NOT_AVAILABLE };
      try {
        script ??= deps.loadScript(answer.key);
        await script;
      } catch (e) {
        failedNote = errorText(e);
        return { state: 'failed', note: failedNote };
      }
      if (failedNote) return { state: 'failed', note: failedNote };
      made += 1;
      return { state: 'ready', map: deps.make(), reused: false };
    },
    /** The page is gone: its map waits for the next page (never made again in this tab). */
    give(map: M) {
      if (!failedNote && !kept.includes(map)) kept.push(map);
    },
    /** Google refused the key after the map was shown (gm_authFailure), or the map never drew: the free map in this tab. */
    fail(note: string) {
      failedNote ??= note;
      kept.length = 0;
    },
    failed: () => failedNote,
    /** Maps made (= map loads counted and used), for the test. */
    made: () => made,
    kept: () => kept.length,
  };
}

/** A promise that fails after `ms` (the script blocked or too slow). */
export function withinLimit<T>(p: Promise<T>, ms: number, note: string, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = timers.set(() => reject(new Error(note)), ms);
    p.then(
      (v) => { timers.clear(timer); resolve(v); },
      (e: unknown) => { timers.clear(timer); reject(e); },
    );
  });
}

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === 'string' && m ? m : NOT_AVAILABLE;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
