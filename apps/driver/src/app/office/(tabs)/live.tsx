// Office mode (Phase 8, O1): the Live tab (design 15), the office person's live map of the drivers. The map first (both
// engines, components/DriversMap.tsx), the drivers as markers (initials in a ring: blue on a task, green free, grey off
// duty), the filter chips, then the rows. Tapping a row or a marker selects the driver: the map moves to them and a card
// comes up over the bottom (the name, the plate, the line, Call / WhatsApp / Open in Maps from the links the server gave).
// `live_drivers` is read when the tab opens, every 30 s while it is in front, and on pull to refresh. Opened from Home
// with ?driver=<username>, that driver is selected. Trails and playback are not built in O1 (no button for them).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DriversMap } from '@/components/DriversMap';
import { type LucideIcon, MessageCircle, Navigation, Phone, X } from '@/components/icons';
import { LanguagePill } from '@/components/LanguageSwitch';
import { DriverDot } from '@/components/mapPins';
import { Plate, Txt } from '@/components/ui';
import { filterCounts, filterDrivers, focusOf, frameAll, LIVE_FILTERS, type LiveFilter, markersOf, pillOf, rowLine } from '@/office/liveLogic';
import { useOffice, useTool } from '@/office/state';
import { initials } from '@/office/text';
import type { LiveDriver, LiveDrivers } from '@/office/types';
import { Divider, Empty, ErrorNotice, FilterChips, Loading, Pill } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function LiveTab() {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { driver: param } = useLocalSearchParams<{ driver?: string }>();
  const q = useTool<LiveDrivers>('live_drivers', {}, { every: 30_000 });
  const [filter, setFilter] = useState<LiveFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  // The same row tapped again moves the map to the driver again.
  const [nonce, setNonce] = useState(0);

  const all = useMemo(() => q.data?.drivers ?? [], [q.data]);
  const counts = useMemo(() => filterCounts(all), [all]);
  const rows = useMemo(() => filterDrivers(all, filter), [all, filter]);
  const markers = useMemo(() => markersOf(rows, selected, t), [rows, selected, t]);
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

  const subtitle = all.length === 1 ? t('office.live.countOne') : t('office.live.count', { n: all.length });

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
        <DriversMap markers={markers} fit={fit} focus={focus} onPressMarker={select} mapPackage={me.map?.package} />
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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: chosen ? 240 : 24 }}
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

      {chosen && <DriverCard d={chosen} onClose={() => setSelected(null)} />}
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

/** The selected driver's card over the bottom: the name, the plate, the lines, Call / WhatsApp / Open in Maps as the links allow. */
function DriverCard({ d, onClose }: { d: LiveDriver; onClose: () => void }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const pill = pillOf(d);
  const links = d.links ?? {};
  const extra = [d.status_text, d.task_note, d.not_available, d.app_stops_text].filter((s): s is string => !!s);
  return (
    <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 12) }]} testID="live-card">
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
      {(links.call || links.whatsapp || links.maps) && (
        <View style={styles.actions}>
          {links.call && <Action icon={Phone} label={t('office.common.call')} url={links.call} />}
          {links.whatsapp && <Action icon={MessageCircle} label={t('office.common.whatsapp')} url={links.whatsapp} />}
          {links.maps && <Action icon={Navigation} label={t('office.live.openMaps')} url={links.maps} />}
        </View>
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
