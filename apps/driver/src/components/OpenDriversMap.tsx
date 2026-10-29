// The free map for the Live tab's drivers (DriversMap.tsx; Office mode, Phase 8 O1): MapLibre with OpenFreeMap's tiles, no
// key, in every build, as OpenTaskMap.tsx. The same markers as Google's map (driver positions are ours: nothing is held back
// here), the frame around them all, and the move to a selected driver. It says when it has loaded (onDidFinishLoadingMap)
// or failed (onDidFailLoadingMap: the style or the tiles could not be fetched).
// O2: the route layers as GeoJSON sources with a line layer each (today's trails muted with their holes dashed; the shown
// route as runs by speed band with the colour on each feature, its holes dashed grey, the estimated roads dashed slate),
// the stops and the playback marker as markers (the same pins as Google's map), the map framed on the shown route once
// when it arrives. line-dasharray is a layer's, never a feature's, so the dashed lines have layers of their own.
// Stage 1 (O3 item 4f): the cluster's commands (DriversMap.tsx): a zoom step from the zoom the map last reported, or the
// frame around every marker and the shown route.
// Round 48 (item 3): the route's start and end pins, its gap markers (the Layers filter), the stop's time when tapped or
// asked for, and the route markers that would overlap as one numbered circle (the same helper as Google's map,
// lib/cluster.ts, from the zoom the map reports; a tap zooms in two steps). Markers are views above every layer, so the
// dots stay small.

import { Camera, type CameraRef, type CameraStop, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { freeMapStyle, useMapScheme } from '@/lib/appTheme';
import { clusterMarkers, clusterZoom } from '@/lib/cluster';
import { endLine, gapLine } from '@/office/driversLogic';
import { fitAllFrame, zoomStep } from '@/office/liveLogic';
import { ESTIMATED_COLOR, HOLE_COLOR, type HoleLine, STOP_PIN, WEB_TRIP_COLOR } from '@/office/liveRouteLogic';
import { routeMarkerPoints, visibleGaps } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import type { LiveLayerProps } from './DriversMap';
import { MapCompass } from './MapCompass';
import { DRIVER_PIN, DRIVER_ZOOM, DriverPin, DRIVERS_PADDING, type DriversEngineProps, nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import { ClusterPin, GapPin, RouteEndPin } from './routePins';
import type { LatLng } from './taskMapLogic';

export function OpenDriversMap({ markers, fit, focus, onPressMarker, onLoaded, onFailed, layers, pins, command }: DriversEngineProps & LiveLayerProps) {
  const { t } = useApp();
  const scheme = useMapScheme();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const focused = focus !== null;

  const framed = useMemo((): CameraStop => {
    const f = fit.frame;
    if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: DRIVERS_PADDING };
    if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM };
    return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
  }, [fit]);

  /** A camera move on the mounted map (setStop throws until the native view exists: then the Camera's own stop is enough). */
  const move = (next: CameraStop) => {
    try {
      void camera.current?.setStop({ ...next, duration: 600, easing: 'ease' });
    } catch {
      // The map is not up yet: the Camera's stop applies when it is.
    }
  };

  // Everyone: the Camera's own stop (applied once the map is ready, so drivers that arrive before the tiles still frame it)
  // follows the set of drivers with a position while nobody is selected. The Camera deep-compares its stop, so the frame
  // after a selection is cleared is set on it by hand below.
  const [stop, setStop] = useState(framed);
  useEffect(() => {
    if (!focused) setStop(framed);
  }, [framed, focused]);
  const wasFocused = useRef(false);
  useEffect(() => {
    if (wasFocused.current && !focused) move({ ...framed });
    wasFocused.current = focused;
    // Only the selection's end refits (the frame itself goes through the Camera's stop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  // The selected driver: once per selection (the same row tapped again: nonce), never on their later positions.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus ? `${focus.username}:${focus.nonce}` : null;
  useEffect(() => {
    const f = focusRef.current;
    if (!f) return;
    move({ center: [f.lng, f.lat], zoom: DRIVER_ZOOM });
  }, [focusKey]);

  // The shown route: the map frames the whole day once when it arrives for a driver (its key), never on the merges that
  // grow it, and never pulls the map back during playback.
  const route = layers.route;
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeKey = route?.key ?? null;
  useEffect(() => {
    const r = routeRef.current;
    if (!r) return;
    const f = r.frame;
    if (f.kind === 'box') move({ bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: DRIVERS_PADDING });
    else if (f.kind === 'point') move({ center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM });
  }, [routeKey]);

  // The sources, made once per route or set of trails (the playback marker re-renders the map several times a second).
  const trailData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: layers.trails.map((tr) => line(tr.points, { color: tr.color })),
  }), [layers.trails]);
  const trailHoleData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: layers.trails.flatMap((tr) => tr.holes.map((h) => holeLine(h, tr.color))),
  }), [layers.trails]);
  const runData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (route?.runs ?? []).map((r) => line(r.points, { color: r.color })),
  }), [route]);
  const holeData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (route?.holes ?? []).map((h) => holeLine(h, HOLE_COLOR)),
  }), [route]);
  const estimatedData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (route?.estimated ?? []).map((e) => line(e.points, { color: ESTIMATED_COLOR })),
  }), [route]);
  // Round 50 (§37.5): a web trip's actions joined by a straight dashed line (no live route).
  const webData = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (route?.web ?? []).map((w) => line(w.points, { color: WEB_TRIP_COLOR })),
  }), [route]);
  // The marker whose card is open (a stop's or a gap's key): its label shown, never clustered.
  const [openStop, setOpenStop] = useState<string | null>(null);
  useEffect(() => setOpenStop(null), [routeKey]);
  // The zoom the map last reported (null until it does): the cluster helper's input (the cluster's steps use zoomNow).
  const [zoom, setZoom] = useState<number | null>(null);
  const show = layers.show;
  const gaps = useMemo(() => visibleGaps(route?.gaps ?? [], show, openStop), [route, show, openStop]);
  const points = useMemo(() => routeMarkerPoints(route?.ends ?? null, route?.stops ?? [], route?.gaps ?? [], show, openStop), [route, show, openStop]);
  const grouped = useMemo(() => clusterMarkers(points, zoom), [points, zoom]);
  const single = new Set(grouped.singles.map((m) => m.key));
  const ends = route?.ends ?? null;
  const zoomInto = (c: LatLng) => move({ center: [c.lng, c.lat], zoom: clusterZoom(zoom) });

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    move({ bearing: 0, pitch: 0 });
  };

  // The cluster: one command per tap (its nonce); the zoom steps from the zoom the map last reported.
  const zoomNow = useRef(6.4);
  const latest = useRef({ markers, route: layers.route });
  latest.current = { markers, route: layers.route };
  const commandRef = useRef(command);
  commandRef.current = command;
  const commandKey = command?.nonce ?? 0;
  useEffect(() => {
    const c = commandRef.current;
    if (!c) return;
    if (c.kind === 'fit') {
      const f = fitAllFrame(latest.current.markers, latest.current.route?.frame);
      if (f.kind === 'box') move({ bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: DRIVERS_PADDING });
      else if (f.kind === 'point') move({ center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM });
      return;
    }
    const next = zoomStep(zoomNow.current, c.kind);
    zoomNow.current = next;
    try {
      camera.current?.zoomTo(next, { duration: 300 });
    } catch {
      // The map is not up yet.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandKey]);

  const cursor = layers.cursor;
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
          zoomNow.current = e.nativeEvent.zoom;
          setZoom(Number.isFinite(e.nativeEvent.zoom) ? e.nativeEvent.zoom : null);
          setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch));
        }}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {/* Today's trails under everything: each driver's line in its colour, its holes dashed in the same colour. */}
        <GeoJSONSource id="live-trails" data={trailData}>
          <Layer id="live-trails-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 }} />
        </GeoJSONSource>
        <GeoJSONSource id="live-trail-holes" data={trailHoleData}>
          <Layer id="live-trail-holes-line" type="line" layout={{ 'line-cap': 'round' }}
            paint={{ 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [2, 2.5] }} />
        </GeoJSONSource>
        {/* The shown route: the holes and the estimated roads dashed under the runs by speed. */}
        <GeoJSONSource id="live-route-holes" data={holeData}>
          <Layer id="live-route-holes-line" type="line" layout={{ 'line-cap': 'round' }}
            paint={{ 'line-color': HOLE_COLOR, 'line-width': 3, 'line-dasharray': [2, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="live-route-estimated" data={estimatedData}>
          <Layer id="live-route-estimated-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ESTIMATED_COLOR, 'line-width': 3.5, 'line-dasharray': [1, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="live-route-web" data={webData}>
          <Layer id="live-route-web-line" type="line" layout={{ 'line-cap': 'round' }}
            paint={{ 'line-color': WEB_TRIP_COLOR, 'line-width': 3, 'line-dasharray': [2.5, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="live-route" data={runData}>
          <Layer id="live-route-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': ['get', 'color'], 'line-width': 5 }} />
        </GeoJSONSource>
        {/* The route's ends: the start's flag and the end's square (unless clustered). */}
        {ends && single.has('start') && (
          <Marker id="live-route-start" lngLat={[ends.start.lng, ends.start.lat]} anchor="center">
            <Pressable accessibilityRole="image" accessibilityLabel={endLine(ends.start, t)}><RouteEndPin end={ends.start} /></Pressable>
          </Marker>
        )}
        {ends?.end && single.has('end') && (
          <Marker id="live-route-end" lngLat={[ends.end.lng, ends.end.lat]} anchor="center">
            <Pressable accessibilityRole="image" accessibilityLabel={endLine(ends.end, t)}><RouteEndPin end={ends.end} /></Pressable>
          </Marker>
        )}
        {/* The stops: a circle each, its centre on the position whatever the label's height; a tap opens its times. */}
        {(route?.stops ?? []).filter((s) => single.has(s.key) || s.key === openStop).map((s) => {
          const open = openStop === s.key;
          const labelled = open || show.stopTimes;
          return (
            <Marker
              key={s.key}
              id={`live-stop-${s.key}`}
              lngLat={[s.lng, s.lat]}
              anchor="bottom"
              offset={[0, STOP_PIN.size / 2]}
              onPress={() => setOpenStop((o) => (o === s.key ? null : s.key))}
            >
              <pins.Stop stop={s} open={open} labelled={labelled} />
            </Marker>
          );
        })}
        {/* The gaps (the Layers filter, or the one open): where the signal went; a tap opens its words. */}
        {gaps.filter((g) => single.has(g.key) || g.key === openStop).map((g) => (
          <Marker key={g.key} id={`live-gap-${g.key}`} lngLat={[g.lng, g.lat]} anchor="center" onPress={() => setOpenStop((o) => (o === g.key ? null : g.key))}>
            <Pressable accessibilityRole="button" accessibilityLabel={gapLine(g, t)} onPress={() => setOpenStop((o) => (o === g.key ? null : g.key))} hitSlop={8}>
              <GapPin gap={g} open={openStop === g.key} />
            </Pressable>
          </Marker>
        ))}
        {grouped.clusters.map((c) => (
          // Google Maps' marker clustering: one numbered circle; a tap zooms in two steps so its markers come apart.
          <Marker key={c.key} id={`live-${c.key}`} lngLat={[c.lng, c.lat]} anchor="center">
            <Pressable accessibilityRole="button" accessibilityLabel={t('dayRoute.cluster', { n: c.count })} onPress={() => zoomInto(c)} testID="live-cluster">
              <ClusterPin count={c.count} />
            </Pressable>
          </Marker>
        ))}
        {markers.map((m) => (
          // The ring's centre on the position whatever the label's height: anchored at the bottom, moved down by half a ring.
          <Marker
            key={`${m.username}:${m.tone}:${m.dim}:${m.selected}:${m.label ?? ''}:${m.initials}`}
            id={`driver-${m.username}`}
            lngLat={[m.lng, m.lat]}
            anchor="bottom"
            offset={[0, DRIVER_PIN.size / 2]}
            onPress={() => onPressMarker(m.username)}
          >
            <DriverPin marker={m} />
          </Marker>
        ))}
        {cursor && (
          <Marker id="live-cursor" lngLat={[cursor.lng, cursor.lat]} anchor="bottom" offset={[0, STOP_PIN.size / 2]}>
            <pins.Cursor cursor={cursor} />
          </Marker>
        )}
      </Map>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}

function line(points: readonly LatLng[], properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } };
}

function holeLine(h: HoleLine, color: string): GeoJSON.Feature {
  return line([h.from, h.to], { color });
}
