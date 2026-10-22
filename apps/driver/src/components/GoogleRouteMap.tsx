// Google's map for a driver's day (RouteMap.tsx; Office mode, Phase 8 O2): react-native-maps with PROVIDER_GOOGLE, as
// GoogleDriversMap.tsx (the Maps SDK for Android, free on a phone; no map id). One polyline per leg of the day's line in
// its speed band's colour (the holes and the estimated roads dashed), a circle per stop over 10 minutes with its time, the
// frame around the day, and the move to a tapped timeline row. It says when it has finished loading (onMapLoaded), which
// a refused key, billing, authorisation or Google Play services problem never does (lib/mapEngine.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { useMapScheme } from '@/lib/appTheme';
import { BAND_COLORS } from '@/office/driversLogic';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import { lineWidth, PlaybackPin, ROUTE_PADDING, ROUTE_ZOOM, type RouteEngineProps, routePinAnchorY, RouteStopPin } from './RouteMap';
import type { Frame, LatLng } from './taskMapLogic';

export function GoogleRouteMap({ lines, stops, fit, focus, marker, onStop, onLoaded }: RouteEngineProps) {
  const { t } = useApp();
  const scheme = useMapScheme();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

  const show = (f: Frame, zoom: number) => {
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: ROUTE_PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom, heading: 0, pitch: 0 }, { duration: 600 });
  };

  // The whole day: when the map is ready and when the points shown change (fit.key), never while a row is focused.
  const focusedRow = focus !== null;
  useEffect(() => {
    if (!ready || focusedRow) return;
    show(fit.frame, ONE_PLACE_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.key, ready, focusedRow]);

  // A tapped timeline row: once per tap (nonce), never pulled back by a refresh.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const f = focusRef.current;
    if (!ready || !f) return;
    show(f.frame, ROUTE_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.nonce]);

  const readTurn = () => {
    map.current?.getCamera()
      .then((c) => setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0)))
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  const drawn = useMemo(() => lines.map((l) => ({ ...l, coords: l.points.map(at) })), [lines]);

  return (
    <>
      <GoogleMapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        // The app's theme (lib/appTheme.ts, C §33.12): light today, so the light map whatever the phone's dark mode; read
        // once when the map is made (Android's MapColorScheme through react-native-maps 1.27.2's initial props, no native change).
        userInterfaceStyle={scheme}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: SRI_LANKA.lat, longitude: SRI_LANKA.lng, latitudeDelta: 3.5, longitudeDelta: 3.5 }}
        toolbarEnabled={false}
        showsCompass={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={onLoaded}
        onRegionChangeComplete={readTurn}
      >
        {drawn.map((l) => (
          <Polyline
            key={l.key}
            coordinates={l.coords}
            strokeColor={BAND_COLORS[l.band]}
            strokeWidth={lineWidth(l)}
            lineDashPattern={l.dashed ? [12, 10] : undefined}
            lineCap="round"
            lineJoin="round"
            zIndex={l.band === 'estimated' ? 1 : l.band === 'gap' ? 2 : 3}
          />
        ))}
        {stops.map((s) => (
          // A marker's picture is taken once (tracksViewChanges off): a new time makes a new marker.
          // §33.6 item 1: a tap says where and how long (the screen's card) and moves the map to it.
          <GoogleMarker key={`${s.key}:${s.time}`} coordinate={at(s)} anchor={{ x: 0.5, y: routePinAnchorY() }} tracksViewChanges={false} zIndex={5}
            onPress={onStop ? () => onStop(s.key) : undefined} accessibilityLabel={s.label}>
            <RouteStopPin stop={s} />
          </GoogleMarker>
        ))}
        {marker ? (
          // The playback marker: flat, turned by Google to the path (rotation); a new picture only when it goes hollow or back.
          <GoogleMarker key={`play:${marker.estimated}:${marker.heading == null}`} coordinate={at(marker)} anchor={{ x: 0.5, y: 0.5 }}
            flat rotation={marker.heading ?? 0} tracksViewChanges={false} zIndex={9}>
            <PlaybackPin marker={marker} turn={false} />
          </GoogleMarker>
        ) : null}
      </GoogleMapView>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}

function at(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}
