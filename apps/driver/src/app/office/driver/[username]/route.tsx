// Office mode (Phase 8, Stage 2 start; Sahan's decision 2, 20 October 2026: the driver page split, Uber's driver profile,
// Samsara): a driver's day on its own screen, opened from the profile's "Today's route" card, from Live's "Earlier days"
// (?date=) or from a link with a day. The day strip (today and the 89 days before it), driver_route at tolerance 0 (up to
// 3,000 points, the estimated roads; today read again every minute, a past day once), the day's tasks with their km
// (list_tasks, with assign_tasks; a row opens the task) and components/office/DayRoute.tsx: the map on both engines, one
// playback bar, the day's numbers and the timeline. Back means back. The rules: office/historyLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DayRoute } from '@/components/office/DayRoute';
import { DayStrip } from '@/components/patterns/Calendar';
import { SkeletonRows } from '@/components/patterns/ListState';
import { Mono, Txt } from '@/components/ui';
import { colomboDate } from '@/lib/time';
import { dayRouteArgs, dayTasks, dayTasksArgs, historyDay, historyMin, routeEvery } from '@/office/historyLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriverProfile, DriverRoute, TaskHistory } from '@/office/types';
import { BackHeader, ListFailed, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function DriverDayRoute() {
  const { username, date: askedDate } = useLocalSearchParams<{ username: string; date?: string }>();
  const router = useRouter();
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const today = colomboDate();

  // The driver's name for the header (the profile the page before it read; a link straight here reads it once).
  const profile = useTool<DriverProfile>('driver_profile', { driver: username });
  const name = profile.data?.driver?.name ?? username;
  const [day, setDay] = useState(() => historyDay(askedDate, today));
  const route = useTool<DriverRoute>('driver_route', dayRouteArgs(username, day), { every: routeEvery(day, today) });
  const mayTasks = me.tools.includes('list_tasks');
  const tasks = useTool<TaskHistory>('list_tasks', dayTasksArgs(username, day), { enabled: mayTasks });
  const theDay = tasks.data ? dayTasks(tasks.data.tasks) : null;
  // An answer for another day is never drawn under the chosen day (the tool keeps the last answer while the next loads).
  const routeData = route.data && route.data.date === day ? route.data : null;
  const refresh = () => void Promise.all([route.reload(), mayTasks ? tasks.reload() : Promise.resolve()]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={name} subtitle={t('office.history.routeTitle')} />
      <Screen refreshing={route.refreshing} onRefresh={refresh} bottom={24}>
        <DayStrip value={day} onChange={setDay} max={today} min={historyMin(today)} testID="history-day" />
        <View>
          <DayRoute
            data={routeData}
            error={route.error}
            onRetry={refresh}
            onSignIn={() => void signOut()}
            mapPackage={me.map?.package}
            emptyText={t('office.history.noDayPoints')}
          >
            {mayTasks && (
              <View style={{ paddingVertical: 8, gap: 2 }} testID="history-tasks">
                <Txt variant="strong" size={15}>{t('office.history.dayTasks')}</Txt>
                {!theDay && !tasks.error && <SkeletonRows rows={2} lines={1} />}
                {tasks.error && <ListFailed stale={!!theDay} error={tasks.error} onRetry={() => void tasks.reload()} onSignIn={() => void signOut()} />}
                {theDay && theDay.tasks.length === 0 && <Txt variant="muted" size={15}>{t('office.history.noDayTasks')}</Txt>}
                {theDay && theDay.tasks.length > 0 && <Txt variant="small">{t('office.history.dayTasksLine', { n: theDay.tasks.length, km: theDay.km })}</Txt>}
                {theDay?.tasks.map((x) => (
                  <Pressable key={x.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: x.id } })}
                    style={({ pressed }) => [styles.taskRow, pressed && { opacity: 0.8 }]} testID="history-task">
                    <Mono size={14} bold>{x.time}</Mono>
                    <View style={{ flex: 1 }}>
                      <Txt variant="strong" size={15} numberOfLines={1}>{x.title}</Txt>
                      <Txt variant="small" numberOfLines={1}>{[t(`office.history.status_${x.status}`), x.vehicle, x.km != null ? t('office.history.kmLine', { km: x.km }) : ''].filter(Boolean).join(' · ')}</Txt>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </DayRoute>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 6 },
});
