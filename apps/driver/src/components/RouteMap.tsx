// A driver's day on the map (Office mode, Phase 8 O2; the driver's page, office/driversLogic.ts): one map, two engines, every
// build, exactly as the Live tab's drivers map (DriversMap.tsx; the rules in lib/mapEngine.ts):
//   - Google's map (GoogleRouteMap.tsx: react-native-maps, the Maps SDK for Android, free, no map id) when the build
//     carries the Android key, the office's map package is google and Google's map has not failed on this phone since the
//     app opened;
//   - the free map (OpenRouteMap.tsx: MapLibre with OpenFreeMap's tiles, no key) otherwise, with its credit line;
//   - neither: "Map not available" with Try again; the day's numbers above the map keep working.
// Both engines draw the same content (the positions are ours, rule 10): the day's line coloured by speed band (standing
// grey, under 20 amber, 20–60 blue, over 60 dark blue), the holes dashed grey, the estimated road over a gap dashed slate
// (openrouteservice's: its credit shows with the map), the stops over 10 minutes as small dots (a tap says where and how
// long: §33.6 item 1), the frame around the day, and the move to a tapped stop. A Google map that has not said it loaded
// within phone_map_wait_s while online is judged failed (the phone moves to the free map; a render error or MapLibre's
// onDidFailLoadingMap at once); the wait runs only while this screen is in front and the app on screen.
// Round 48 (item 3, Google Maps Timeline; the pins in routePins.tsx, the rules in office/routeMarks.ts and lib/cluster.ts):
// the start and the end of the route are pins, a stop is a dot that shows its time when tapped or when the Layers filter
// says so, the "no GPS" / "app not running" markers show only with the Layers filter (or the one whose card is open),
// and markers that would overlap are one numbered circle until the map is zoomed in (a tap zooms in). Both native SDKs
// draw their markers above their lines (no z-index crosses the two), so the dots are small enough for the line to read
// through; the playback marker stays on top of everything.

import MapPinOff from 'lucide-react-native/icons/map-pin-off';
import * as Network from 'expo-network';
import { useIsFocused } from 'expo-router';
import { Component, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Txt } from '@/components/ui';
import { type Engine, engineFor, type MapPackage, mapSession, mapStep, type MountEvent, type MountState, startMount, waitFor } from '@/lib/mapEngine';
import { NO_ROUTE_LAYERS, type RouteLayers } from '@/lib/mapLayout';
import type { RouteFit, RouteLine, StopMark } from '@/office/driversLogic';
import type { EndMarks, GapMark } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { GoogleRouteMap } from './GoogleRouteMap';
import { mapStyles } from './mapPins';
import { OpenRouteMap } from './OpenRouteMap';
import { GOOGLE_MAP_BUILD } from './TaskMap';
import { type Frame, ORS_CREDIT, OSM_CREDIT } from './taskMapLogic';

/** Room around the day when the map frames it. */
export const ROUTE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };
/** The zoom for one place (a stop, a short row). */
export const ROUTE_ZOOM = 15;

/** A stop pin tapped (§33.6 item 1; a timeline row before): the map moves to it once per tap (`nonce`: tapped again moves it again). */
export interface RouteFocus {
  frame: Frame;
  nonce: number;
}

/** What each engine is given: the lines, the stops, the frame around the day, the focus, and how it says it loaded or failed. */
export interface RouteEngineProps {
  lines: RouteLine[];
  stops: StopMark[];
  fit: RouteFit;
  focus: RouteFocus | null;
  /** The playback marker (O3 item 1): where the driver was at the playback clock; hollow inside a gap. None when not playing. */
  marker?: PlaybackMarker | null;
  /** §33.6 item 1: a stop pin tapped (its key): the screen says where and how long, and moves the map to it. */
  onStop?: (key: string) => void;
  /** Round 48: the start and end pins (none without a point). */
  ends?: EndMarks | null;
  /** Round 48: the gap markers to draw (the screen filters them by the Layers choice: office/routeMarks.ts visibleGaps). */
  gaps?: GapMark[];
  /** Round 48: the Layers choices (every stop's time label). */
  layers?: RouteLayers;
  /** Round 48: the marker whose card is open (a stop's or a gap's key): drawn apart from any cluster, a stop with its time. */
  selected?: string | null;
  /** Round 48: a gap marker tapped (its key): the screen says what it was and moves the map to it. */
  onGap?: (key: string) => void;
  /** The map finished loading (Google: onMapLoaded; MapLibre: onDidFinishLoadingMap). */
  onLoaded: () => void;
  /** The map said it failed (MapLibre: onDidFailLoadingMap). */
  onFailed: () => void;
}

/** The playback marker's position and direction (office/historyLogic.ts positionOn). */
export interface PlaybackMarker {
  lat: number;
  lng: number;
  heading: number | null;
  estimated: boolean;
}

/** The playback marker's size: one circle, centred on the position on both engines. */
export const PLAYBACK_PIN = 26;

/** The playback marker: a blue circle with an arrow to the path's direction (hollow inside a gap). Google turns it with its
 * own rotation (`turn` false); MapLibre's view turns itself. */
export function PlaybackPin({ marker, turn }: { marker: PlaybackMarker; turn: boolean }) {
  const deg = marker.heading ?? 0;
  return (
    <View style={[pinStyles.play, marker.estimated && pinStyles.playHollow, turn && marker.heading != null ? { transform: [{ rotate: `${deg}deg` }] } : null]} testID="playback-marker">
      {marker.heading != null ? <View style={[pinStyles.arrow, marker.estimated && { borderBottomColor: colors.blue }]} /> : null}
    </View>
  );
}

/** The line's width by what it is: the day's line 5, standing and the dashed legs 3. */
export function lineWidth(l: Pick<RouteLine, 'band'>): number {
  return l.band === 'standing' || l.band === 'gap' || l.band === 'estimated' ? 3 : 5;
}

/** The engines' defaults for the Round 48 parts, so an older caller (no ends, no layers) draws as before. */
export const ROUTE_DEFAULTS = { ends: null, gaps: [] as GapMark[], layers: NO_ROUTE_LAYERS, selected: null } as const;

/** The credits a map owes under it (never translated): the free map's tiles, and openrouteservice's when an estimated road is drawn. */
export function routeCredit(googleMap: boolean, lines: readonly Pick<RouteLine, 'band'>[]): string | null {
  const parts = [googleMap ? null : OSM_CREDIT, lines.some((l) => l.band === 'estimated') ? ORS_CREDIT : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The engine for this phone now: the build, the map package (the office's own GET /me) and Google's failure since the app opened. */
export function useRouteMapEngine(mapPackage: MapPackage | undefined): Engine {
  const { settings } = useApp();
  const failed = useSyncExternalStore(mapSession.subscribe, mapSession.googleFailed);
  return engineFor(GOOGLE_MAP_BUILD, mapPackage ?? settings.map_package, failed);
}

type Props = Omit<RouteEngineProps, 'onLoaded' | 'onFailed'> & {
  /** The office's map package (me.map.package); the phone's setting when absent. */
  mapPackage?: MapPackage;
  /** The screen's controls over the map (Round 48: the snap-to-roads chip), down the right side under the compass, shown only while a map is mounted, never over "Map not available". */
  controls?: ReactNode;
};

export function RouteMap({ mapPackage, controls, ...parts }: Props) {
  const { t, settings, dataAvailable } = useApp();
  const engine = useRouteMapEngine(mapPackage);
  const focused = useIsFocused();
  const active = useAppActive();

  // One mount of the map: loading → loaded, or the card (lib/mapEngine.ts mapStep), as DriversMap.tsx.
  const [mount, setMount] = useState<MountState>(() => startMount(engine));
  const mountRef = useRef(mount);
  mountRef.current = mount;
  const dispatch = (e: MountEvent) => {
    const step = mapStep(mountRef.current, e);
    mountRef.current = step.state;
    setMount(step.state);
    if (step.googleFailed) mapSession.markGoogleFailed(Date.now());
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => { dispatchRef.current({ type: 'engine', engine }); }, [engine]);

  const waitS = waitFor(mount.engine, settings.phone_map_wait_s);
  const [waitRun, setWaitRun] = useState(0);
  useEffect(() => {
    if (mount.status !== 'loading' || !focused || !active) return;
    const judged = { attempt: mount.attempt, engine: mount.engine };
    let live = true;
    const timer = setTimeout(() => {
      void Network.getNetworkStateAsync()
        .then((s) => s.isInternetReachable ?? s.isConnected ?? false)
        .catch(() => false)
        .then((online) => { if (live) dispatchRef.current({ type: 'timeout', online, ...judged }); });
    }, waitS * 1000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mount.status, mount.attempt, mount.engine, waitS, focused, active, waitRun]);

  const wasOnline = useRef(dataAvailable);
  useEffect(() => {
    if (dataAvailable && !wasOnline.current) {
      if (mountRef.current.status === 'unavailable') dispatchRef.current({ type: 'retry' });
      else if (mountRef.current.status === 'loading') setWaitRun((n) => n + 1);
    }
    wasOnline.current = dataAvailable;
  }, [dataAvailable]);

  if (mount.status === 'unavailable') {
    return (
      <View style={styles.card} testID="route-map-unavailable">
        <View style={styles.head}>
          <MapPinOff size={22} color={colors.muted} strokeWidth={2.4} />
          <Txt variant="strong" size={17} style={{ flex: 1 }}>{t('map.unavailable')}</Txt>
          <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'retry' })} hitSlop={8} style={styles.retry}>
            <Txt variant="strong" size={15} color={colors.blue}>{t('map.tryAgain')}</Txt>
          </Pressable>
        </View>
        <Txt variant="small">{t('dayRoute.mapUnavailableBody')}</Txt>
      </View>
    );
  }

  const credit = routeCredit(mount.engine === 'google', parts.lines);
  const engineProps: RouteEngineProps = {
    ...parts,
    onLoaded: () => dispatchRef.current({ type: 'loaded' }),
    onFailed: () => dispatchRef.current({ type: 'error' }),
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <MapBoundary key={`${mount.engine}:${mount.attempt}`} onError={() => dispatchRef.current({ type: 'error' })}>
        {mount.engine === 'google' ? <GoogleRouteMap {...engineProps} /> : <OpenRouteMap {...engineProps} />}
      </MapBoundary>
      {controls ? <View style={styles.cluster} pointerEvents="box-none" testID="route-map-controls">{controls}</View> : null}
      {credit ? (
        <View style={styles.bottom} pointerEvents="none">
          <Text style={mapStyles.credit} accessibilityLanguage="en" testID="route-map-credit">{credit}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The app is on screen (AppState active). */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/** A map that throws while drawing is a failed map (Google's: the phone moves to the free map), never a broken screen. */
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

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.mapLand, paddingHorizontal: 16, paddingTop: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  bottom: { position: 'absolute', left: 12, bottom: 8, alignItems: 'flex-start' },
  cluster: { position: 'absolute', top: 68, right: 12, alignItems: 'flex-end', gap: 8 },
});

const pinStyles = StyleSheet.create({
  play: { width: PLAYBACK_PIN, height: PLAYBACK_PIN, borderRadius: PLAYBACK_PIN / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, elevation: 4 },
  playHollow: { backgroundColor: '#ffffff', borderColor: colors.blue },
  arrow: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff' },
});
