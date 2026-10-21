// Office mode (Phase 8, O1): the Live tab (design 15), the office person's live map of the drivers. The map first (both
// engines, components/DriversMap.tsx), the drivers as markers (initials in a ring: blue on a task, green free, grey off
// duty), one Filter button (the duty, with the counts; no search: the list is short), then the rows (skeleton rows first). Tapping a row or a marker selects the driver: the map moves to them and a card
// comes up over the bottom (the name, the plate, the line, Call / WhatsApp / Open in Maps from the links the server gave).
// `live_drivers` is read when the tab opens, every 30 s while it is in front, and on pull to refresh. Opened from Home
// with ?driver=<username>, that driver is selected.
// O2 (the plan's §6, the site's Live; office/liveRouteLogic.ts), for a person who may call driver_route:
//   - Today's trails: a tick box in the Filter sheet's Map section (Sahan's decision 3, 20 October 2026) draws every
//     sharing driver's line today, at most 10
//     (the rest "+N not drawn"), one driver_route call each, then again every 60 s while on, merged by time into the line
//     drawn, never replaced; each in a muted colour, its holes dashed. Off: the lines go.
//   - The shown route: the selected driver's day in full colour by speed band, the stops as circles with their times, the
//     holes dashed grey, the estimated roads dashed slate (openrouteservice's credit under the map); the card says
//     "Today: 61 km · driving 2 h 10 min · stopped 45 min · 3 stops".
//   - Playback on the shown route: Play / Pause, 1× 5× 20× 60×, a time slider, the marker stepping along the line in time
//     order with its time and speed; the driver's live marker is hidden while it runs; closing the card ends it.
// Stage 1 (O3 item 4; the site's Live):
//   - watched mode: while the tab is in front and the app on screen, watch_drivers every 30 s for the selected driver while
//     they share (every sharing driver while today's trails are on), so their phones upload every 10 s while moving;
//   - the card: the speed (while live) and the battery, the driver's page for today (with driver_route, beside Earlier
//     days), Clock out (a driver on duty without a task: a sheet with the optional reason; the server's sentence when it
//     refuses) and Move to vehicle (move/[username]; on a task it is Task detail's Swap vehicle), each with its tool;
//   - the Problems choice in the Filter sheet (No signal or Location off while on duty, the site's rule);
//   - the map's cluster: zoom in, zoom out, fit everyone (components/DriversMap.tsx), the compass above it: at most three.

import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type LayoutChangeEvent, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DriversMap } from '@/components/DriversMap';
import { type LucideIcon, MessageCircle, Navigation, Phone, X } from '@/components/icons';
import { type Playback, PlaybackBar, usePlayback } from '@/components/office/PlaybackBar';
import { pickedStyle } from '@/components/patterns/Select';
import { LanguagePill } from '@/components/LanguageSwitch';
import { DriverDot } from '@/components/mapPins';
import { VehicleChipView } from '@/components/office/DriverRows';
import { vehicleChip } from '@/office/approveLogic';
import { Sheet } from '@/components/patterns/Sheet';
import { Button, Plate, Txt } from '@/components/ui';
import { plusDays } from '@/lib/patterns/calendarLogic';
import { colomboDate } from '@/lib/time';
import {
  batteryText, canClockOut, clockOutInput, clockOutLine, type ClockOutResult, filterCounts, filterDrivers, focusOf, frameAll, liveChoice, liveFilterDefs, markersOf, moveMode, trailsOn,
  pillOf, rowLine, speedText, WATCH_EVERY_MS, watchBatches, watchList,
} from '@/office/liveLogic';
import {
  canPlay, type Cursor, cursorAt, drawingOf, gapWindowsOf, type LiveLayers, mergeRoute,
  playbackPath, type Route, ROUTE_REFRESH_MS, routeArgs, routeOf, routeSummary, trailsLoading, trailsOf, trailsPlan,
} from '@/office/liveRouteLogic';
import { useOffice, useTool } from '@/office/state';
import { initials } from '@/office/text';
import type { DriverRoute, FleetError, LiveDriver, LiveDrivers, SettingsResult } from '@/office/types';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { Divider, ErrorNotice, ListFailed, Pill, StatusChip, useWebThemeColor } from '@/office/ui';
import { sentenceText } from '@/office/statusWords';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { SavedNotice } from '@/components/office/SavedNotice';
import { useApp } from '@/state/app';
import { colors, fonts, shadow } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function LiveTab() {
  useWebThemeColor(colors.ink);
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { driver: param } = useLocalSearchParams<{ driver?: string }>();
  const q = useTool<LiveDrivers>('live_drivers', {}, { every: 30_000 });
  // Round 3: the vehicle chip says "Vehicle: on the day" when the fleet setting is on and a driver holds none.
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const onDay = settings.data?.settings.vehicle_on_the_day === true;
  const [values, setValues] = useState<FilterValues>({ duty: 'all' });
  const filter = liveChoice(values);
  const [selected, setSelected] = useState<string | null>(null);
  // The same row tapped again moves the map to the driver again.
  const [nonce, setNonce] = useState(0);
  // The lines need driver_route: without it the tab is as in O1 (no button for them).
  const routes = me.tools.includes('driver_route');

  const all = useMemo(() => q.data?.drivers ?? [], [q.data]);
  const counts = useMemo(() => filterCounts(all), [all]);
  const rows = useMemo(() => filterDrivers(all, filter), [all, filter]);
  const allMarkers = useMemo(() => markersOf(rows, selected, t), [rows, selected, t]);
  const fitKey = frameAll(rows).key;
  // Only the set of drivers with a position (and the chip) frames the map again, never a refresh that moved them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fit = useMemo(() => frameAll(rows), [fitKey, filter]);
  const chosen = selected === null ? null : all.find((d) => d.username === selected) ?? null;
  const focusPoint = focusOf(all, selected);
  const focus = useMemo(() => (focusPoint ? { ...focusPoint, nonce } : null), [focusPoint?.username, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened with a driver (Home's rows and its on-the-road chip): select them once, then forget the parameter so the tab
  // does not reselect them every time it comes back.
  useEffect(() => {
    if (!param || all.length === 0) return;
    // The parameter is a username (Home's rows) or the driver's name (Task detail's Live map).
    const found = all.find((d) => d.username === param || d.driver === param);
    if (found) setSelected(found.username);
    router.setParams({ driver: '' });
  }, [param, all, router]);

  const select = (username: string) => {
    setSelected(username);
    setNonce((n) => n + 1);
  };

  // ---- The shown route: the selected driver's day, loaded when they are selected, merged every 60 s ------------------
  const [route, setRoute] = useState<Route | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState<FleetError | null>(null);
  const [routeTry, setRouteTry] = useState(0);
  useEffect(() => {
    if (!routes || selected === null) {
      setRoute(null);
      setRouteErr(null);
      setRouteBusy(false);
      return;
    }
    const who = selected;
    setRoute((r) => (r && r.username === who ? r : null));
    setRouteErr(null);
    setRouteBusy(true);
    let live = true;
    api.call<DriverRoute>('driver_route', routeArgs(who))
      .then((p) => {
        if (!live) return;
        const fresh = routeOf(who, p);
        setRoute((r) => (r && r.username === who ? mergeRoute(r, fresh) : fresh));
      })
      .catch((e: FleetError) => { if (live) setRouteErr(e); })
      .finally(() => { if (live) setRouteBusy(false); });
    return () => { live = false; };
  }, [routes, selected, routeTry, api]);
  const shownRoute = route && route.username === selected ? route : null;
  const shownUser = shownRoute?.username ?? null;

  // ---- Today's trails: every sharing driver's line (at most TRAILS_CAP), loaded once each, merged every 60 s ----------
  // On or off from the Filter sheet's Map section (Sahan's decision 3); off forgets the lines loaded.
  const trails = routes && trailsOn(values);
  const [trailMap, setTrailMap] = useState<Map<string, Route>>(() => new Map());
  const trailBusy = useRef(new Set<string>());
  // A trail asked before the trails went off (or before they went off and on again) is dropped when it lands.
  const trailGen = useRef(0);
  const plan = useMemo(() => trailsPlan(all), [all]);
  const planRef = useRef(plan);
  planRef.current = plan;
  /** One driver's trail: fetched and merged into the one drawn (the first time it is simply set). */
  const loadTrail = useCallback((u: string) => {
    if (trailBusy.current.has(u)) return;
    trailBusy.current.add(u);
    const gen = trailGen.current;
    api.call<DriverRoute>('driver_route', routeArgs(u))
      .then((p) => gen === trailGen.current && setTrailMap((m) => {
        const cur = m.get(u);
        const fresh = routeOf(u, p);
        return new Map(m).set(u, cur ? mergeRoute(cur, fresh) : fresh);
      }))
      .catch(() => undefined)
      .finally(() => trailBusy.current.delete(u));
  }, [api]);
  // Trails on: today's route of every planned driver that has none yet.
  useEffect(() => {
    if (!trails || !routes) return;
    for (const u of plan.draw) if (!trailMap.has(u)) loadTrail(u);
  }, [trails, routes, plan, trailMap, loadTrail]);
  useEffect(() => {
    if (trails) return;
    trailGen.current += 1;
    trailBusy.current.clear();
    setTrailMap(new Map());
  }, [trails]);

  // Watched mode (the site's useWatchDrivers): the selected driver while they share, every sharing driver while the trails
  // are on; watch_drivers now and every 30 s while the tab is in front and the app on screen. Leaving stops the calls (the
  // server lets the watch lapse after 90 s). A failed call is quiet: the phones simply upload at their usual pace.
  const watchKey = useMemo(() => watchList(all, trails, selected).join(','), [all, trails, selected]);
  const mayWatch = me.tools.includes('watch_drivers');
  useEffect(() => {
    if (!focused || !mayWatch || !watchKey) return;
    const drivers = watchKey.split(',');
    const call = () => {
      if (AppState.currentState !== 'active') return;
      for (const batch of watchBatches(drivers)) void api.call('watch_drivers', { drivers: batch }).catch(() => undefined);
    };
    call();
    const timer = setInterval(call, WATCH_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') call(); });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [focused, mayWatch, watchKey, api]);

  // Every 60 s while the tab is in front: the trails and the shown route are fetched again and merged, never replaced.
  useEffect(() => {
    if (!focused || !routes || (!trails && shownUser === null)) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (trails) for (const u of planRef.current.draw) loadTrail(u);
      if (shownUser !== null) {
        api.call<DriverRoute>('driver_route', routeArgs(shownUser))
          .then((p) => setRoute((r) => (r && r.username === shownUser ? mergeRoute(r, routeOf(shownUser, p)) : r)))
          .catch(() => undefined);
      }
    }, ROUTE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [focused, routes, trails, shownUser, loadTrail, api]);

  // ---- What the map draws, and the playback ----------------------------------------------------------------------------
  const drawing = useMemo(() => drawingOf(shownRoute, t), [shownRoute, t]);
  const trailLines = useMemo(() => (trails ? trailsOf(trailMap, plan.draw, drawing?.username ?? null) : []), [trails, trailMap, plan.draw, drawing?.username]);
  const path = useMemo(() => (shownRoute ? playbackPath(shownRoute.points, shownRoute.estimated) : []), [shownRoute]);
  const windows = useMemo(() => gapWindowsOf(shownRoute), [shownRoute]);
  const playback = usePlayback(path, focused);
  const cursor = useMemo(() => (playback.active ? cursorAt(shownRoute, path, windows, playback.t) : null), [playback.active, playback.t, shownRoute, path, windows]);
  const layers = useMemo<LiveLayers>(() => ({ trails: trailLines, route: drawing, cursor }), [trailLines, drawing, cursor]);
  // The driver's live marker is hidden while the playback marker stands for them.
  const markers = useMemo(() => (cursor && drawing ? allMarkers.filter((m) => m.username !== drawing.username) : allMarkers), [allMarkers, cursor, drawing]);
  const loadingTrails = trails && trailsLoading(plan.draw, trailMap);

  const [cardH, setCardH] = useState(0);
  const subtitle = all.length === 1 ? t('office.live.countOne') : t('office.live.count', { n: all.length });

  // What the trails are doing, under the map's cluster (the toggle itself is in the Filter sheet: at most three map
  // controls). DriversMap shows it only while a map is mounted (never over "Map not available").
  const controls = trails && (loadingTrails || plan.notDrawn > 0) ? (
    <View style={styles.trailsControl} pointerEvents="box-none">
      {(
        <View style={styles.mapPill}>
          {loadingTrails && <ActivityIndicator size="small" color={colors.muted} />}
          <Txt variant="small" color={colors.ink} numberOfLines={1}>
            {loadingTrails ? t('office.live.trailsLoading') : t('office.live.trailsNotDrawn', { n: plan.notDrawn })}
          </Txt>
        </View>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {/* A slim dark bar (the other tabs' header, shorter): the title, the count and the language pill; the map wants the room. */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Txt variant="heading" color="#ffffff" numberOfLines={1}>{t('office.live.title')}</Txt>
          {q.data ? <Txt variant="small" color="#c9ccd1" numberOfLines={1}>{subtitle}</Txt> : null}
        </View>
        <LanguagePill />
      </View>

      <View style={styles.map} testID="live-map">
        <DriversMap markers={markers} fit={fit} focus={focus} onPressMarker={select} mapPackage={me.map?.package} layers={layers} controls={controls} />
      </View>

      <View style={styles.chips}>
        <FilterBar defs={liveFilterDefs(q.data ? counts : undefined, t, { trails: !!routes })} values={values} onApply={setValues} testID="live-filter" />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: chosen ? Math.max(240, cardH + 16) : 24 }}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={() => void q.reload()} colors={[colors.amber]} />}
      >
        {!q.data && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!q.data && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.data && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && all.length === 0 && <ListEmpty text={t('office.live.empty')} />}
        {q.data && all.length > 0 && rows.length === 0 && <ListEmpty text={t('office.live.noneInFilter')} action={t('patterns.clearAll')} onAction={() => setValues((v) => ({ ...v, duty: 'all' }))} />}
        {rows.map((d, i) => (
          <View key={d.username}>
            {i > 0 && <Divider />}
            <DriverRow d={d} selected={d.username === selected} onPress={() => select(d.username)} onDay={onDay} />
          </View>
        ))}
      </ScrollView>

      {chosen && (
        <DriverCard
          d={chosen}
          onClose={() => setSelected(null)}
          onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
          route={routes ? { route: shownRoute, busy: routeBusy, error: routeErr, retry: () => setRouteTry((n) => n + 1) } : null}
          playback={canPlay(path) ? playback : null}
          cursor={cursor}
          onHistory={routes ? () => router.push({ pathname: '/office/driver/[username]/route', params: { username: chosen.username, date: plusDays(colomboDate(), -1) } }) : undefined}
          onDriverPage={routes ? () => router.push({ pathname: '/office/driver/[username]', params: { username: chosen.username } }) : undefined}
          onMove={me.tools.includes('move_driver_vehicle') && moveMode(chosen) !== 'none'
            ? () => (moveMode(chosen) === 'swap' && chosen.task_id
              ? router.push({ pathname: '/office/task/[id]/swap', params: { id: chosen.task_id } })
              : router.push({ pathname: '/office/move/[username]', params: { username: chosen.username } }))
            : undefined}
          moveLabel={moveMode(chosen) === 'swap' ? t('office.task.swapVehicle') : t('office.live.moveVehicle')}
          onClockOut={me.tools.includes('clock_out_driver') && canClockOut(chosen) ? async (reason) => {
            const r = await api.call<ClockOutResult>('clock_out_driver', clockOutInput(chosen.username, reason));
            void q.reload();
            return clockOutLine(r, chosen.driver.split(' ')[0], t);
          } : undefined}
        />
      )}
    </View>
  );
}

/**
 * A driver's row (design 15; Round 3: the driver-first card of Uber Fleet and Samsara): the photo in the state's ring
 * (the initials until there is one), the name, the vehicle chip under it, the line, the pill.
 */
function DriverRow({ d, selected, onPress, onDay }: { d: LiveDriver; selected: boolean; onPress: () => void; onDay: boolean }) {
  const { t } = useApp();
  const pill = pillOf(d);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} testID={`live-row-${d.username}`}
      style={({ pressed }) => [styles.row, selected && pickedStyle, pressed && { opacity: 0.7 }]}>
      <DriverDot initials={initials(d.driver)} tone={pill.tone} dim={pill.key === 'offDuty'} selected={selected} size={40} photo={d.photo_url} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.name}>
          <Txt variant="strong" size={17} numberOfLines={1} style={{ flexShrink: 1 }}>{d.driver}</Txt>
        </View>
        <VehicleChipView chip={vehicleChip({ vehicle: d.vehicle ? { reg_no: d.vehicle, source: 'on_duty' } : null }, onDay)} />
        <Txt variant="muted" size={15} numberOfLines={2}>{rowLine(d, t)}</Txt>
      </View>
      <StatusChip text={t(`office.live.pill.${pill.key}`)} tone={pill.tone} />
    </Pressable>
  );
}

/** The shown route's state for the card: loading, failed (Try again), or the route (its numbers). */
interface RouteState {
  route: Route | null;
  busy: boolean;
  error: FleetError | null;
  retry: () => void;
}

/**
 * The selected driver's card over the bottom: the name, the plate, the lines, today's numbers from the route, Call / WhatsApp
 * / Open in Maps as the links allow, and the playback bar when the route has a span to play.
 */
function DriverCard({ d, onClose, onLayout, route, playback, cursor, onHistory, onDriverPage, onMove, moveLabel, onClockOut }: {
  d: LiveDriver;
  onClose: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Null when the person may not call driver_route. */
  route: RouteState | null;
  playback: Playback | null;
  cursor: Cursor | null;
  /** Stage 1 (O3 item 1): the driver's page on yesterday, the day strip back 90 days (with driver_route). */
  onHistory?: () => void;
  /** Stage 1 (O3 item 4d): the driver's page for today (with driver_route). */
  onDriverPage?: () => void;
  /** Stage 1 (O3 item 4c): Move to vehicle (on duty) or Swap vehicle (on a task), with move_driver_vehicle. */
  onMove?: () => void;
  moveLabel: string;
  /** Stage 1 (O3 item 4b): clock_out_driver with the reason; answers the sentence to show (throws the server's refusal). */
  onClockOut?: (reason: string) => Promise<string>;
}) {
  const { t, language } = useApp();
  const insets = useSafeAreaInsets();
  const pill = pillOf(d);
  const links = d.links ?? {};
  const extra = [sentenceText(t, d.status_text), d.task_note, d.not_available ? sentenceText(t, d.not_available) : undefined, d.app_stops_text].filter((s): s is string => !!s);
  const summary = route?.route ? routeSummary(route.route, t) : null;
  const facts = [speedText(d, t), batteryText(d, t)].filter((s): s is string => !!s);
  // Clock out: a sheet with the optional reason; the answer in the snackbar, the server's refusal on the card.
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<FleetError | null>(null);
  useEffect(() => {
    setRefused(null);
  }, [d.username]);
  async function clockOut() {
    if (!onClockOut || busy) return;
    setBusy(true);
    setRefused(null);
    try {
      showSnackbar({ text: await onClockOut(reason) });
      setAsking(false);
      setReason('');
    } catch (e) {
      setRefused(e as FleetError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="live-card" onLayout={onLayout}>
      <View style={styles.handle} />
      <View style={styles.cardHead}>
        <DriverDot initials={initials(d.driver)} tone={pill.tone} dim={pill.key === 'offDuty'} size={44} photo={d.photo_url} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.name}>
            <Txt variant="big" numberOfLines={1} style={{ flexShrink: 1 }}>{d.driver}</Txt>
            {d.vehicle ? <Plate regNo={d.vehicle} /> : null}
          </View>
          <Pill text={t(`office.live.pill.${pill.key}`)} tone={pill.tone} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('office.live.close')} onPress={onClose} style={styles.close}>
          <X size={24} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      </View>
      <Txt variant="muted" size={15}>{rowLine(d, t)}</Txt>
      {facts.length > 0 && <Txt variant="strong" size={15} testID="live-facts">{facts.join(' · ')}</Txt>}
      {extra.map((line) => <Txt key={line} variant="small" numberOfLines={2}>{line}</Txt>)}
      {!focusable(d) && <Txt variant="small">{t('office.live.noPosition')}</Txt>}
      {route && (
        <View testID="live-route-line">
          {route.busy && !route.route && <SkeletonRows rows={1} lines={1} testID="live-route-skeleton" />}
          {!route.busy && route.error && !route.route && (
            <View style={styles.routeErr}>
              <Txt variant="small" color={colors.red} style={{ flex: 1 }}>{t('office.live.routeFailed')}</Txt>
              <Pressable accessibilityRole="button" onPress={route.retry} style={styles.retry}>
                <Txt variant="strong" size={15} color={colors.blue}>{t('office.common.tryAgain')}</Txt>
              </Pressable>
            </View>
          )}
          {route.route && (summary ? <Txt variant="strong" size={15}>{summary}</Txt> : <Txt variant="small">{t('office.live.routeNone')}</Txt>)}
        </View>
      )}
      {(links.call || links.whatsapp || links.maps) && (
        <View style={styles.actions}>
          {links.call && <Action icon={Phone} label={t('office.common.call')} url={links.call} />}
          {links.whatsapp && <Action icon={MessageCircle} label={t('office.common.whatsapp')} url={links.whatsapp} />}
          {links.maps && <Action icon={Navigation} label={t('office.live.openMaps')} url={links.maps} />}
        </View>
      )}
      {playback && <PlaybackBar playback={playback} cursor={cursor} />}
      {(onMove || onClockOut) && (
        <View style={styles.actions}>
          {onMove && <Button kind="outline" label={moveLabel} onPress={onMove} style={{ flex: 1, minHeight: 52 }} testID="live-move" />}
          {onClockOut && <Button kind="outline" label={t('office.live.clockOut')} onPress={() => { setRefused(null); setAsking(true); }} style={{ flex: 1, minHeight: 52 }} testID="live-clock-out" />}
        </View>
      )}
      <SavedNotice noticeKey={`live:${d.username}`} />
      {refused && !asking ? <ErrorNotice error={refused} /> : null}
      {(onDriverPage || onHistory) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {onDriverPage && (
            <Pressable accessibilityRole="button" onPress={onDriverPage} style={styles.retry} testID="live-driver-page">
              <Txt variant="strong" size={15} color={colors.blue}>{t('office.live.driverPage')} ›</Txt>
            </Pressable>
          )}
          {onHistory && (
            <Pressable accessibilityRole="button" onPress={onHistory} style={styles.retry} testID="live-history">
              <Txt variant="strong" size={15} color={colors.blue}>{t('office.history.earlierDays')} ›</Txt>
            </Pressable>
          )}
        </View>
      )}
      {onClockOut && (
        <Sheet
          visible={asking}
          title={t('office.live.clockOutTitle', { name: d.driver.split(' ')[0] })}
          onClose={() => setAsking(false)}
          testID="clock-out-sheet"
          actions={(
            <>
              <Button kind="outline" label={t('office.live.keepOnDuty')} onPress={() => setAsking(false)} style={{ flex: 1, minHeight: 52 }} />
              <Button label={t('office.live.clockOut')} onPress={() => void clockOut()} busy={busy} style={{ flex: 1.2, minHeight: 52, backgroundColor: colors.red }} />
            </>
          )}
        >
          <Txt variant="muted">{t('office.live.clockOutBody')}</Txt>
          <TextInput value={reason} onChangeText={setReason} maxLength={200} placeholder={t('office.live.clockOutReason')} placeholderTextColor="#9aa0a6"
            style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]} accessibilityLabel={t('office.live.clockOutReason')} />
          {refused ? <ErrorNotice error={refused} onRetry={() => void clockOut()} /> : null}
        </Sheet>
      )}
    </View>
  );
}

const focusable = (d: LiveDriver) => typeof d.lat === 'number' && typeof d.lng === 'number';

/** One of the card's buttons: opens the dialler, a WhatsApp chat or the Google Maps app at the position. */
function Action({ icon: Icon, label, url }: { icon: LucideIcon; label: string; url: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => open(url)} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <Icon size={20} color={colors.ink} strokeWidth={2.4} />
      <Txt variant="strong" size={15} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 10 },
  map: { flex: 1.2, backgroundColor: colors.mapLand, minHeight: 220 },
  trailsControl: { alignItems: 'flex-end', gap: 8 },
  mapPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 220 },
  chips: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.page },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, minHeight: 64, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  name: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
    ...shadow(12, true),
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  routeErr: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
});
