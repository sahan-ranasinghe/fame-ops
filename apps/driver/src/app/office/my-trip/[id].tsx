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

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { TripCard } from '@/components/office/MyTripParts';
import { SavedNotice } from '@/components/office/SavedNotice';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Notice, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { colomboDate } from '@/lib/time';
import { plateOfTrip, tripMode, windowWords } from '@/office/myTripLogic';
import { useOffice, useTool } from '@/office/state';
import type { MyTrip } from '@/office/types';
import { BackHeader, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function MyTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const q = useTool<MyTrip>('my_trip', { task_id: id }, { every: 60_000 });
  const trip = q.data && q.data.task_id === id ? q.data : null;
  const mode = trip ? tripMode(trip) : null;
  const opens = trip ? `${dateWords(t, trip.date)} ${trip.window.opens_at}` : '';
  const plate = trip ? plateOfTrip(trip) : '';
  const step = (name: 'check' | 'finish', result?: 'ok' | 'problem' | 'odo') =>
    router.push({ pathname: `/office/my-trip/[id]/${name}`, params: { id, ...(result ? { result } : {}) } });
  const win = trip ? windowWords(trip, opens) : null;
  const checkedToday = trip?.check && trip.check.date === colomboDate();

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={trip?.title ?? t('office.myTrip.title')} subtitle={trip ? t('office.myTrip.above', { when: `${dateWords(t, trip.date)} ${trip.leave_at}` }) : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        <SavedNotice noticeKey={`myTrip:${id}`} />
        {trip && <TripCard trip={trip} />}

        {trip && mode === 'check' && trip.check_needed && (
          <View style={styles.card} testID="my-trip-question">
            <Txt variant="label" color={colors.muted}>{t('office.myTrip.checkTitle').toUpperCase()}</Txt>
            <Txt variant="heading" size={22}>{t('office.myTrip.question', { plate })}</Txt>
            <Button label={t('office.myTrip.allGood')} onPress={() => step('check', 'ok')} style={{ minHeight: 60 }} testID="check-ok" />
            <Button kind="outline" label={t('office.myTrip.aProblem')} onPress={() => step('check', 'problem')} style={{ minHeight: 60 }} testID="check-problem" />
            {win && <Txt variant="small" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
            {checkedToday && trip.check ? <Txt variant="small">{t(trip.check.result === 'problem' ? 'office.myTrip.checkedTodayProblem' : 'office.myTrip.checkedTodayOk', { time: trip.check.at })}</Txt> : null}
          </View>
        )}
        {trip && mode === 'check' && !trip.check_needed && (
          <View style={styles.card} testID="my-trip-start">
            <Txt variant="label" color={colors.muted}>{t('office.myTrip.startTitle').toUpperCase()}</Txt>
            {win && <Txt variant="body" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
          </View>
        )}
        {trip && mode === 'check' && trip.can.finish && (
          <Button kind="outline" label={t('office.myTrip.alreadyDone')} onPress={() => step('finish')} style={{ minHeight: 52 }} testID="already-done" />
        )}

        {trip && (mode === 'finish' || mode === 'confirm') && (
          <View style={styles.card} testID="my-trip-finish-card">
            <Txt variant="label" color={colors.muted}>{t(mode === 'confirm' ? 'office.myTrip.confirmTitle' : 'office.myTrip.finishTitle').toUpperCase()}</Txt>
            <Txt variant="body">{t(mode === 'confirm' ? 'office.myTrip.confirmWhy' : trip.state === 'on_the_way' ? 'office.myTrip.finishOnTheWay' : 'office.myTrip.finishWhy')}</Txt>
          </View>
        )}
        {trip && mode === 'done' && <Notice tone="info" text={trip.km != null ? t('office.myTrip.doneKm', { km: trip.km.toLocaleString('en-US') }) : t('office.myTrip.doneLine')} />}
        {trip && mode === 'cancelled' && <ListEmpty text={t('office.myTrip.cancelled')} />}
        {trip && mode === 'other' && <ListEmpty text={t('office.myTrip.nothing')} />}
      </Screen>
      {trip && mode === 'check' && !trip.check_needed && (
        <StickyActions>
          <Button label={t('office.myTrip.startTrip')} onPress={() => step('check', 'odo')} disabled={!trip.window.open} style={{ minHeight: 60 }} testID="start-trip" />
          {!trip.window.open && <Txt variant="small" style={{ textAlign: 'center' }} testID="start-why">{t('office.myTrip.why.notYet', { when: opens })}</Txt>}
        </StickyActions>
      )}
      {trip && (mode === 'finish' || mode === 'confirm') && (
        <StickyActions>
          <Button label={t(mode === 'confirm' ? 'office.myTrip.action.confirm' : 'office.myTrip.finishCta')} onPress={() => step('finish')} style={{ minHeight: 60 }} testID="finish-open" />
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
});
