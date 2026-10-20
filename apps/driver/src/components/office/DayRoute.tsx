// Office mode (Stage 1, O3 item 1): a route on the map with everything under it, one component for a driver's day (the
// driver page, today or a day of the last 90) and a finished task's driven route (task/[id]/route): the map on both engines
// (RouteMap: the line by speed band, holes dashed, the estimated roads, the stops over 10 minutes with their times), the
// legend, the one playback bar (PlaybackBar.tsx, as on Live: Play / Pause, 1× 5× 20× 60×, the time and speed, a slider;
// the marker on the map), the numbers (GPS km, driving, stopped, stops), and the timeline; a row tapped moves the map to
// its span. The rules: office/driversLogic.ts (the line) and office/liveRouteLogic.ts (the playback).

import { useIsFocused } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { RouteMap } from '@/components/RouteMap';
import { Mono, Txt } from '@/components/ui';
import { pickedStyle } from '@/components/patterns/Select';
import { durationText } from '@/lib/durations';
import type { MapPackage } from '@/lib/mapEngine';
import { BAND_COLORS, dayNumbers, routeFrame, routeLines, routePoints, rowFrame, segmentLine, segmentTone, SPEED_BANDS, stopMarks } from '@/office/driversLogic';
import { canPlay, cursorAt, gapWindowsOf, playbackPath, routeOf } from '@/office/liveRouteLogic';
import type { DriverRoute, FleetError } from '@/office/types';
import { Divider, ListFailed } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { PlaybackBar, usePlayback } from './PlaybackBar';

interface Props {
  data: DriverRoute | null;
  error: FleetError | null;
  onRetry: () => void;
  onSignIn: () => void;
  mapPackage?: MapPackage;
  /** The sentence when the route has no points (a day with no driving, a task with no GPS). */
  emptyText: string;
  /** Shown between the numbers and the timeline (the day's tasks). */
  children?: ReactNode;
}

export function DayRoute({ data, error, onRetry, onSignIn, mapPackage, emptyText, children }: Props) {
  const { t } = useApp();
  const points = useMemo(() => (data ? routePoints(data) : []), [data]);
  const lines = useMemo(() => (data ? routeLines(data) : []), [data]);
  const stops = useMemo(() => (data ? stopMarks(data) : []), [data]);
  const fitNow = routeFrame(lines, stops);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fit = useMemo(() => fitNow, [fitNow.key]);
  const [focus, setFocus] = useState<{ frame: ReturnType<typeof rowFrame>; nonce: number; index: number } | null>(null);
  const numbers = data ? dayNumbers(data) : null;

  // The playback (Live's rules, office/liveRouteLogic.ts): the path in time order, the gaps, the marker at the clock.
  const played = useMemo(() => (data ? routeOf(data.driver, data) : null), [data]);
  const path = useMemo(() => (played ? playbackPath(played.points, played.estimated) : []), [played]);
  const windows = useMemo(() => gapWindowsOf(played), [played]);
  const playback = usePlayback(path, useIsFocused());
  const marker = useMemo(() => (playback.active ? cursorAt(played, path, windows, playback.t) : null), [playback.active, playback.t, played, path, windows]);

  return (
    <View>
      <View style={styles.map} testID="driver-route-map">
        <RouteMap lines={lines} stops={stops} fit={fit} focus={focus} marker={marker} mapPackage={mapPackage} />
      </View>
      <View style={styles.legend}>
        {SPEED_BANDS.map((b) => <LegendItem key={b} color={BAND_COLORS[b]} text={t(`office.drivers.route.legend.${b}`)} />)}
        <LegendItem color={BAND_COLORS.gap} text={t('office.drivers.route.legend.gap')} dashed />
        {lines.some((l) => l.band === 'estimated') && <LegendItem color={BAND_COLORS.estimated} text={t('office.drivers.route.legend.estimated')} dashed />}
      </View>
      {!data && !error && <SkeletonRows rows={2} lines={1} />}
      {error && <ListFailed stale={!!data} error={error} onRetry={onRetry} onSignIn={onSignIn} />}
      {canPlay(path) && <View style={styles.bar}><PlaybackBar playback={playback} cursor={marker} /></View>}
      {numbers && (
        <View style={styles.numbers}>
          <Number label={t('office.drivers.route.km')} value={numbers.km === null ? '—' : String(numbers.km)} />
          <Number label={t('office.drivers.route.driving')} value={durationText(t, numbers.drivingMin)} />
          <Number label={t('office.drivers.route.stopped')} value={durationText(t, numbers.stoppedMin)} />
          <Number label={t('office.drivers.route.stops')} value={String(numbers.stops)} />
        </View>
      )}
      {data && points.length === 0 && <ListEmpty text={emptyText} />}
      {data?.km_note && <Txt variant="small">{data.km_note}</Txt>}
      {children}
      {(data?.timeline ?? []).map((seg, i) => {
        const on = focus?.index === i;
        return (
          <View key={`${seg.kind}:${seg.from_at}`}>
            {i > 0 && <Divider />}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFocus({ frame: rowFrame(points, seg), nonce: (focus?.nonce ?? 0) + 1, index: i })}
              style={({ pressed }) => [styles.segRow, on && pickedStyle, pressed && { opacity: 0.8 }]}
              testID="route-row"
            >
              <View style={[styles.segDot, { backgroundColor: toneColor(segmentTone(seg.kind)) }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="strong" size={15} numberOfLines={2}>{seg.text}</Txt>
                <Txt variant="small">{segmentLine(seg, t)}</Txt>
              </View>
            </Pressable>
          </View>
        );
      })}
      {focus && (
        <Pressable accessibilityRole="button" onPress={() => setFocus(null)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('office.history.wholeRoute')}</Txt>
        </Pressable>
      )}
    </View>
  );
}

function toneColor(tone: ReturnType<typeof segmentTone>): string {
  return tone === 'blue' ? colors.blue : tone === 'amber' ? colors.amber : tone === 'red' ? colors.red : '#8d9096';
}

function LegendItem({ color, text, dashed = false }: { color: string; text: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={[{ width: 18, height: 4, borderRadius: 2, backgroundColor: color }, dashed && { height: 0, borderTopWidth: 3, borderStyle: 'dashed', borderColor: color, backgroundColor: 'transparent' }]} />
      <Txt variant="small" size={12}>{text}</Txt>
    </View>
  );
}

function Number({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Mono size={18} bold>{value}</Mono>
      <Txt variant="small" size={12} numberOfLines={1}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 300, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.mapLand, marginTop: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
  bar: { marginBottom: 4 },
  numbers: { flexDirection: 'row', gap: 6, paddingVertical: 8, marginTop: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  // The row shown on the map: the tint and the 2 px border (docs/ui-patterns.md §11; no mark: nothing is being chosen).
  segRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 10, minHeight: 56, borderWidth: 2, borderColor: 'transparent' },
  segDot: { width: 12, height: 12, borderRadius: 6 },
});
