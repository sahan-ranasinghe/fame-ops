// Google's map for a driver's day (RouteMap.tsx; Office mode, Phase 8 O2): react-native-maps with PROVIDER_GOOGLE, as
// GoogleDriversMap.tsx (the Maps SDK for Android, free on a phone; no map id). One polyline per leg of the day's line in
// its speed band's colour (the holes and the estimated roads dashed), a dot per stop over 10 minutes, the
// frame around the day, and the move to a tapped stop. It says when it has finished loading (onMapLoaded), which
// a refused key, billing, authorisation or Google Play services problem never does (lib/mapEngine.ts).
// Round 48 (item 3, Google Maps Timeline; Google Maps' marker clustering): the start and end pins, the gap markers the
// Layers filter shows, the stop's time when tapped or asked for, and the markers that would overlap as one numbered circle
// (lib/cluster.ts, from the camera's zoom read after each move; a tap zooms in two steps). The SDK draws every marker
// above every polyline (no z-index crosses the two), so the dots are small and the line reads through.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { useMapScheme } from '@/lib/appTheme';
import { clusterMarkers, clusterZoom } from '@/lib/cluster';
import { BAND_COLORS, endLine, gapLine } from '@/office/driversLogic';
import { routeMarkerPoints } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import { lineWidth, PlaybackPin, ROUTE_DEFAULTS, ROUTE_PADDING, ROUTE_ZOOM, type RouteEngineProps } from './RouteMap';
import { ClusterPin, GapPin, RouteEndPin, RouteStopDot, stopDotAnchorY } from './routePins';
import type { Frame, LatLng } from './taskMapLogic';

export function GoogleRouteMap({ lines, stops, fit, focus, marker, onStop, onGap, onLoaded, ends = ROUTE_DEFAULTS.ends, gaps = ROUTE_DEFAULTS.gaps, layers = ROUTE_DEFAULTS.layers, selected = ROUTE_DEFAULTS.selected }: RouteEngineProps) {
  const { t } = useApp();
  const scheme = useMapScheme();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  // The camera's zoom after each move (null until the map says): the cluster helper's input.
  const [zoom, setZoom] = useState<number | null>(null);

  const show = (f: Frame, zoomTo: number) => {
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: ROUTE_PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: zoomTo, heading: 0, pitch: 0 }, { duration: 600 });
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

  const readCamera = () => {
    map.current?.getCamera()
      .then((c) => {
        setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0));
        setZoom(typeof c.zoom === 'number' && Number.isFinite(c.zoom) ? c.zoom : null);
      })
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  const drawn = useMemo(() => lines.map((l) => ({ ...l, coords: l.points.map(at) })), [lines]);

  // The markers at this zoom: the clusters, and the singles by what they are (the selected one is never clustered).
  const points = useMemo(() => routeMarkerPoints(ends, stops, gaps, layers, selected), [ends, stops, gaps, layers, selected]);
  const grouped = useMemo(() => clusterMarkers(points, zoom), [points, zoom]);
  const single = new Set(grouped.singles.map((m) => m.key));
  const shownStops = stops.filter((s) => single.has(s.key) || s.key === selected);
  const shownGaps = gaps.filter((g) => single.has(g.key) || g.key === selected);
  const zoomInto = (c: LatLng) => map.current?.animateCamera({ center: at(c), zoom: clusterZoom(zoom) }, { duration: 500 });

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
        onRegionChangeComplete={readCamera}
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
        {/* The ends: the start's flag, the end's square (a marker's picture is taken once: the time is in the key). */}
        {ends && single.has('start') && (
          <GoogleMarker key={`start:${ends.start.time}`} coordinate={at(ends.start)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5} accessibilityLabel={endLine(ends.start, t)}>
            <RouteEndPin end={ends.start} />
          </GoogleMarker>
        )}
        {ends?.end && single.has('end') && (
          <GoogleMarker key={`end:${ends.end.time}`} coordinate={at(ends.end)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5} accessibilityLabel={endLine(ends.end, t)}>
            <RouteEndPin end={ends.end} />
          </GoogleMarker>
        )}
        {shownStops.map((s) => {
          const open = s.key === selected;
          const labelled = open || layers.stopTimes;
          return (
            // §33.6 item 1: a tap says where and how long (the screen's card) and moves the map to it.
            <GoogleMarker key={`${s.key}:${s.time}:${labelled}:${open}`} coordinate={at(s)} anchor={{ x: 0.5, y: stopDotAnchorY(labelled) }} tracksViewChanges={false} zIndex={open ? 6 : 4}
              onPress={onStop ? () => onStop(s.key) : undefined} accessibilityLabel={s.label}>
              <RouteStopDot time={s.time} labelled={labelled} open={open} />
            </GoogleMarker>
          );
        })}
        {shownGaps.map((g) => {
          const open = g.key === selected;
          return (
            <GoogleMarker key={`${g.key}:${open}`} coordinate={at(g)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={open ? 6 : 4}
              onPress={onGap ? () => onGap(g.key) : undefined} accessibilityLabel={gapLine(g, t)}>
              <GapPin gap={g} open={open} />
            </GoogleMarker>
          );
        })}
        {grouped.clusters.map((c) => (
          // Google Maps' marker clustering: one numbered circle; a tap zooms in two steps so its markers come apart.
          <GoogleMarker key={`${c.key}:${c.count}`} coordinate={at(c)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={6}
            onPress={() => zoomInto(c)} accessibilityLabel={t('dayRoute.cluster', { n: c.count })}>
            <ClusterPin count={c.count} />
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
