// Office mode and /m/ (Round 4–7, feature 4; phase8-plan.md §33.1): a trip nobody drives with the app, on the person's own
// account (I'll drive myself, or Someone else drives it). Opened from My trips' row button (Vehicle check, Trip finished?,
// Enter the odometer) and from the notification "Trip finished? Enter the odometer" (/my-trips/<task>, office/nav.ts).
// my_trip says where the trip is and what it asks now; the page shows the trip in one card and that one job:
// - before setting off: "Any damage or problem with <plate>?" No, all good / Yes, a problem, each opening the check's step
//   (my-trip/[id]/check), with when the check starts the trip (from 2 h before on its day; earlier it is only recorded).
//   With the switch vehicle_check off: only the odometer (Start the trip, disabled with its reason before that time).
//   "Trip already done? Enter the odometer" for someone back without a check.
// - started, asked, or its day over: Trip finished? Enter the odometer (my-trip/[id]/finish); closed at 09:00 the next day
//   without it (Completed · not confirmed): Enter the odometer, the same step.
// - finished, cancelled, nothing to do: says so.
// The rules: office/myTripLogic.ts; the strings: office.myTrip.*.
// Round 4–7 (6): a trip the person rides in (my_trip's viewer passenger) shows the passenger's view instead, view only
// (components/office/Passengers.tsx PassengerTripCard; the passenger notifications link here too).
// Round 4–7, item 12 (the approved mockup 4 without the office's actions): the passenger's view as the status banner, the
// driver card and the route stepper; the trip's own card has its stops on the stepper; the cards in the mockups' look.
// Round 50 (§37.4): a trip the person drives themselves, for someone who can drive with the app (can_drive, self_drive_mode
// on; the app, not a browser): "Drive with the app" with Start driving opens Driving mode on this trip in place of the
// manual check and its Start the trip (the driver screens do the check, the odometer, the stops and the fuel); "Trip
// already done? Enter the odometer" stays. Under way: Continue driving above the finish card (the finish stays).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { TripCard } from '@/components/office/MyTripParts';
import { WebDriveOffer } from '@/components/office/WebDriveOffer';
import { PassengerTripCard } from '@/components/office/Passengers';
import { SavedNotice } from '@/components/office/SavedNotice';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { look } from '@/components/patterns/look';
import { Button, Notice, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { colomboDate } from '@/lib/time';
import { plateOfTrip, tripMode, windowWords } from '@/office/myTripLogic';
import { useOffice, useTool } from '@/office/state';
import { useCanDrive, useStartDriving } from '@/office/driving';
import { isPassengerView } from '@/office/passengerView';
import type { MyTrip, PassengerTrip } from '@/office/types';
import { BackHeader, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MyTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const q = useTool<MyTrip | PassengerTrip>('my_trip', { task_id: id }, { every: 60_000 });
  const answer = q.data && q.data.task_id === id ? q.data : null;
  // A trip the person rides in: the passenger's view only (no check, no finish).
  const riding = isPassengerView(answer) ? answer : null;
  const trip = riding ? null : (answer as MyTrip | null);
  const mode = trip ? tripMode(trip) : null;
  const opens = trip ? `${dateWords(t, trip.date)} ${trip.window.opens_at}` : '';
  const plate = trip ? plateOfTrip(trip) : '';
  const step = (name: 'check' | 'finish', result?: 'ok' | 'problem' | 'odo') =>
    router.push({ pathname: `/office/my-trip/[id]/${name}`, params: { id, ...(result ? { result } : {}) } });
  const win = trip ? windowWords(trip, opens) : null;
  const checkedToday = trip?.check && trip.check.date === colomboDate();
  // Round 50: Driving mode for this trip (the person drives it themselves and may drive with the app).
  const canDrive = useCanDrive();
  const driving = useStartDriving();
  const appDrive = !!trip && canDrive && trip.driven_by === 'self';
  const driveBefore = appDrive && mode === 'check';
  const driveUnderWay = appDrive && mode === 'finish' && trip?.state === 'on_the_way';

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={trip?.title ?? riding?.title ?? t('office.myTrip.title')} subtitle={trip ? t('office.myTrip.above', { when: `${dateWords(t, trip.date)} ${trip.leave_at}` }) : riding ? t('office.passengers.above', { when: `${dateWords(t, riding.date)} ${riding.leave_at}` }) : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        <SavedNotice noticeKey={`myTrip:${id}`} />
        {trip && <TripCard trip={trip} />}
        {/* Round 50 (§37.5): /m/ driver-lite, web only: "Drive this trip here" when my_trip allows it (WebDriveOffer). */}
        {Platform.OS === 'web' && trip && <WebDriveOffer trip={trip} />}
        {riding && <PassengerTripCard trip={riding} />}

        {(driveBefore || driveUnderWay) && (
          <View style={styles.card} testID="my-trip-drive">
            <Txt variant="label" color={colors.muted}>{t('driving.myTripTitle').toUpperCase()}</Txt>
            <Txt variant="body">{t('driving.myTripBody')}</Txt>
            {win && driveBefore && <Txt variant="small" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
            {driveUnderWay && <Button label={t('driving.continue')} busy={driving.busy} onPress={() => void driving.start(id)} style={{ minHeight: 60 }} testID="my-trip-continue-driving" />}
          </View>
        )}
        {trip && mode === 'check' && trip.check_needed && !driveBefore && (
          <View style={styles.card} testID="my-trip-question">
            <Txt variant="label" color={colors.muted}>{t('office.myTrip.checkTitle').toUpperCase()}</Txt>
            <Txt variant="heading" size={22}>{t('office.myTrip.question', { plate })}</Txt>
            <Button label={t('office.myTrip.allGood')} onPress={() => step('check', 'ok')} style={{ minHeight: 60 }} testID="check-ok" />
            <Button kind="outline" label={t('office.myTrip.aProblem')} onPress={() => step('check', 'problem')} style={{ minHeight: 60 }} testID="check-problem" />
            {win && <Txt variant="small" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
            {checkedToday && trip.check ? <Txt variant="small">{t(trip.check.result === 'problem' ? 'office.myTrip.checkedTodayProblem' : 'office.myTrip.checkedTodayOk', { time: trip.check.at })}</Txt> : null}
          </View>
        )}
        {trip && mode === 'check' && !trip.check_needed && !driveBefore && (
          <View style={styles.card} testID="my-trip-start">
            <Txt variant="label" color={colors.muted}>{t('office.myTrip.startTitle').toUpperCase()}</Txt>
            {win && <Txt variant="body" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
          </View>
        )}
        {trip && mode === 'check' && trip.can.finish && (
          <Button kind="outline" label={t('office.myTrip.alreadyDone')} onPress={() => step('finish')} style={{ minHeight: 52 }} testID="already-done" />
        )}

        {/* Round 50: a trip started in the app or on the web finishes there (the server answers can.finish false). */}
        {trip && (mode === 'finish' || mode === 'confirm') && trip.can.finish && (
          <View style={styles.card} testID="my-trip-finish-card">
            <Txt variant="label" color={colors.muted}>{t(mode === 'confirm' ? 'office.myTrip.confirmTitle' : 'office.myTrip.finishTitle').toUpperCase()}</Txt>
            <Txt variant="body">{t(mode === 'confirm' ? 'office.myTrip.confirmWhy' : trip.state === 'on_the_way' ? 'office.myTrip.finishOnTheWay' : 'office.myTrip.finishWhy')}</Txt>
          </View>
        )}
        {trip && mode === 'done' && <Notice tone="info" text={trip.km != null ? t('office.myTrip.doneKm', { km: trip.km.toLocaleString('en-US') }) : t('office.myTrip.doneLine')} />}
        {trip && mode === 'cancelled' && <ListEmpty text={t('office.myTrip.cancelled')} />}
        {trip && mode === 'other' && <ListEmpty text={t('office.myTrip.nothing')} />}
      </Screen>
      {driveBefore && (
        <StickyActions>
          <Button label={t('driving.start')} busy={driving.busy} onPress={() => void driving.start(id)} style={{ minHeight: 60 }} testID="my-trip-start-driving" />
        </StickyActions>
      )}
      {trip && mode === 'check' && !trip.check_needed && !driveBefore && (
        <StickyActions>
          <Button label={t('office.myTrip.startTrip')} onPress={() => step('check', 'odo')} disabled={!trip.window.open} style={{ minHeight: 60 }} testID="start-trip" />
          {!trip.window.open && <Txt variant="small" style={{ textAlign: 'center' }} testID="start-why">{t('office.myTrip.why.notYet', { when: opens })}</Txt>}
        </StickyActions>
      )}
      {trip && (mode === 'finish' || mode === 'confirm') && trip.can.finish && (
        <StickyActions>
          <Button label={t(mode === 'confirm' ? 'office.myTrip.action.confirm' : 'office.myTrip.finishCta')} onPress={() => step('finish')} style={{ minHeight: 60 }} testID="finish-open" />
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
});
