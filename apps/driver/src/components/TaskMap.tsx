// The task map on the running task's screen (Phase 7, §20 and §24), in both builds:
//   - Google's map (the gmaps build, react-native-maps with PROVIDER_GOOGLE): every stop numbered with its time, the
//     planned road line decoded from the plan's Google polylines (legs[].line), and the phone.
//   - The OpenFreeMap map (MapLibre): the stops that are not Google places, and the phone. Never Google's line or a
//     Google place's pin (rule 10, lib/mapRule.ts).
// It frames the route (stops, line, the phone) when the screen opens, when the first position comes and when the
// office changes the stops (the task is fetched again on Realtime), never on each new position. While the map is
// turned or tilted, the compass button turns it north-up again. The rules are in taskMapLogic.ts.

import { Camera, Map, Marker, type CameraRef, type CameraStop } from '@maplibre/maplibre-react-native';
import Flag from 'lucide-react-native/icons/flag';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, Txt } from '@/components/ui';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { MapCompass } from './MapCompass';
import { fitKey, frameOf, mapStops, routeLines, startPoint, type Frame, type LatLng, type MapStop, type RouteLeg } from './taskMapLogic';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SRI_LANKA: LatLng = { lat: 7.75, lng: 80.7 };
/** Room for the back button and the duty pill above, the sheet's rounded top below, and the pins' labels. */
const PADDING = { top: 120, right: 60, bottom: 60, left: 60 };
/** The sheet covers the map's bottom edge: Google's logo and the framing stay above it. */
const SHEET_OVERLAP = 24;
const ONE_PLACE_ZOOM = 14;

interface Props {
  task: TaskWithStops;
  /** The phone's position (null until a fresh fix). */
  me: LatLng | null;
  /** The build's map is Google's (the gmaps build). */
  googleMap: boolean;
  /** A line over the bottom of the map (the OpenFreeMap map: the current stop is a Google place, not drawn). */
  note?: string | null;
}

interface Fit {
  key: string;
  frame: Frame;
}

interface Turn {
  heading: number;
  pitch: number;
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

  return googleMap
    ? <GoogleTaskMap stops={stops} lines={lines} start={start} me={me} fit={fit} />
    : <OpenTaskMap stops={stops} start={start} me={me} fit={fit} note={note} />;
}

interface MapParts {
  stops: MapStop[];
  start: LatLng | null;
  me: LatLng | null;
  fit: Fit;
}

/** Only the changes a person can see: a re-render per pan would be wasted. */
function nextTurn(prev: Turn, heading: number, pitch: number): Turn {
  return Math.abs(prev.heading - heading) < 0.5 && Math.abs(prev.pitch - pitch) < 0.5 ? prev : { heading, pitch };
}

/** The OpenFreeMap map (MapLibre): the stops that are not Google places, and the phone. No line (rule 10). */
function OpenTaskMap({ stops, start, me, fit, note }: MapParts & { note?: string | null }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

  const stop = useMemo((): Partial<CameraStop> => {
    const f = fit.frame;
    if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: { ...PADDING, bottom: PADDING.bottom + SHEET_OVERLAP } };
    if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM };
    return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
  }, [fit]);

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    void camera.current?.setStop({ bearing: 0, pitch: 0, duration: 400, easing: 'ease' });
  };

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        onRegionDidChange={(e) => setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch))}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {start && (
          <Marker id="start" lngLat={[start.lng, start.lat]} anchor="center">
            <StartPin />
          </Marker>
        )}
        {stops.map((s) => (
          <Marker key={`${s.id}:${s.state}:${s.time ?? ''}`} id={`stop-${s.id}`} lngLat={[s.lng, s.lat]} anchor="bottom">
            <StopPin stop={s} />
          </Marker>
        ))}
        {me && (
          <Marker id="me" lngLat={[me.lng, me.lat]} anchor="center">
            <MePin />
          </Marker>
        )}
      </Map>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: insets.top + 68, right: 16 }} />
      {note ? (
        <View style={styles.mapNote} pointerEvents="none">
          <Txt variant="strong" size={14} color="#ffffff">{note}</Txt>
        </View>
      ) : null}
    </>
  );
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

/** A stop: its number (a flag on the start stop) and its time, on a stem to the point. */
function StopPin({ stop }: { stop: MapStop }) {
  const current = stop.state === 'current';
  const done = stop.state === 'done';
  const fill = current ? colors.blue : done ? colors.card : colors.ink;
  const ink = done ? colors.muted : '#ffffff';
  const size = current ? 16 : 14;
  return (
    <View style={{ alignItems: 'center', opacity: done ? 0.75 : 1 }}>
      <View style={[styles.pin, { backgroundColor: fill, borderColor: done ? colors.line : '#ffffff' }, current && styles.pinCurrent]}>
        <View style={[styles.pinNumber, current && styles.pinNumberCurrent, done && { backgroundColor: colors.page }]}>
          <Mono size={size} bold color={current ? colors.blue : colors.ink}>{String(stop.n)}</Mono>
        </View>
        {stop.isStart && <Flag size={size} color={ink} strokeWidth={2.6} />}
        {stop.time !== null && <Mono size={size} bold color={ink}>{stop.time}</Mono>}
      </View>
      <View style={[styles.stem, { backgroundColor: current ? colors.blue : done ? colors.muted : colors.ink }]} />
    </View>
  );
}

/** Where the trip starts when it is not a stop: a small flag, muted (the driver has left it). */
function StartPin() {
  return (
    <View style={styles.start}>
      <Flag size={14} color="#ffffff" strokeWidth={2.6} />
    </View>
  );
}

/** The phone. */
function MePin() {
  return (
    <View style={styles.meHalo}>
      <View style={styles.meDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  mapNote: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: SHEET_OVERLAP + 10,
    backgroundColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 3,
    paddingRight: 9,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 2,
    elevation: 3,
  },
  pinCurrent: { paddingVertical: 4, paddingRight: 11, borderRadius: 18 },
  pinNumber: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 4, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  pinNumberCurrent: { minWidth: 28, height: 28, borderRadius: 14 },
  stem: { width: 10, height: 10, borderRadius: 5, marginTop: 2, borderWidth: 2, borderColor: '#ffffff' },
  start: { width: 26, height: 26, borderRadius: 7, backgroundColor: colors.ink, opacity: 0.8, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#ffffff' },
  meHalo: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(30,79,160,0.22)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 24, height: 24, borderRadius: 7, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff' },
});
