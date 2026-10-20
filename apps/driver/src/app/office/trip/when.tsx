// Office mode (Phase 8, O2): the trip editor's step 2, When (design 07): the day (Today, Tomorrow, the day after, Pick a
// date → the next 14 days), each stop's arrive-by and the time at the stop (chips, Other = minutes; "Usual here" from
// the plan), Back by, and "Leave from <start>" with the leave-by time: empty = planned from the arrive-by times (the plan
// fills it in), typed = checked against them ("36 min too late", the sentence, Use HH:MM, Move arrive-by to HH:MM).
// The plan comes 1.5 s after the last change (plan_task). Next: Who.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TimeInput } from '@/components/office/TimeInput';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { Button, Mono, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import { addDays, colomboDate } from '@/lib/time';
import { useOffice, useTool } from '@/office/state';
import { nextStep, updateDraft, useTripDraft } from '@/office/trip/draft';
import { dwellFallbacks } from '@/office/trip/planLogic';
import { dwellText, parseDwell, type StopDraft, stopsInput } from '@/office/trip/stopsLogic';
import { useTrip } from '@/office/trip/useTrip';
import { departureText, DWELL_CHIPS, dwellChipText, lateByText, reasonText } from '@/office/trip/words';
import type { SettingsResult } from '@/office/types';
import { Loading, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

export default function TripWhen() {
  const { t, tList } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const [pickDate, setPickDate] = useState(false);
  const [other, setOther] = useState<string | null>(null); // the stop whose "Other" minutes box is open
  const names = { days: tList('days'), months: tList('months') };
  const today = colomboDate();
  const draft = d ?? null;
  const trip = useTrip(draft ?? { mode: 'request', fields: { date: today, leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' }, rows: [], step: 'when', at: 0 }, settings.data ?? null);
  if (!draft) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;
  const f = draft.fields;
  const setF = (patch: Partial<typeof f>) => updateDraft((x) => ({ ...x, fields: { ...x.fields, ...patch } }));
  const patchStop = (key: string, patch: Partial<StopDraft>) => setF({ stops: f.stops.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const fallbacks = dwellFallbacks(f.stops, trip.preview?.stops, trip.dwellSetting);
  const days = [today, addDays(today, 1), addDays(today, 2)];
  const dayLabel = (day: string) => day === today ? t('office.common.today') : day === addDays(today, 1) ? `${t('office.common.tomorrow')} · ${shortDate(names, `${day}T06:00:00Z`)}` : shortDate(names, `${day}T06:00:00Z`);
  const stopsOk = stopsInput(f.stops, f.startPax ? 1 : 0);
  const problem = 'error' in stopsOk ? reasonText(t, stopsOk.error) : !f.leaveBy && !f.stops.some((s) => s.arriveBy) ? t('office.trip.reasonLeave') : null;
  const check = trip.check;
  const lateLabel = lateByText(t, check, f.leaveBy);
  const startName = f.start.trim() || trip.base?.name || '';
  const above = draft.mode === 'task' ? t('office.trip.assignAbove', { n: 2 }) : draft.mode === 'edit' ? t('office.trip.editAbove') : draft.mode === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 2 });

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="when" mode={draft.mode} above={above} onBack={() => router.back()} />
      <Screen bottom={16}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(pickDate ? Array.from({ length: 14 }, (_, i) => addDays(today, i)) : [...days, ...(days.includes(f.date) ? [] : [f.date])]).map((day) => (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: f.date === day }} onPress={() => setF({ date: day })} style={[styles.chip, f.date === day && styles.chipOn]}>
              <Txt variant="strong" size={16} color={f.date === day ? '#ffffff' : colors.ink}>{dayLabel(day)}</Txt>
            </Pressable>
          ))}
          {!pickDate && (
            <Pressable accessibilityRole="button" onPress={() => setPickDate(true)} style={styles.chip}>
              <Txt variant="strong" size={16}>{t('office.trip.pickDate')}</Txt>
            </Pressable>
          )}
        </View>

        {f.stops.map((s, i) => {
          const fb = fallbacks.get(s.key);
          const chosen = parseDwell(s.dwell);
          const chosenMin = typeof chosen === 'number' ? chosen : null;
          const onChip = chosenMin !== null && DWELL_CHIPS.includes(chosenMin);
          return (
            <View key={s.key} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.mark}><Mono size={14} bold color="#ffffff">{String(i + 1 + (f.startPax ? 1 : 0) + (draft.reached ?? 0))}</Mono></View>
                <View style={{ flex: 1 }}>
                  <Txt variant="strong" numberOfLines={2}>{s.place || t('office.trip.stopNoPlace')}</Txt>
                  <Txt variant="small">{t(`office.trip.type_${s.type}`)}</Txt>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TimeInput label={t('office.trip.arriveBy')} value={s.arriveBy} onCommit={(arriveBy) => patchStop(s.key, { arriveBy })} tone={trip.lateKey === s.key ? 'red' : undefined} />
                {i === f.stops.length - 1 && <TimeInput label={t('office.trip.backBy')} value={f.end} onCommit={(end) => setF({ end })} tone={trip.lateBack ? 'red' : undefined} />}
              </View>
              {check && check.kind === 'late' && trip.lateKey === s.key && (
                <DepartureNote text={departureText(t, check)} tone={check.tone} useLabel={t('office.trip.use', { time: check.leaveBy })} onUse={() => trip.setLeave(check.leaveBy)} moveLabel={check.moveTo ? t('office.trip.moveArriveBy', { time: check.moveTo }) : undefined} onMove={check.moveTo ? () => trip.moveArriveBy(check.n, check.moveTo!) : undefined} />
              )}
              <Txt variant="label" color={colors.muted}>{t('office.trip.timeAtStop').toUpperCase()}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {DWELL_CHIPS.map((min) => {
                  const on = chosenMin === min;
                  return (
                    <Pressable key={min} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { patchStop(s.key, { dwell: on ? '' : String(min) }); setOther(null); }} style={[styles.chip, on && styles.chipOn]}>
                      <Txt variant="strong" size={15} color={on ? '#ffffff' : colors.ink}>{dwellChipText(t, min)}</Txt>
                    </Pressable>
                  );
                })}
                <Pressable accessibilityRole="button" accessibilityState={{ selected: other === s.key || (chosenMin !== null && !onChip) }} onPress={() => setOther(other === s.key ? null : s.key)} style={[styles.chip, (other === s.key || (chosenMin !== null && !onChip)) && styles.chipOn]}>
                  <Txt variant="strong" size={15} color={other === s.key || (chosenMin !== null && !onChip) ? '#ffffff' : colors.ink}>{t('office.trip.other')}</Txt>
                </Pressable>
              </View>
              {other === s.key && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TextInput value={s.dwell} onChangeText={(v) => patchStop(s.key, { dwell: v.replace(/[^\d:]/g, '').slice(0, 5) })} keyboardType="number-pad" placeholder="45" placeholderTextColor="#9aa0a6" style={styles.minutes} accessibilityLabel={t('office.trip.minutes')} />
                  <Txt variant="muted">{t('office.trip.minutes')}</Txt>
                </View>
              )}
              {chosenMin === null && fb && <Txt variant="small">{fb.source === 'place' ? t('office.trip.usualHere', { dur: dwellText(fb.min) }) : t('office.trip.defaultHere', { dur: dwellText(fb.min) })}</Txt>}
            </View>
          );
        })}

        <View style={styles.card}>
          <Txt variant="label" color={colors.muted}>{t('office.trip.leaveFrom', { place: startName }).toUpperCase()}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TimeInput value={f.leaveBy} onCommit={trip.setLeave} tone={lateLabel ? 'red' : undefined} placeholder={t('office.trip.leaveAuto')} />
            {lateLabel && <Txt variant="strong" size={15} color={colors.red}>{lateLabel}</Txt>}
          </View>
          {!f.leaveBy && <Txt variant="small">{trip.plan.updating ? t('office.trip.planning') : t('office.trip.leaveHint')}</Txt>}
          {check && check.kind === 'late' && !trip.lateKey && (
            <DepartureNote text={departureText(t, check)} tone={check.tone} useLabel={t('office.trip.use', { time: check.leaveBy })} onUse={() => trip.setLeave(check.leaveBy)} moveLabel={check.back && check.moveBackTo ? t('office.trip.moveBackBy', { time: check.moveBackTo }) : check.moveTo ? t('office.trip.moveArriveBy', { time: check.moveTo }) : undefined} onMove={check.back && check.moveBackTo ? () => trip.setEnd(check.moveBackTo!) : check.moveTo ? () => trip.moveArriveBy(check.n, check.moveTo!) : undefined} />
          )}
          {check && check.kind === 'early' && <Txt variant="small">{departureText(t, check)}</Txt>}
          {trip.reasons.filter((r) => !r.note).length > 0 && f.leaveBy ? (
            <View style={{ gap: 4 }}>{trip.reasons.filter((r) => !r.note).map((r, i) => <Txt key={i} variant="small" color={colors.amberText}>{reasonText(t, r.text)}</Txt>)}</View>
          ) : null}
          {trip.plan.input && (
            <Button kind="outline" label={trip.plan.updating ? t('office.trip.planning') : t('office.trip.planNow')} onPress={trip.plan.planNow} busy={trip.plan.updating} style={{ minHeight: 48 }} />
          )}
        </View>
      </Screen>
      <TripFooter label={t(nextStep('when', draft.mode) === 'review' ? 'office.trip.nextReview' : 'office.trip.nextWho')} onPress={() => { const next = nextStep('when', draft.mode) ?? 'who'; updateDraft((x) => ({ ...x, step: next })); router.push(`/office/trip/${next}` as never); }} disabled={!!problem} problem={problem} />
    </View>
  );
}

function DepartureNote({ text, tone, useLabel, onUse, moveLabel, onMove }: { text: string; tone: 'bad' | 'warn'; useLabel: string; onUse: () => void; moveLabel?: string; onMove?: () => void }) {
  const ink = tone === 'bad' ? colors.red : colors.amberText;
  return (
    <View style={[styles.note, { backgroundColor: tone === 'bad' ? colors.redChip : colors.amberChip }]}>
      <Txt variant="strong" size={16} color={ink}>{text}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label={useLabel} onPress={onUse} style={{ minHeight: 48, paddingHorizontal: 14 }} />
        {moveLabel && onMove && <Button kind="outline" label={moveLabel} onPress={onMove} style={{ minHeight: 48, paddingHorizontal: 14, borderColor: ink }} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  mark: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  minutes: { width: 90, minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, fontFamily: fonts.monoSemiBold, fontSize: 22, color: colors.ink, backgroundColor: colors.card },
  note: { borderRadius: 14, padding: 14, gap: 10 },
});
