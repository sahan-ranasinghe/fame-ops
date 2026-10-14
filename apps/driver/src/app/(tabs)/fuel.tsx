// Fuel tab (Phase 6, Part 3): this month's fills for my vehicle with the state
// of each video (uploading with a percentage, waiting for Wi-Fi, uploaded,
// failed · tap to retry), and the one button: Log fuel (the fuel form with
// its required video).

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fuel, Video } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateLabel } from '@/components/task';
import { Button, Card, Mono, Plate, Txt } from '@/components/ui';
import { fetchMileage, type Mileage } from '@/lib/api';
import { thousands } from '@/lib/format';
import { getJson, setJson } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { colomboTime, startOfColomboMonth } from '@/lib/time';
import { megabytes, percentOf } from '@/lib/video';
import { flushNow, pendingFuelLogs, retryVideo, videoUploads } from '@/sync';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const CACHE_KEY = 'cache.mileage';

interface Row {
  id: string;
  at: string;
  litres: number | null;
  amountCents: number | null;
  /** The server's word for the video, when the row has reached the server. */
  serverStatus: string | null;
  onServer: boolean;
}

export default function FuelScreen() {
  const app = useApp();
  const { t, vehicle, queue, wifiOnly } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
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

  // The server's rows for this month plus the ones still on the phone, newest first.
  const pending = pendingFuelLogs();
  const uploads = new Map(videoUploads().map((u) => [u.op.fuel_log_id, u]));
  const rows: Row[] = [
    ...(mileage?.fuel ?? []).map((f) => ({ id: f.id, at: f.logged_at, litres: f.litres === null ? null : Number(f.litres), amountCents: f.amount_cents, serverStatus: f.video_status ?? 'none', onServer: true })),
    ...pending.filter((p) => !(mileage?.fuel ?? []).some((f) => f.id === p.id)).map((p) => ({
      id: p.id,
      at: p.logged_at ?? new Date().toISOString(),
      litres: p.litres == null ? null : Number(p.litres),
      amountCents: p.amount_cents ?? null,
      serverStatus: p.video_status ?? 'none',
      onServer: false,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const litres = rows.reduce((sum, r) => sum + (r.litres ?? 0), 0);
  const lkr = rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0) / 100;

  function videoLine(row: Row): { text: string; tone: string; retry?: boolean } {
    const up = uploads.get(row.id);
    if (up?.failed) return { text: t('fuel.failed'), tone: colors.red, retry: true };
    if (up) {
      if (wifiOnly && !app.dataAvailable) return { text: t('fuel.waitingWifi'), tone: colors.amberText };
      if (wifiOnly) return { text: t('fuel.waitingWifi'), tone: colors.amberText };
      return { text: t('fuel.uploading', { pct: percentOf(up.op.offset, up.op.bytes) }), tone: colors.blue };
    }
    if (row.serverStatus === 'uploaded') return { text: t('fuel.uploaded'), tone: colors.blue };
    if (row.serverStatus === 'failed') return { text: t('fuel.failed'), tone: colors.red };
    if (row.serverStatus === 'recorded' || row.serverStatus === 'uploading') return { text: t('fuel.uploading', { pct: 0 }), tone: colors.amberText };
    return { text: t('fuel.noVideo'), tone: colors.muted };
  }

  function retry(row: Row) {
    if (retryVideo(row.id)) {
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
            <Mono size={34} bold>{thousands(Math.round(litres))}</Mono>
            <Txt variant="muted" size={18}>{`${t('fuel.litres')} · LKR ${thousands(Math.round(lkr))}`}</Txt>
          </View>
          <Txt variant="small">{`${rows.length} ${t('fuel.entries')}`}</Txt>
        </Card>

        <Button kind="dark" icon={Fuel} label={t('fuel.logFuel')} onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'fuel' } })} />

        <Card style={{ padding: 0 }}>
          {rows.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('fuel.nothingYet')}</Txt>}
          {rows.map((row, index) => {
            const line = videoLine(row);
            return (
              <Pressable
                key={row.id}
                accessibilityRole={line.retry ? 'button' : undefined}
                onPress={line.retry ? () => retry(row) : undefined}
                style={[styles.row, index > 0 && styles.divider]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Mono size={17} bold>
                    {[row.litres !== null ? `${row.litres} L` : null, row.amountCents !== null ? `LKR ${thousands(row.amountCents / 100)}` : null].filter(Boolean).join(' · ') || '—'}
                  </Mono>
                  <Txt variant="small">{`${dateLabel(row.at)} ${colomboTime(row.at)}${row.onServer ? '' : ` · ${t('fuel.savedOffline')}`}`}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Video size={16} color={line.tone} />
                    <Txt variant="strong" size={14} color={line.tone}>{line.text}</Txt>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </Card>
        {queue.videos > 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>{`${queue.videos} · ${megabytes(queue.videoBytes)}`}</Txt>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 60 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
});
