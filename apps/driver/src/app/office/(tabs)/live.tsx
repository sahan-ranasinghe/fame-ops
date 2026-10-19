// Office mode (Phase 8, O1): the Live tab (design 15), the office person's live map of the drivers. The map first (both
// engines, components/DriversMap.tsx), the drivers as markers (initials in a ring: blue on a task, green free, grey off
// duty), the filter chips, then the rows. Tapping a row or a marker selects the driver: the map moves to them and a card
// comes up over the bottom (the name, the plate, the line, Call / WhatsApp / Open in Maps from the links the server gave).
// `live_drivers` is read when the tab opens, every 30 s while it is in front, and on pull to refresh. Opened from Home
// with ?driver=<username>, that driver is selected.
// O2 (the plan's §6, the site's Live; office/liveRouteLogic.ts), for a person who may call driver_route:
//   - Today's trails: the control over the map (design 15's cluster) draws every sharing driver's line today, at most 10
//     (the rest "+N not drawn"), one driver_route call each, then again every 60 s while on, merged by time into the line
//     drawn, never replaced; each in a muted colour, its holes dashed. Off: the lines go.
//   - The shown route: the selected driver's day in full colour by speed band, the stops as circles with their times, the
//     holes dashed grey, the estimated roads dashed slate (openrouteservice's credit under the map); the card says
//     "Today: 61 km · driving 2 h 10 min · stopped 45 min · 3 stops".
//   - Playback on the shown route: Play / Pause, 1× 5× 20× 60×, a time slider, the marker stepping along the line in time
//     order with its time and speed; the driver's live marker is hidden while it runs; closing the card ends it.

import Pause from 'lucide-react-native/icons/pause';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, type LayoutChangeEvent, Linking, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DriversMap } from '@/components/DriversMap';
import { type LucideIcon, MessageCircle, Navigation, Phone, Play, Route as RouteIcon, X } from '@/components/icons';
import { LanguagePill } from '@/components/LanguageSwitch';
import { DriverDot } from '@/components/mapPins';
import { Mono, Plate, Txt } from '@/components/ui';
import { filterCounts, filterDrivers, focusOf, frameAll, LIVE_FILTERS, type LiveFilter, markersOf, pillOf, rowLine } from '@/office/liveLogic';
import {
  advance, canPlay, clockS, type Cursor, cursorAt, drawingOf, gapWindowsOf, type LiveLayers, mergeRoute, type PathPoint, PLAYBACK_TICK_MS, type PlaybackSpeed,
  playbackPath, type Route, ROUTE_REFRESH_MS, routeArgs, routeOf, routeSummary, sliderFraction, SPEEDS, timeAtFraction, trailsLoading, trailsOf, trailsPlan,
} from '@/office/liveRouteLogic';
import { useOffice, useTool } from '@/office/state';
import { initials } from '@/office/text';
import type { DriverRoute, FleetError, LiveDriver, LiveDrivers } from '@/office/types';
import { Divider, Empty, ErrorNotice, FilterChips, Loading, Pill } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function LiveTab() {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { driver: param } = useLocalSearchParams<{ driver?: string }>();
  const q = useTool<LiveDrivers>('live_drivers', {}, { every: 30_000 });
  const [filter, setFilter] = useState<LiveFilter>('all');
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
  const [trails, setTrails] = useState(false);
  const [trailMap, setTrailMap] = useState<Map<string, Route>>(() => new Map());
  const trailBusy = useRef(new Set<string>());
  const plan = useMemo(() => trailsPlan(all), [all]);
  const planRef = useRef(plan);
  planRef.current = plan;
  /** One driver's trail: fetched and merged into the one drawn (the first time it is simply set). */
  const loadTrail = useCallback((u: string) => {
    if (trailBusy.current.has(u)) return;
    trailBusy.current.add(u);
    api.call<DriverRoute>('driver_route', routeArgs(u))
      .then((p) => setTrailMap((m) => {
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
  const toggleTrails = () => {
    if (trails) setTrailMap(new Map());
    setTrails(!trails);
  };

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

  // Design 15's cluster, under the compass's place: the trails toggle (dark while on) and what it is doing. DriversMap
  // shows it only while a map is mounted (never over "Map not available").
  const controls = routes ? (
    <View style={styles.mapControls} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('office.live.trails')}
        accessibilityState={{ selected: trails }}
        onPress={toggleTrails}
        testID="live-trails"
        style={({ pressed }) => [styles.mapButton, trails && styles.mapButtonOn, pressed && { opacity: 0.8 }]}
      >
        <RouteIcon size={24} color={trails ? '#ffffff' : colors.ink} strokeWidth={2.4} />
      </Pressable>
      {trails && (loadingTrails || plan.notDrawn > 0) && (
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
        <FilterChips
          options={LIVE_FILTERS.map((k) => ({ key: k, label: t(`office.live.filter.${k}`), n: counts[k] }))}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: chosen ? Math.max(240, cardH + 16) : 24 }}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={() => void q.reload()} colors={[colors.amber]} />}
      >
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !q.data && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && all.length === 0 && <Empty text={t('office.live.empty')} />}
        {q.data && all.length > 0 && rows.length === 0 && <Empty text={t('office.live.noneInFilter')} />}
        {rows.map((d, i) => (
          <View key={d.username}>
            {i > 0 && <Divider />}
            <DriverRow d={d} selected={d.username === selected} onPress={() => select(d.username)} />
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
        />
      )}
    </View>
  );
}

/** A driver's row: the ring with the initials, "Sunil · [WP CAB-4521]", the line, the pill (design 15). */
function DriverRow({ d, selected, onPress }: { d: LiveDriver; selected: boolean; onPress: () => void }) {
  const { t } = useApp();
  const pill = pillOf(d);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} testID={`live-row-${d.username}`}
      style={({ pressed }) => [styles.row, selected && { backgroundColor: colors.blueChip }, pressed && { opacity: 0.7 }]}>
      <DriverDot initials={initials(d.driver)} tone={pill.tone} dim={pill.key === 'offDuty'} selected={selected} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.name}>
          <Txt variant="strong" size={17} numberOfLines={1} style={{ flexShrink: 1 }}>{d.driver}</Txt>
          {d.vehicle ? <Plate regNo={d.vehicle} /> : null}
        </View>
        <Txt variant="muted" size={15} numberOfLines={2}>{rowLine(d, t)}</Txt>
      </View>
      <Pill text={t(`office.live.pill.${pill.key}`)} tone={pill.tone} />
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
function DriverCard({ d, onClose, onLayout, route, playback, cursor }: {
  d: LiveDriver;
  onClose: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  /** Null when the person may not call driver_route. */
  route: RouteState | null;
  playback: Playback | null;
  cursor: Cursor | null;
}) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const pill = pillOf(d);
  const links = d.links ?? {};
  const extra = [d.status_text, d.task_note, d.not_available, d.app_stops_text].filter((s): s is string => !!s);
  const summary = route?.route ? routeSummary(route.route, t) : null;
  return (
    <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="live-card" onLayout={onLayout}>
      <View style={styles.handle} />
      <View style={styles.cardHead}>
        <DriverDot initials={initials(d.driver)} tone={pill.tone} dim={pill.key === 'offDuty'} size={44} />
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
      {extra.map((line) => <Txt key={line} variant="small" numberOfLines={2}>{line}</Txt>)}
      {!focusable(d) && <Txt variant="small">{t('office.live.noPosition')}</Txt>}
      {route && (
        <View testID="live-route-line">
          {route.busy && !route.route && <Loading text={t('office.live.routeLoading')} />}
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

// ---- Playback (the site's usePlayback on a timer: the phone has no animation frame worth the battery) ------------------

interface Playback {
  /** The recorded time the marker is at, Unix ms. */
  t: number;
  start: number;
  end: number;
  playing: boolean;
  /** Playing, or moved away from the start: the marker is shown. */
  active: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  /** To any moment (clamped to the route). */
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

/**
 * The clock runs in recorded time at 1×, 5×, 20× or 60× on a 125 ms tick (each tick moves it on by the real time since
 * the last × the speed, a long tick capped), and stops at the end. A new route (another driver) starts it again at its
 * start, paused; new points on the same route leave the clock alone. Leaving the tab pauses it.
 */
function usePlayback(path: PathPoint[], focused: boolean): Playback {
  const start = path[0]?.at ?? 0;
  const end = path[path.length - 1]?.at ?? 0;
  const [t, setT] = useState(start);
  const tRef = useRef(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(60);
  const speedRef = useRef<PlaybackSpeed>(60);
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    tRef.current = start;
    setT(start);
    setPlaying(false);
  }, [start]);
  useEffect(() => {
    if (!focused) setPlaying(false);
  }, [focused]);

  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const next = advance(tRef.current, now - last, speedRef.current, endRef.current);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= endRef.current) setPlaying(false);
    }, PLAYBACK_TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);

  const seek = useCallback((v: number) => {
    const clamped = Math.max(start, Math.min(end, v));
    tRef.current = clamped;
    setT(clamped);
  }, [start, end]);
  const toggle = useCallback(() => {
    if (!playing && tRef.current >= end) seek(start);
    setPlaying((p) => !p);
  }, [playing, end, start, seek]);
  const setSpeed = useCallback((s: PlaybackSpeed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);
  const shown = Math.max(start, Math.min(end, t));
  return { t: shown, start, end, playing, active: playing || shown > start, speed, toggle, seek, setSpeed };
}

/**
 * The bar under the card's lines: Play / Pause and the speeds on one row (48 px each), then the time slider from the
 * day's first minute with the clock (the recorded time to the second, the speed or "estimated") on its right.
 */
function PlaybackBar({ playback, cursor }: { playback: Playback; cursor: Cursor | null }) {
  const { t } = useApp();
  const words = cursor ? (cursor.estimated ? t('office.live.estimated') : cursor.kmh === null ? '' : t('office.live.kmh', { n: cursor.kmh })) : '';
  return (
    <View style={styles.playback} testID="live-playback">
      <View style={styles.playRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playback.playing ? t('office.live.pause') : t('office.live.play')}
          onPress={playback.toggle}
          testID="live-play"
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}
        >
          {playback.playing ? <Pause size={22} color="#ffffff" strokeWidth={2.6} /> : <Play size={22} color="#ffffff" strokeWidth={2.6} />}
        </Pressable>
        {SPEEDS.map((s) => {
          const on = s === playback.speed;
          return (
            <Pressable key={s} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => playback.setSpeed(s)}
              style={[styles.speed, on && styles.speedOn]}>
              <Mono size={14} bold color={on ? '#ffffff' : colors.ink}>{`${s}×`}</Mono>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sliderRow}>
        <Mono size={12} color={colors.muted}>{clockS(playback.start).slice(0, 5)}</Mono>
        <Slider fraction={sliderFraction(playback.t, playback.start, playback.end)} onSeek={(k) => playback.seek(timeAtFraction(k, playback.start, playback.end))} label={t('office.live.slider')} />
        <View style={styles.clock}>
          <Mono size={15} bold>{cursor ? cursor.time : clockS(playback.t)}</Mono>
          {words ? <Txt variant="small" size={12} numberOfLines={1}>{words}</Txt> : null}
        </View>
      </View>
    </View>
  );
}

/** A time slider (no slider module in the build): a track with a thumb; a touch or a drag anywhere on it jumps there. */
function Slider({ fraction, onSeek, label }: { fraction: number; onSeek: (k: number) => void; label: string }) {
  const width = useRef(0);
  const left = useRef(0);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const seekAt = (pageX: number) => {
    if (width.current > 0) seekRef.current((pageX - left.current) / width.current);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      // Where the track starts on the screen: the touch's page position less its position inside the track.
      left.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
      seekAt(e.nativeEvent.pageX);
    },
    onPanResponderMove: (e) => seekAt(e.nativeEvent.pageX),
  })).current;
  const pct = Math.round(fraction * 100);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => seekRef.current(Math.max(0, Math.min(1, fraction + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))))}
      style={styles.track}
      testID="live-slider"
    >
      <View style={styles.trackBar} pointerEvents="none">
        <View style={[styles.trackFill, { width: `${pct}%` }]} />
      </View>
      <View style={[styles.thumb, { left: `${pct}%` }]} pointerEvents="none" />
    </View>
  );
}

const THUMB = 24;

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 10 },
  map: { flex: 1.2, backgroundColor: colors.mapLand, minHeight: 220 },
  mapControls: { position: 'absolute', top: 68, right: 12, alignItems: 'flex-end', gap: 8 },
  mapButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  mapButtonOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  mapPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 220 },
  chips: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.page },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, minHeight: 64, borderRadius: 12 },
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
    elevation: 12,
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, alignSelf: 'center', marginBottom: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  routeErr: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  playback: { gap: 4, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  speed: { minWidth: 48, height: 48, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  speedOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  clock: { alignItems: 'flex-end', minWidth: 76 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 48, justifyContent: 'center' },
  trackBar: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  trackFill: { height: 6, backgroundColor: colors.blue },
  thumb: { position: 'absolute', top: (48 - THUMB) / 2, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: colors.card, elevation: 2 },
});
