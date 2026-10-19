// "Map not available" (Part 6): in the map's place when neither map can load (no internet, or the free map's tiles are
// down too). The stops in order with the straight-line distance from the phone to each one still to do, and Try again. The
// screen's buttons are outside the map and keep working (Start, Complete, the odometer, fuel, Report, and Navigate, which
// opens the Google Maps app).

import MapPinOff from 'lucide-react-native/icons/map-pin-off';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mono, Txt } from '@/components/ui';
import { distanceKm } from '@/lib/format';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { GoogleCredit } from './GoogleCredit';
import { SHEET_OVERLAP } from './mapPins';
import { kmText, type LatLng } from './taskMapLogic';
import { stopLabel } from './taskLines';

export function MapUnavailable({ task, me, onRetry }: { task: TaskWithStops; me: LatLng | null; onRetry: () => void }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const stops = task.task_stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
  return (
    <View style={[styles.card, { paddingTop: insets.top + 64 }]} testID="map-unavailable">
      <View style={styles.head}>
        <MapPinOff size={22} color={colors.muted} strokeWidth={2.4} />
        <Txt variant="strong" size={17} style={{ flex: 1 }}>{t('map.unavailable')}</Txt>
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={styles.retry}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('map.tryAgain')}</Txt>
        </Pressable>
      </View>
      <Txt variant="small">{t('map.unavailableBody')}</Txt>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6, paddingBottom: SHEET_OVERLAP + 8 }}>
        {stops.map((s) => {
          const todo = s.status === 'pending' || s.status === 'arrived';
          const km = todo && me && s.lat != null && s.lng != null ? distanceKm(me, { lat: s.lat, lng: s.lng }) : null;
          return (
            <View key={s.id} style={[styles.row, !todo && { opacity: 0.6 }]}>
              <View style={{ flex: 1 }}>
                <Txt variant="small" color={colors.muted}>{stopLabel(t, task, s)}</Txt>
                <Txt variant="strong" size={15} numberOfLines={1}>{s.place_name}</Txt>
                <GoogleCredit show={!!s.google_place_id} />
              </View>
              {km !== null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Mono size={15} bold>{`≈ ${kmText(km)} ${t('common.km')}`}</Mono>
                  <Txt variant="small">{t('task.straightLine')}</Txt>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.mapLand, paddingHorizontal: 16, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
