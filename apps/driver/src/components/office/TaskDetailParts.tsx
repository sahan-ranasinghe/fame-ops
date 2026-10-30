// Office mode (Stage 1, O3 item 3c–f): the parts Task detail (app/office/task/[id].tsx) gained from task_detail, as the
// site's TaskDetail shows them, laid out for a phone (docs/phase8-plan.md §16: the warnings on the screen, the rest under
// one "More details" fold):
//   - TaskWarnings: the km nobody logged before the task, the warnings saved past;
//   - TripPurposeCard: a driver-started trip, company work or personal, charged to what; Change opens its own screen
//     (task/[id]/purpose, set_trip_purpose);
//   - SwapSegments: the vehicle swap's stretches with their total, and "Type the reading" in a sheet for a reading the
//     driver's phone has not sent (swap_reading);
//   - StopArrival: where the driver's phone was when a stop was reached, and "Save as our place" in a sheet for a reached
//     Google stop (save_arrival_place: our own name and the kind; Google's name is refused by the server);
//   - TaskMoreDetails: charged to, the odometer readings and fuel fills with their photos, receipts and video pieces (the
//     1-hour links open in the phone's browser), the problems reported with their photos, the history, and "Show the plan
//     on the map".
// The rules: office/taskDetailLogic.ts. Each write only with its tool; the server's sentence when it refuses.

import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chips, MoreDetails } from '@/components/office/Controls';
import { Sheet } from '@/components/patterns/Sheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { clockOf, videoChip, videoLine, videoPieces } from '@/office/manageLogic';
import { useOffice } from '@/office/state';
import { sentenceText } from '@/office/statusWords';
import {
  arrivalParts, arrivalPlaceInput, canSaveArrival, chargedTo, fuelTitle, historyParts, type LinkKey, odometerParts, PLACE_KINDS, type PlaceKind,
  planDrawable, reportWords, segmentRows, segmentsTotal, swapReadingInput, unloggedText,
} from '@/office/taskDetailLogic';
import type { FleetError, Stop, TaskDetail } from '@/office/types';
import { Divider, ErrorNotice, Pill, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';
import { dateWords, datesInWords } from '@/lib/dateWords';

/** A small outlined link button (Photo, Receipt, Watch video, Map). */
function LinkButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} testID={testID} style={({ pressed }) => [styles.link, pressed && { opacity: 0.8 }]}>
      <Txt variant="strong" size={15} color={colors.blue}>{label}</Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// The warnings
// ---------------------------------------------------------------------------

export function TaskWarnings({ p }: { p: TaskDetail }) {
  const { t } = useApp();
  // The server's dates in words (Round 3 A4, lib/dateWords.ts): "last reading Yesterday 18:02".
  const unlogged = datesInWords(t, unloggedText(p, t));
  const saved = p.task.warnings_saved?.filter(Boolean) ?? [];
  if (!unlogged && saved.length === 0) return null;
  return (
    <View style={styles.warn} testID="task-warnings">
      {unlogged ? <Txt variant="strong" size={15} color={colors.amberText} testID="unlogged-km">{unlogged}</Txt> : null}
      {saved.length > 0 && (
        <View style={{ gap: 2 }} testID="warnings-saved">
          <Txt variant="strong" size={15} color={colors.amberText}>{t('office.task.warningsSaved')}</Txt>
          {saved.map((w, i) => <Txt key={i} variant="body" size={15}>{`• ${sentenceText(t, w)}`}</Txt>)}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// A driver-started trip
// ---------------------------------------------------------------------------

export function TripPurposeCard({ p }: { p: TaskDetail }) {
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const task = p.task;
  if (task.kind !== 'self') return null;
  const now = task.purpose ?? 'company';
  const who = task.driver ? task.driver.split(' ')[0] : t('office.task.theDriver');
  return (
    <View style={styles.card} testID="trip-purpose">
      <Txt variant="strong">{t('office.task.purposeTitle')}</Txt>
      <Txt variant="muted" size={15}>
        {[t('office.task.purposeLine', { name: who, purpose: t(`office.task.purpose_${now}`) }), now === 'company' ? t('office.task.purposeCharged', { project: chargedTo(p, t) }) : '', t('office.task.purposeApart')].filter(Boolean).join(' ')}
      </Txt>
      {me.tools.includes('set_trip_purpose') && (
        <Button kind="outline" label={t('office.task.purposeChange')} onPress={() => router.push({ pathname: '/office/task/[id]/purpose', params: { id: task.id } })} style={{ minHeight: 52 }} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The vehicle swap's stretches, and the reading still owed
// ---------------------------------------------------------------------------

export function SwapSegments({ p, onSaved }: { p: TaskDetail; onSaved: () => Promise<void> }) {
  const { t, language } = useApp();
  const { me, api } = useOffice();
  const rows = segmentRows(p.segments, t);
  const [typing, setTyping] = useState<{ vehicle: string; need: 'start' | 'end' } | null>(null);
  const [value, setValue] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const mayType = me.tools.includes('swap_reading');

  const close = () => {
    setTyping(null);
    setValue('');
    setWhy(null);
    setProblem(null);
  };
  async function save() {
    if (!typing || busy) return;
    const r = swapReadingInput(p.task.id, typing.vehicle, typing.need, value);
    if ('error' in r) {
      setWhy(t('office.task.readingBad', { why: t(`office.task.km_${r.error}`) }));
      return;
    }
    setWhy(null);
    setProblem(null);
    setBusy(true);
    try {
      const out = await api.call<{ note?: string; task_km?: number }>('swap_reading', r.input);
      close();
      setDone(out.task_km != null ? t('office.task.readingSavedKm', { km: out.task_km.toLocaleString('en-US') }) : t('office.task.readingSaved'));
      await onSaved();
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('office.task.swapTitle')}>
      {rows.map((g, i) => (
        <View key={i} style={{ paddingVertical: 8, gap: 4 }} testID="segment">
          {i > 0 && <Divider />}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {g.vehicle ? <Plate regNo={g.vehicle} /> : null}
            <Mono size={15} bold>{g.window}</Mono>
            <View style={{ flex: 1 }} />
            <Mono size={16} bold>{g.km || '—'}</Mono>
          </View>
          <Txt variant="muted" size={15}>{g.readings}</Txt>
          {g.waiting && <Txt variant="strong" size={15} color={colors.amberText}>{t('office.task.swapToCome')}</Txt>}
          {g.why ? <Txt variant="small">{g.why}</Txt> : null}
          {g.need && mayType && (
            <Button kind="outline" label={t('office.task.typeReading')} onPress={() => { setDone(null); setTyping({ vehicle: g.vehicle, need: g.need! }); }} style={{ minHeight: 48 }} testID="swap-reading" />
          )}
        </View>
      ))}
      <Txt variant="strong" size={15} testID="segments-total">{segmentsTotal(p.segments, t)}</Txt>
      {done ? <Txt variant="small" color={colors.green}>{done}</Txt> : null}
      <Sheet
        visible={!!typing}
        title={t('office.task.typeReading')}
        onClose={close}
        testID="swap-reading-sheet"
        actions={(
          <>
            <Button kind="outline" label={t('office.common.cancel')} onPress={close} style={{ flex: 1, minHeight: 52 }} />
            <Button label={t('office.common.save')} onPress={() => void save()} busy={busy} disabled={!value.trim()} style={{ flex: 1.4, minHeight: 52 }} />
          </>
        )}
      >
        <Txt variant="strong" size={16}>{typing ? t(typing.need === 'end' ? 'office.task.readingEnd' : 'office.task.readingStart', { plate: typing.vehicle }) : ''}</Txt>
        <TextInput value={value} onChangeText={(v) => { setValue(v); setWhy(null); }} keyboardType="number-pad" placeholder="—" placeholderTextColor="#9aa0a6" autoFocus
          style={[styles.km, { fontFamily: fonts.monoSemiBold }]} accessibilityLabel={t('office.task.typeReading')} />
        {!value.trim() ? <Txt variant="small" style={{ fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }}>{t('office.task.readingWhy')}</Txt> : null}
        {why ? <Txt variant="strong" size={15} color={colors.red}>{why}</Txt> : null}
        {problem ? <ErrorNotice error={problem} onRetry={() => void save()} /> : null}
      </Sheet>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// A stop's arrival point, and Save as our place
// ---------------------------------------------------------------------------

export function StopArrival({ stop, onSaved }: { stop: Stop; onSaved: () => Promise<void> }) {
  const { t, language } = useApp();
  const { me, api } = useOffice();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlaceKind>('other');
  const [why, setWhy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [busy, setBusy] = useState(false);
  const a = arrivalParts(stop, t);
  if (!a && !stop.saved_place) return null;
  const canSave = canSaveArrival(stop, me.tools);

  const close = () => {
    setOpen(false);
    setWhy(false);
    setProblem(null);
  };
  async function save() {
    if (!stop.id || busy) return;
    const r = arrivalPlaceInput(stop.id, name, kind);
    if ('error' in r) {
      setWhy(true);
      return;
    }
    setWhy(false);
    setProblem(null);
    setBusy(true);
    try {
      await api.call('save_arrival_place', r.input);
      setName('');
      close();
      await onSaved();
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 4, marginTop: 4 }} testID="stop-arrival">
      {a && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt variant="small" style={{ flexShrink: 1 }}>{a.line}</Txt>
          {a.maps ? <LinkButton label={t('office.task.arrivalMap')} onPress={() => void Linking.openURL(a.maps!).catch(() => undefined)} /> : null}
        </View>
      )}
      {stop.saved_place && <Txt variant="small" color={colors.green}>{t('office.task.savedAs', { name: stop.saved_place.name })}</Txt>}
      {canSave && <LinkButton label={t('office.task.saveAsPlace')} onPress={() => setOpen(true)} testID="save-as-place" />}
      <Sheet
        visible={open}
        title={t('office.task.saveAsPlace')}
        onClose={close}
        testID="save-place-sheet"
        actions={(
          <>
            <Button kind="outline" label={t('office.common.cancel')} onPress={close} style={{ flex: 1, minHeight: 52 }} />
            <Button label={t('office.common.save')} onPress={() => void save()} busy={busy} disabled={name.trim().length < 2} style={{ flex: 1.4, minHeight: 52 }} />
          </>
        )}
      >
        <Txt variant="strong" size={16}>{t('office.task.placeName')}</Txt>
        <TextInput value={name} onChangeText={(v) => { setName(v); setWhy(false); }} maxLength={120} placeholder={t('office.task.placeNameExample')} placeholderTextColor="#9aa0a6"
          style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]} accessibilityLabel={t('office.task.placeName')} />
        <Txt variant="small">{t('office.task.placeNameHint')}</Txt>
        <Txt variant="strong" size={16}>{t('office.task.placeKind')}</Txt>
        <Chips options={PLACE_KINDS.map((k) => ({ key: k, label: t(`office.task.kind_${k}`) }))} value={kind} onChange={setKind} />
        {why || name.trim().length < 2 ? <Txt variant="small" color={why ? colors.red : colors.muted}>{t('office.task.placeNeedName')}</Txt> : null}
        {problem ? <ErrorNotice error={problem} onRetry={() => void save()} /> : null}
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// More details: charged to, the odometer and fuel, the problems, the history, the plan
// ---------------------------------------------------------------------------

export function TaskMoreDetails({ p, openLink, linkNote, onPlan, fillExtra, odoExtra }: {
  p: TaskDetail;
  /** Round 52: under each fill (its "Delete…" for a wrong entry, the approve permission). */
  fillExtra?: (fill: TaskDetail['fuel'][number]) => ReactNode;
  /** Round 52: under each odometer reading (its "Delete…"). */
  odoExtra?: (reading: TaskDetail['odometer'][number]) => ReactNode;
  /** Opens a link by its key (the screen reads the task again first when its links are old). */
  openLink: (key: LinkKey) => void;
  /** "Renewing the link…" or "The link could not open." */
  linkNote?: string | null;
  /** Show the plan on the map (task/[id]/plan); absent without a plan. */
  onPlan?: () => void;
}) {
  const { t } = useApp();
  const history = p.assignment_history ?? [];
  const n = (x: number) => x.toLocaleString('en-US');
  return (
    <MoreDetails filled={false} testID="task-more-details">
      <Section title={t('office.task.chargedTo')}>
        <Txt variant="body" testID="charged-to">{chargedTo(p, t)}</Txt>
      </Section>

      <Section title={t('office.task.odoFuel')}>
        {p.odometer.length === 0 && p.fuel.length === 0 && <Txt variant="muted">{t('office.task.noReadings')}</Txt>}
        {p.odometer.map((o, i) => {
          const x = odometerParts(o, t);
          return (
            <View key={`o${i}`} style={{ paddingVertical: 8, gap: 4 }} testID="odometer-row">
              {i > 0 && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Mono size={17} bold>{x.title}</Mono>
                {x.flag ? <Pill text={x.flag} tone="amber" size={12} /> : null}
                <View style={{ flex: 1 }} />
                {x.photo ? <LinkButton label={t('office.task.photo')} onPress={() => openLink({ kind: 'odo', i })} /> : null}
              </View>
              <Txt variant="muted" size={15}>{datesInWords(t, x.line)}</Txt>
              {odoExtra ? odoExtra(o) : null}
            </View>
          );
        })}
        {p.fuel.map((f, i) => {
          const chip = f.video ? videoChip(f.video) : null;
          const pieces = f.video ? videoPieces(f.video) : [];
          return (
            <View key={`f${i}`} style={{ paddingVertical: 8, gap: 4 }} testID="fuel-row">
              {(i > 0 || p.odometer.length > 0) && <Divider />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Txt variant="strong" size={16}>{fuelTitle(f, t)}</Txt>
                {chip ? <Pill text={t(`office.reports.video_${chip.key}`)} tone={chip.tone} size={12} /> : null}
                <View style={{ flex: 1 }} />
                {f.receipt_photo && /^https:\/\//.test(f.receipt_photo) ? <LinkButton label={t('office.task.receipt')} onPress={() => openLink({ kind: 'receipt', i })} /> : null}
              </View>
              <Txt variant="muted" size={15}>{[t('office.task.fuelWord'), dateWords(t, f.at), f.odometer_km != null ? `${n(f.odometer_km)} km` : '', f.video ? videoLine(f.video) : ''].filter(Boolean).join(' · ')}</Txt>
              {f.video?.timeline ? <Txt variant="small">{f.video.timeline}</Txt> : null}
              {pieces.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {pieces.map((piece, k) => (
                    <LinkButton key={piece.n} testID="fuel-video"
                      label={pieces.length > 1 ? t('office.reports.watchPiece', { n: k + 1, d: piece.duration_s != null ? clockOf(piece.duration_s) : '' }) : t('office.reports.watch')}
                      onPress={() => openLink({ kind: 'video', i, n: piece.n })} />
                  ))}
                </View>
              )}
              {fillExtra ? fillExtra(f) : null}
            </View>
          );
        })}
      </Section>

      {p.vehicle_reports.length > 0 && (
        <Section title={t('office.task.problems')} count={p.vehicle_reports.length}>
          {p.vehicle_reports.map((r, i) => {
            const w = reportWords(r, t);
            return (
              <View key={r.id} style={{ paddingVertical: 8, gap: 4 }} testID="report-row">
                {i > 0 && <Divider />}
                <Txt variant="strong" size={16}>{w.category}</Txt>
                <Txt variant="muted" size={15}>{[dateWords(t, r.at), w.status, r.note ?? ''].filter(Boolean).join(' · ')}</Txt>
                {(r.photos ?? []).some((u) => /^https:\/\//.test(u)) && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(r.photos ?? []).map((u, k) => (/^https:\/\//.test(u) ? <LinkButton key={k} label={t('office.task.photoN', { n: k + 1 })} onPress={() => openLink({ kind: 'report', i, k })} /> : null))}
                  </View>
                )}
              </View>
            );
          })}
        </Section>
      )}
      {linkNote ? <Txt variant="small" color={colors.red}>{linkNote}</Txt> : null}
      <Txt variant="small">{t('office.task.linksNote')}</Txt>

      {history.length > 0 && (
        <Section title={t('office.task.history')} count={history.length}>
          {history.map((e, i) => {
            const h = historyParts(e, t);
            return (
              <View key={i} style={{ paddingVertical: 8, gap: 2 }} testID="history-event">
                {i > 0 && <Divider />}
                <Mono size={14} color={colors.muted}>{dateWords(t, h.at)}</Mono>
                <Txt variant="body" size={15}>{h.title}</Txt>
                {h.changes.map((c, k) => <Txt key={k} variant="small">{`• ${c}`}</Txt>)}
              </View>
            );
          })}
        </Section>
      )}

      {onPlan && p.plan && planDrawable(p) && (
        <Button kind="outline" label={t('office.task.showPlan')} onPress={onPlan} style={{ minHeight: 56 }} testID="show-plan" />
      )}
    </MoreDetails>
  );
}

const styles = StyleSheet.create({
  warn: { backgroundColor: colors.amberChip, borderRadius: 12, padding: 12, gap: 6 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignSelf: 'flex-start' },
  km: { minHeight: 56, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontSize: 22, color: colors.ink, backgroundColor: colors.card },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
});
