// Round 4–7, feature 7 (Sahan, 22 October 2026): the day's timeline (Google Calendar's resource view, phone layout): who
// has each driver or vehicle, hour by hour (day_timeline). Drivers | Vehicles, the week strip (any day, ahead too), then
// one card per driver or vehicle: the name (a vehicle's plate and its words), the day's line ("2 trips", "Free all day",
// "Not available 08:00–13:00", "In garage"), a thin 06:00–22:00 track with each booking as a bar (to come amber, under way
// blue, done grey; not available dashed red; a line at now on today), then the bookings: the time, the title, and the
// holder's photo and name (who asked for it, else who assigned it; none while holder_contact is off). A booking opens its
// task for who may open tasks. The busy ones first. The rules: office/holderLogic.ts.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { DayStrip } from '@/components/patterns/Calendar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Mono, Plate, Segmented, Txt } from '@/components/ui';
import { colomboDate, colomboTime } from '@/lib/time';
import { barOf, bookingTime, bookingTone, byLine, holderTitle, hourTicks, nowAt, rowLine, type TimelineRow, timelineOrder } from '@/office/holderLogic';
import { useOffice, useTool } from '@/office/state';
import { useSwitch } from '@/office/switches';
import type { DayTimeline } from '@/office/types';
import { Avatar, BackHeader, ListFailed, Screen, StatusChip, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

type Kind = DayTimeline['kind'];

const BAR: Record<'blue' | 'muted' | 'amber', { bg: string; edge: string }> = {
  amber: { bg: colors.amberChip, edge: colors.amber },
  blue: { bg: colors.blueChip, edge: colors.blue },
  muted: { bg: '#ebe9e3', edge: '#b9bcc0' },
};
const STATUS_KEY: Record<string, string> = { assigned: 'office.holders.st_assigned', in_progress: 'office.holders.st_in_progress', completed: 'office.holders.st_completed' };

export default function TimelineScreen() {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const today = colomboDate();
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<Kind>('drivers');
  const q = useTool<DayTimeline>('day_timeline', { date, kind }, { every: 60_000 });
  // Never another day's or kind's rows under the day chosen (skeletons until they come).
  const data = q.data && q.data.date === date && q.data.kind === kind ? q.data : null;
  const rows = data ? timelineOrder(data.rows) : [];
  const opensTasks = me.permissions.includes('assign_tasks');
  const now = date === today ? nowAt(colomboTime(new Date())) : null;
  const ticks = hourTicks();
  // holder_contact off: no holder under a booking and no Asks link (the server sends none; an older answer shows none).
  const holders = useSwitch('holder_contact');
  const mayAsks = holders && me.tools.includes('holder_asks') && ['request', 'approve', 'assign_tasks'].some((p) => me.permissions.includes(p as never));

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        title={t('office.holders.timelineTitle')}
        subtitle={data ? t('office.holders.busyOf', { busy: data.busy, count: data.count }) : t('office.holders.timelineLine')}
        right={mayAsks ? (
          <Pressable accessibilityRole="button" onPress={() => router.push('/office/holder-asks')} style={(state) => [styles.headLink, hoverStyle(state)]} testID="timeline-asks">
            <Txt variant="strong" size={15} color={colors.blue}>{t('office.holders.asksTitle')}</Txt>
          </Pressable>
        ) : undefined}
      />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <Segmented<Kind>
          options={[{ value: 'drivers', label: t('office.holders.drivers') }, { value: 'vehicles', label: t('office.holders.vehicles') }]}
          value={kind}
          onChange={setKind}
        />
        <DayStrip value={date} onChange={setDate} testID="timeline-day" />
        {!data && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {data && rows.length === 0 && <ListEmpty text={t(kind === 'drivers' ? 'office.holders.noDrivers' : 'office.holders.noVehicles')} />}
        {rows.map((r) => (
          <RowCard key={r.id} r={r} kind={kind} now={now} ticks={ticks} meName={me.name} holders={holders} onOpen={opensTasks ? (id) => router.push({ pathname: '/office/task/[id]', params: { id } }) : undefined} />
        ))}
      </Screen>
    </View>
  );
}

function RowCard({ r, kind, now, ticks, meName, holders, onOpen }: {
  r: TimelineRow;
  kind: Kind;
  now: number | null;
  ticks: ReturnType<typeof hourTicks>;
  meName: string;
  /** The switch holder_contact: off = no holder's photo and name under a booking. */
  holders: boolean;
  onOpen?: (taskId: string) => void;
}) {
  const { t } = useApp();
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%` as const;
  return (
    <View style={styles.card} testID="timeline-row">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {kind === 'vehicles' ? <Plate regNo={r.name} /> : <Txt variant="strong" size={17} numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</Txt>}
        {kind === 'vehicles' && r.label ? <Txt variant="muted" size={15} numberOfLines={1} style={{ flex: 1 }}>{r.label}</Txt> : <View style={{ flex: 1 }} />}
        {r.in_garage ? <StatusChip text={t('office.holders.inGarage')} tone="red" /> : null}
      </View>
      <Txt variant="small">{rowLine(r, t)}</Txt>
      {/* The day's track, 06:00–22:00: the bookings as bars, not available dashed, now as a line. */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {ticks.slice(1, -1).map((k) => <View key={k.h} style={[styles.tick, { left: pct(k.at) }]} />)}
        {(r.not_available ?? []).map((u, i) => {
          const b = barOf(u.from, u.to);
          return b ? <View key={`na-${i}`} style={[styles.bar, styles.away, { left: pct(b.left), width: pct(b.width) }]} /> : null;
        })}
        {r.bookings.map((x) => {
          const b = barOf(x.from, x.to);
          const c = BAR[bookingTone(x.status)];
          return b ? <View key={x.task_id} style={[styles.bar, { left: pct(b.left), width: pct(b.width), backgroundColor: c.bg, borderColor: c.edge }]} /> : null;
        })}
        {now !== null && <View style={[styles.now, { left: pct(now) }]} />}
      </View>
      <View style={styles.scale}>
        {ticks.filter((_, i) => i % 2 === 0).map((k) => <Mono key={k.h} size={11} color={colors.muted}>{k.label}</Mono>)}
      </View>
      {r.bookings.map((x) => {
        const tone: Tone = bookingTone(x.status);
        const inner = (
          <>
            <Mono size={14} bold style={{ width: 92 }}>{bookingTime(x, t)}</Mono>
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <Txt variant="strong" size={15} numberOfLines={1}>{x.title}</Txt>
              {kind === 'drivers' && x.vehicle ? <Txt variant="small" numberOfLines={1}>{x.vehicle}</Txt> : null}
              {kind === 'vehicles' && x.driver ? <Txt variant="small" numberOfLines={1}>{x.driver}</Txt> : null}
              {x.holder && holders ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="timeline-holder">
                  <Avatar name={x.holder.name} size={22} photo={x.holder.photo_url} />
                  <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{[holderTitle(x.holder, meName, t), byLine({ name: x.holder.name, by: x.holder.by }, t)].filter(Boolean).join(' · ')}</Txt>
                </View>
              ) : null}
            </View>
            {STATUS_KEY[x.status] ? <StatusChip text={t(STATUS_KEY[x.status])} tone={tone} /> : null}
            {onOpen ? <ChevronRight size={18} color={colors.muted} /> : null}
          </>
        );
        return onOpen ? (
          <Pressable key={x.task_id} accessibilityRole="button" onPress={() => onOpen(x.task_id)} style={(state) => [styles.booking, hoverStyle(state), state.pressed && { opacity: 0.7 }]} testID="timeline-booking">
            {inner}
          </Pressable>
        ) : (
          <View key={x.task_id} style={styles.booking} testID="timeline-booking">{inner}</View>
        );
      })}
      {(r.not_available ?? []).map((u, i) => (
        <View key={`na-row-${i}`} style={styles.booking}>
          <Mono size={14} bold style={{ width: 92 }}>{`${u.from}–${u.to}`}</Mono>
          <Txt variant="muted" size={15} style={{ flex: 1 }}>{t('office.holders.notAvailable')}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  track: { height: 22, borderRadius: 6, backgroundColor: colors.page, position: 'relative', overflow: 'hidden', marginTop: 2 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.line },
  bar: { position: 'absolute', top: 3, bottom: 3, borderRadius: 4, borderWidth: 1.5 },
  away: { backgroundColor: colors.redChip, borderColor: colors.red, borderStyle: 'dashed' },
  now: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.red },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  booking: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderTopWidth: 1, borderTopColor: '#efede8', paddingTop: 8 },
});
