// The Live tab's drivers map in the mobile website (Phase 8, O4): the phones' DriversMap.tsx drawn by the browser's engines
// (components/web: Google's map under the google package, its load counted by register_map_load; else the free map,
// MapLibre with OpenFreeMap's tiles). Driver positions are ours (no Google content, rule 10), so both engines draw the
// same: one marker per driver (the initials in a ring coloured by duty, the selected one labelled), the frame around them
// all, the move to a selected driver, and the route layers (office/liveRouteLogic.ts): today's trails, the shown route by
// speed with its holes and estimated roads, its stops that open their times on a tap, the playback marker. The one control
// cluster down the right side (no zoom buttons since 20 October 2026: pinch and the wheel zoom; the screen's own controls,
// then fit everyone) under the compass the free map shows while it is turned (a tap turns north); shown only while a map
// is mounted, never over "Map not available". Round 48 (item 3): the shown route's start and end pins, its gap markers
// while the Filter sheet's Layers say so, every stop's time when asked, and overlapping route markers as one numbered
// circle (lib/cluster.ts, from the zoom the engine reports; a tap zooms in two steps), as on the phones.

import Maximize from 'lucide-react-native/icons/maximize';
import type { LucideIcon } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { clusterMarkers, clusterZoom } from '@/lib/cluster';
import type { MapPackage } from '@/lib/mapEngine';
import { endLine, gapLine } from '@/office/driversLogic';
import { fitAllFrame, type MapCommand } from '@/office/liveLogic';
import { creditWithOrs, ESTIMATED_COLOR, HOLE_COLOR, type LiveLayers, NO_LAYERS, STOP_PIN } from '@/office/liveRouteLogic';
import { routeMarkerPoints, visibleGaps } from '@/office/routeMarks';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { MapCompass } from './MapCompass';
import { DRIVER_PIN, DRIVER_ZOOM, DriverPin, DRIVERS_PADDING, type DriversEngineProps, nextTurn, ONE_PLACE_ZOOM, type Turn } from './mapPins';
import { mapCredit } from './taskMapLogic';
import type { MapAdapter } from './web/adapters';
import { BrowserMap, CreditLine, MapLines, MapMarker, UnavailableCard, useMapMount } from './web/BrowserMap';
import { cameraFor, DASH } from './web/browserMapLogic';
import { ClusterPin, CursorPin, GapPin, RouteEndPin, StopDot } from './web/pins';

type Props = Omit<DriversEngineProps, 'onLoaded' | 'onFailed'> & {
  mapPackage?: MapPackage;
  layers?: LiveLayers;
  controls?: ReactNode;
};

export function DriversMap({ markers, fit, focus, onPressMarker, mapPackage, layers = NO_LAYERS, controls }: Props) {
  const { t } = useApp();
  const mapMount = useMapMount(mapPackage);
  const { mount, dispatch } = mapMount;
  const [map, setMap] = useState<MapAdapter | null>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const [command, setCommand] = useState<MapCommand | null>(null);
  const tap = (kind: MapCommand['kind']) => setCommand((c) => ({ kind, nonce: (c?.nonce ?? 0) + 1 }));

  // Everyone: when the map is made, when the set of drivers with a position changes (fit.key), and when the selection is
  // cleared; never while a driver is selected, never on a refresh that only moved them.
  const focused = focus !== null;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (!map || focused) return;
    map.show(cameraFor(fitRef.current.frame, ONE_PLACE_ZOOM), DRIVERS_PADDING);
  }, [map, fit.key, focused]);

  // The selected driver: the map moves to them once per selection (the same row tapped again: nonce).
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus ? `${focus.username}:${focus.nonce}` : null;
  useEffect(() => {
    const f = focusRef.current;
    if (!map || !f) return;
    map.show({ kind: 'center', center: f, zoom: DRIVER_ZOOM }, DRIVERS_PADDING);
  }, [map, focusKey]);

  // The shown route: framed once when it arrives for a driver (its key), never on the merges that grow it.
  const route = layers.route;
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeKey = route?.key ?? null;
  useEffect(() => {
    const r = routeRef.current;
    if (!map || !r) return;
    map.show(cameraFor(r.frame, ONE_PLACE_ZOOM), DRIVERS_PADDING);
  }, [map, routeKey]);

  // The cluster: one command per tap (its nonce), on the camera as it is now.
  const latest = useRef({ markers, route });
  latest.current = { markers, route };
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(() => {
    const c = commandRef.current;
    if (!map || !c) return;
    if (c.kind === 'fit') map.show(cameraFor(fitAllFrame(latest.current.markers, latest.current.route?.frame), ONE_PLACE_ZOOM), DRIVERS_PADDING);
    else map.zoomBy(c.kind);
  }, [map, command?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // The marker whose card is open (a stop's or a gap's key): its label shown, never clustered.
  const [openStop, setOpenStop] = useState<string | null>(null);
  useEffect(() => setOpenStop(null), [routeKey]);
  // The zoom the engine last reported (null until it does): the cluster helper's input.
  const [zoom, setZoom] = useState<number | null>(null);
  const show = layers.show;
  const gaps = useMemo(() => visibleGaps(route?.gaps ?? [], show, openStop), [route, show, openStop]);
  const points = useMemo(() => routeMarkerPoints(route?.ends ?? null, route?.stops ?? [], route?.gaps ?? [], show, openStop), [route, show, openStop]);
  const grouped = useMemo(() => clusterMarkers(points, zoom), [points, zoom]);
  const single = new Set(grouped.singles.map((m) => m.key));
  const ends = route?.ends ?? null;
  const zoomInto = (c: { lat: number; lng: number }) => map?.show({ kind: 'center', center: c, zoom: clusterZoom(zoom) }, DRIVERS_PADDING);

  // The lines, made once per route or set of trails (the playback marker re-renders the map several times a second).
  const trails = useMemo(() => layers.trails.map((tr) => ({ points: tr.points, color: tr.color, width: 3, opacity: 0.85 })), [layers.trails]);
  const trailHoles = useMemo(() => layers.trails.flatMap((tr) => tr.holes.map((h) => ({ points: [h.from, h.to], color: tr.color, width: 2, opacity: 0.85, dash: DASH.trailHole }))), [layers.trails]);
  const holes = useMemo(() => (route?.holes ?? []).map((h) => ({ points: [h.from, h.to], color: HOLE_COLOR, width: 3, dash: DASH.hole })), [route]);
  const estimated = useMemo(() => (route?.estimated ?? []).map((e) => ({ points: e.points, color: ESTIMATED_COLOR, width: 3.5, dash: DASH.estimated })), [route]);
  const runs = useMemo(() => (route?.runs ?? []).map((r) => ({ points: r.points, color: r.color, width: 5 })), [route]);

  if (mount.status === 'unavailable') {
    return <UnavailableCard body={t('office.live.mapUnavailableBody')} onRetry={() => dispatch({ type: 'retry' })} testID="drivers-map-unavailable" />;
  }

  // An estimated road drawn (openrouteservice's) adds its credit to the map's own.
  const google = mount.engine === 'google';
  const credit = creditWithOrs(mapCredit(google, []), google, (route?.estimated.length ?? 0) > 0);
  const cursor = layers.cursor;
  return (
    <View style={StyleSheet.absoluteFill}>
      <BrowserMap
        mapMount={mapMount}
        start={cameraFor(fit.frame, ONE_PLACE_ZOOM)}
        padding={DRIVERS_PADDING}
        onAdapter={setMap}
        events={{ moved: (_c, z) => setZoom(Number.isFinite(z) ? z : null), turned: (h, p) => setTurn((prev) => nextTurn(prev, h, p)) }}
      >
        {/* Today's trails under everything; the shown route's holes and estimated roads under its runs by speed. */}
        <MapLines group="live-trails" z={1} lines={trails} />
        <MapLines group="live-trail-holes" z={1} lines={trailHoles} />
        <MapLines group="live-route-holes" z={2} lines={holes} />
        <MapLines group="live-route-estimated" z={2} lines={estimated} />
        <MapLines group="live-route" z={3} lines={runs} />
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
        {(route?.stops ?? []).filter((s) => single.has(s.key) || s.key === openStop).map((s) => {
          const open = openStop === s.key;
          const labelled = open || show.stopTimes;
          // The circle's centre on the position whatever the label's height: anchored at the bottom, moved down by half a circle.
          return (
            <MapMarker key={s.key} at={s} anchor="bottom" offsetY={STOP_PIN.size / 2} z={open ? 5 : 4} onPress={() => setOpenStop((o) => (o === s.key ? null : s.key))}>
              <StopDot stop={s} open={open} labelled={labelled} />
            </MapMarker>
          );
        })}
        {gaps.filter((g) => single.has(g.key) || g.key === openStop).map((g) => (
          <MapMarker key={g.key} at={g} anchor="center" z={openStop === g.key ? 5 : 4} onPress={() => setOpenStop((o) => (o === g.key ? null : g.key))}>
            <View accessibilityLabel={gapLine(g, t)}><GapPin gap={g} open={openStop === g.key} /></View>
          </MapMarker>
        ))}
        {grouped.clusters.map((c) => (
          // Google Maps' marker clustering: one numbered circle; a tap zooms in two steps so its markers come apart.
          <MapMarker key={c.key} at={c} anchor="center" z={5} onPress={() => zoomInto(c)}>
            <View accessibilityLabel={t('dayRoute.cluster', { n: c.count })} testID="live-cluster"><ClusterPin count={c.count} /></View>
          </MapMarker>
        ))}
        {markers.map((m) => (
          <MapMarker key={m.username} at={m} anchor="bottom" offsetY={DRIVER_PIN.size / 2}
            z={m.selected ? 9 : m.tone === 'blue' ? 8 : m.tone === 'green' ? 7 : 6} onPress={() => onPressMarker(m.username)}>
            <DriverPin marker={m} />
          </MapMarker>
        ))}
        {cursor && (
          <MapMarker at={cursor} anchor="bottom" offsetY={STOP_PIN.size / 2} z={10}>
            <CursorPin cursor={cursor} />
          </MapMarker>
        )}
      </BrowserMap>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={() => map?.northUp()} style={{ top: 12, right: 12 }} />
      <View style={styles.cluster} pointerEvents="box-none" testID="drivers-map-controls">
        {controls}
        <MapButton icon={Maximize} label={t('office.live.fitAll')} onPress={() => tap('fit')} testID="map-fit" />
      </View>
      <CreditLine text={credit} testID="drivers-map-credit" />
    </View>
  );
}

/** One button of the cluster: 48 px, white, the icon in ink. */
function MapButton({ icon: Icon, label, onPress, testID }: { icon: LucideIcon; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={({ pressed }) => [styles.mapButton, pressed && { opacity: 0.8 }]}>
      <Icon size={22} color={colors.ink} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cluster: { position: 'absolute', top: 68, right: 12, alignItems: 'flex-end', gap: 8 },
  mapButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' },
});
