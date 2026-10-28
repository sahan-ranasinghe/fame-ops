// The free map for a driver's day (RouteMap.tsx; Office mode, Phase 8 O2): MapLibre with OpenFreeMap's tiles, no key, in
// every build, as OpenDriversMap.tsx. The same content as Google's map (the positions are ours: nothing is held back here):
// the day's line as one GeoJSON source with a colour and a width per leg (the holes and the estimated roads on a dashed
// layer), a dot per stop over 10 minutes, the frame around the day, and the move to a tapped timeline
// row. It says when it has loaded (onDidFinishLoadingMap) or failed (onDidFailLoadingMap).
// Round 48 (item 3, Google Maps Timeline; Google Maps' marker clustering): the start and end pins, the gap markers the
// Layers filter shows, the stop's time when tapped or asked for, and the markers that would overlap as one numbered circle
// (the same helper as Google's map, lib/cluster.ts, from the zoom the map reports after each move; a tap zooms in two
// steps). MapLibre's markers are views over the map, above every layer, so the dots are small and the line reads through.

import { Camera, type CameraRef, type CameraStop, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { freeMapStyle, useMapScheme } from '@/lib/appTheme';
import { clusterMarkers, clusterZoom } from '@/lib/cluster';
import { BAND_COLORS, endLine, gapLine } from '@/office/driversLogic';
import { routeMarkerPoints } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import { lineWidth, PlaybackPin, ROUTE_DEFAULTS, ROUTE_PADDING, ROUTE_ZOOM, type RouteEngineProps } from './RouteMap';
import { ClusterPin, GapPin, ROUTE_DOT, RouteEndPin, RouteStopDot } from './routePins';
import type { Frame, LatLng } from './taskMapLogic';

function stopFor(f: Frame, zoom: number): CameraStop {
  if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: ROUTE_PADDING };
  if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom };
  return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
}

export function OpenRouteMap({ lines, stops, fit, focus, marker, onStop, onGap, onLoaded, onFailed, ends = ROUTE_DEFAULTS.ends, gaps = ROUTE_DEFAULTS.gaps, layers = ROUTE_DEFAULTS.layers, selected = ROUTE_DEFAULTS.selected }: RouteEngineProps) {
  const { t } = useApp();
  const scheme = useMapScheme();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  // The zoom the map last reported (null until it does): the cluster helper's input.
  const [zoom, setZoom] = useState<number | null>(null);
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

  // The markers at this zoom: the clusters, and the singles by what they are (the selected one is never clustered).
  const points = useMemo(() => routeMarkerPoints(ends, stops, gaps, layers, selected), [ends, stops, gaps, layers, selected]);
  const grouped = useMemo(() => clusterMarkers(points, zoom), [points, zoom]);
  const single = new Set(grouped.singles.map((m) => m.key));
  const shownStops = stops.filter((s) => single.has(s.key) || s.key === selected);
  const shownGaps = gaps.filter((g) => single.has(g.key) || g.key === selected);
  const zoomInto = (c: LatLng) => move({ center: [c.lng, c.lat], zoom: clusterZoom(zoom) });

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={freeMapStyle(scheme)}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
        onRegionDidChange={(e) => {
          setZoom(Number.isFinite(e.nativeEvent.zoom) ? e.nativeEvent.zoom : null);
          setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch));
        }}
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
        {/* The ends: the start's flag, the end's square, centred on the point. */}
        {ends && single.has('start') && (
          <Marker id="route-start" lngLat={[ends.start.lng, ends.start.lat]} anchor="center">
            <Pressable accessibilityRole="image" accessibilityLabel={endLine(ends.start, t)}><RouteEndPin end={ends.start} /></Pressable>
          </Marker>
        )}
        {ends?.end && single.has('end') && (
          <Marker id="route-end" lngLat={[ends.end.lng, ends.end.lat]} anchor="center">
            <Pressable accessibilityRole="image" accessibilityLabel={endLine(ends.end, t)}><RouteEndPin end={ends.end} /></Pressable>
          </Marker>
        )}
        {shownStops.map((s) => {
          const open = s.key === selected;
          const labelled = open || layers.stopTimes;
          return (
            // The dot's centre on the position whatever the label: anchored at the bottom, moved down by half a dot.
            <Marker key={`${s.key}:${s.time}`} id={`route-stop-${s.key}`} lngLat={[s.lng, s.lat]} anchor="bottom" offset={[0, ROUTE_DOT.size / 2]}>
              {/* §33.6 item 1: a tap says where and how long (the screen's card) and moves the map to it. */}
              <Pressable accessibilityRole="button" accessibilityLabel={s.label} disabled={!onStop} onPress={() => onStop?.(s.key)} hitSlop={10} testID={`route-stop-pin-${s.key}`}>
                <RouteStopDot time={s.time} labelled={labelled} open={open} />
              </Pressable>
            </Marker>
          );
        })}
        {shownGaps.map((g) => (
          <Marker key={g.key} id={`route-gap-${g.key}`} lngLat={[g.lng, g.lat]} anchor="center">
            <Pressable accessibilityRole="button" accessibilityLabel={gapLine(g, t)} disabled={!onGap} onPress={() => onGap?.(g.key)} hitSlop={8} testID={`route-gap-pin-${g.key}`}>
              <GapPin gap={g} open={g.key === selected} />
            </Pressable>
          </Marker>
        ))}
        {grouped.clusters.map((c) => (
          // Google Maps' marker clustering: one numbered circle; a tap zooms in two steps so its markers come apart.
          <Marker key={c.key} id={`route-${c.key}`} lngLat={[c.lng, c.lat]} anchor="center">
            <Pressable accessibilityRole="button" accessibilityLabel={t('dayRoute.cluster', { n: c.count })} onPress={() => zoomInto(c)} testID="route-cluster">
              <ClusterPin count={c.count} />
            </Pressable>
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
