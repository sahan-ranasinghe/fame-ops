// The task map (Phase 7, §20 and §24; Part 6: one map, two engines, every build). Used by the running task's screen and
// the whole task before accepting (TaskPreview). Both engines draw the same things from the same parts: the stops numbered
// with their time, the line, where the trip starts, the phone, follow me and the compass. What differs is only Google's
// content (rule 10, lib/mapRule.ts): Google's road line and a Google place's pin are drawn on Google's map only; on the
// free map dashed straight lines join the stops it draws, and a line over the map says a Google place opens in Navigate.
//
//   - Google's map (GoogleTaskMap.tsx: react-native-maps, the Maps SDK for Android, free, no map id).
//   - The free map (OpenTaskMap.tsx: MapLibre with OpenFreeMap's tiles, no key).
//   - Neither: the "Map not available" card (MapUnavailable.tsx) with the stops and the straight-line distance; the
//     screen's buttons (Start, Complete, odometer, fuel, Report, Navigate) are outside the map and work as before.
// Which one, and when Google counts as failed: lib/mapEngine.ts. The map frames the route when it opens, when the first
// position comes and when the office changes the stops, never on each new position unless Follow me is on (a pan or a
// pinch turns it off). The rules are in taskMapLogic.ts.

import Constants from 'expo-constants';
import * as Network from 'expo-network';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { type Engine, engineFor, type MountEvent, mapSession, mapStep, type MountState, startMount, waitFor } from '@/lib/mapEngine';
import { noteMapOutcome } from '@/lib/mapReport';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { GoogleTaskMap } from './GoogleTaskMap';
import { FollowButton } from './MapCompass';
import { MapUnavailable } from './MapUnavailable';
import { type Fit, mapStyles, type EngineProps } from './mapPins';
import { OpenTaskMap } from './OpenTaskMap';
import { currentStop, fitKey, frameOf, mapLines, mapStops, startPoint, type LatLng } from './taskMapLogic';

/** The build carries the Android Maps key (app.config.ts): Google's map can be used (Part 5). */
export const GOOGLE_MAP_BUILD = (Constants.expoConfig?.extra as { googleMapsAndroid?: boolean } | undefined)?.googleMapsAndroid === true;

/** The engine for this phone now: the build, the office's map package (read every minute) and Google's failure since the app opened. */
export function useMapEngine(): Engine {
  const { settings } = useApp();
  const failed = useSyncExternalStore(mapSession.subscribe, mapSession.googleFailed);
  return engineFor(GOOGLE_MAP_BUILD, settings.map_package, failed);
}

interface Props {
  task: TaskWithStops;
  /** The phone's position (null until a fresh fix; the preview has none). */
  me: LatLng | null;
  /** Which Google place the free map's line speaks about: the stop being driven to (the task screen) or any (the preview). */
  googleNoteFor: 'current' | 'any';
}

export function TaskMap({ task, me, googleNoteFor }: Props) {
  const { t, settings, dataAvailable } = useApp();
  const insets = useSafeAreaInsets();
  const engine = useMapEngine();
  const google = engine === 'google';
  const stops = useMemo(() => mapStops(task, google), [task, google]);
  const start = useMemo(() => startPoint(task, google), [task, google]);
  const lines = useMemo(() => mapLines(task, google, stops, start), [task, google, stops, start]);

  // One mount of the map: loading → loaded, or the card (lib/mapEngine.ts mapStep).
  const [mount, setMount] = useState<MountState>(() => startMount(engine));
  const mountRef = useRef(mount);
  mountRef.current = mount;
  const dispatch = (e: MountEvent) => {
    const step = mapStep(mountRef.current, e);
    mountRef.current = step.state;
    setMount(step.state);
    if (step.googleFailed) {
      mapSession.markGoogleFailed(Date.now());
      noteMapOutcome({ googleFailed: step.googleFailed });
    } else if (step.googleLoaded) {
      noteMapOutcome({ googleLoaded: true });
    }
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // The setting, or Google's failure, changed the engine: mount the other one.
  useEffect(() => { dispatchRef.current({ type: 'engine', engine }); }, [engine]);

  // The wait: a map that has not said it loaded by then is judged, online or not (asked at that moment).
  const waitS = waitFor(mount.engine, settings.phone_map_wait_s);
  useEffect(() => {
    if (mount.status !== 'loading') return;
    const timer = setTimeout(() => {
      void Network.getNetworkStateAsync()
        .then((s) => s.isInternetReachable ?? s.isConnected ?? false)
        .catch(() => false)
        .then((online) => dispatchRef.current({ type: 'timeout', online }));
    }, waitS * 1000);
    return () => clearTimeout(timer);
  }, [mount.status, mount.attempt, mount.engine, waitS]);

  // The card goes by itself when the network comes back.
  const wasOnline = useRef(dataAvailable);
  useEffect(() => {
    if (dataAvailable && !wasOnline.current && mountRef.current.status === 'unavailable') dispatchRef.current({ type: 'retry' });
    wasOnline.current = dataAvailable;
  }, [dataAvailable]);

  // The phone counts in the framing from its first position on; later positions don't move the camera (but Follow me).
  const [firstMe, setFirstMe] = useState<LatLng | null>(null);
  const latestMe = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!me) return;
    latestMe.current = me;
    setFirstMe((had) => had ?? me);
  }, [me]);
  const [follow, setFollow] = useState(false);

  const key = fitKey(stops, lines, start, firstMe !== null);
  const fit = useMemo((): Fit => {
    const mine = latestMe.current ?? firstMe;
    const points: LatLng[] = [...stops, ...lines.flatMap((l) => l.points), ...(start ? [start] : []), ...(mine ? [mine] : [])];
    return { key, frame: frameOf(points) };
    // Only the key decides when the map frames again (see fitKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (mount.status === 'unavailable') {
    return <MapUnavailable task={task} me={me} onRetry={() => dispatch({ type: 'retry' })} />;
  }

  const hiddenGoogle = mount.engine === 'open' && (googleNoteFor === 'current'
    ? !!currentStop(task)?.google_place_id
    : task.task_stops.some((s) => s.status !== 'removed' && !!s.google_place_id));
  const parts: EngineProps = {
    stops,
    start,
    me,
    fit,
    lines,
    follow,
    onUserMove: () => setFollow(false),
    onLoaded: () => dispatchRef.current({ type: 'loaded' }),
    onFailed: () => dispatchRef.current({ type: 'error' }),
  };
  return (
    <>
      <MapBoundary key={`${mount.engine}:${mount.attempt}`} onError={() => dispatchRef.current({ type: 'error' })}>
        {mount.engine === 'google' ? <GoogleTaskMap {...parts} /> : <OpenTaskMap {...parts} />}
      </MapBoundary>
      {me && (
        <FollowButton on={follow} label={t('map.followMe')} onPress={() => setFollow((on) => !on)} style={{ top: insets.top + 124, right: 16 }} />
      )}
      {hiddenGoogle ? (
        <View style={mapStyles.mapNote} pointerEvents="none">
          <Txt variant="strong" size={14} color="#ffffff">{t('task.googleNotOnMap')}</Txt>
        </View>
      ) : null}
    </>
  );
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
