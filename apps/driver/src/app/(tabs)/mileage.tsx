// Mileage tab: this month's km for my vehicle against its allowance, today's
// tasks with their km, and the two buttons to log a reading or fuel.

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronRight, Fuel, Gauge } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateLabel } from '@/components/task';
import { Button, Card, Mono, Plate, Txt } from '@/components/ui';
import { fetchMileage, type Mileage } from '@/lib/api';
import { thousands } from '@/lib/format';
import { getJson, setJson } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboMonth } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const CACHE_KEY = 'cache.mileage';

export default function MileageScreen() {
  const app = useApp();
  const { t, vehicle, tasks } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  const [mileage, setMileage] = useState<Mileage | null>(() => getJson<Mileage>(CACHE_KEY));

  const vehicleId = vehicle?.id ?? null;
  const queued = app.queue.ops;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchMileage(supabase, vehicleId, startOfColomboMonth())
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
    }, [vehicleId, queued]),
  );

  // Km this month: from the reading the month began with to the newest reading.
  const readings = mileage?.odometer ?? [];
  const startKm = mileage?.baselineKm ?? readings[0]?.reading_km ?? null;
  const nowKm = vehicle?.current_odometer_km ?? readings[readings.length - 1]?.reading_km ?? null;
  const monthKm = startKm !== null && nowKm !== null ? Math.max(0, nowKm - startKm) : 0;
  const allowance = vehicle?.monthly_km_allowance ?? null;
  const over = allowance !== null && monthKm > allowance;

  const today = colomboDate();
  const todayTasks = tasks.filter((task) => colomboDate(task.start_at) === today || (task.completed_at && colomboDate(task.completed_at) === today));

  const entries = [
    ...readings.map((log) => ({ at: log.logged_at, title: t('mileage.odometer'), value: thousands(log.reading_km) })),
    ...(mileage?.fuel ?? []).map((log) => ({
      at: log.logged_at,
      title: t('mileage.fuel'),
      value: [log.litres !== null ? `${Number(log.litres)} L` : null, log.amount_cents !== null ? `LKR ${thousands(log.amount_cents / 100)}` : null]
        .filter(Boolean).join(' · '),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

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

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button kind="dark" icon={Gauge} label={t('mileage.logOdometer')} style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'manual' } })} />
          <Button kind="outline" icon={Fuel} label={t('mileage.logFuel')} style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'fuel' } })} />
        </View>

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('mileage.todayTasks')}</Txt>
          <Card style={{ padding: 0 }}>
            {todayTasks.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('mileage.noTasksToday')}</Txt>}
            {todayTasks.map((task, index) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
                style={[styles.row, index > 0 && styles.divider]}
              >
                <Mono size={17} bold style={{ width: 58 }}>{colomboTime(task.start_at)}</Mono>
                <Txt variant="strong" style={{ flex: 1 }} numberOfLines={2}>{task.title}</Txt>
                {task.status === 'completed' && task.km !== null
                  ? <Mono size={17} bold color={colors.blue}>{`${thousands(task.km)} ${t('common.km')}`}</Mono>
                  : <Txt variant="muted" size={15}>{t(task.status === 'in_progress' ? 'mileage.inProgress' : task.status === 'cancelled' ? 'mileage.cancelled' : 'mileage.notStarted')}</Txt>}
                <ChevronRight size={20} color={colors.muted} />
              </Pressable>
            ))}
          </Card>
        </View>

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('mileage.recent')}</Txt>
          <Card style={{ padding: 0 }}>
            {entries.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('mileage.nothingYet')}</Txt>}
            {entries.map((entry, index) => (
              <View key={`${entry.at}-${entry.title}`} style={[styles.row, index > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Txt variant="strong">{entry.title}</Txt>
                  <Txt variant="small">{`${dateLabel(entry.at)} ${colomboTime(entry.at)}`}</Txt>
                </View>
                <Mono size={17} bold>{entry.value}</Mono>
              </View>
            ))}
          </Card>
        </View>
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
