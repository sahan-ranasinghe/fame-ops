// Office mode and /m/ (Round 4–7, feature 4): the vehicle check's step for a trip nobody drives with the app, opened from
// its page with the answer to "Any damage or problem with <plate>?" (result ok or problem), or with the switch
// vehicle_check off (odo: the odometer alone).
// - All good: the odometer now (the vehicle's last reading prefilled; never under it) and, under More details, "Add 4
//   photos (front, back, left, right)": one tile per side, the next one asked for by name (Turo's check-in photos).
// - A problem: what it is (six chips), 1–6 photos (the camera or the phone's photos), a note (optional), the odometer.
// One sticky button (Start trip / Save check / Send and start trip / Send the problem), disabled with its reason under it.
// my_trip_check with the check's id made here (a retry never doubles it); the photos went up as they were taken, into the
// person's own folder (their ids). Then back to the trip's page: the snackbar says it started (On the way · left 07:42),
// or, before its time, that it was only recorded (the page keeps the line until OK).

import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { Chips, MoreDetails } from '@/components/office/Controls';
import { EmptyTile, PhotoFailed, PhotoTile, TripCard, TripPhotoPick, type UpPhoto, useTripPhotos } from '@/components/office/MyTripParts';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Field, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import {
  CATEGORIES, categoryKey, checkButtonKey, checkDone, checkInput, checkReason, type CheckForm, kmText, MAX_PROBLEM_PHOTOS, plateOfTrip, type Side, SIDES,
  tripMode, windowWords,
} from '@/office/myTripLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, MyTrip, ReportCategory } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type Result = CheckForm['result'];

export default function MyTripCheckScreen() {
  const { id, result: asked } = useLocalSearchParams<{ id: string; result?: string }>();
  const result: Result = asked === 'problem' ? 'problem' : asked === 'odo' ? 'odo' : 'ok';
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<MyTrip>('my_trip', { task_id: id });
  const trip = q.data && q.data.task_id === id ? q.data : null;
  const [checkId] = useState(() => Crypto.randomUUID());
  const [odometer, setOdometer] = useState<string | null>(null);
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<UpPhoto[]>([]);
  const [sides, setSides] = useState<Partial<Record<Side, UpPhoto>>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const up = useTripPhotos();
  const dirty = odometer !== null || !!category || !!note.trim() || photos.length > 0 || Object.keys(sides).length > 0;
  const { allowLeave } = useLeaveGuard(dirty, busy);

  const opens = trip ? `${dateWords(t, trip.date)} ${trip.window.opens_at}` : '';
  const form: CheckForm = {
    result,
    odometer: odometer ?? (trip?.last_odometer_km != null ? String(trip.last_odometer_km) : ''),
    category,
    note,
    photos: photos.map((p) => p.id),
    sides: SIDES.flatMap((side) => (sides[side] ? [{ photo_id: sides[side]!.id, side }] : [])),
    uploading: up.uploading,
  };
  const why = trip ? checkReason(trip, form, opens) : null;
  const plate = trip ? plateOfTrip(trip) : '';
  const nextSide = SIDES.find((s) => !sides[s]);
  const win = trip ? windowWords(trip, opens) : null;

  async function send() {
    if (!trip || why || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await api.call<MyTrip>('my_trip_check', checkInput(trip.task_id, checkId, form));
      allowLeave();
      const done = checkDone(r, `${dateWords(t, r.date)} ${r.window.opens_at}`);
      // Only recorded (before its time): the trip's page keeps the line until OK.
      if (!r.started_now) setSavedNotice(`myTrip:${id}`, [t(done.key, done.vars)], t('office.myTrip.done.recordedTitle'));
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/office/my-trip/[id]', params: { id } });
      showSnackbar({ text: r.started_now ? t(done.key, done.vars) : t('office.myTrip.done.recordedTitle') });
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  const title = result === 'problem' ? t('office.myTrip.problemTitle') : result === 'odo' ? t('office.myTrip.startTitle') : t('office.myTrip.okTitle');
  const stale = trip && tripMode(trip) !== 'check';

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={title} subtitle={plate || undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {stale && <ListEmpty text={t('office.myTrip.notToCheck')} />}
        {trip && !stale && (
          <>
            {result === 'problem' && (
              <>
                <View style={{ gap: 8 }}>
                  <Txt variant="strong" size={17}>{t('office.myTrip.whatIsIt')}</Txt>
                  <Chips options={CATEGORIES.map((c) => ({ key: c, label: t(categoryKey(c)) }))} value={category} onChange={setCategory} />
                </View>
                <View style={{ gap: 8 }} testID="problem-photos">
                  <Txt variant="strong" size={17}>{t('office.myTrip.problemPhotos', { n: photos.length, max: MAX_PROBLEM_PHOTOS })}</Txt>
                  {photos.length > 0 && (
                    <View style={styles.tiles}>
                      {photos.map((p, n) => (
                        <PhotoTile key={p.id} photo={p} label={t('office.checks.photoN', { n: n + 1 })} onRemove={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} />
                      ))}
                    </View>
                  )}
                  {photos.length + up.uploading < MAX_PROBLEM_PHOTOS && (
                    <TripPhotoPick label={t('office.media.takePhoto')} onShot={(shot) => void up.add('vehicle_report', shot, (p) => setPhotos((x) => [...x, p]))} testID="problem-photo-pick" />
                  )}
                  {up.uploading > 0 && <Txt variant="small">{t('office.myTrip.sending')}</Txt>}
                  <PhotoFailed failed={up.failed} />
                </View>
                <Field label={t('office.myTrip.note')} value={note} onChangeText={setNote} multiline maxLength={500} placeholder={t('office.myTrip.notePlaceholder')} style={{ minHeight: 80, textAlignVertical: 'top' }} />
              </>
            )}
            <View style={{ gap: 8 }}>
              <Txt variant="strong" size={17}>{t('office.vehicles.f_odo')}</Txt>
              <TextInput
                value={form.odometer}
                onChangeText={(v) => setOdometer(v.replace(/[^\d]/g, '').slice(0, 7))}
                keyboardType="number-pad"
                maxLength={7}
                accessibilityLabel={t('office.vehicles.f_odo')}
                style={styles.odo}
                testID="odometer"
              />
              {trip.last_odometer_km != null && <Txt variant="small">{t('office.myTrip.lastReading', { km: kmText(trip.last_odometer_km) })}</Txt>}
            </View>
            {result === 'ok' && (
              <MoreDetails filled={Object.keys(sides).length > 0} testID="sides-fold">
                <Txt variant="strong" size={16}>{t('office.myTrip.addSides')}</Txt>
                <View style={styles.tiles} testID="side-photos">
                  {SIDES.map((side) => {
                    const p = sides[side];
                    const label = t(`office.checks.side.${side}`);
                    return p
                      ? <PhotoTile key={side} photo={p} label={label} onRemove={() => setSides((x) => { const n = { ...x }; delete n[side]; return n; })} />
                      : <EmptyTile key={side} label={label} next={side === nextSide} />;
                  })}
                </View>
                {nextSide && up.uploading === 0 && (
                  <TripPhotoPick label={t('office.myTrip.takeSide', { side: t(`office.checks.side.${nextSide}`) })} onShot={(shot) => void up.add('vehicle_check', shot, (p) => setSides((x) => ({ ...x, [nextSide]: p })))} testID="side-photo-pick" />
                )}
                {up.uploading > 0 && <Txt variant="small">{t('office.myTrip.sending')}</Txt>}
                <PhotoFailed failed={up.failed} />
              </MoreDetails>
            )}
            {win && <Txt variant="small" testID="my-trip-window">{t(win.key, win.vars)}</Txt>}
            {problem && <ErrorNotice error={problem} onRetry={() => void send()} onSignIn={() => void signOut()} />}
            <TripCard trip={trip} />
          </>
        )}
      </Screen>
      {trip && !stale && (
        <StickyActions>
          <Button label={t(checkButtonKey(trip, form))} onPress={() => void send()} busy={busy} disabled={!!why} style={{ minHeight: 60 }} testID="check-send" />
          {why && <Txt variant="small" style={{ textAlign: 'center' }} testID="check-why">{t(why.key, why.vars)}</Txt>}
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  odo: { minHeight: 64, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 16, fontSize: 30, fontFamily: fonts.monoSemiBold, color: colors.ink, backgroundColor: colors.card },
});
