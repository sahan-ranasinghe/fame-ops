// Round 4–7, §33.6 (Google Pay / Revolut / PickMe's history): one row per fill or reading, on the Fuel and Mileage tabs'
// "Recent" card and on the history (app/history.tsx). Gmail's row: an icon for the kind (a fuel pump, an odometer gauge),
// ONE line with the litres and the amount ("32.5 L · LKR 12,400"; a missing amount reads "–") or the km, ONE grey line
// with the plate and the date in words; at the end the fill's video: a mark once uploaded, how far while it goes up,
// waiting for Wi-Fi, or failed (the row then retries it). The rules: lib/history.ts.

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Fuel, Gauge, RefreshCw, Video, Wifi } from '@/components/icons';
import { Card, Mono, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { thousands } from '@/lib/format';
import { fuelLine, type LogEntry, type Upload, videoMark } from '@/lib/history';
import { percentOf } from '@/lib/video';
import { videoUploads } from '@/sync';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** Every piece of a fill still on the phone, together (the size to go up and how far it is), by the fill's id. */
export function uploadsByFill(): Map<string, Upload> {
  const uploads = new Map<string, Upload>();
  for (const u of videoUploads()) {
    const seen = uploads.get(u.op.fuel_log_id) ?? { failed: false, bytes: 0, offset: 0 };
    uploads.set(u.op.fuel_log_id, { failed: seen.failed || u.failed, bytes: seen.bytes + u.op.bytes, offset: seen.offset + u.op.offset });
  }
  return uploads;
}

export function LogRow({ entry, first, upload, onRetry }: {
  entry: LogEntry;
  first: boolean;
  upload?: Upload;
  /** A fill whose video failed: tapping the row tries again. */
  onRetry?: (entry: LogEntry) => void;
}) {
  const { t, vehicles, wifiOnly } = useApp();
  const plate = entry.vehicleId ? vehicles.find((v) => v.id === entry.vehicleId)?.reg_no ?? null : null;
  const fill = entry.kind === 'fuel';
  const mark = fill ? videoMark(entry, upload, wifiOnly) : null;
  const title = fill ? fuelLine(entry) : `${entry.km === null ? '–' : thousands(entry.km)} ${t('common.km')}`;
  const meta = [plate, dateWords(t, entry.at), entry.onPhone ? t('fuel.savedOffline') : null].filter(Boolean).join(' · ');
  const retry = mark?.kind === 'failed' && onRetry ? () => onRetry(entry) : undefined;
  const pct = mark?.kind === 'uploading' ? percentOf(mark.offset, mark.bytes) : 0;
  const markWords = !mark
    ? null
    : mark.kind === 'uploaded' ? t('fuel.uploaded')
    : mark.kind === 'failed' ? t('fuel.failed')
    : mark.kind === 'waitingWifi' ? t('fuel.waitingWifi')
    : mark.kind === 'uploading' ? t('fuel.uploading', { pct })
    : mark.kind === 'queued' ? t('fuel.uploading', { pct: 0 })
    : t('fuel.noVideo');
  const Icon = fill ? Fuel : Gauge;
  return (
    <Pressable
      accessibilityRole={retry ? 'button' : undefined}
      accessibilityLabel={[t(fill ? 'mileage.fuel' : 'mileage.odometer'), title, meta, markWords].filter(Boolean).join(', ')}
      onPress={retry}
      disabled={!retry}
      style={[styles.row, !first && styles.divider]}
      testID={`log-row-${entry.kind}`}
    >
      <View style={styles.icon}>
        <Icon size={20} color={colors.ink} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Mono size={17} bold numberOfLines={1}>{title}</Mono>
        <Txt variant="small" numberOfLines={1}>{meta}</Txt>
      </View>
      {mark && <VideoBadge mark={mark.kind} pct={pct} />}
    </Pressable>
  );
}

/** The fill's video at the row's end: a mark once uploaded, the share while it goes up, Wi-Fi, or Retry (red). */
function VideoBadge({ mark, pct }: { mark: ReturnType<typeof videoMark>['kind']; pct: number }) {
  if (mark === 'uploaded') return <View testID="video-mark"><Video size={20} color={colors.blue} /></View>;
  if (mark === 'failed') return <View testID="video-failed"><RefreshCw size={20} color={colors.red} /></View>;
  if (mark === 'waitingWifi') return <Wifi size={20} color={colors.amberText} />;
  if (mark === 'uploading' || mark === 'queued') {
    return (
      <View style={styles.badge}>
        <Video size={18} color={colors.amberText} />
        <Mono size={14} color={colors.amberText}>{`${pct} %`}</Mono>
      </View>
    );
  }
  return null;
}

/** The tab's one "Recent" card: its header with "See all", the last few rows, or the empty line. */
export function RecentCard({ entries, empty, seeAll, children }: {
  entries: LogEntry[];
  empty: string;
  /** Where "See all" goes (the history, with its kind). */
  seeAll: 'fuel' | 'all';
  children: (entry: LogEntry, index: number) => ReactNode;
}) {
  const { t } = useApp();
  const router = useRouter();
  return (
    <View style={{ gap: 10 }} testID="recent-card">
      <View style={styles.head}>
        <Txt variant="heading" style={{ flex: 1, marginLeft: 6 }}>{t('logHistory.recent')}</Txt>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/history', params: { kind: seeAll } })}
          hitSlop={8}
          style={styles.seeAll}
          testID="see-all"
        >
          <Txt variant="strong" size={16} color={colors.blue}>{t('logHistory.seeAll')}</Txt>
        </Pressable>
      </View>
      <Card style={{ padding: 0 }}>
        {entries.length === 0 ? <Txt variant="muted" style={{ padding: 18 }}>{empty}</Txt> : entries.map(children)}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.page, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
});
