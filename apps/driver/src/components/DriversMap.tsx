// The Live tab's drivers map (Office mode, Phase 8 O1; design 15): one map, two engines, every build, exactly as the task
// map (TaskMap.tsx; the rules in lib/mapEngine.ts):
//   - Google's map (GoogleDriversMap.tsx: react-native-maps, the Maps SDK for Android, free, no map id) when the build
//     carries the Android key, the office's map package is google and Google's map has not failed on this phone since the
//     app opened;
//   - the free map (OpenDriversMap.tsx: MapLibre with OpenFreeMap's tiles, no key) otherwise, with its credit line;
//   - neither: "Map not available" with Try again; the drivers' rows under the map keep working.
// A Google map that has not said it loaded within phone_map_wait_s while online is judged failed (the phone moves to the
// free map; a render error or MapLibre's onDidFailLoadingMap at once); the wait runs only while this screen is in front and
// the app on screen, and starts again when the network returns. Driver positions are ours (no Google content, rule 10),
// so both engines draw the same markers. The office's own sign-in does not report a failure to the server (report_map_state
// is the driver's call): the phone still switches engines by itself (mapSession).
// O2: the route layers (office/liveRouteLogic.ts), the same on both engines: today's trails (each driver's line in a muted
// colour, its holes dashed), the shown route (the selected driver's day as runs by speed band, the holes dashed grey, the
// estimated roads dashed slate, the stops as circles with their times) and the playback marker with its time. The two
// pins the engines share (the stop circle, the playback marker) live here and reach the engines as props; the credit line
// gains openrouteservice's whenever an estimated road is drawn.
// Stage 1 (O3 item 4f): the one control cluster down the right side (Sahan, 20 October 2026: no zoom buttons, pinch and the
// wheel zoom; the screen's own controls, then fit everyone), under the compass each engine shows while the map is turned.
// A tap is a command (MapCommand, a new nonce each time) the mounted engine carries out on its own camera: a zoom step,
// or the frame around every driver's marker and the shown route (office/liveLogic.ts fitAllFrame). Shown only while a map
// is mounted, never over "Map not available".

import MapPinOff from 'lucide-react-native/icons/map-pin-off';
import Maximize from 'lucide-react-native/icons/maximize';
import * as Network from 'expo-network';
import { useIsFocused } from 'expo-router';
import { Component, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { type Engine, engineFor, type MapPackage, mapSession, mapStep, type MountEvent, type MountState, startMount, waitFor } from '@/lib/mapEngine';
import type { MapCommand } from '@/office/liveLogic';
import { type Cursor, creditWithOrs, ESTIMATED_COLOR, HOLE_COLOR, type LiveLayers, NO_LAYERS, STOP_PIN, type StopMark } from '@/office/liveRouteLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { GoogleDriversMap } from './GoogleDriversMap';
import { type DriversEngineProps, mapStyles } from './mapPins';
import { OpenDriversMap } from './OpenDriversMap';
import { GOOGLE_MAP_BUILD } from './TaskMap';
import { mapCredit } from './taskMapLogic';

/** What both engines are given for the route layers (O2), on top of the markers: the lines and the pins that draw them. */
export interface LiveLayerProps {
  layers: LiveLayers;
  pins: LivePins;
  /** Stage 1: the cluster's last tap (zoom in, zoom out, fit everyone), carried out once per nonce; null before any. */
  command: MapCommand | null;
}

export interface LivePins {
  /** A stop over 10 minutes: a small circle; its times above it while it is open (tapped). */
  Stop: (props: { stop: StopMark; open: boolean }) => ReactNode;
  /** The playback marker: the dot (hollow while estimated) under its time and speed. */
  Cursor: (props: { cursor: Cursor }) => ReactNode;
}

/**
 * The engine for this phone now: the build, the map package (the office's own `GET /me` says it for an office sign-in;
 * else the phone's settings) and Google's failure since the app opened.
 */
export function useDriversMapEngine(mapPackage: MapPackage | undefined): Engine {
  const { settings } = useApp();
  const failed = useSyncExternalStore(mapSession.subscribe, mapSession.googleFailed);
  return engineFor(GOOGLE_MAP_BUILD, mapPackage ?? settings.map_package, failed);
}

type Props = Omit<DriversEngineProps, 'onLoaded' | 'onFailed'> & {
  /** The office's map package (me.map.package); the phone's setting when absent. */
  mapPackage?: MapPackage;
  /** The route layers (O2): the trails, the shown route, the playback marker; none by default. */
  layers?: LiveLayers;
  /** The screen's controls over the map (none on Live since the trails moved into the Filter sheet), shown only while a map is mounted, never over "Map not available". */
  controls?: ReactNode;
};

export function DriversMap({ mapPackage, layers = NO_LAYERS, controls, ...parts }: Props) {
  const { t, settings, dataAvailable } = useApp();
  const engine = useDriversMapEngine(mapPackage);
  const focused = useIsFocused();
  const active = useAppActive();
  // The cluster's taps, for the mounted engine (a new nonce each time, so the same button twice works twice).
  const [command, setCommand] = useState<MapCommand | null>(null);
  const tap = (kind: MapCommand['kind']) => setCommand((c) => ({ kind, nonce: (c?.nonce ?? 0) + 1 }));

  // One mount of the map: loading → loaded, or the card (lib/mapEngine.ts mapStep), as TaskMap.tsx.
  const [mount, setMount] = useState<MountState>(() => startMount(engine));
  const mountRef = useRef(mount);
  mountRef.current = mount;
  const dispatch = (e: MountEvent) => {
    const step = mapStep(mountRef.current, e);
    mountRef.current = step.state;
    setMount(step.state);
    // Google failed on this phone: the session marks it once per try and every map on the phone moves to the free map.
    if (step.googleFailed) mapSession.markGoogleFailed(Date.now());
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // The setting, or Google's failure, changed the engine: mount the other one.
  useEffect(() => { dispatchRef.current({ type: 'engine', engine }); }, [engine]);

  // The wait: a map that has not said it loaded by then is judged, online or not (asked at that moment). It runs only while
  // the map can draw (this tab in front, the app on screen) and starts again when that returns or the network comes back.
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

  // The network back: the card goes by itself; a map still loading gets its whole wait again.
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
      <View style={styles.card} testID="drivers-map-unavailable">
        <View style={styles.head}>
          <MapPinOff size={22} color={colors.muted} strokeWidth={2.4} />
          <Txt variant="strong" size={17} style={{ flex: 1 }}>{t('map.unavailable')}</Txt>
          <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'retry' })} hitSlop={8} style={styles.retry}>
            <Txt variant="strong" size={15} color={colors.blue}>{t('map.tryAgain')}</Txt>
          </Pressable>
        </View>
        <Txt variant="small">{t('office.live.mapUnavailableBody')}</Txt>
      </View>
    );
  }

  // An estimated road drawn (openrouteservice's) adds its credit to the map's own.
  const credit = creditWithOrs(mapCredit(mount.engine === 'google', []), mount.engine === 'google', (layers.route?.estimated.length ?? 0) > 0);
  const engineProps: DriversEngineProps & LiveLayerProps = {
    ...parts,
    layers,
    pins: PINS,
    command,
    onLoaded: () => dispatchRef.current({ type: 'loaded' }),
    onFailed: () => dispatchRef.current({ type: 'error' }),
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <MapBoundary key={`${mount.engine}:${mount.attempt}`} onError={() => dispatchRef.current({ type: 'error' })}>
        {mount.engine === 'google' ? <GoogleDriversMap {...engineProps} /> : <OpenDriversMap {...engineProps} />}
      </MapBoundary>
      <View style={styles.cluster} pointerEvents="box-none" testID="drivers-map-controls">
        {controls}
        <MapButton icon={Maximize} label={t('office.live.fitAll')} onPress={() => tap('fit')} testID="map-fit" />
      </View>
      {/* The providers' credits, in their own words (never translated); Google's map shows its own. */}
      {credit ? (
        <View style={styles.bottom} pointerEvents="none">
          <Text style={mapStyles.credit} accessibilityLanguage="en" testID="drivers-map-credit">{credit}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One button of the cluster: 48 px, white, the icon in ink. */
function MapButton({ icon: Icon, label, onPress, testID }: { icon: LucideIcon; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={({ pressed }) => [styles.mapButton, pressed && { opacity: 0.8 }]}>
      <Icon size={22} color={colors.ink} strokeWidth={2.4} />
    </Pressable>
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

// --- The route pins (O2), the same picture on both engines ------------------------------------------------------------

/** A stop over 10 minutes: a small white circle with a grey ring; tapped, its times and length sit above it. */
function StopDot({ stop, open }: { stop: StopMark; open: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      {open && (
        <View style={[pinStyles.label, { height: STOP_PIN.labelHeight, marginBottom: STOP_PIN.gap }]}>
          <Mono size={12} bold>{stop.label}</Mono>
        </View>
      )}
      <View style={[pinStyles.stop, open && { borderColor: colors.ink }]} />
    </View>
  );
}

/** The playback marker: "09:12:05 · 62 km/h" (or "· estimated") above a blue dot, hollow while estimated. */
function CursorPin({ cursor }: { cursor: Cursor }) {
  const { t } = useApp();
  const words = cursor.estimated ? t('office.live.estimated') : cursor.kmh === null ? null : t('office.live.kmh', { n: cursor.kmh });
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[pinStyles.label, { height: STOP_PIN.labelHeight, marginBottom: STOP_PIN.gap, flexDirection: 'row', gap: 6 }]}>
        <Mono size={12} bold>{cursor.time}</Mono>
        {words ? <Txt variant="strong" size={12} color={cursor.estimated ? colors.muted : colors.ink}>{words}</Txt> : null}
      </View>
      <View style={[pinStyles.cursor, cursor.estimated && { backgroundColor: colors.card, borderColor: ESTIMATED_COLOR }]} />
    </View>
  );
}

const PINS: LivePins = { Stop: StopDot, Cursor: CursorPin };

/** Google's view-based marker needs the sizes; MapLibre anchors the view itself. */
export const CURSOR_PIN = { size: 18, labelHeight: STOP_PIN.labelHeight, gap: STOP_PIN.gap } as const;

const pinStyles = StyleSheet.create({
  label: { backgroundColor: colors.card, borderRadius: 8, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  stop: { width: STOP_PIN.size, height: STOP_PIN.size, borderRadius: STOP_PIN.size / 2, backgroundColor: colors.card, borderWidth: 2.5, borderColor: HOLE_COLOR, elevation: 2 },
  cursor: { width: CURSOR_PIN.size, height: CURSOR_PIN.size, borderRadius: CURSOR_PIN.size / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: colors.card, elevation: 3 },
});

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.mapLand, paddingHorizontal: 16, paddingTop: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  bottom: { position: 'absolute', left: 12, bottom: 8, alignItems: 'flex-start' },
  cluster: { position: 'absolute', top: 68, right: 12, alignItems: 'flex-end', gap: 8 },
  mapButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', elevation: 4 },
});
