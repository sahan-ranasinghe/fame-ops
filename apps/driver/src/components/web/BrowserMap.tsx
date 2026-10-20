// The mobile website's map host (Phase 8, O4): what the four browser maps (TaskMap.web.tsx, RouteMap.web.tsx,
// DriversMap.web.tsx, office/PinAdjust.web.tsx) share, so each says only what it draws.
//   - useMapMount: the engine and one mount of it, exactly as the phones' maps (lib/mapEngine.ts mapStep): Google's map when
//     the office's package is google and Google has not failed in this tab, the free map otherwise; Google refused by the
//     server (a cap, the counter, our server not answering) = the free map for this map with the reason kept; Google failed
//     (the key refused, the script blocked or slow, no tiles within the wait while online) = the free map in this tab until
//     it is loaded again; the free map failed (its style could not load, no WebGL) or anything offline = "Map not available"
//     with Try again, tried again by itself when the browser is back online. The wait runs only while the screen is in front
//     and the tab is shown.
//   - BrowserMap: the engine's box (a plain div: the map libraries draw into the page's own elements), the error boundary,
//     and the adapter handed to the pins and lines inside it.
//   - MapMarker: a React pin rendered into the element the engine places at a point (a portal, so the pins are the app's
//     own views, as on the phones). MapLines: a group of lines.

import MapPinOff from 'lucide-react-native/icons/map-pin-off';
import { useIsFocused } from 'expo-router';
import { Component, createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Txt } from '@/components/ui';
import { type Engine, type MapPackage, mapSession, mapStep, type MountEvent, type MountState, startMount, waitFor } from '@/lib/mapEngine';
import type { LatLng } from '@/components/taskMapLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { createFreeMap, createGoogleMap, googleNeverDrew, type LineSpec, type MapAdapter, type MapEvents, type MarkerHandle, type Padding } from './adapters';
import { type Anchor, browserEngine, type Camera } from './browserMapLogic';
import { giveGoogleMap, googleApi, takeGoogleMap } from './googleWeb';

/** The engine this tab asks for: the office's package and Google's failure in this tab. */
export function useBrowserEngine(mapPackage: MapPackage | undefined): Engine {
  const failed = useSyncExternalStore(mapSession.subscribe, mapSession.googleFailed, mapSession.googleFailed);
  return browserEngine(mapPackage, failed);
}

export interface MapMount {
  mount: MountState;
  dispatch: (e: MountEvent) => void;
  /** Google's map refused by the server for this map: the free map instead, and why (shown to nobody: the note is the server's English). */
  refuse: (note: string) => void;
}

/** One map's engine and mount (the phones' TaskMap.tsx logic, with the browser's online flag and the tab's visibility). */
export function useMapMount(mapPackage: MapPackage | undefined): MapMount {
  const { settings, dataAvailable } = useApp();
  const wanted = useBrowserEngine(mapPackage);
  const [refused, setRefused] = useState(false);
  const engine: Engine = refused ? 'open' : wanted;
  const focused = useIsFocused();
  const active = useTabShown();

  const [mount, setMount] = useState<MountState>(() => startMount(engine));
  const mountRef = useRef(mount);
  mountRef.current = mount;
  const dispatch = (e: MountEvent) => {
    const step = mapStep(mountRef.current, e);
    mountRef.current = step.state;
    setMount(step.state);
    // Google failed in this tab: every map here moves to the free map (the office's sign-in never reports it).
    if (step.googleFailed) googleNeverDrew(step.googleFailed === 'timeout' ? "Google's map did not load in time" : "Google's map could not load");
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => { dispatchRef.current({ type: 'engine', engine }); }, [engine]);

  // In a browser Google's map first waits for its count (register_map_load) and the script (at most 15 s): its wait is never
  // shorter than 20 s, so a load is not counted and then judged failed while still on its way.
  const waitS = mount.engine === 'google' ? Math.max(20, waitFor(mount.engine, settings.phone_map_wait_s)) : waitFor(mount.engine, settings.phone_map_wait_s);
  const [waitRun, setWaitRun] = useState(0);
  useEffect(() => {
    if (mount.status !== 'loading' || !focused || !active) return;
    const judged = { attempt: mount.attempt, engine: mount.engine };
    const timer = setTimeout(() => {
      dispatchRef.current({ type: 'timeout', online: typeof navigator === 'undefined' || navigator.onLine !== false, ...judged });
    }, waitS * 1000);
    return () => clearTimeout(timer);
  }, [mount.status, mount.attempt, mount.engine, waitS, focused, active, waitRun]);

  // The browser back online: the card goes by itself; a map still loading gets its whole wait again.
  const wasOnline = useRef(dataAvailable);
  useEffect(() => {
    if (dataAvailable && !wasOnline.current) {
      if (mountRef.current.status === 'unavailable') dispatchRef.current({ type: 'retry' });
      else if (mountRef.current.status === 'loading') setWaitRun((n) => n + 1);
    }
    wasOnline.current = dataAvailable;
  }, [dataAvailable]);

  return { mount, dispatch: (e) => dispatchRef.current(e), refuse: () => setRefused(true) };
}

/** The tab is shown (react-native-web's AppState follows the page's visibility). */
function useTabShown(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

const MapCtx = createContext<MapAdapter | null>(null);

/** The mounted engine's adapter, for pins and lines inside a BrowserMap (null until it exists). */
export const useMapAdapter = () => useContext(MapCtx);

interface BrowserMapProps {
  mapMount: MapMount;
  /** Where the camera starts (the frame the page shows first). */
  start: Camera;
  padding: Padding;
  /** The adapter, once made (null when the map goes): the page moves the camera with it. */
  onAdapter: (map: MapAdapter | null) => void;
  /** The camera came to rest, the person moved the map, the map turned. */
  events?: Pick<MapEvents, 'moved' | 'userMove' | 'turned'>;
  children?: ReactNode;
}

/** One mount of the engine (made again for Try again, the engine changing): the box, the boundary, the adapter. */
export function BrowserMap({ mapMount, start, padding, onAdapter, events, children }: BrowserMapProps) {
  const { mount, dispatch } = mapMount;
  return (
    <MapBoundary key={`${mount.engine}:${mount.attempt}`} onError={() => dispatch({ type: 'error' })}>
      <EngineBox mapMount={mapMount} start={start} padding={padding} onAdapter={onAdapter} events={events}>{children}</EngineBox>
    </MapBoundary>
  );
}

function EngineBox({ mapMount, start, padding, onAdapter, events, children }: BrowserMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  // The latest callbacks, so the engine is made once per mount.
  const latest = useRef({ mapMount, start, padding, onAdapter, events });
  latest.current = { mapMount, start, padding, onAdapter, events };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    let made: MapAdapter | null = null;
    const on: MapEvents = {
      loaded: () => { if (alive) latest.current.mapMount.dispatch({ type: 'loaded' }); },
      failed: () => { if (alive) latest.current.mapMount.dispatch({ type: 'error' }); },
      moved: (c) => latest.current.events?.moved?.(c),
      userMove: () => latest.current.events?.userMove?.(),
      turned: (h, p) => latest.current.events?.turned?.(h, p),
    };
    const ready = (a: MapAdapter) => {
      made = a;
      setAdapter(a);
      latest.current.onAdapter(a);
    };
    const { start: s, padding: pad } = latest.current;
    if (latest.current.mapMount.mount.engine === 'google') {
      void takeGoogleMap().then((grant) => {
        if (!alive) {
          // The page went while the map was being counted: keep it for the next page, never throw a counted map away.
          if (grant.state === 'ready') giveGoogleMap(grant.map);
          return;
        }
        if (grant.state === 'ready') ready(createGoogleMap(el, googleApi(), grant.map, s, pad, on));
        else if (grant.state === 'refused') latest.current.mapMount.refuse(grant.note);
        else latest.current.mapMount.dispatch({ type: 'error' });
      });
    } else {
      ready(createFreeMap(el, s, pad, on));
    }
    return () => {
      alive = false;
      made?.destroy();
      latest.current.onAdapter(null);
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <div ref={box} style={{ position: 'absolute', inset: 0, background: colors.mapLand }} />
      <MapCtx.Provider value={adapter}>{children}</MapCtx.Provider>
    </View>
  );
}

/** A map that throws while drawing is a failed map (Google's: the tab moves to the free map), never a broken screen. */
class MapBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? <View style={StyleSheet.absoluteFill} /> : this.props.children;
  }
}

/** A pin at a point: the engine's element with the React pin rendered into it. */
export function MapMarker({ at, anchor = 'center', offsetY = 0, z = 0, onPress, children }: {
  at: LatLng;
  anchor?: Anchor;
  offsetY?: number;
  z?: number;
  onPress?: () => void;
  children: ReactNode;
}) {
  const map = useMapAdapter();
  const [handle, setHandle] = useState<MarkerHandle | null>(null);
  const press = useRef(onPress);
  press.current = onPress;
  const clickable = !!onPress;
  const first = useRef({ at, anchor, offsetY, z });
  useEffect(() => {
    if (!map) return;
    const f = first.current;
    const h = map.marker(f.at, { anchor: f.anchor, offsetY: f.offsetY, z: f.z, ...(clickable ? { onPress: () => press.current?.() } : {}) });
    setHandle(h);
    return () => {
      h.remove();
      setHandle(null);
    };
  }, [map, clickable]);
  useEffect(() => { handle?.move(at); }, [handle, at.lat, at.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    handle?.set({ anchor, offsetY, z, ...(clickable ? { onPress: () => press.current?.() } : {}) });
  }, [handle, anchor, offsetY, z, clickable]);
  return handle ? createPortal(children, handle.el) : null;
}

/** A group of lines (one layer of the picture); `z` orders the groups. */
export function MapLines({ group, z, lines }: { group: string; z: number; lines: readonly LineSpec[] }) {
  const map = useMapAdapter();
  useEffect(() => {
    map?.lines(group, z, lines);
  }, [map, group, z, lines]);
  useEffect(() => () => map?.lines(group, z, []), [map, group, z]);
  return null;
}

/** "Map not available" with Try again, and the page's own line under it (the rows under the map keep working). */
export function UnavailableCard({ body, onRetry, testID }: { body: string; onRetry: () => void; testID: string }) {
  const { t } = useApp();
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <MapPinOff size={22} color={colors.muted} strokeWidth={2.4} />
        <Txt variant="strong" size={17} style={{ flex: 1 }}>{t('map.unavailable')}</Txt>
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={styles.retry}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('map.tryAgain')}</Txt>
        </Pressable>
      </View>
      <Txt variant="small">{body}</Txt>
    </View>
  );
}

/** The providers' credits, in their own words (never translated); Google's map shows its own. */
export function CreditLine({ text, testID }: { text: string | null; testID: string }) {
  if (!text) return null;
  return (
    <View style={styles.bottom} pointerEvents="none">
      <Text style={styles.credit} accessibilityLanguage="en" testID={testID}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.mapLand, paddingHorizontal: 16, paddingTop: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  bottom: { position: 'absolute', left: 12, bottom: 8, alignItems: 'flex-start' },
  credit: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 10, color: colors.ink },
});
