// Mileage tab: this month's km for my vehicle against its allowance, today's
// tasks with their km, and Log odometer (Round 51b: one job per tab, fuel only on the Fuel tab).
// A task the office moved to another vehicle (Phase 7 Part 2) shows each vehicle's km under its title.
// Hotfix 3 (L6): today's tasks 20 at a time with "Load more" (the phone's own list: works offline); never a missed one.
// Round 4–7, §33.6 (Google Pay / Revolut / PickMe's history): after today's tasks ONE "Recent" card with the last 5
// readings and fills (an odometer gauge or a fuel pump, the km or the litres, the plate and the date in words; the ones
// still on the phone too) and "See all": the history (app/history.tsx) with the chips All · Odometer · Fuel.
// Round 51b (Sahan, 30 October 2026): one job per tab. Log odometer is the one full-width action (Log fuel is on the Fuel
// tab only); Recent shows ONLY the odometer readings and the finished trips with their km (a gauge or a route, the reading
// or "N km", the plate, the date in words), never a fill, and See all opens the readings and trips (All · Odometer ·
// Trips). The This month card's plate is the vehicle its figures are for: the copy kept on the phone carries its vehicle
// and is read only for that vehicle (a copy for another one never shows under this plate); every Recent row says its own
// plate.

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronRight, Gauge } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadMore } from '@/components/patterns/ListState';
import { Stretches } from '@/components/SwapCard';
import { LogRow, RecentCard, uploadsByFill } from '@/components/LogRows';
import { useNow } from '@/components/task';
import { shownTaskKm, taskTitle } from '@/components/taskLines';
import { Button, Card, Mono, Plate, Txt } from '@/components/ui';
import { fetchMileage, type Mileage } from '@/lib/api';
import { thousands } from '@/lib/format';
import { mergeEntries, odometerEntry, recentEntries, tripEntry } from '@/lib/history';
import { getJson, setJson } from '@/lib/kv';
import { loadMore, PAGE, pageInfo, visibleTasks, windowOf } from '@/lib/lists';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboMonth } from '@/lib/time';
import { pendingOdometerLogs } from '@/sync';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const CACHE_KEY = 'cache.mileage';

export default function MileageScreen() {
  const app = useApp();
  // Off duty, the vehicle held last (Phase 7).
  const { t, workVehicle: vehicle, tasks } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [kept, setMileage] = useState<Mileage | null>(() => getJson<Mileage>(CACHE_KEY));
  const [shown, setShown] = useState(PAGE);
  const now = useNow();

  const vehicleId = vehicle?.id ?? null;
  // Round 51b: the month's figures only when they are this vehicle's (a copy from before Round 51b has no vehicle: not
  // shown either); the newest readings and trips are mine on every vehicle, so they show whatever the vehicle.
  const mileage = kept && kept.vehicleId === vehicleId ? kept : kept ? { ...kept, baselineKm: null, odometer: [] } : null;
  const employeeId = app.me?.id ?? null;
  const queued = app.queue.ops;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchMileage(supabase, vehicleId, startOfColomboMonth(), employeeId)
        .then((fresh) => {
          if (cancelled) return;
          setMileage(fresh);
          setJson(CACHE_KEY, fresh);
        })
        .catch(() => undefined); // offline: keep showing the last numbers
      return () => {
        cancelled = true;
      };
      // Reload when the vehicle changes and when queued entries have been sent.
    }, [vehicleId, queued, employeeId]),
  );

  // Km this month: from the reading the month began with to the newest reading.
  const readings = mileage?.odometer ?? [];
  const startKm = mileage?.baselineKm ?? readings[0]?.reading_km ?? null;
  const nowKm = vehicle?.current_odometer_km ?? readings[readings.length - 1]?.reading_km ?? null;
  const monthKm = startKm !== null && nowKm !== null ? Math.max(0, nowKm - startKm) : 0;
  // No allowance set (null or 0): no allowance line and never "over" (Hotfix 3, L2).
  const allowance = (vehicle?.monthly_km_allowance ?? 0) > 0 ? vehicle!.monthly_km_allowance : null;
  const over = allowance !== null && monthKm > allowance;

  const today = colomboDate();
  const todayTasks = visibleTasks(tasks, now)
    .filter((task) => colomboDate(task.start_at) === today || (task.completed_at && colomboDate(task.completed_at) === today));

  // Round 51b: the last 5 readings and finished trips (never a fill): the readings still on the phone first, today's
  // finished trips the phone holds, then the server's newest (every vehicle), and this vehicle's month as before.
  const finished = tasks.filter((task) => task.status === 'completed' && !!task.completed_at);
  const recent = recentEntries(mergeEntries(
    pendingOdometerLogs().map((log) => odometerEntry(log, true)),
    finished.map((task) => tripEntry({ id: task.id, completed_at: task.completed_at, vehicle_id: task.vehicle_id, km: shownTaskKm(task) })),
    (mileage?.recentOdometer ?? []).map((log) => odometerEntry(log)),
    (mileage?.recentTrips ?? []).map((row) => tripEntry(row)),
    readings.map((log) => odometerEntry(log)),
  ));
  const uploads = uploadsByFill();

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={app.refresh} colors={[colors.ink]} />}
      >
        <Txt variant="title">{t('tabs.mileage')}</Txt>

        <Card style={{ gap: 12 }}>
          <View style={styles.between}>
            <Txt variant="big">{t('mileage.thisMonth')}</Txt>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t('today.noVehicle')}</Txt>}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={34} bold color={over ? colors.red : colors.ink}>{thousands(monthKm)}</Mono>
            <Txt variant="muted" size={18}>
              {allowance !== null ? t('mileage.ofAllowance', { km: thousands(allowance) }) : t('mileage.noAllowance')}
            </Txt>
          </View>
          {allowance !== null && allowance > 0 && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (monthKm / allowance) * 100)}%`, backgroundColor: over ? colors.red : colors.blue }]} />
            </View>
          )}
          {over && <Txt variant="strong" color={colors.red}>{t('mileage.over')}</Txt>}
          <Txt variant="small">{t('mileage.fromYourReadings')}</Txt>
        </Card>

        {/* Round 51b: the one full-width action; fuel is logged on the Fuel tab. */}
        <Button kind="dark" icon={Gauge} label={t('mileage.logOdometer')} testID="mileage-log-odometer"
          onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'manual' } })} />

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('mileage.todayTasks')}</Txt>
          <Card style={{ padding: 0 }}>
            {todayTasks.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('mileage.noTasksToday')}</Txt>}
            {windowOf(todayTasks, shown).map((task, index) => {
              const km = task.status === 'completed' ? shownTaskKm(task) : null;
              return (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                  style={[styles.row, index > 0 && styles.divider]}
                >
                  <Mono size={17} bold style={{ width: 58 }}>{colomboTime(task.start_at)}</Mono>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt variant="strong" numberOfLines={2}>{taskTitle(t, task, true)}</Txt>
                    {km !== null && <Stretches task={task} size={14} />}
                  </View>
                  {km !== null
                    ? <Mono size={17} bold color={colors.blue}>{`${thousands(km)} ${t('common.km')}`}</Mono>
                    : <Txt variant="muted" size={15}>{t(task.status === 'in_progress' ? 'mileage.inProgress' : task.status === 'cancelled' ? 'mileage.cancelled' : 'mileage.notStarted')}</Txt>}
                  <ChevronRight size={20} color={colors.muted} />
                </Pressable>
              );
            })}
          </Card>
          {pageInfo(shown, todayTasks.length).more && <LoadMore shown={pageInfo(shown, todayTasks.length).n} total={todayTasks.length} busy={false} onPress={() => setShown(loadMore(shown, todayTasks.length, null).shown)} />}
        </View>

        <RecentCard entries={recent} empty={t('mileage.nothingYet')} seeAll="all">
          {(entry, index) => <LogRow key={entry.id} entry={entry} first={index === 0} upload={uploads.get(entry.id)} />}
        </RecentCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  track: { height: 10, borderRadius: 5, backgroundColor: '#e7e4dc', overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 60 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
