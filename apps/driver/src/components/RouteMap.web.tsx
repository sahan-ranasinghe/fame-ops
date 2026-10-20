// A driver's day on the map in the mobile website (Phase 8, O4): the phones' RouteMap.tsx drawn by the browser's engines
// (components/web: Google's map under the google package, its load counted; else the free map, MapLibre with OpenFreeMap).
// The same content on both (the positions are ours, rule 10): the day's line coloured by speed band, the holes dashed grey,
// the estimated roads dashed slate (openrouteservice's: its credit shows), the stops over 10 minutes with the time they
// began, the playback marker, the frame around the day and the move to one timeline row when it is tapped. Neither map:
// "Map not available" with Try again; the timeline under the map keeps working.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Engine, MapPackage } from '@/lib/mapEngine';
import { BAND_COLORS, type RouteFit, type RouteLine, type StopMark } from '@/office/driversLogic';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { nextTurn, ONE_PLACE_ZOOM, type Turn } from './mapPins';
import { type Frame, ORS_CREDIT, OSM_CREDIT } from './taskMapLogic';
import type { MapAdapter } from './web/adapters';
import { BrowserMap, CreditLine, MapLines, MapMarker, UnavailableCard, useBrowserEngine, useMapMount } from './web/BrowserMap';
import { cameraFor, DASH } from './web/browserMapLogic';
import { type PlaybackMarker, PlaybackPin, ROUTE_PIN, RouteStopPin } from './web/pins';

export type { PlaybackMarker };

/** Room around the day when the map frames it. */
export const ROUTE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };
/** The zoom for one place (a stop, a short row). */
export const ROUTE_ZOOM = 15;

/** A timeline row tapped: the map moves to its span once per tap (`nonce`). */
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
  mapPackage?: MapPackage;
}

export function RouteMap({ lines, stops, fit, focus, marker, mapPackage }: Props) {
  const { t } = useApp();
  const mapMount = useMapMount(mapPackage);
  const { mount, dispatch } = mapMount;
  const [map, setMap] = useState<MapAdapter | null>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

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
  const gaps = useMemo(() => lines.filter((l) => l.band === 'gap').map(spec), [lines]);
  const day = useMemo(() => lines.filter((l) => l.band !== 'estimated' && l.band !== 'gap').map(spec), [lines]);

  if (mount.status === 'unavailable') {
    return <UnavailableCard body={t('office.drivers.route.mapUnavailableBody')} onRetry={() => dispatch({ type: 'retry' })} testID="route-map-unavailable" />;
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <BrowserMap
        mapMount={mapMount}
        start={cameraFor(fit.frame, ONE_PLACE_ZOOM)}
        padding={ROUTE_PADDING}
        onAdapter={setMap}
        events={{ turned: (h, p) => setTurn((prev) => nextTurn(prev, h, p)) }}
      >
        <MapLines group="route-estimated" z={1} lines={estimated} />
        <MapLines group="route-gaps" z={2} lines={gaps} />
        <MapLines group="route-day" z={3} lines={day} />
        {stops.map((s) => (
          // The circle's centre on the position whatever the label: anchored at the top, moved up by half a circle.
          <MapMarker key={`${s.key}:${s.time}`} at={s} anchor="top" offsetY={-ROUTE_PIN.circle / 2} z={5}>
            <RouteStopPin stop={s} />
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
