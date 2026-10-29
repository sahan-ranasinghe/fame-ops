// Round 50 (29 October 2026, phase8-plan.md §37.5): the trip page's offer on /m/ to drive this self trip in the browser
// ("Drive this trip here" → my-trip/[id]/drive), only on the web and only when my_trip's `web.allowed` says so
// (office/webTripLogic.ts offerWebDrive). The phone app never shows it (Platform.OS === 'web' only): it has Driving mode.

import { useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { look } from '@/components/patterns/look';
import { Button, Txt } from '@/components/ui';
import type { MyTrip } from '@/office/types';
import { offerWebDrive } from '@/office/webTripLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function WebDriveOffer({ trip }: { trip: Pick<MyTrip, 'task_id' | 'web'> }) {
  const { t } = useApp();
  const router = useRouter();
  if (Platform.OS !== 'web' || !offerWebDrive(Platform.OS, trip.web)) return null;
  return (
    <View style={styles.card} testID="web-drive-offer">
      <Txt variant="label" color={colors.muted}>{t('office.webTrip.offerTitle').toUpperCase()}</Txt>
      <Txt variant="body">{t('office.webTrip.offerHint')}</Txt>
      <Button label={t('office.webTrip.offer')} onPress={() => router.push({ pathname: '/office/my-trip/[id]/drive', params: { id: trip.task_id } })} style={{ minHeight: 60 }} testID="web-drive-open" />
      <Txt variant="small">{t('office.webTrip.noTracking')}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
});
