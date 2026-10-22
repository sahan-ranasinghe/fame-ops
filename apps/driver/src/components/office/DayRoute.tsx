// Office mode (Stage 1, O3 item 1): a route on the map with everything around it, one component for a driver's day (the
// driver page, today or a day of the last 90) and a finished task's driven route (task/[id]/route). §33.6 item 1 (Round
// 4–7, Sahan's decision; Samsara's driver day, Google Maps Timeline): ONE summary card above the map (GPS km, driving,
// stopped, stops, the first and last point, and one line "No GPS for 2 h 10 min" when the day has gaps), then the map on
// both engines (RouteMap: the line by speed band, holes dashed, the estimated roads, the stops over 10 minutes as pins: a
// tap says "Stopped near Kurunegala · 06:56–07:15 · 19 min" and moves the map to it), the legend and the one playback bar
// (PlaybackBar.tsx, as on Live: Play / Pause, 1× 5× 20× 60×, the time and speed, a slider; the marker on the map). The
// day's timeline list is gone (its driving rows are the card's km and driving time, its stops the pins, its gaps the
// card's line and the dashed legs). The rules: office/driversLogic.ts (the line, the pins' words, the summary) and
// office/liveRouteLogic.ts (the playback).

import { useIsFocused } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { MapPin, TriangleAlert, X } from '@/components/icons';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { RouteMap } from '@/components/RouteMap';
import type { Frame } from '@/components/taskMapLogic';
import { Mono, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import type { MapPackage } from '@/lib/mapEngine';
import { BAND_COLORS, dayNumbers, daySummary, noGpsLine, routeFrame, routeLines, routePoints, SPEED_BANDS, stopLine, stopMarks } from '@/office/driversLogic';
import { canPlay, cursorAt, gapWindowsOf, playbackPath, routeOf } from '@/office/liveRouteLogic';
import type { DriverRoute, FleetError } from '@/office/types';
import { ListFailed } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, shadow } from '@/theme';
import { PlaybackBar, usePlayback } from './PlaybackBar';

interface Props {
  data: DriverRoute | null;
  error: FleetError | null;
  onRetry: () => void;
  onSignIn: () => void;
  mapPackage?: MapPackage;
  /** The sentence when the route has no points (a day with no driving, a task with no GPS). */
  emptyText: string;
  /** Shown under the map and the playback (the day's tasks). */
  children?: ReactNode;
}

export function DayRoute({ data, error, onRetry, onSignIn, mapPackage, emptyText, children }: Props) {
  const { t } = useApp();
  const points = useMemo(() => (data ? routePoints(data) : []), [data]);
  const lines = useMemo(() => (data ? routeLines(data) : []), [data]);
  // Each stop with its words (the pin's card, and its name for a screen reader).
  const stops = useMemo(() => (data ? stopMarks(data).map((s) => ({ ...s, label: stopLine(s, t) })) : []), [data, t]);
  const fitNow = routeFrame(lines, stops);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fit = useMemo(() => fitNow, [fitNow.key]);
  // A stop pin tapped: its card on the map, and the map moved to it (what a timeline row did before §33.6).
  const [focus, setFocus] = useState<{ frame: Frame; nonce: number } | null>(null);
  const [stopKey, setStopKey] = useState<string | null>(null);
  const picked = stopKey ? stops.find((s) => s.key === stopKey) ?? null : null;
  const pickStop = (key: string) => {
    const s = stops.find((x) => x.key === key);
    if (!s) return;
    setStopKey(key);
    setFocus((f) => ({ frame: { kind: 'point', center: { lat: s.lat, lng: s.lng } }, nonce: (f?.nonce ?? 0) + 1 }));
  };
  const numbers = data ? dayNumbers(data) : null;
  const summary = data ? daySummary(data) : null;
  const gapsLine = summary ? noGpsLine(summary, t) : null;

  // The playback (Live's rules, office/liveRouteLogic.ts): the path in time order, the gaps, the marker at the clock.
  const played = useMemo(() => (data ? routeOf(data.driver, data) : null), [data]);
  const path = useMemo(() => (played ? playbackPath(played.points, played.estimated) : []), [played]);
  const windows = useMemo(() => gapWindowsOf(played), [played]);
  const playback = usePlayback(path, useIsFocused());
  const marker = useMemo(() => (playback.active ? cursorAt(played, path, windows, playback.t) : null), [playback.active, playback.t, played, path, windows]);

  return (
    <View>
      {/* §33.6 item 1: the day in one card above the map. */}
      {numbers && (
        <View style={styles.summary} testID="day-summary">
          <View style={styles.numbers}>
            <Number label={t('office.drivers.route.km')} value={numbers.km === null ? '—' : String(numbers.km)} />
            <Number label={t('office.drivers.route.driving')} value={durationText(t, numbers.drivingMin)} />
            <Number label={t('office.drivers.route.stopped')} value={durationText(t, numbers.stoppedMin)} />
            <Number label={t('office.drivers.route.stops')} value={String(numbers.stops)} />
          </View>
          {summary?.span && (
            <View style={styles.line}>
              <Txt variant="small" size={13}>{t('dayRoute.firstLast')}</Txt>
              <Mono size={14} bold testID="day-span">{summary.span}</Mono>
            </View>
          )}
          {gapsLine && (
            <View style={styles.line} testID="day-gaps">
              <TriangleAlert size={16} color={colors.amberText} strokeWidth={2.4} />
              <Txt variant="strong" size={14} color={colors.amberText} style={{ flex: 1 }}>{gapsLine}</Txt>
            </View>
          )}
        </View>
      )}
      <View style={styles.map} testID="driver-route-map">
        <RouteMap lines={lines} stops={stops} fit={fit} focus={focus} marker={marker} onStop={pickStop} mapPackage={mapPackage} />
        {picked && (
          <View style={styles.stopCard} testID="stop-card">
            <MapPin size={18} color={colors.ink} strokeWidth={2.4} />
            <Txt variant="strong" size={14} style={{ flex: 1 }}>{picked.label}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setStopKey(null)} hitSlop={8} style={styles.close}>
              <X size={18} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.legend}>
        {SPEED_BANDS.map((b) => <LegendItem key={b} color={BAND_COLORS[b]} text={t(`office.drivers.route.legend.${b}`)} />)}
        <LegendItem color={BAND_COLORS.gap} text={t('office.drivers.route.legend.gap')} dashed />
        {lines.some((l) => l.band === 'estimated') && <LegendItem color={BAND_COLORS.estimated} text={t('office.drivers.route.legend.estimated')} dashed />}
      </View>
      {!data && !error && <SkeletonRows rows={2} lines={1} />}
      {error && <ListFailed stale={!!data} error={error} onRetry={onRetry} onSignIn={onSignIn} />}
      {canPlay(path) && <View style={styles.bar}><PlaybackBar playback={playback} cursor={marker} /></View>}
      {data && points.length === 0 && <ListEmpty text={emptyText} />}
      {data?.km_note && <Txt variant="small">{data.km_note}</Txt>}
      {children}
      {focus && (
        <Pressable accessibilityRole="button" onPress={() => { setFocus(null); setStopKey(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('office.history.wholeRoute')}</Txt>
        </Pressable>
      )}
    </View>
  );
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
  summary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginTop: 6 },
  numbers: { flexDirection: 'row', gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  map: { height: 300, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.mapLand, marginTop: 8 },
  // The tapped stop's words over the map's foot (Google Maps' place card), above the credit line.
  stopCard: {
    position: 'absolute', left: 10, right: 10, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card,
    borderRadius: 12, paddingLeft: 12, paddingRight: 4, paddingVertical: 6, minHeight: 48, borderWidth: 1, borderColor: colors.line, ...shadow(4),
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
  bar: { marginBottom: 4 },
});
