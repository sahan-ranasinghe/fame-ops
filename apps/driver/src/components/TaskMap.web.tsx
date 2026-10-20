// The task map in the mobile website (Phase 8, O4): the phones' TaskMap.tsx drawn by the browser's engines
// (components/web: Google's Maps JavaScript API under the google package, its load counted by register_map_load; else the
// free map, MapLibre GL JS with OpenFreeMap's tiles). The same content from the same rules (taskMapLogic.ts): the stops
// numbered with their time, the line, where the trip starts, the phone and Follow me when a position is given. Google's
// content (rule 10, lib/mapRule.ts) only on Google's map: on the free map dashed straight lines join the stops it draws
// and a line says a Google place opens in Navigate. Neither map: "Map not available" with the stops (MapUnavailable.tsx).
// Office mode never reports the map's outcome (report_map_state is the driver's): the `report` prop is ignored here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import type { Engine, MapPackage } from '@/lib/mapEngine';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { FollowButton, MapCompass } from './MapCompass';
import { MapUnavailable } from './MapUnavailable';
import { type Fit, FOLLOW_ZOOM, mapStyles, MePin, nextTurn, ONE_PLACE_ZOOM, PADDING, SHEET_OVERLAP, StartPin, StopPin, type Turn } from './mapPins';
import { currentStop, fitKey, frameOf, mapCredit, mapLines, mapStops, type LatLng, startPoint } from './taskMapLogic';
import type { MapAdapter } from './web/adapters';
import { BrowserMap, MapLines, MapMarker, useBrowserEngine, useMapMount } from './web/BrowserMap';
import { cameraFor, DASH } from './web/browserMapLogic';

/** The browser always can show Google's map (the key comes from the server, counted): the package decides. */
export const GOOGLE_MAP_BUILD = true;

/** The engine this tab asks for (the office's package, Google's failure in this tab). */
export function useMapEngine(mapPackage?: MapPackage): Engine {
  return useBrowserEngine(mapPackage);
}

interface Props {
  task: TaskWithStops;
  me: LatLng | null;
  googleNoteFor: 'current' | 'any';
  report?: boolean;
  mapPackage?: MapPackage;
}

const FRAME_PADDING = { ...PADDING, bottom: PADDING.bottom + SHEET_OVERLAP };

export function TaskMap({ task, me, googleNoteFor, mapPackage }: Props) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const mapMount = useMapMount(mapPackage);
  const { mount, dispatch } = mapMount;

  // What is drawn follows the engine mounted: Google's content never reaches the free map, even for one render (rule 10).
  const google = mount.engine === 'google';
  const stops = useMemo(() => mapStops(task, google), [task, google]);
  const start = useMemo(() => startPoint(task, google), [task, google]);
  const lines = useMemo(() => mapLines(task, google, stops, start), [task, google, stops, start]);

  const [firstMe, setFirstMe] = useState<LatLng | null>(null);
  const latestMe = useRef<LatLng | null>(null);
  useEffect(() => {
    if (!me) return;
    latestMe.current = me;
    setFirstMe((had) => had ?? me);
  }, [me]);
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;

  const key = fitKey(stops, lines, start, firstMe !== null);
  const fit = useMemo((): Fit => {
    const mine = latestMe.current ?? firstMe;
    const points: LatLng[] = [...stops, ...lines.flatMap((l) => l.points), ...(start ? [start] : []), ...(mine ? [mine] : [])];
    return { key, frame: frameOf(points) };
    // Only the key decides when the map frames again (see fitKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [map, setMap] = useState<MapAdapter | null>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

  // The frame: when the map is made and when the key changes, never while Follow me is on.
  useEffect(() => {
    if (!map || followRef.current) return;
    map.show(cameraFor(fit.frame, ONE_PLACE_ZOOM), FRAME_PADDING);
  }, [map, fit]);

  // Follow me: to the phone at a street's zoom when turned on, then the middle follows each new position.
  const followedOnce = useRef(false);
  useEffect(() => {
    if (!map || !follow || !me) {
      if (!follow) followedOnce.current = false;
      return;
    }
    if (followedOnce.current) map.panTo(me);
    else map.show({ kind: 'center', center: me, zoom: FOLLOW_ZOOM }, FRAME_PADDING);
    followedOnce.current = true;
  }, [map, follow, me]);

  // Driven legs first, so the line still to drive lies on top where they meet.
  const done = useMemo(() => lines.filter((l) => l.done).map((l) => ({ points: l.points, color: colors.muted, width: 4, dash: l.dashed ? DASH.task : null })), [lines]);
  const todo = useMemo(() => lines.filter((l) => !l.done).map((l) => ({ points: l.points, color: colors.blue, width: l.dashed ? 4 : 6, dash: l.dashed ? DASH.task : null })), [lines]);

  if (mount.status === 'unavailable') {
    return <MapUnavailable task={task} me={me} onRetry={() => dispatch({ type: 'retry' })} />;
  }

  const credit = mapCredit(google, lines);
  const hiddenGoogle = !google && (googleNoteFor === 'current'
    ? !!currentStop(task)?.google_place_id
    : task.task_stops.some((s) => s.status !== 'removed' && !!s.google_place_id));
  return (
    <>
      <BrowserMap
        mapMount={mapMount}
        start={cameraFor(fit.frame, ONE_PLACE_ZOOM)}
        padding={FRAME_PADDING}
        onAdapter={setMap}
        events={{
          userMove: () => { if (followRef.current) setFollow(false); },
          turned: (h, p) => setTurn((prev) => nextTurn(prev, h, p)),
        }}
      >
        <MapLines group="task-done" z={1} lines={done} />
        <MapLines group="task-todo" z={2} lines={todo} />
        {start && (
          <MapMarker at={start} anchor="center" z={3}>
            <StartPin />
          </MapMarker>
        )}
        {stops.map((s) => (
          <MapMarker key={s.id} at={s} anchor="bottom" z={s.state === 'current' ? 6 : s.state === 'todo' ? 5 : 4}>
            <StopPin stop={s} />
          </MapMarker>
        ))}
        {me && (
          <MapMarker at={me} anchor="center" z={7}>
            <MePin />
          </MapMarker>
        )}
      </BrowserMap>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={() => map?.northUp()} style={{ top: insets.top + 68, right: 16 }} />
      {me && (
        <FollowButton on={follow} label={t('map.followMe')} onPress={() => setFollow((on) => !on)} style={{ top: insets.top + 124, right: 16 }} />
      )}
      <View style={mapStyles.mapBottom} pointerEvents="none">
        {hiddenGoogle ? (
          <View style={mapStyles.mapNote}>
            <Txt variant="strong" size={14} color="#ffffff">{t('task.googleNotOnMap')}</Txt>
          </View>
        ) : null}
        {/* The providers' credits, in their own words (never translated, as Google's own). */}
        {credit ? <Text style={mapStyles.credit} accessibilityLanguage="en" testID="map-credit">{credit}</Text> : null}
      </View>
    </>
  );
}
