// Round 50 (docs/phase8-plan.md §37.4): Office mode's Home says "You have a trip to drive · Start driving" while a trip the
// person drives themselves is today and still to start, or under way ("Your trip is under way · Continue driving"). The
// button opens Driving mode on that trip (office/driving.tsx). Nothing for someone who cannot drive, nor in a browser.
// Round 51b (30 October 2026; Uber's upcoming-trip card, Google Calendar's event card): the whole card opens the trip's own
// page (office/my-trip/[id]), pressed as one; Start driving keeps its own action.

import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Car } from '@/components/icons';
import { RowIcon } from '@/components/patterns/ListRow';
import { look } from '@/components/patterns/look';
import { Button } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { useStartDriving, useTripToDrive } from '@/office/driving';
import { Row } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function DriveLine() {
  const { t } = useApp();
  const router = useRouter();
  const trip = useTripToDrive();
  const { busy, start } = useStartDriving();
  if (!trip) return null;
  const running = trip.status === 'in_progress';
  return (
    <View style={styles.card} testID="home-drive-line">
      <Row
        inset
        left={<RowIcon icon={Car} tone="blue" />}
        title={t(running ? 'driving.homeLineRunning' : 'driving.homeLine')}
        line={[colomboTime(trip.leave_by ?? trip.start_at), trip.title].filter(Boolean).join(' · ')}
        right={<Button compact label={t(running ? 'driving.continue' : 'driving.start')} busy={busy} onPress={() => void start(trip.id)} testID="home-start-driving" />}
        onPress={() => router.push({ pathname: '/office/my-trip/[id]', params: { id: trip.id } })}
        accessibilityLabel={`${t(running ? 'driving.homeLineRunning' : 'driving.homeLine')}, ${trip.title ?? ''}`}
        testID="home-drive-card"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, overflow: 'hidden' },
});
