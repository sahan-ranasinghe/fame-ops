// Office mode and /m/ (Round 4–7, feature 4): "Trip finished? Enter the odometer" for a trip nobody drives with the app
// (Zipcar's and Turo's return), and "Enter the odometer" for one closed at 09:00 the next day without it (Completed · not
// confirmed). On the screen: the odometer now (never under the start; the km of the trip shown as it is typed) and, when
// the trip has no start reading (never checked), the odometer at the start (the vehicle's last reading by default,
// editable). Under More details: the fuel added (litres and / or LKR; no video) and an odometer photo. One sticky button
// (Finish trip / Confirm trip), disabled with its reason under it; finish_my_trip, then back to the trip's page with
// "Trip finished · 42 km" in the snackbar.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { MoreDetails } from '@/components/office/Controls';
import { PhotoFailed, PhotoTile, TripCard, TripPhotoPick, type UpPhoto, useTripPhotos } from '@/components/office/MyTripParts';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Notice, Txt } from '@/components/ui';
import { emptyFinish, finishDone, finishInput, finishReason, type FinishForm, kmText, needsStart, tripKm, tripMode } from '@/office/myTripLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, MyTrip } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

/** A number box with its label above (the odometer in big mono, the fuel smaller). */
function NumberBox({ label, value, onChange, decimal = false, big = false, testID }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
  big?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ gap: 8, flex: big ? undefined : 1 }}>
      <Txt variant="strong" size={big ? 17 : 16}>{label}</Txt>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(decimal ? v.replace(/[^\d.,]/g, '').slice(0, 12) : v.replace(/[^\d]/g, '').slice(0, 7))}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        accessibilityLabel={label}
        style={[styles.box, big && styles.big]}
        testID={testID}
      />
    </View>
  );
}

export default function MyTripFinishScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<MyTrip>('my_trip', { task_id: id });
  const trip = q.data && q.data.task_id === id ? q.data : null;
  const [typed, setTyped] = useState<Partial<FinishForm>>({});
  const [photo, setPhoto] = useState<UpPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const up = useTripPhotos();
  const { allowLeave } = useLeaveGuard(Object.values(typed).some(Boolean) || !!photo, busy);

  const mode = trip ? tripMode(trip) : null;
  // "Trip already done?" from a trip not checked yet: the finish of a trip never started.
  const open = trip ? trip.can.finish : false;
  const confirm = mode === 'confirm';
  const f: FinishForm = { ...(trip ? emptyFinish(trip) : emptyFinish({ last_odometer_km: undefined, start_odometer_km: undefined })), ...typed, photo: photo?.id ?? null, uploading: up.uploading > 0 };
  const why = trip ? finishReason(trip, f) : null;
  const km = trip ? tripKm(trip, f) : null;
  const set = (patch: Partial<FinishForm>) => setTyped((x) => ({ ...x, ...patch }));

  async function send() {
    if (!trip || why || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.call<MyTrip>('finish_my_trip', finishInput(trip.task_id, trip, f));
      allowLeave();
      const done = finishDone(r.km ?? km, confirm);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/office/my-trip/[id]', params: { id } });
      showSnackbar({ text: t(done.key, done.vars) });
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t(confirm ? 'office.myTrip.confirmTitle' : 'office.myTrip.finishTitle')} subtitle={trip?.title} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {trip && !open && <ListEmpty text={t('office.myTrip.nothing')} />}
        {trip && open && (
          <>
            {confirm && <Notice text={t('office.myTrip.confirmWhy')} />}
            {needsStart(trip) && (
              <View style={{ gap: 6 }}>
                <NumberBox label={t('office.myTrip.odometerStart')} value={f.start} onChange={(v) => set({ start: v })} big testID="odometer-start" />
                <Txt variant="small">{trip.last_odometer_km != null ? t('office.myTrip.startHint', { km: kmText(trip.last_odometer_km) }) : t('office.myTrip.startHintNone')}</Txt>
              </View>
            )}
            <View style={{ gap: 6 }}>
              <NumberBox label={t('office.vehicles.f_odo')} value={f.odometer} onChange={(v) => set({ odometer: v })} big testID="odometer-end" />
              <Txt variant="small" testID="my-trip-km">
                {[trip.start_odometer_km != null ? t('office.myTrip.startWas', { km: kmText(trip.start_odometer_km) }) : '', km != null ? t('office.myTrip.kmThisTrip', { km: kmText(km) }) : ''].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            <MoreDetails filled={!!(typed.litres || typed.amount || photo)} testID="finish-fold">
              <Txt variant="strong" size={16}>{t('office.myTrip.fuelAdded')}</Txt>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <NumberBox label={t('log.litres')} value={f.litres} onChange={(v) => set({ litres: v })} decimal testID="litres" />
                <NumberBox label={t('office.myTrip.amount')} value={f.amount} onChange={(v) => set({ amount: v })} decimal testID="amount" />
              </View>
              <Txt variant="strong" size={16}>{t('office.myTrip.odometerPhoto')}</Txt>
              {photo
                ? <PhotoTile photo={photo} label={t('office.myTrip.odometerPhoto')} onRemove={() => setPhoto(null)} />
                : <TripPhotoPick label={t('office.media.takePhoto')} disabled={up.uploading > 0} onShot={(shot) => void up.add('odometer', shot, setPhoto)} testID="odometer-photo-pick" />}
              {up.uploading > 0 && <Txt variant="small">{t('office.myTrip.sending')}</Txt>}
              <PhotoFailed failed={up.failed} />
            </MoreDetails>
            {problem && <ErrorNotice error={problem} onRetry={() => void send()} onSignIn={() => void signOut()} />}
            <TripCard trip={trip} />
          </>
        )}
      </Screen>
      {trip && open && (
        <StickyActions>
          <Button label={t(confirm ? 'office.myTrip.confirmTrip' : 'office.myTrip.finishTrip')} onPress={() => void send()} busy={busy} disabled={!!why} style={{ minHeight: 60 }} testID="finish-send" />
          {why && <Txt variant="small" style={{ textAlign: 'center' }} testID="finish-why">{t(why.key, why.vars)}</Txt>}
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 20, fontFamily: fonts.monoSemiBold, color: colors.ink, backgroundColor: colors.card },
  big: { minHeight: 64, fontSize: 30, borderRadius: 14, paddingHorizontal: 16 },
});
