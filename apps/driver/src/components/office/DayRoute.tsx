// Office mode (Stage 1, O3 item 1): a route on the map with everything around it, one component for a driver's day (the
// driver page, today or a day of the last 90) and a finished task's driven route (task/[id]/route). §33.6 item 1 (Round
// 4–7, Sahan's decision; Samsara's driver day, Google Maps Timeline): ONE summary card (GPS km, driving, stopped, stops,
// the first and last point, and one line "No GPS for 2 h 10 min" when the day has gaps), the map on both engines
// (RouteMap: the line by speed band, holes dashed, the estimated roads, the stops over 10 minutes: a tap says "Stopped near
// Kurunegala · 06:56–07:15 · 19 min" and moves the map to it), the one playback bar (PlaybackBar.tsx, as on Live). The
// day's timeline list is gone (its driving rows are the card's km and driving time, its stops the pins, its gaps the
// card's line and the dashed legs).
// Round 48 (items 2 and 3; Google Maps Timeline, Airbnb's split view): the map sits at a FIXED height (lib/mapLayout.ts:
// 45 % of the window, at least 300 px), never inside the scroll, so a pinch zooms the map and the page's scroll never does;
// the playback bar directly under it; the summary card and the rest scroll below. The legend, the explanatory sentences
// (the estimated roads over N gaps, the server's km note) and the map data's full credits live behind the ⓘ button in the
// one bottom sheet (Apple Maps' info sheet; office/routeInfo.ts); the credits the licences require stay on the map. The
// markers (office/routeMarks.ts): the start and end pins, the stops as dots, the gap markers off until Filters → Layers
// shows them, the summary's gaps line opening the gaps sheet (a tap on a gap highlights its spot even with the layer off),
// overlapping markers as one numbered circle (lib/cluster.ts). The rules: office/driversLogic.ts and office/liveRouteLogic.ts.

import { useIsFocused } from 'expo-router';
import { type ReactNode, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ChevronRight, Info, MapPin, TriangleAlert, X } from '@/components/icons';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { RouteMap } from '@/components/RouteMap';
import { GOOGLE_MAP_BUILD } from '@/components/TaskMap';
import { ClusterPin, GapPin, RouteEndPin, RouteStopDot } from '@/components/routePins';
import type { Frame } from '@/components/taskMapLogic';
import { Mono, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { engineFor, type MapPackage, mapSession } from '@/lib/mapEngine';
import { mapHeight, routeLayerDefs, routeLayersOf } from '@/lib/mapLayout';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { dayNumbers, daySummary, gapLine, gapMarks, noGpsLine, routeEnds, routeFrame, routeLines, routePoints, stopLine, stopMarks } from '@/office/driversLogic';
import { canPlay, cursorAt, gapWindowsOf, playbackPath, routeOf } from '@/office/liveRouteLogic';
import { snapControl, snapNoteKey, snapView } from '@/office/snapLogic';
import { type LegendEntry, mapInfo } from '@/office/routeInfo';
import { visibleGaps } from '@/office/routeMarks';
import type { DriverRoute, FleetError } from '@/office/types';
import { ListFailed } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, shadow } from '@/theme';
import { PlaybackBar, usePlayback } from './PlaybackBar';
import { SnapChip, type SnapState } from './SnapChip';

interface Props {
  data: DriverRoute | null;
  error: FleetError | null;
  onRetry: () => void;
  onSignIn: () => void;
  mapPackage?: MapPackage;
  /** The sentence when the route has no points (a day with no driving, a task with no GPS). */
  emptyText: string;
  /** Fixed above the map (the day strip, a task's line). */
  above?: ReactNode;
  /** Pull to refresh on the scrolling part. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Scrolls under the summary card (the day's tasks, a task's km). */
  children?: ReactNode;
  /** Round 48 item 5: snap to roads (the screen asked driver_route with snap when `on`); the chip over the map, the note under it. */
  snap?: SnapState;
}

export function DayRoute({ data, error, onRetry, onSignIn, mapPackage, emptyText, above, refreshing, onRefresh, children, snap }: Props) {
  const { t, settings } = useApp();
  const { height } = useWindowDimensions();
  // Round 48 item 5: the line drawn is the snapped one in the route's place when the chip is on and the server gave it
  // (office/snapLogic.ts); the summary's numbers stay the server's (`data`: km from the odometer and the raw points).
  const snapOn = snap?.on === true;
  const shown = useMemo(() => (data ? snapView(data, snapOn) : null), [data, snapOn]);
  const snapUi = snapControl(data?.snapped, snap?.allowed === true, snap?.wanted === true);
  const points = useMemo(() => (shown ? routePoints(shown) : []), [shown]);
  const lines = useMemo(() => (shown ? routeLines(shown) : []), [shown]);
  // Each stop with its words (the pin's card, and its name for a screen reader).
  const stops = useMemo(() => (data ? stopMarks(data).map((s) => ({ ...s, label: stopLine(s, t) })) : []), [data, t]);
  // Round 48: the route's ends and its gap markers (the timeline's no-GPS and no-app rows).
  const ends = useMemo(() => routeEnds(points), [points]);
  const gaps = useMemo(() => (data ? gapMarks(data, points) : []), [data, points]);
  const fitNow = routeFrame(lines, stops);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fit = useMemo(() => fitNow, [fitNow.key]);
  // A stop or a gap tapped: its card on the map, and the map moved to it (what a timeline row did before §33.6).
  const [focus, setFocus] = useState<{ frame: Frame; nonce: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const pickedStop = selected ? stops.find((s) => s.key === selected) ?? null : null;
  const pickedGap = selected ? gaps.find((g) => g.key === selected) ?? null : null;
  const moveTo = (p: { lat: number; lng: number }) => setFocus((f) => ({ frame: { kind: 'point', center: { lat: p.lat, lng: p.lng } }, nonce: (f?.nonce ?? 0) + 1 }));
  const pickStop = (key: string) => {
    const s = stops.find((x) => x.key === key);
    if (!s) return;
    setSelected(key);
    moveTo(s);
  };
  const pickGap = (key: string) => {
    const g = gaps.find((x) => x.key === key);
    if (!g) return;
    setSelected(key);
    moveTo(g);
  };
  const clear = () => {
    setFocus(null);
    setSelected(null);
  };
  const numbers = data ? dayNumbers(data) : null;
  const summary = data ? daySummary(data) : null;
  const gapsLine = summary ? noGpsLine(summary, t) : null;

  // The Layers filter (docs/ui-patterns.md §1: the one Filter button; Google Maps' Layers): the gap markers, every stop's time.
  const [values, setValues] = useState<FilterValues>({});
  const layers = routeLayersOf(values);
  const shownGaps = useMemo(() => visibleGaps(gaps, layers, selected), [gaps, layers, selected]);

  // The ⓘ sheet (Apple Maps' info sheet): the legend, the sentences that stood under the map, the map data in full.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  // The engine the map asks for (the sheet names the map data; the licences' line on the map itself follows the mounted one).
  const googleFailed = useSyncExternalStore(mapSession.subscribe, mapSession.googleFailed, mapSession.googleFailed);
  const engine = engineFor(GOOGLE_MAP_BUILD, mapPackage ?? settings.map_package, googleFailed);
  const estimated = lines.filter((l) => l.band === 'estimated').length;
  const info = useMemo(() => mapInfo({ googleMap: engine === 'google', estimated: estimated > 0, estimatedGaps: estimated, kmNote: data?.km_note, estimatedNote: data?.estimated_note }, t), [engine, estimated, data?.km_note, data?.estimated_note, t]);

  // The playback (Live's rules, office/liveRouteLogic.ts): the path in time order along the line drawn (the roads when
  // snapped, as on the site), the gaps, the marker at the clock.
  const played = useMemo(() => (shown ? routeOf(shown.driver, shown) : null), [shown]);
  const path = useMemo(() => (played ? playbackPath(played.points, played.estimated) : []), [played]);
  const windows = useMemo(() => gapWindowsOf(played), [played]);
  const playback = usePlayback(path, useIsFocused());
  const marker = useMemo(() => (playback.active ? cursorAt(played, path, windows, playback.t) : null), [playback.active, playback.t, played, path, windows]);

  const cardText = pickedStop ? pickedStop.label : pickedGap ? gapLine(pickedGap, t) : null;

  return (
    <View style={{ flex: 1 }}>
      {above ? <View style={styles.above}>{above}</View> : null}
      {/* Round 48 (item 2): the map at a fixed height, never inside the scroll (a pinch zooms it, the page never scrolls it). */}
      <View style={[styles.map, { height: mapHeight(height) }]} testID="driver-route-map">
        <RouteMap lines={lines} stops={stops} fit={fit} focus={focus} marker={marker} onStop={pickStop} mapPackage={mapPackage}
          controls={snap && snapUi.toggle && points.length > 0 ? <SnapChip on={snapUi.on} onChange={snap.setWanted} /> : null}
          ends={ends} gaps={shownGaps} layers={layers} selected={selected} onGap={pickGap} />
        {cardText && (
          <View style={styles.stopCard} testID={pickedStop ? 'stop-card' : 'gap-card'}>
            {pickedGap ? <GapPin gap={pickedGap} /> : <MapPin size={18} color={colors.ink} strokeWidth={2.4} />}
            <Txt variant="strong" size={14} style={{ flex: 1 }}>{cardText}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => setSelected(null)} hitSlop={8} style={styles.close}>
              <X size={18} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          </View>
        )}
      </View>
      {/* ⓘ (the legend and the notes) and the one Filter button with its Layers section, under the map as on Live. */}
      <View style={styles.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('dayRoute.about')} onPress={() => setAboutOpen(true)} style={({ pressed }) => [styles.info, pressed && { opacity: 0.7 }]} testID="route-about">
          <Info size={22} color={colors.ink} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <FilterBar defs={routeLayerDefs(t)} values={values} onApply={setValues} testID="route-filter" />
        </View>
      </View>
      {/* Round 48 item 5: which line the map draws ("Snapped to roads · km from the odometer", "GPS line"…), always in view with the chip. */}
      {snapUi.note && points.length > 0 && <Txt variant="small" size={12} style={styles.snapNote} testID="snap-note">{t(snapNoteKey(snapUi.note))}</Txt>}
      {canPlay(path) && <View style={styles.bar}><PlaybackBar playback={playback} cursor={marker} /></View>}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.amber]} /> : undefined}
        testID="route-content"
      >
        {focus && (
          <Pressable accessibilityRole="button" onPress={clear} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Txt variant="strong" size={15} color={colors.blue}>{t('office.history.wholeRoute')}</Txt>
          </Pressable>
        )}
        {/* §33.6 item 1: the day in one card (under the map since Round 48: the map is fixed above, the rest scrolls). */}
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
              // Round 48: the gaps line opens the gaps sheet (a count opens its list; a row highlights the spot on the map).
              <Pressable accessibilityRole="button" accessibilityLabel={`${gapsLine} · ${t('dayRoute.showGaps')}`} onPress={() => setGapsOpen(true)} disabled={gaps.length === 0}
                style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]} testID="day-gaps-button">
                <TriangleAlert size={16} color={colors.amberText} strokeWidth={2.4} />
                <Txt variant="strong" size={14} color={colors.amberText} style={{ flex: 1 }} testID="day-gaps">{gapsLine}</Txt>
                {gaps.length > 0 && <ChevronRight size={18} color={colors.muted} />}
              </Pressable>
            )}
          </View>
        )}
        {!data && !error && <SkeletonRows rows={2} lines={1} />}
        {error && <ListFailed stale={!!data} error={error} onRetry={onRetry} onSignIn={onSignIn} />}
        {data && points.length === 0 && <ListEmpty text={emptyText} />}
        {children}
      </ScrollView>

      <Sheet visible={aboutOpen} title={t('dayRoute.about')} onClose={() => setAboutOpen(false)} testID="route-about-sheet">
        <Txt variant="label" color={colors.muted}>{t('dayRoute.legendTitle').toUpperCase()}</Txt>
        {info.legend.map((e) => <LegendRow key={e.key} entry={e} />)}
        {info.notes.length > 0 && (
          <View style={{ gap: 6 }}>
            <Txt variant="label" color={colors.muted}>{t('dayRoute.kmNoteTitle').toUpperCase()}</Txt>
            {info.notes.map((n) => <Txt key={n} variant="muted" size={15}>{n}</Txt>)}
          </View>
        )}
        <View style={{ gap: 4 }}>
          <Txt variant="label" color={colors.muted}>{t('dayRoute.mapData').toUpperCase()}</Txt>
          {/* The providers' credits, in their own words (never translated; the licences' line stays on the map). */}
          {info.credits.map((c) => <Txt key={c} variant="small" accessibilityLanguage="en" testID="route-about-credit">{c}</Txt>)}
        </View>
      </Sheet>

      <Sheet visible={gapsOpen} title={t('dayRoute.gapsTitle')} onClose={() => setGapsOpen(false)} testID="route-gaps-sheet">
        <Txt variant="muted" size={15}>{t('dayRoute.gapsHint')}</Txt>
        {gaps.map((g) => (
          <Pressable key={g.key} accessibilityRole="button" onPress={() => { setGapsOpen(false); pickGap(g.key); }} style={({ pressed }) => [styles.gapRow, pressed && { opacity: 0.7 }]} testID="route-gap-row">
            <GapPin gap={g} />
            <Txt variant="strong" size={15} style={{ flex: 1 }}>{gapLine(g, t)}</Txt>
            <ChevronRight size={20} color={colors.muted} />
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

/** One line of the legend: the mark as it is drawn on the map, then its words. */
function LegendRow({ entry }: { entry: LegendEntry }) {
  let mark: ReactNode;
  switch (entry.mark) {
    case 'line':
      mark = <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: entry.color }} />;
      break;
    case 'dashed':
      mark = <View style={{ width: 22, height: 0, borderTopWidth: 3, borderStyle: 'dashed', borderColor: entry.color }} />;
      break;
    case 'pinStart':
      mark = <RouteEndPin end={{ kind: 'start' }} />;
      break;
    case 'pinEnd':
      mark = <RouteEndPin end={{ kind: 'end' }} />;
      break;
    case 'dot':
      mark = <RouteStopDot time="" labelled={false} />;
      break;
    case 'gap':
      mark = <GapPin gap={{ kind: 'no_gps' }} />;
      break;
    default:
      mark = <ClusterPin count={3} />;
  }
  return (
    <View style={styles.legendRow} testID={`legend-${entry.key}`}>
      <View style={styles.legendMark}>{mark}</View>
      <Txt variant="body" size={15} style={{ flex: 1 }}>{entry.text}</Txt>
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
  above: { paddingHorizontal: 16, paddingTop: 8 },
  summary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  numbers: { flexDirection: 'row', gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, minHeight: 36 },
  map: { backgroundColor: colors.mapLand, marginTop: 8 },
  // The tapped stop's words over the map's foot (Google Maps' place card), above the credit line.
  stopCard: {
    position: 'absolute', left: 10, right: 10, bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card,
    borderRadius: 12, paddingLeft: 12, paddingRight: 4, paddingVertical: 6, minHeight: 48, borderWidth: 1, borderColor: colors.line, ...shadow(4),
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  info: { width: 50, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  bar: { paddingHorizontal: 16, paddingBottom: 4 },
  snapNote: { paddingHorizontal: 16, paddingTop: 4 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  legendMark: { width: 40, alignItems: 'center', justifyContent: 'center' },
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
});
