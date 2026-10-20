// The free map for a driver's day (RouteMap.tsx; Office mode, Phase 8 O2): MapLibre with OpenFreeMap's tiles, no key, in
// every build, as OpenDriversMap.tsx. The same content as Google's map (the positions are ours: nothing is held back here):
// the day's line as one GeoJSON source with a colour and a width per leg (the holes and the estimated roads on a dashed
// layer), a circle per stop over 10 minutes with its time, the frame around the day, and the move to a tapped timeline
// row. It says when it has loaded (onDidFinishLoadingMap) or failed (onDidFailLoadingMap).

import { Camera, type CameraRef, type CameraStop, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { BAND_COLORS } from '@/office/driversLogic';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import { lineWidth, PlaybackPin, ROUTE_PADDING, ROUTE_PIN, ROUTE_ZOOM, type RouteEngineProps, RouteStopPin } from './RouteMap';
import type { Frame } from './taskMapLogic';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function stopFor(f: Frame, zoom: number): CameraStop {
  if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: ROUTE_PADDING };
  if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom };
  return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
}

export function OpenRouteMap({ lines, stops, fit, focus, marker, onLoaded, onFailed }: RouteEngineProps) {
  const { t } = useApp();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const focusedRow = focus !== null;

  const framed = useMemo((): CameraStop => stopFor(fit.frame, ONE_PLACE_ZOOM), [fit]);

  /** A camera move on the mounted map (setStop throws until the native view exists: then the Camera's own stop is enough). */
  const move = (next: CameraStop) => {
    try {
      void camera.current?.setStop({ ...next, duration: 600, easing: 'ease' });
    } catch {
      // The map is not up yet: the Camera's stop applies when it is.
    }
  };

  // The whole day: the Camera's own stop follows the points shown while no row is focused; a focus cleared refits by hand.
  const [stop, setStop] = useState(framed);
  useEffect(() => {
    if (!focusedRow) setStop(framed);
  }, [framed, focusedRow]);
  const wasFocused = useRef(false);
  useEffect(() => {
    if (wasFocused.current && !focusedRow) move({ ...framed });
    wasFocused.current = focusedRow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRow]);

  // A tapped timeline row: once per tap (nonce).
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const f = focusRef.current;
    if (!f) return;
    move(stopFor(f.frame, ROUTE_ZOOM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    move({ bearing: 0, pitch: 0 });
  };

  // One source, a colour and a width per leg; the dashed legs on their own layer (line-dasharray is the layer's).
  const data = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature',
      properties: { color: BAND_COLORS[l.band], width: lineWidth(l), dashed: l.dashed },
      geometry: { type: 'LineString', coordinates: l.points.map((p) => [p.lng, p.lat]) },
    })),
  }), [lines]);

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
        onRegionDidChange={(e) => setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch))}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {lines.length > 0 && (
          <GeoJSONSource id="route-lines" data={data}>
            <Layer id="route-lines-dashed" type="line" filter={['==', ['get', 'dashed'], true]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [2, 1.5] }} />
            <Layer id="route-lines-solid" type="line" filter={['==', ['get', 'dashed'], false]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] }} />
          </GeoJSONSource>
        )}
        {stops.map((s) => (
          // The circle's centre on the position whatever the label: anchored at the top, moved up by half a circle.
          <Marker key={`${s.key}:${s.time}`} id={`route-stop-${s.key}`} lngLat={[s.lng, s.lat]} anchor="top" offset={[0, -ROUTE_PIN.circle / 2]}>
            <RouteStopPin stop={s} />
          </Marker>
        ))}
        {marker ? (
          // The playback marker: the circle's centre on the position; the view turns to the path (less the map's own turn).
          <Marker id="route-playback" lngLat={[marker.lng, marker.lat]} anchor="center">
            <PlaybackPin marker={{ ...marker, heading: marker.heading == null ? null : marker.heading - turn.heading }} turn />
          </Marker>
        ) : null}
      </Map>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}
