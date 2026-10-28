// A driver's day on the map in the mobile website (Phase 8, O4): the phones' RouteMap.tsx drawn by the browser's engines
// (components/web: Google's map under the google package, its load counted; else the free map, MapLibre with OpenFreeMap).
// The same content on both (the positions are ours, rule 10): the day's line coloured by speed band, the holes dashed grey,
// the estimated roads dashed slate (openrouteservice's: its credit shows), the stops over 10 minutes as dots (a tap says
// where and how long: §33.6 item 1), the playback marker, the frame around the day and the move to a tapped stop. Neither
// map: "Map not available" with Try again; the day's numbers keep working.
// Round 48 (item 3, Google Maps Timeline; Google Maps' marker clustering): the start and end pins, the gap markers the
// Layers filter shows, the stop's time when tapped or asked for, and overlapping markers as one numbered circle
// (lib/cluster.ts, from the zoom the engine reports after each move; a tap zooms in two steps). The wheel over the map
// zooms the map (MapLibre's scrollZoom, Google's greedy gestures), never the page: the map is outside the page's scroll.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { clusterMarkers, clusterZoom } from '@/lib/cluster';
import type { Engine, MapPackage } from '@/lib/mapEngine';
import { NO_ROUTE_LAYERS, type RouteLayers } from '@/lib/mapLayout';
import { BAND_COLORS, endLine, gapLine, type RouteFit, type RouteLine, type StopMark } from '@/office/driversLogic';
import { type EndMarks, type GapMark, routeMarkerPoints } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, type Turn } from './mapPins';
import { type Frame, ORS_CREDIT, OSM_CREDIT } from './taskMapLogic';
import type { MapAdapter } from './web/adapters';
import { BrowserMap, CreditLine, MapLines, MapMarker, UnavailableCard, useBrowserEngine, useMapMount } from './web/BrowserMap';
import { cameraFor, DASH } from './web/browserMapLogic';
import { ClusterPin, GapPin, type PlaybackMarker, PlaybackPin, ROUTE_DOT, RouteEndPin, RouteStopDot } from './web/pins';

export type { PlaybackMarker };

/** Room around the day when the map frames it. */
export const ROUTE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };
/** The zoom for one place (a stop, a short row). */
export const ROUTE_ZOOM = 15;

/** A stop pin tapped (§33.6 item 1; a timeline row before): the map moves to it once per tap (`nonce`). */
export interface RouteFocus {
  frame: Frame;
  nonce: number;
}

/** The line's width by what it is: the day's line 5, standing and the dashed legs 3. */
export function lineWidth(l: Pick<RouteLine, 'band'>): number {
  return l.band === 'standing' || l.band === 'gap' || l.band === 'estimated' ? 3 : 5;
}

/** The credits a map owes under it (never translated): the free map's tiles, and openrouteservice's when an estimated road is drawn. */
export function routeCredit(googleMap: boolean, lines: readonly Pick<RouteLine, 'band'>[]): string | null {
  const parts = [googleMap ? null : OSM_CREDIT, lines.some((l) => l.band === 'estimated') ? ORS_CREDIT : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The engine this tab asks for (the office's package, Google's failure in this tab). */
export function useRouteMapEngine(mapPackage: MapPackage | undefined): Engine {
  return useBrowserEngine(mapPackage);
}

interface Props {
  lines: RouteLine[];
  stops: StopMark[];
  fit: RouteFit;
  focus: RouteFocus | null;
  marker?: PlaybackMarker | null;
  /** §33.6 item 1: a stop pin tapped (its key). */
  onStop?: (key: string) => void;
  mapPackage?: MapPackage;
  /** Round 48: the start and end pins, the gap markers to draw, the Layers choices, the marker whose card is open, a gap tapped. */
  ends?: EndMarks | null;
  gaps?: GapMark[];
  layers?: RouteLayers;
  selected?: string | null;
  onGap?: (key: string) => void;
}

export function RouteMap({ lines, stops, fit, focus, marker, onStop, mapPackage, ends = null, gaps = [], layers = NO_ROUTE_LAYERS, selected = null, onGap }: Props) {
  const { t } = useApp();
  const mapMount = useMapMount(mapPackage);
  const { mount, dispatch } = mapMount;
  const [map, setMap] = useState<MapAdapter | null>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  // The zoom the engine last reported (null until it does): the cluster helper's input.
  const [zoom, setZoom] = useState<number | null>(null);

  // The whole day: when the map is made and when the points shown change (fit.key), never while a row is focused; a
  // focus cleared frames the day again.
  const focusedRow = focus !== null;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (!map || focusedRow) return;
    map.show(cameraFor(fitRef.current.frame, ONE_PLACE_ZOOM), ROUTE_PADDING);
  }, [map, fit.key, focusedRow]);

  // A tapped timeline row: once per tap (nonce), never pulled back by a refresh.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const f = focusRef.current;
    if (!map || !f) return;
    map.show(cameraFor(f.frame, ROUTE_ZOOM), ROUTE_PADDING);
  }, [map, focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimated = useMemo(() => lines.filter((l) => l.band === 'estimated').map(spec), [lines]);
  const gapLines = useMemo(() => lines.filter((l) => l.band === 'gap').map(spec), [lines]);
  const day = useMemo(() => lines.filter((l) => l.band !== 'estimated' && l.band !== 'gap').map(spec), [lines]);

  // The markers at this zoom: the clusters, and the singles by what they are (the selected one is never clustered).
  const points = useMemo(() => routeMarkerPoints(ends, stops, gaps, layers, selected), [ends, stops, gaps, layers, selected]);
  const grouped = useMemo(() => clusterMarkers(points, zoom), [points, zoom]);
  const single = new Set(grouped.singles.map((m) => m.key));
  const shownStops = stops.filter((s) => single.has(s.key) || s.key === selected);
  const shownGaps = gaps.filter((g) => single.has(g.key) || g.key === selected);
  const zoomInto = (c: { lat: number; lng: number }) => map?.show({ kind: 'center', center: c, zoom: clusterZoom(zoom) }, ROUTE_PADDING);

  if (mount.status === 'unavailable') {
    return <UnavailableCard body={t('dayRoute.mapUnavailableBody')} onRetry={() => dispatch({ type: 'retry' })} testID="route-map-unavailable" />;
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <BrowserMap
        mapMount={mapMount}
        start={cameraFor(fit.frame, ONE_PLACE_ZOOM)}
        padding={ROUTE_PADDING}
        onAdapter={setMap}
        events={{ moved: (_c, z) => setZoom(Number.isFinite(z) ? z : null), turned: (h, p) => setTurn((prev) => nextTurn(prev, h, p)) }}
      >
        <MapLines group="route-estimated" z={1} lines={estimated} />
        <MapLines group="route-gaps" z={2} lines={gapLines} />
        <MapLines group="route-day" z={3} lines={day} />
        {ends && single.has('start') && (
          <MapMarker at={ends.start} anchor="center" z={5}>
            <View accessibilityLabel={endLine(ends.start, t)}><RouteEndPin end={ends.start} /></View>
          </MapMarker>
        )}
        {ends?.end && single.has('end') && (
          <MapMarker at={ends.end} anchor="center" z={5}>
            <View accessibilityLabel={endLine(ends.end, t)}><RouteEndPin end={ends.end} /></View>
          </MapMarker>
        )}
        {shownStops.map((s) => {
          const open = s.key === selected;
          const labelled = open || layers.stopTimes;
          // The dot's centre on the position whatever the label: anchored at the bottom, moved down by half a dot.
          // §33.6 item 1: a tap says where and how long (the screen's card) and moves the map to it.
          return (
            <MapMarker key={`${s.key}:${s.time}`} at={s} anchor="bottom" offsetY={ROUTE_DOT.size / 2} z={open ? 6 : 4} onPress={onStop ? () => onStop(s.key) : undefined}>
              <View accessibilityLabel={s.label}><RouteStopDot time={s.time} labelled={labelled} open={open} /></View>
            </MapMarker>
          );
        })}
        {shownGaps.map((g) => (
          <MapMarker key={g.key} at={g} anchor="center" z={g.key === selected ? 6 : 4} onPress={onGap ? () => onGap(g.key) : undefined}>
            <View accessibilityLabel={gapLine(g, t)}><GapPin gap={g} open={g.key === selected} /></View>
          </MapMarker>
        ))}
        {grouped.clusters.map((c) => (
          // Google Maps' marker clustering: one numbered circle; a tap zooms in two steps so its markers come apart.
          <MapMarker key={c.key} at={c} anchor="center" z={6} onPress={() => zoomInto(c)}>
            <View accessibilityLabel={t('dayRoute.cluster', { n: c.count })} testID="route-cluster"><ClusterPin count={c.count} /></View>
          </MapMarker>
        ))}
        {marker ? (
          // The playback marker: turned to the path, less the map's own turn.
          <MapMarker at={marker} anchor="center" z={9}>
            <PlaybackPin marker={{ ...marker, heading: marker.heading == null ? null : marker.heading - turn.heading }} />
          </MapMarker>
        ) : null}
      </BrowserMap>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={() => map?.northUp()} style={{ top: 12, right: 12 }} />
      <CreditLine text={routeCredit(mount.engine === 'google', lines)} testID="route-map-credit" />
    </View>
  );
}

function spec(l: RouteLine) {
  return { points: l.points, color: BAND_COLORS[l.band], width: lineWidth(l), dash: l.dashed ? DASH.route : null };
}
