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

import MapPinOff from 'lucide-react-native/icons/map-pin-off';
import * as Network from 'expo-network';
import { useIsFocused } from 'expo-router';
import { Component, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { Txt } from '@/components/ui';
import { type Engine, engineFor, type MapPackage, mapSession, mapStep, type MountEvent, type MountState, startMount, waitFor } from '@/lib/mapEngine';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { GoogleDriversMap } from './GoogleDriversMap';
import { type DriversEngineProps, mapStyles } from './mapPins';
import { OpenDriversMap } from './OpenDriversMap';
import { GOOGLE_MAP_BUILD } from './TaskMap';
import { mapCredit } from './taskMapLogic';

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
};

export function DriversMap({ mapPackage, ...parts }: Props) {
  const { t, settings, dataAvailable } = useApp();
  const engine = useDriversMapEngine(mapPackage);
  const focused = useIsFocused();
  const active = useAppActive();

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

  const credit = mapCredit(mount.engine === 'google', []);
  const engineProps: DriversEngineProps = {
    ...parts,
    onLoaded: () => dispatchRef.current({ type: 'loaded' }),
    onFailed: () => dispatchRef.current({ type: 'error' }),
  };
  return (
    <View style={StyleSheet.absoluteFill}>
      <MapBoundary key={`${mount.engine}:${mount.attempt}`} onError={() => dispatchRef.current({ type: 'error' })}>
        {mount.engine === 'google' ? <GoogleDriversMap {...engineProps} /> : <OpenDriversMap {...engineProps} />}
      </MapBoundary>
      {/* The providers' credits, in their own words (never translated); Google's map shows its own. */}
      {credit ? (
        <View style={styles.bottom} pointerEvents="none">
          <Text style={mapStyles.credit} accessibilityLanguage="en" testID="drivers-map-credit">{credit}</Text>
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
});
