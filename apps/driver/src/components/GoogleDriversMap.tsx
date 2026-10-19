// Google's map for the Live tab's drivers (DriversMap.tsx; Office mode, Phase 8 O1): react-native-maps with PROVIDER_GOOGLE,
// as GoogleTaskMap.tsx (the Maps SDK for Android, free on a phone; no map id). One marker per driver with a position (the
// initials in a ring coloured by duty, the selected one labelled), the frame around them all, and the move to a selected
// driver. It says when it has finished loading (onMapLoaded: every tile drawn), which a refused key, billing, authorisation
// or Google Play services problem never does (lib/mapEngine.ts). Driver positions are ours: both engines draw the same.
// O2: the route layers as polylines (today's trails muted with their holes dashed; the shown route as runs by speed band,
// its holes dashed grey, the estimated roads dashed slate; the stops as circles that open their times on a tap; the
// playback marker with its time), the map framed on the shown route once when it arrives. The points are ours (no Google
// content), so the free map draws exactly the same.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { ESTIMATED_COLOR, HOLE_COLOR, stopPinAnchorY } from '@/office/liveRouteLogic';
import { useApp } from '@/state/app';
import type { LiveLayerProps } from './DriversMap';
import { MapCompass } from './MapCompass';
import { DRIVER_ZOOM, DriverPin, driverPinAnchorY, DRIVERS_PADDING, type DriversEngineProps, nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import type { LatLng } from './taskMapLogic';

export function GoogleDriversMap({ markers, fit, focus, onPressMarker, onLoaded, layers, pins }: DriversEngineProps & LiveLayerProps) {
  const { t } = useApp();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const focused = focus !== null;

  // Everyone: when the map is ready, when the set of drivers with a position changes (fit.key), and when the selection is
  // cleared; never while a driver is selected, never on a refresh that only moved them.
  useEffect(() => {
    if (!ready || focused) return;
    const f = fit.frame;
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: DRIVERS_PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: ONE_PLACE_ZOOM, heading: 0, pitch: 0 }, { duration: 600 });
  }, [fit, ready, focused]);

  // The selected driver: the map moves to them once per selection (the same row tapped again moves it again: nonce); a
  // later position of theirs does not pull the map back from where the person panned.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus ? `${focus.username}:${focus.nonce}` : null;
  useEffect(() => {
    const f = focusRef.current;
    if (!ready || !f) return;
    map.current?.animateCamera({ center: at(f), zoom: DRIVER_ZOOM }, { duration: 600 });
  }, [ready, focusKey]);

  // The shown route: the map frames the whole day once when it arrives for a driver (its key), never on the merges that
  // grow it, and never pulls the map back during playback.
  const route = layers.route;
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeKey = route?.key ?? null;
  useEffect(() => {
    const r = routeRef.current;
    if (!ready || !r) return;
    const f = r.frame;
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: DRIVERS_PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: ONE_PLACE_ZOOM }, { duration: 600 });
  }, [ready, routeKey]);

  // The lines' coordinates in Google's shape, made once per route or set of trails (the playback marker re-renders the map
  // several times a second: the arrays must stay the same objects).
  const trails = useMemo(() => layers.trails.map((tr) => ({ ...tr, coords: tr.points.map(at), holeCoords: tr.holes.map((h) => [at(h.from), at(h.to)]) })), [layers.trails]);
  const runs = useMemo(() => (route?.runs ?? []).map((r, i) => ({ key: `run:${i}`, color: r.color, coords: r.points.map(at) })), [route]);
  const holes = useMemo(() => (route?.holes ?? []).map((h) => ({ key: `hole:${h.fromAt}`, coords: [at(h.from), at(h.to)] })), [route]);
  const estimated = useMemo(() => (route?.estimated ?? []).map((e) => ({ key: e.key, coords: e.points.map(at) })), [route]);
  const [openStop, setOpenStop] = useState<string | null>(null);
  useEffect(() => setOpenStop(null), [routeKey]);

  const readTurn = () => {
    map.current?.getCamera()
      .then((c) => setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0)))
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  const cursor = layers.cursor;
  return (
    <>
      <GoogleMapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: SRI_LANKA.lat, longitude: SRI_LANKA.lng, latitudeDelta: 3.5, longitudeDelta: 3.5 }}
        toolbarEnabled={false}
        showsCompass={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={onLoaded}
        onRegionChangeComplete={readTurn}
      >
        {/* Today's trails: each driver's line in its muted colour, its holes dashed in the same colour, under everything. */}
        {trails.map((tr) => (
          <Polyline key={`trail:${tr.username}`} coordinates={tr.coords} strokeColor={tr.color} strokeWidth={3} lineCap="round" lineJoin="round" zIndex={1} />
        ))}
        {trails.flatMap((tr) => tr.holeCoords.map((coords, i) => (
          <Polyline key={`trail-hole:${tr.username}:${i}`} coordinates={coords} strokeColor={tr.color} strokeWidth={2} lineDashPattern={[6, 8]} zIndex={1} />
        )))}
        {/* The shown route: the holes and the estimated roads dashed under the runs by speed. */}
        {holes.map((h) => (
          <Polyline key={h.key} coordinates={h.coords} strokeColor={HOLE_COLOR} strokeWidth={3} lineDashPattern={[8, 8]} lineCap="round" zIndex={2} />
        ))}
        {estimated.map((e) => (
          <Polyline key={e.key} coordinates={e.coords} strokeColor={ESTIMATED_COLOR} strokeWidth={3.5} lineDashPattern={[4, 8]} lineCap="round" lineJoin="round" zIndex={2} />
        ))}
        {runs.map((r) => (
          <Polyline key={r.key} coordinates={r.coords} strokeColor={r.color} strokeWidth={5} lineCap="round" lineJoin="round" zIndex={3} />
        ))}
        {/* The stops: a circle each; a tap opens its times (a marker's picture is taken once: open or closed is in the key). */}
        {(route?.stops ?? []).map((s) => {
          const open = openStop === s.key;
          return (
            <GoogleMarker
              key={`${s.key}:${open}`}
              coordinate={at(s)}
              anchor={{ x: 0.5, y: stopPinAnchorY(open) }}
              tracksViewChanges={false}
              zIndex={open ? 5 : 4}
              onPress={() => setOpenStop((o) => (o === s.key ? null : s.key))}
            >
              <pins.Stop stop={s} open={open} />
            </GoogleMarker>
          );
        })}
        {markers.map((m) => (
          // A marker's picture is taken once (tracksViewChanges off): a new ring, label or letters makes a new marker.
          <GoogleMarker
            key={`${m.username}:${m.tone}:${m.dim}:${m.selected}:${m.label ?? ''}:${m.initials}`}
            coordinate={at(m)}
            anchor={{ x: 0.5, y: driverPinAnchorY(m.label !== null) }}
            tracksViewChanges={false}
            zIndex={m.selected ? 9 : m.tone === 'blue' ? 8 : m.tone === 'green' ? 7 : 6}
            onPress={() => onPressMarker(m.username)}
          >
            <DriverPin marker={m} />
          </GoogleMarker>
        ))}
        {/* The playback marker: its label changes every tick, so this one marker keeps tracking its view. */}
        {cursor && (
          <GoogleMarker coordinate={at(cursor)} anchor={{ x: 0.5, y: stopPinAnchorY(true) }} tracksViewChanges zIndex={10}>
            <pins.Cursor cursor={cursor} />
          </GoogleMarker>
        )}
      </GoogleMapView>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}

function at(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}
