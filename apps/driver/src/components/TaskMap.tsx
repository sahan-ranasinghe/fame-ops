// The task map on the running task's screen (Phase 7, §20 and §24), in both builds (the OpenFreeMap one in OpenTaskMap.tsx):
//   - Google's map (the gmaps build, react-native-maps with PROVIDER_GOOGLE): every stop numbered with its time, the
//     planned road line decoded from the plan's Google polylines (legs[].line), and the phone.
//   - The OpenFreeMap map (MapLibre): the stops that are not Google places, and the phone. Never Google's line or a
//     Google place's pin (rule 10, lib/mapRule.ts).
// It frames the route (stops, line, the phone) when the screen opens, when the first position comes and when the
// office changes the stops (the task is fetched again on Realtime), never on each new position. While the map is
// turned or tilted, the compass button turns it north-up again. The rules are in taskMapLogic.ts.

import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { MapCompass } from './MapCompass';
import { type Fit, type MapParts, MePin, nextTurn, ONE_PLACE_ZOOM, PADDING, SHEET_OVERLAP, SRI_LANKA, StartPin, StopPin, type Turn } from './mapPins';
import { fitKey, frameOf, mapStops, routeLines, startPoint, type LatLng, type RouteLeg } from './taskMapLogic';

/** The build carries the Google key (app.config.ts): the task map is Google's (Part 5). */
export const GOOGLE_MAP_BUILD = (Constants.expoConfig?.extra as { googleMapsAndroid?: boolean } | undefined)?.googleMapsAndroid === true;

/**
 * The OpenFreeMap map's module, required only by a build without the Google map (Part 6): the Google-map build leaves
 * MapLibre out, so even loading that module there would fail.
 */
const OpenTaskMap: typeof import('./OpenTaskMap').OpenTaskMap | null = GOOGLE_MAP_BUILD
  ? null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : (require('./OpenTaskMap') as typeof import('./OpenTaskMap')).OpenTaskMap;

interface Props {
  task: TaskWithStops;
  /** The phone's position (null until a fresh fix). */
  me: LatLng | null;
  /** The build's map is Google's (the gmaps build). */
  googleMap: boolean;
  /** A line over the bottom of the map (the OpenFreeMap map: the current stop is a Google place, not drawn). */
  note?: string | null;
}

export function TaskMap({ task, me, googleMap, note }: Props) {
  const stops = useMemo(() => mapStops(task, googleMap), [task, googleMap]);
  const lines = useMemo(() => routeLines(task, googleMap), [task, googleMap]);
  const start = useMemo(() => startPoint(task, googleMap), [task, googleMap]);

  // The phone counts in the framing from its first position on; later positions don't move the camera.
  const [firstMe, setFirstMe] = useState<LatLng | null>(null);
  const latestMe = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!me) return;
    latestMe.current = me;
    setFirstMe((had) => had ?? me);
  }, [me]);

  const key = fitKey(stops, lines, start, firstMe !== null);
  const fit = useMemo((): Fit => {
    const mine = latestMe.current ?? firstMe;
    const points: LatLng[] = [...stops, ...lines.flatMap((l) => l.points), ...(start ? [start] : []), ...(mine ? [mine] : [])];
    return { key, frame: frameOf(points) };
    // Only the key decides when the map frames again (see fitKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return googleMap || !OpenTaskMap
    ? <GoogleTaskMap stops={stops} lines={lines} start={start} me={me} fit={fit} />
    : <OpenTaskMap stops={stops} start={start} me={me} fit={fit} note={note} />;
}

/**
 * Google's map (the gmaps build): the stops (Google places too), the planned road line from the plan's polylines and
 * the phone. No map id, so Android's map loads stay free.
 */
function GoogleTaskMap({ stops, lines, start, me, fit }: MapParts & { lines: RouteLeg[] }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

  useEffect(() => {
    if (!ready) return;
    const f = fit.frame;
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: ONE_PLACE_ZOOM, heading: 0, pitch: 0 }, { duration: 600 });
  }, [fit, ready]);

  const readTurn = () => {
    map.current?.getCamera()
      .then((c) => setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0)))
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  // Driven legs first, so the line still to drive lies on top where they meet.
  const ordered = useMemo(() => [...lines].sort((a, b) => Number(b.done) - Number(a.done)).map((l) => ({ ...l, coords: l.points.map(at) })), [lines]);

  return (
    <>
      <GoogleMapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: SRI_LANKA.lat, longitude: SRI_LANKA.lng, latitudeDelta: 3.5, longitudeDelta: 3.5 }}
        mapPadding={{ top: 0, right: 0, bottom: SHEET_OVERLAP, left: 0 }}
        toolbarEnabled={false}
        showsCompass={false}
        onMapReady={() => setReady(true)}
        onRegionChangeComplete={readTurn}
      >
        {ordered.map((l) => (
          <Polyline
            key={l.key}
            coordinates={l.coords}
            strokeColor={l.done ? colors.muted : colors.blue}
            strokeWidth={l.done ? 4 : 6}
            lineCap="round"
            lineJoin="round"
            zIndex={l.done ? 1 : 2}
          />
        ))}
        {start && (
          <GoogleMarker coordinate={at(start)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={3}>
            <StartPin />
          </GoogleMarker>
        )}
        {stops.map((s) => (
          // A marker's picture is taken once (tracksViewChanges off): a new state or time makes a new marker.
          <GoogleMarker
            key={`${s.id}:${s.state}:${s.time ?? ''}`}
            coordinate={at(s)}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            zIndex={s.state === 'current' ? 6 : s.state === 'todo' ? 5 : 4}
          >
            <StopPin stop={s} />
          </GoogleMarker>
        ))}
        {me && (
          <GoogleMarker coordinate={at(me)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={7}>
            <MePin />
          </GoogleMarker>
        )}
      </GoogleMapView>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: insets.top + 68, right: 16 }} />
    </>
  );
}

function at(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}
