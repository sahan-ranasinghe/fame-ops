// Round 4–7, §33.6 (Google Pay / Revolut / PickMe's history): one row per fill or reading, on the Fuel and Mileage tabs'
// "Recent" card and on the history (app/history.tsx). Gmail's row (the app's one list row, components/patterns/ListRow):
// an icon for the kind (a fuel pump, an odometer gauge), ONE line with the litres and the amount ("32.5 L · LKR 12,400"; a
// missing amount reads "–") or the km, ONE grey line with the plate and the date in words; a fill's video in words under
// it ("Uploaded", "40 % of 12.3 MB", "Waiting for Wi-Fi", "Failed · tap to retry", "No video") with its mark at the end.
// A failed video is retried by a tap only while the phone still holds the piece; a failure only the server knows is said,
// not offered. The rules: lib/history.ts.

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Fuel, Gauge, RefreshCw, TriangleAlert, Video, Wifi } from '@/components/icons';
import { ListRow, RowIcon } from '@/components/patterns/ListRow';
import { Card, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { thousands } from '@/lib/format';
import { fuelLine, type LogEntry, type Upload, videoMark, videoWords } from '@/lib/history';
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
  /** A fill whose video failed on this phone: tapping the row tries again. */
  onRetry?: (entry: LogEntry) => void;
}) {
  const { t, vehicles, wifiOnly } = useApp();
  const plate = entry.vehicleId ? vehicles.find((v) => v.id === entry.vehicleId)?.reg_no ?? null : null;
  const fill = entry.kind === 'fuel';
  const mark = fill ? videoMark(entry, upload, wifiOnly) : null;
  const title = fill ? fuelLine(entry) : `${entry.km === null ? '–' : thousands(entry.km)} ${t('common.km')}`;
  const meta = [plate, dateWords(t, entry.at), entry.onPhone ? t('fuel.savedOffline') : null].filter(Boolean).join(' · ');
  // A retry only for a piece the phone's queue still holds (and a screen that retries): never a tap that does nothing.
  const retry = mark?.kind === 'failed' && mark.retry && onRetry ? () => onRetry(entry) : undefined;
  const words = mark ? videoWords(mark, !!retry) : null;
  const markWords = words ? t(words.key, words.vars) : null;
  const Icon = fill ? Fuel : Gauge;
  return (
    <View style={!first && styles.divider}>
      <ListRow
        inset
        left={<RowIcon icon={Icon} tone="quiet" />}
        title={title}
        titleMono
        line={meta}
        line2={markWords ?? undefined}
        line2Tone={words?.tone}
        right={mark ? <VideoBadge mark={mark} retry={!!retry} /> : undefined}
        onPress={retry}
        accessibilityLabel={[t(fill ? 'mileage.fuel' : 'mileage.odometer'), title, meta, markWords].filter(Boolean).join(', ')}
        testID={`log-row-${entry.kind}`}
      />
    </View>
  );
}

/** The fill's video at the row's end (its words are on the row's second line): uploaded, going up, Wi-Fi, failed. */
function VideoBadge({ mark, retry }: { mark: ReturnType<typeof videoMark>; retry: boolean }) {
  if (mark.kind === 'uploaded') return <View testID="video-mark"><Video size={20} color={colors.blue} /></View>;
  if (mark.kind === 'failed') return <View testID={retry ? 'video-failed' : 'video-failed-server'}>{retry ? <RefreshCw size={20} color={colors.red} /> : <TriangleAlert size={20} color={colors.red} />}</View>;
  if (mark.kind === 'waitingWifi') return <Wifi size={20} color={colors.amberText} />;
  if (mark.kind === 'uploading' || mark.kind === 'queued') return <Video size={20} color={mark.kind === 'uploading' ? colors.blue : colors.amberText} />;
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
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seeAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
});
