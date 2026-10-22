// Fuel tab (Phase 6, Part 3): this month's fills for my vehicle, and the one button: Log fuel (the fuel form with its
// required video).
// Round 4–7, §33.6 (Google Pay / Revolut / PickMe's history; Sahan, 22 October 2026): no list that grows without end. The
// summary card on top (the month's litres and amount), Log fuel, then ONE "Recent" card with the last 5 fills (a fuel
// pump, the litres and the amount, the plate and the date in words, the video's mark once uploaded; a failed upload
// retries from its row) and "See all", which opens the history (app/history.tsx: by month, 20 at a time). A missing
// amount reads "–", never "LKR 0": the total adds only the known amounts and says "2 fills without an amount".
// The month's rows are all on the phone already (at most 200, the totals need them); offline the same, with the fills
// still on the phone.

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fuel } from '@/components/icons';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogRow, RecentCard, uploadsByFill } from '@/components/LogRows';
import { Button, Card, Mono, Plate, Txt } from '@/components/ui';
import { fetchMileage, type Mileage } from '@/lib/api';
import { thousands } from '@/lib/format';
import { fuelEntry, fuelTotals, type LogEntry, mergeEntries, missingAmountKey, recentEntries, totalAmountText } from '@/lib/history';
import { getJson, setJson } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { startOfColomboMonth } from '@/lib/time';
import { megabytes } from '@/lib/video';
import { flushNow, pendingFuelLogs, retryVideo } from '@/sync';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const CACHE_KEY = 'cache.mileage';

export default function FuelScreen() {
  const app = useApp();
  // Off duty, the vehicle held last (Phase 7).
  const { t, workVehicle: vehicle, queue } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mileage, setMileage] = useState<Mileage | null>(() => getJson<Mileage>(CACHE_KEY));
  const [, bump] = useState(0);

  const vehicleId = vehicle?.id ?? null;
  const queued = queue.ops;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchMileage(supabase, vehicleId, startOfColomboMonth())
        .then((fresh) => {
          if (cancelled) return;
          setMileage(fresh);
          setJson(CACHE_KEY, fresh);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [vehicleId, queued]),
  );

  // The month's fills from the server and the ones still on the phone (the phone's copy first), newest first.
  const entries: LogEntry[] = mergeEntries(
    pendingFuelLogs().map((p) => fuelEntry(p, true)),
    (mileage?.fuel ?? []).map((f) => fuelEntry(f)),
  );
  const totals = fuelTotals(entries);
  const missing = missingAmountKey(totals);
  const uploads = uploadsByFill();

  function retry(entry: LogEntry) {
    if (retryVideo(entry.id)) {
      bump((n) => n + 1);
      void flushNow(true);
    }
  }

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={app.refresh} colors={[colors.ink]} />}
      >
        <Txt variant="title">{t('fuel.title')}</Txt>

        <Card style={{ gap: 12 }}>
          <View style={styles.between}>
            <Txt variant="big">{t('fuel.thisMonth')}</Txt>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t('today.noVehicle')}</Txt>}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <Mono size={34} bold>{thousands(Math.round(totals.litres))}</Mono>
            <Txt variant="muted" size={18}>{`${t('fuel.litres')} · ${totalAmountText(totals)}`}</Txt>
          </View>
          <Txt variant="small">{`${totals.fills} ${t('fuel.entries')}`}</Txt>
          {missing && <Txt variant="small" color={colors.amberText} testID="fuel-no-amount">{t(missing.key, { n: missing.n })}</Txt>}
        </Card>

        <Button kind="dark" icon={Fuel} label={t('fuel.logFuel')} onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'fuel' } })} />

        <RecentCard entries={recentEntries(entries)} empty={t('fuel.nothingYet')} seeAll="fuel">
          {(entry, index) => <LogRow key={entry.id} entry={entry} first={index === 0} upload={uploads.get(entry.id)} onRetry={retry} />}
        </RecentCard>
        {queue.videos > 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>{`${queue.videos} · ${megabytes(queue.videoBytes)}`}</Txt>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
