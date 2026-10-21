// Office mode (Phase 8, O2): a driver's page, opened from a row of the Drivers board. The profile (driver_profile: the
// photo's letters, the name and code, Call / WhatsApp from the links, the vehicle held today, the licence chip with its
// expiry, this month's tasks and km, what is missing; the emergency contact and the licence number only when the server
// sent them, i.e. the person holds vehicles or users), today's state (the driver's row of drivers_board, when the person
// may read the board), the days marked not available (Remove through remove_unavailability after a confirmation, when
// allowed), and a "Today's route" card (today's km, driving time and stops) that opens the day's route on its own screen
// (driver/[username]/route: the day strip, the map, playback, the timeline, the day's tasks; Sahan's decision 2,
// 20 October 2026, Uber's driver profile, Samsara). A link with `?date=` opens that day's route. Back means back.
// The rules: office/driversLogic.ts and office/historyLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, MessageCircle, Phone, Plus, Route as RouteIcon } from '@/components/icons';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import { colomboDate } from '@/lib/time';
import { boardPill, entryParts, rowLines } from '@/office/driversLogic';
import { durationText } from '@/lib/durations';
import { dayNumbers } from '@/office/driversLogic';
import { todaySummaryArgs } from '@/office/historyLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriverProfile, DriverRoute, DriversBoard, FleetError, UnavailableEntry } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, BackHeader, Divider, ErrorNotice, ListFailed, Pill, Screen, Section, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LICENCE_TONE: Record<string, Tone> = { ok: 'green', orange: 'amber', red: 'red', 'not set': 'muted' };

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function DriverPage() {
  const { username, date: askedDate } = useLocalSearchParams<{ username: string; date?: string }>();
  const router = useRouter();
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const names = { days: tList('days'), months: tList('months') };
  const dayLabel = (date: string) => shortDate(names, `${date}T06:00:00Z`);
  const today = colomboDate();

  const profile = useTool<DriverProfile>('driver_profile', { driver: username });
  const mayBoard = me.tools.includes('drivers_board');
  const board = useTool<DriversBoard>('drivers_board', { search: username }, { enabled: mayBoard, every: 60_000 });
  const mayRoute = me.tools.includes('driver_route');
  // Today's numbers for the card (a short line; the route screen reads the whole day).
  const todayRoute = useTool<DriverRoute>('driver_route', todaySummaryArgs(username, today), { enabled: mayRoute, every: 60_000 });
  const todayNumbers = todayRoute.data ? dayNumbers(todayRoute.data) : null;
  const openRoute = (date?: string) => router.push({ pathname: '/office/driver/[username]/route', params: { username, ...(date ? { date } : {}) } });
  // A link with a day (Live's "Earlier days", a notification) opens that day's route, once, over the profile.
  const [openedDay, setOpenedDay] = useState(false);
  useEffect(() => {
    if (askedDate && mayRoute && !openedDay) {
      setOpenedDay(true);
      openRoute(askedDate);
    }
  }, [askedDate, mayRoute, openedDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const mayRemove = me.tools.includes('remove_unavailability');
  const [problem, setProblem] = useState<FleetError | null>(null);
  // The entry whose Remove failed: Try again removes it again (never only hides the error).
  const [lastRemove, setLastRemove] = useState<UnavailableEntry | null>(null);

  const p = profile.data;
  const d = p?.driver;
  const row = board.data?.drivers.find((x) => x.username === username) ?? board.data?.drivers.find((x) => d && x.name === d.name) ?? null;


  const refresh = () => void Promise.all([profile.reload(), mayBoard ? board.reload() : Promise.resolve(), mayRoute ? todayRoute.reload() : Promise.resolve()]);

  function confirmRemove(e: UnavailableEntry) {
    const when = entryParts(e, dayLabel, t).slice(0, 2).join(' · ');
    Alert.alert(t('office.drivers.removeTitle'), t('office.drivers.removeBody', { name: d?.name ?? '', when }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('office.drivers.remove'), style: 'destructive', onPress: () => void remove(e) },
    ]);
  }
  async function remove(e: UnavailableEntry) {
    setProblem(null);
    setLastRemove(e);
    try {
      await api.call('remove_unavailability', { id: e.id });
      setLastRemove(null);
      profile.patch((prev) => ({ ...prev, not_available: prev.not_available.filter((x) => x.id !== e.id) }));
      if (mayBoard) void board.reload();
    } catch (err) {
      setProblem(err as FleetError);
    }
  }

  const licence = d?.licence_chip ?? (p?.licence ? { chip: p.licence.chip, expiry: p.licence.expiry ?? null } : null);
  const links = d?.links ?? {};
  const pill = row ? boardPill(row) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={d?.name ?? username} subtitle={d ? [t('office.drivers.profile.code', { code: d.code }), d.active ? '' : t('office.drivers.profile.switchedOff')].filter(Boolean).join(' · ') : undefined} />
      <Screen refreshing={profile.refreshing} onRefresh={refresh} bottom={24}>
        {!profile.data && !profile.error && <SkeletonRows rows={3} lines={2} />}
        {profile.error && <ListFailed stale={!!p} error={profile.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {profile.data && !d && <ListEmpty text={t('office.drivers.profile.notFound')} />}
        {d && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={d.name} size={56} photo={d.photo_url} />
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="big" numberOfLines={1}>{d.name}</Txt>
                {d.phone_display ? <Mono size={15} color={colors.muted}>{d.phone_display}</Mono> : null}
                {pill && row && <Pill text={t(`office.drivers.pill.${pill.key}`)} tone={pill.tone} size={13} />}
              </View>
            </View>
            {(links.call || links.whatsapp) && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {links.call && <Action icon={Phone} label={t('office.common.call')} onPress={() => open(links.call as string)} />}
                {links.whatsapp && <Action icon={MessageCircle} label={t('office.common.whatsapp')} onPress={() => open(links.whatsapp as string)} />}
              </View>
            )}
            {row && <Txt variant="muted" size={15}>{rowLines(row, t).filter(Boolean).join(' · ')}</Txt>}
            <Divider />
            <Line label={t('office.drivers.profile.currentVehicle')}>
              {d.current_vehicle ? <Plate regNo={d.current_vehicle.split(' · ')[0]} /> : <Txt variant="muted" size={15}>{t('office.drivers.profile.noVehicle')}</Txt>}
            </Line>
            <Line label={t('office.drivers.profile.licence')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {licence && <Pill text={licence.expiry ? t('office.drivers.profile.licenceExpiry', { date: licence.expiry }) : t('office.drivers.profile.licenceNotSet')} tone={LICENCE_TONE[licence.chip] ?? 'muted'} size={13} />}
                {p?.licence?.number ? <Mono size={14} color={colors.muted}>{t('office.drivers.profile.licenceNumber', { number: p.licence.number })}</Mono> : null}
              </View>
            </Line>
            {p && (
              <Line label={t('office.drivers.profile.thisMonth')}>
                <Txt variant="strong" size={15}>{t('office.drivers.profile.tasksKm', { tasks: p.this_month.tasks, km: Math.round(p.this_month.km) })}</Txt>
              </Line>
            )}
            {p?.emergency && (p.emergency.name || p.emergency.phone_display) && (
              <Line label={t('office.drivers.profile.emergency')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Txt variant="strong" size={15} style={{ flex: 1 }} numberOfLines={2}>{[p.emergency.name, p.emergency.relation, p.emergency.phone_display].filter(Boolean).join(' · ')}</Txt>
                  {p.emergency.links?.call && (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open(p.emergency!.links!.call as string)} style={styles.iconBtn}>
                      <Phone size={20} color={colors.ink} strokeWidth={2.4} />
                    </Pressable>
                  )}
                </View>
              </Line>
            )}
            {p && p.missing.length > 0 && <Txt variant="small" color={colors.amberText}>{t('office.drivers.profile.missing', { list: p.missing.join(', ') })}</Txt>}
            {p?.private_hidden && <Txt variant="small">{p.private_hidden}</Txt>}
            {d.app_version && <Txt variant="small">{t('office.drivers.profile.appVersion', { version: d.app_version })}</Txt>}
          </View>
        )}

        {/* The day's route: under the person, before the New task button (the screen's way to the map). */}
        {mayRoute && d && (
          <Pressable accessibilityRole="button" onPress={() => openRoute()} style={({ pressed }) => [styles.card, styles.routeCard, pressed && { opacity: 0.85 }]} testID="driver-today-route">
            <RouteIcon size={26} color={colors.blue} strokeWidth={2.2} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="strong" size={17}>{t('office.history.todayRoute')}</Txt>
              {!todayRoute.data && !todayRoute.error && <Txt variant="small">{t('office.common.loading')}</Txt>}
              {!todayRoute.data && todayRoute.error && <Txt variant="small" color={colors.amberText}>{t('office.history.todayFailed')}</Txt>}
              {todayNumbers && (todayNumbers.km !== null || todayNumbers.drivingMin > 0
                ? <Txt variant="small">{t('office.history.todayLine', { km: todayNumbers.km ?? 0, driving: durationText(t, todayNumbers.drivingMin), stops: todayNumbers.stops })}</Txt>
                : <Txt variant="small">{t('office.history.noDayPoints')}</Txt>)}
              <Txt variant="small" color={colors.blue}>{t('office.history.openRoute')}</Txt>
            </View>
            <ChevronRight size={22} color={colors.muted} />
          </Pressable>
        )}

        {d && d.active && me.tools.includes('create_task') && (
          <Button icon={Plus} label={t('office.drivers.newTaskFor', { name: d.name.split(' ')[0] })} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'task', driver: username, name: d.name } })} style={{ minHeight: 56 }} testID="driver-new-task" />
        )}

        {p && (
          <Section title={t('office.drivers.profile.notAvailable')} count={p.not_available.length}>
            {p.not_available.length === 0 && <ListEmpty text={t('office.drivers.profile.noEntries')} />}
            {p.not_available.map((e, i) => (
              <View key={e.id}>
                {i > 0 && <Divider />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 6 }}>
                  <View style={[styles.dot, { backgroundColor: e.part === 'full_day' ? colors.red : colors.amber }]} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong" size={15}>{entryParts(e, dayLabel, t).join(' · ')}</Txt>
                    <Txt variant="small">{t('office.drivers.addedBy', { name: e.added_by, at: e.added })}</Txt>
                  </View>
                  {mayRemove && (
                    <Pressable accessibilityRole="button" onPress={() => confirmRemove(e)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
                      <Txt variant="strong" size={15} color={colors.red}>{t('office.drivers.remove')}</Txt>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
            {problem && <ErrorNotice error={problem} onRetry={() => { if (lastRemove) void remove(lastRemove); else setProblem(null); }} />}
          </Section>
        )}

      </Screen>
    </View>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 }}>
      <Txt variant="small" style={{ width: 110 }}>{label}</Txt>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function Action({ icon: Icon, label, onPress }: { icon: typeof Phone; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
      <Icon size={20} color={colors.ink} strokeWidth={2.4} />
      <Txt variant="strong" size={15}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  action: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  iconBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72 },
});
