// Round 50 (29 October 2026, phase8-plan.md §37.5): /m/ driver-lite. A self trip driven in a browser (the mobile website),
// opened from the trip's page ("Drive this trip here", web only, when my_trip's `web.allowed` says so). Zipcar's and
// Turo's trip flow for whoever drives, as one job per screen with one sticky primary:
// - Start: the vehicle check when check_needed (No, all good with the four sides optional / Yes, a problem with what it
//   is, 1–6 photos and a note: MyTripParts' tiles and the shared PhotoPick), the fuel card's question when it asks, and
//   the odometer: a photo (the camera, or the phone's photos) and the reading typed (the vehicle's last reading
//   prefilled, never under it). Start trip, disabled with its reason under it.
// - Each stop in order: the Arrived slide, then the Done slide (the driver app's SlideToConfirm, which runs on the web).
//   "Finish the trip now" under the stops leaves the stops not reached as not visited.
// - Finish: the odometer photo and reading (never under the start; the km as typed), the fuel added under More details
//   (litres, LKR, a receipt photo; no video: MediaRecorder is not reliable on iOS Safari, so "Fuel video needs the Fame
//   Fleet app").
// Each action asks the browser for ONE position at that moment (office/webPosition.ts; refused or failed = saved with no
// position, and the page says so), carries a client id per action (a retry never doubles it: office/webTripLogic.ts) and
// calls web_trip_action. No continuous tracking and no fake live state: the page says "Live tracking needs the Fame Fleet
// app". Offline: refused at once with "No connection" and Try again (no queue on the web). The rules: webTripLogic.ts;
// the strings: office.webTrip.*.

import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useLeaveGuard } from '@/components/navigation';
import { Chips, MoreDetails } from '@/components/office/Controls';
import { EmptyTile, PhotoFailed, PhotoTile, TripPhotoPick, type UpPhoto, useTripPhotos } from '@/components/office/MyTripParts';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { look } from '@/components/patterns/look';
import { RouteStepper, type StepperRow } from '@/components/patterns/RouteStepper';
import { ChoiceChips } from '@/components/patterns/Select';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Field, Notice, Plate, Txt } from '@/components/ui';
import { CATEGORIES, categoryKey, kmText, MAX_PROBLEM_PHOTOS, plateOfTrip, type Side, SIDES } from '@/office/myTripLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, MyTrip, MyTripWeb, MyTripWebStop, ReportCategory, WebTripActionInput, WebTripActionKind, WebTripActionResult } from '@/office/types';
import { BackHeader, ErrorNotice, ListFailed, Screen, StickyActions } from '@/office/ui';
import { browserOnline, askOnePosition } from '@/office/webPosition';
import {
  actionKey, browserOffline, clientIdFor, doneWords, emptyStart, emptyWebFinish, fuelEstimateWords, idsAfterFailure, noPositionWords, OFFLINE, positionInput,
  type StartForm, startInput, startReason, stopInput, stopsLeft, type WebFinishForm, webFinishInput, webFinishReason, webKm, webStep, type Words,
} from '@/office/webTripLogic';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const STOP_KEY: Record<string, string> = { pickup: 'office.trip.type_pickup', drop: 'office.trip.type_drop', visit: 'office.trip.type_visit' };

/** A number box with its label above (the odometer big in mono, the fuel smaller). */
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
        inputMode={decimal ? 'decimal' : 'numeric'}
        accessibilityLabel={label}
        style={[styles.box, big && styles.big]}
        testID={testID}
      />
    </View>
  );
}

export default function DriveTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<MyTrip>('my_trip', { task_id: id }, { every: 60_000 });
  const trip = q.data && q.data.task_id === id ? q.data : null;
  const web: MyTripWeb | null = trip?.web ?? null;
  // Finished here: the done card at once (my_trip's next answer says the same).
  const [finished, setFinished] = useState<{ km?: number } | null>(null);
  const step = webStep(web, !!finished || trip?.state === 'done');
  // Finish before every stop is reached (the outline button under the stops).
  const [finishing, setFinishing] = useState(false);
  const showFinish = step.kind === 'finish' || (finishing && (step.kind === 'arrive' || step.kind === 'leave'));

  const [start, setStart] = useState<StartForm | null>(null);
  const s: StartForm = start ?? emptyStart(web ?? { last_km: undefined });
  const setS = (patch: Partial<StartForm>) => setStart((x) => ({ ...(x ?? emptyStart(web ?? { last_km: undefined })), ...patch }));
  const [odoPhoto, setOdoPhoto] = useState<UpPhoto | null>(null);
  const [problemPhotos, setProblemPhotos] = useState<UpPhoto[]>([]);
  const [sides, setSides] = useState<Partial<Record<Side, UpPhoto>>>({});
  const [fin, setFin] = useState<WebFinishForm>(emptyWebFinish());
  const [endPhoto, setEndPhoto] = useState<UpPhoto | null>(null);
  const [receipt, setReceipt] = useState<UpPhoto | null>(null);
  const up = useTripPhotos();

  const [busy, setBusy] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<{ error: FleetError; retry: () => void } | null>(null);
  const [noPosition, setNoPosition] = useState<Words | null>(null);
  // One client id per action (actionKey): Try again sends the same one (webTripLogic.clientIdFor).
  const ids = useRef<Record<string, string>>({});

  const dirty = start !== null || !!odoPhoto || problemPhotos.length > 0 || Object.keys(sides).length > 0 || !!fin.odometer || !!fin.litres || !!fin.lkr || !!endPhoto || !!receipt;
  const { allowLeave } = useLeaveGuard(dirty && (step.kind === 'start' || showFinish), busy !== null);

  const plate = trip ? plateOfTrip(trip) : '';
  const startForm: StartForm = {
    ...s,
    photos: problemPhotos.map((p) => p.id),
    sides: SIDES.flatMap((side) => (sides[side] ? [{ photo_id: sides[side]!.id, side }] : [])),
    odoPhoto: odoPhoto?.id ?? null,
    uploading: up.uploading,
  };
  const finishForm: WebFinishForm = { ...fin, odoPhoto: endPhoto?.id ?? null, receipt: receipt?.id ?? null, uploading: up.uploading };
  const startKm = trip?.start_odometer_km ?? web?.last_km ?? null;
  const startWhy = web ? startReason(web, startForm) : null;
  const finishWhy = webFinishReason(startKm, finishForm);
  const km = webKm(startKm, fin.odometer);
  const nextSide = SIDES.find((x) => !sides[x]);
  const estimate = fuelEstimateWords(web?.fuel_card?.estimate_text);
  const estimateText = !estimate ? null : 'text' in estimate ? estimate.text : t(estimate.key, { ...estimate.vars, ...(estimate.fuel ? { fuel: t(estimate.fuel) } : {}) });

  /** The local copy after a saved action, so the next step shows at once (my_trip is asked again too). */
  function patchAfter(action: WebTripActionKind, r: WebTripActionResult) {
    q.patch((x) => {
      if (!x.web) return x;
      const w = { ...x.web, driven_in: 'web' as const };
      if (action === 'start') w.started = true;
      if (r.stop) w.stops = w.stops.map((st) => (st.id === r.stop!.id ? { ...st, status: r.stop!.status, ...(r.stop!.status === 'arrived' ? { arrived_at: r.stop!.at } : { done_at: r.stop!.at }) } : st));
      return { ...x, web: w };
    });
  }

  /** One action: the browser's one position, the client id, web_trip_action; the error stays with Try again. */
  async function act(action: WebTripActionKind, build: (clientId: string, position: WebTripActionInput['position']) => WebTripActionInput, stop?: MyTripWebStop) {
    if (!trip || busy) return;
    const key = actionKey(action, stop?.id);
    const retry = () => void act(action, build, stop);
    setProblem(null);
    if (browserOffline(browserOnline())) {
      setProblem({ error: OFFLINE, retry });
      return;
    }
    setBusy(key);
    setLocating(true);
    const where = await askOnePosition();
    setLocating(false);
    const made = clientIdFor(ids.current, key, () => Crypto.randomUUID());
    ids.current = made.ids;
    try {
      const r = await api.call<WebTripActionResult>('web_trip_action', build(made.id, positionInput(where)));
      setNoPosition(noPositionWords(where));
      patchAfter(action, r);
      const done = doneWords(action, r, stop?.place);
      if (action === 'finish') {
        allowLeave();
        setFinished({ km: r.km });
        setFinishing(false);
      }
      if (action === 'start') setStart(null);
      showSnackbar({ text: t(done.key, done.vars) });
      void q.refetch();
    } catch (e) {
      ids.current = idsAfterFailure(ids.current, key, e as FleetError);
      setProblem({ error: e as FleetError, retry });
    } finally {
      setBusy(null);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/office/my-trip/[id]', params: { id } }));

  // The stops on the route stepper: done (a check), skipped, the one arrived at or next (current), the rest to come.
  const nextId = step.kind === 'arrive' || step.kind === 'leave' ? step.stop.id : null;
  const rows: StepperRow[] = (web?.stops ?? []).slice().sort((a, b) => a.n - b.n).map((st) => {
    const chip = st.status === 'done' ? { text: t('office.webTrip.stop.done', { time: st.done_at ?? '' }).trim(), tone: 'green' as const }
      : st.status === 'skipped' ? { text: t('office.webTrip.stop.skipped'), tone: 'muted' as const }
        : st.status === 'arrived' ? { text: t('office.webTrip.stop.here'), tone: 'blue' as const }
          : st.id === nextId ? { text: t('office.webTrip.stop.next'), tone: 'amber' as const } : null;
    return {
      key: st.id,
      mark: String(st.n),
      kind: 'stop' as const,
      state: st.status === 'done' ? 'done' as const : st.status === 'skipped' ? 'skipped' as const : st.id === nextId ? 'current' as const : 'todo' as const,
      title: st.place,
      titleLines: 2 as const,
      chip,
      meta: STOP_KEY[st.type] ? [{ text: [t(STOP_KEY[st.type]), st.arrived_at ? t('office.webTrip.stop.arrived', { time: st.arrived_at }) : ''].filter(Boolean).join(' · ') }] : undefined,
      testID: `web-stop-${st.n}`,
    };
  });
  const total = web?.stops.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={trip?.title ?? t('office.webTrip.title')} subtitle={t('office.webTrip.above')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {/* The honest line (§37.5): a browser cannot track; only the button presses carry a position. */}
        {trip && step.kind !== 'done' && step.kind !== 'closed' && step.kind !== 'inApp' && <Notice tone="info" text={t('office.webTrip.noTracking')} />}
        {trip && (
          <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }]} testID="web-trip-head">
            {trip.vehicle ? <Plate regNo={trip.vehicle} /> : plate ? <Txt variant="strong">{plate}</Txt> : null}
            <Txt variant="muted" size={15}>{trip.back_by ? t('office.myTrip.leaveBack', { leave: trip.leave_at, back: trip.back_by }) : t('office.myTrip.leave', { leave: trip.leave_at })}</Txt>
          </View>
        )}

        {step.kind === 'done' && (
          <View style={styles.card} testID="web-trip-done">
            <Txt variant="heading" size={22}>{t(doneWords('finish', { km: finished?.km ?? trip?.km }).key, doneWords('finish', { km: finished?.km ?? trip?.km }).vars)}</Txt>
            <Txt variant="body">{t('office.webTrip.doneLine')}</Txt>
            <Button kind="outline" label={t('office.webTrip.back')} onPress={back} style={{ minHeight: 52 }} testID="web-trip-back" />
          </View>
        )}
        {step.kind === 'inApp' && <ListEmpty text={t('office.webTrip.inApp')} />}
        {trip && step.kind === 'closed' && <ListEmpty text={step.why || t('office.webTrip.closed')} />}

        {noPosition && step.kind !== 'done' && <Notice text={t(noPosition.key, noPosition.vars)} />}

        {/* ---- Start ---- */}
        {trip && web && step.kind === 'start' && (
          <>
            {web.check_needed && (
              <View style={styles.card} testID="web-check">
                <Txt variant="label" color={colors.muted}>{t('office.webTrip.checkTitle').toUpperCase()}</Txt>
                <Txt variant="heading" size={20}>{t('office.myTrip.question', { plate })}</Txt>
                <ChoiceChips
                  options={[{ key: 'ok' as const, label: t('office.myTrip.allGood') }, { key: 'problem' as const, label: t('office.myTrip.aProblem') }]}
                  value={s.check}
                  onChange={(k) => setS({ check: k })}
                  testID="web-check-answer"
                />
                {s.check === 'problem' && (
                  <>
                    <View style={{ gap: 8 }}>
                      <Txt variant="strong" size={17}>{t('office.myTrip.whatIsIt')}</Txt>
                      <Chips options={CATEGORIES.map((c) => ({ key: c, label: t(categoryKey(c)) }))} value={s.category} onChange={(c: ReportCategory) => setS({ category: c })} />
                    </View>
                    <View style={{ gap: 8 }} testID="web-problem-photos">
                      <Txt variant="strong" size={17}>{t('office.myTrip.problemPhotos', { n: problemPhotos.length, max: MAX_PROBLEM_PHOTOS })}</Txt>
                      {problemPhotos.length > 0 && (
                        <View style={styles.tiles}>
                          {problemPhotos.map((p, n) => <PhotoTile key={p.id} photo={p} label={t('office.checks.photoN', { n: n + 1 })} onRemove={() => setProblemPhotos((x) => x.filter((y) => y.id !== p.id))} />)}
                        </View>
                      )}
                      {problemPhotos.length + up.uploading < MAX_PROBLEM_PHOTOS && (
                        <TripPhotoPick label={t('office.media.takePhoto')} onShot={(shot) => void up.add('vehicle_report', shot, (p) => setProblemPhotos((x) => [...x, p]))} testID="web-problem-photo-pick" />
                      )}
                    </View>
                    <Field label={t('office.myTrip.note')} value={s.note} onChangeText={(v) => setS({ note: v })} multiline maxLength={500} placeholder={t('office.myTrip.notePlaceholder')} style={{ minHeight: 80, textAlignVertical: 'top' }} />
                  </>
                )}
                {s.check === 'ok' && (
                  <MoreDetails filled={Object.keys(sides).length > 0} testID="web-sides-fold">
                    <Txt variant="strong" size={16}>{t('office.myTrip.addSides')}</Txt>
                    <View style={styles.tiles}>
                      {SIDES.map((side) => {
                        const p = sides[side];
                        const label = t(`office.checks.side.${side}`);
                        return p
                          ? <PhotoTile key={side} photo={p} label={label} onRemove={() => setSides((x) => { const n = { ...x }; delete n[side]; return n; })} />
                          : <EmptyTile key={side} label={label} next={side === nextSide} />;
                      })}
                    </View>
                    {nextSide && up.uploading === 0 && (
                      <TripPhotoPick label={t('office.myTrip.takeSide', { side: t(`office.checks.side.${nextSide}`) })} onShot={(shot) => void up.add('vehicle_check', shot, (p) => setSides((x) => ({ ...x, [nextSide]: p })))} testID="web-side-photo-pick" />
                    )}
                  </MoreDetails>
                )}
              </View>
            )}
            {web.fuel_card?.asked && (
              <View style={styles.card} testID="web-fuel-card">
                <Txt variant="label" color={colors.muted}>{t('office.webTrip.fuelTitle').toUpperCase()}</Txt>
                {estimateText ? <Txt variant="body">{estimateText}</Txt> : null}
                <ChoiceChips
                  options={[{ key: 'enough' as const, label: t('office.webTrip.fuelEnough') }, { key: 'fill_on_way' as const, label: t('office.webTrip.fuelFill') }]}
                  value={s.fuel}
                  onChange={(k) => setS({ fuel: k })}
                  testID="web-fuel-answer"
                />
              </View>
            )}
            <View style={styles.card} testID="web-odometer-start">
              <Txt variant="label" color={colors.muted}>{t('office.webTrip.odoTitle').toUpperCase()}</Txt>
              {odoPhoto
                ? <PhotoTile photo={odoPhoto} label={t('office.myTrip.odometerPhoto')} onRemove={() => setOdoPhoto(null)} />
                : <TripPhotoPick label={t('office.webTrip.odoPhoto')} disabled={up.uploading > 0} onShot={(shot) => void up.add('odometer', shot, setOdoPhoto)} testID="web-odo-photo-pick" />}
              <NumberBox label={t('office.webTrip.odoReading')} value={s.odometer} onChange={(v) => setS({ odometer: v })} big testID="web-odometer" />
              {web.last_km != null && <Txt variant="small">{t('office.myTrip.lastReading', { km: kmText(web.last_km) })}</Txt>}
            </View>
          </>
        )}

        {/* ---- The stops ---- */}
        {web && web.started && step.kind !== 'done' && rows.length > 0 && (
          <View style={styles.card} testID="web-stops">
            <RouteStepper framed={false} compact live rows={rows} testID="web-stepper" />
          </View>
        )}
        {(step.kind === 'arrive' || step.kind === 'leave') && !showFinish && (
          <View style={styles.card} testID={`web-step-${step.kind}`}>
            <Txt variant="label" color={colors.muted}>{t(step.kind === 'arrive' ? 'office.webTrip.nextStop' : 'office.webTrip.atStop').toUpperCase()} · {t('office.webTrip.stopOf', { n: step.stop.n, total })}</Txt>
            <Txt variant="heading" size={22}>{step.stop.place}</Txt>
            {STOP_KEY[step.stop.type] ? <Txt variant="muted" size={15}>{t(STOP_KEY[step.stop.type])}</Txt> : null}
            {step.kind === 'arrive'
              ? <SlideToConfirm label={t('task.slideArrive', { stop: step.stop.place })} busy={busy === actionKey('arrive', step.stop.id)} disabled={busy !== null} onConfirm={() => void act('arrive', (cid, pos) => stopInput(id, cid, 'arrive', step.stop.id, pos), step.stop)} testID="web-slide-arrive" />
              : <SlideToConfirm tone="dark" label={t('task.slideLeave', { stop: step.stop.place })} busy={busy === actionKey('leave', step.stop.id)} disabled={busy !== null} onConfirm={() => void act('leave', (cid, pos) => stopInput(id, cid, 'leave', step.stop.id, pos), step.stop)} testID="web-slide-leave" />}
          </View>
        )}
        {(step.kind === 'arrive' || step.kind === 'leave') && !showFinish && web && (
          <View style={{ gap: 6 }}>
            <Button kind="outline" label={t('office.webTrip.finishNow')} disabled={busy !== null} onPress={() => setFinishing(true)} style={{ minHeight: 52 }} testID="web-finish-now" />
            {stopsLeft(web) > 0 && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.webTrip.finishNowHint')}</Txt>}
          </View>
        )}

        {/* ---- Finish ---- */}
        {web && showFinish && (
          <View style={styles.card} testID="web-finish">
            <Txt variant="label" color={colors.muted}>{t('office.webTrip.finishTitle').toUpperCase()}</Txt>
            {finishing && step.kind !== 'finish' && <Txt variant="small">{t('office.webTrip.finishNowHint')}</Txt>}
            {endPhoto
              ? <PhotoTile photo={endPhoto} label={t('office.myTrip.odometerPhoto')} onRemove={() => setEndPhoto(null)} />
              : <TripPhotoPick label={t('office.webTrip.odoPhoto')} disabled={up.uploading > 0} onShot={(shot) => void up.add('odometer', shot, setEndPhoto)} testID="web-end-photo-pick" />}
            <NumberBox label={t('office.webTrip.odoReading')} value={fin.odometer} onChange={(v) => setFin((x) => ({ ...x, odometer: v }))} big testID="web-odometer-end" />
            <Txt variant="small" testID="web-km">
              {[startKm != null ? t('office.webTrip.startWas', { km: kmText(startKm) }) : '', km != null ? t('office.webTrip.kmSoFar', { km: kmText(km) }) : ''].filter(Boolean).join(' · ')}
            </Txt>
            <MoreDetails filled={!!(fin.litres || fin.lkr || receipt)} testID="web-fuel-fold">
              <Txt variant="strong" size={16}>{t('office.webTrip.fuelAdded')}</Txt>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <NumberBox label={t('log.litres')} value={fin.litres} onChange={(v) => setFin((x) => ({ ...x, litres: v }))} decimal testID="web-litres" />
                <NumberBox label={t('office.myTrip.amount')} value={fin.lkr} onChange={(v) => setFin((x) => ({ ...x, lkr: v }))} decimal testID="web-lkr" />
              </View>
              <Txt variant="strong" size={16}>{t('office.webTrip.receipt')}</Txt>
              {receipt
                ? <PhotoTile photo={receipt} label={t('office.webTrip.receipt')} onRemove={() => setReceipt(null)} />
                : <TripPhotoPick label={t('office.media.takePhoto')} disabled={up.uploading > 0} onShot={(shot) => void up.add('fuel_receipt', shot, setReceipt)} testID="web-receipt-pick" />}
              <Txt variant="small" testID="web-no-video">{t('office.webTrip.noVideo')}</Txt>
            </MoreDetails>
            {finishing && step.kind !== 'finish' && (
              <Button kind="outline" label={t('common.cancel')} disabled={busy !== null} onPress={() => setFinishing(false)} style={{ minHeight: 48 }} testID="web-finish-cancel" />
            )}
          </View>
        )}

        {up.uploading > 0 && <Txt variant="small">{t('office.myTrip.sending')}</Txt>}
        <PhotoFailed failed={up.failed} />
        {locating && <Txt variant="small" testID="web-locating">{t('office.webTrip.locating')}</Txt>}
        {problem && <ErrorNotice error={problem.error} onRetry={problem.retry} onSignIn={() => void signOut()} />}
      </Screen>

      {trip && web && step.kind === 'start' && (
        <StickyActions>
          <Button label={t('office.webTrip.startButton')} busy={busy === 'start'} disabled={!!startWhy || busy !== null}
            onPress={() => void act('start', (cid, pos) => startInput(id, cid, web, startForm, pos))} style={{ minHeight: 60 }} testID="web-start" />
          {startWhy && <Txt variant="small" style={{ textAlign: 'center' }} testID="web-start-why">{t(startWhy.key, startWhy.vars)}</Txt>}
        </StickyActions>
      )}
      {trip && web && showFinish && (
        <StickyActions>
          <Button label={t('office.webTrip.finishButton')} busy={busy === 'finish'} disabled={!!finishWhy || busy !== null}
            onPress={() => void act('finish', (cid, pos) => webFinishInput(id, cid, finishForm, pos))} style={{ minHeight: 60 }} testID="web-finish-send" />
          {finishWhy && <Txt variant="small" style={{ textAlign: 'center' }} testID="web-finish-why">{t(finishWhy.key, finishWhy.vars)}</Txt>}
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  box: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 20, fontFamily: fonts.monoSemiBold, color: colors.ink, backgroundColor: colors.card },
  big: { minHeight: 64, fontSize: 30, borderRadius: 14, paddingHorizontal: 16 },
});
