// Office mode (Stage 1, O3 row 1): Approve's Change time, opened from Approve a request. One job: when the trip runs. The
// day (Today / Tomorrow / Pick a date), the leave-by and the back-by on the time sheet (the request's own times offered
// first), and for a waiting request asked as From / To the minutes at each place and where the trip starts (the place
// search). "Use these times" keeps them for Approve (office/decideStore.ts), which asks Who's available at the new time
// and sends only what changed (office/decideLogic.ts); "As asked" puts the request's own times back. A changed booking
// (redecide_request) moves the day and the times only.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PlaceSearch } from '@/components/office/PlaceSearch';
import { TripDayPicker } from '@/components/patterns/Calendar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { TimeField } from '@/components/patterns/TimeField';
import { Button, Mono, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { askedOf, asksFromTo, DWELL_CHOICES, hasChange, shownOf, type TimeChange, timeProblem } from '@/office/decideLogic';
import { decideStore } from '@/office/decideStore';
import { requestTitle } from '@/office/homeLogic';
import { useOffice, useTool } from '@/office/state';
import type { RequestsList } from '@/office/types';
import { BackHeader, ListFailed, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords } from '@/lib/dateWords';

export default function ChangeTimeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const q = useTool<RequestsList>('list_requests', { status: 'all', id, limit: 1 });
  const card = q.data?.requests[0] ?? null;
  const [c, setC] = useState<TimeChange>(() => decideStore.get(id) ?? {});
  const [dwellOpen, setDwellOpen] = useState<'from' | 'to' | null>(null);
  const asked = card ? askedOf(card) : null;
  const shown = asked ? shownOf(c, asked) : null;
  const waiting = card?.status === 'waiting';
  const fromTo = !!card && waiting && asksFromTo(card);
  const problem = shown ? timeProblem(shown) : null;
  const changed = !!asked && hasChange(c, asked);
  const block = problem ? t('office.decide.backBeforeLeave') : !changed ? t('office.decide.nothingChanged') : null;

  function use() {
    if (!asked || block) return;
    decideStore.set(id, c);
    router.back();
  }
  function asAsked() {
    decideStore.set(id, null);
    router.back();
  }
  const dwellText = (m: number | null) => (m === null ? t('office.decide.usualTime') : m === 0 ? t('office.decide.noWait') : durationText(t, m));

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.decide.changeTime')} subtitle={card ? requestTitle(card) : undefined} />
      <Screen bottom={140}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={1} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !card && <ListEmpty text={t('office.request.notFound')} />}
        {card && asked && shown && (
          <>
            <Txt variant="muted" size={15}>{t('office.decide.asked', { day: dateWords(t, asked.date), leave: asked.leaveBy || '—', back: asked.back || '—' })}</Txt>
            <Section title={t('office.decide.day')}>
              <TripDayPicker value={shown.date} onChange={(d) => setC((x) => ({ ...x, date: d }))} testID="decide-day" />
            </Section>
            <Section title={t('office.decide.times')}>
              <TimeField label={t('office.decide.leaveBy')} value={shown.leaveBy} suggested={asked.leaveBy || undefined} onCommit={(v) => setC((x) => ({ ...x, leaveBy: v || undefined }))} testID="decide-leave" />
              <TimeField label={t('office.decide.backBy')} value={shown.back} suggested={asked.back || undefined} tone={problem ? 'red' : undefined} onCommit={(v) => setC((x) => ({ ...x, back: v || undefined }))} testID="decide-back" />
              {problem && <Txt variant="small" color={colors.red}>{t('office.decide.backBeforeLeave')}</Txt>}
              <Txt variant="small">{t('office.decide.replanNote')}</Txt>
            </Section>
            {fromTo && (
              <Section title={t('office.decide.minutesThere')}>
                {(['from', 'to'] as const).map((k) => (
                  <Pressable key={k} accessibilityRole="button" onPress={() => setDwellOpen(k)} style={styles.field} testID={`decide-dwell-${k}`}>
                    <Txt variant="strong" size={16} style={{ flex: 1 }} numberOfLines={1}>{k === 'from' ? card.fields?.route_from ?? t('office.decide.from') : card.fields?.route_to ?? t('office.decide.to')}</Txt>
                    <Mono size={15} bold>{dwellText(k === 'from' ? shown.fromDwell : shown.toDwell)}</Mono>
                  </Pressable>
                ))}
              </Section>
            )}
            {waiting && (
              <Section title={t('office.decide.start')}>
                <PlaceSearch
                  value={c.start?.name ?? ''}
                  placeholder={t('office.decide.startHint')}
                  onText={(text) => setC((x) => ({ ...x, start: text.trim() ? { name: text, pinned: false } : undefined }))}
                  onPick={(p) => setC((x) => ({ ...x, start: p }))}
                />
                <Txt variant="small">{t('office.decide.startNote')}</Txt>
              </Section>
            )}
          </>
        )}
      </Screen>
      {card && asked && (
        <StickyActions>
          <Button label={t('office.decide.useTimes')} onPress={use} disabled={!!block} />
          {block && <Txt variant="small" style={{ textAlign: 'center' }}>{block}</Txt>}
          {decideStore.get(id) && <Button kind="outline" label={t('office.decide.asAsked')} onPress={asAsked} style={{ minHeight: 52 }} />}
        </StickyActions>
      )}
      <Sheet visible={dwellOpen !== null} title={dwellOpen === 'to' ? t('office.decide.minutesTo') : t('office.decide.minutesFrom')} onClose={() => setDwellOpen(null)}>
        {/* "Usual time" only while the request names no minutes there: decide_request cannot send it back to the usual. */}
        {[...(asked && (dwellOpen === 'from' ? asked.fromDwell : asked.toDwell) === null ? [null] : []), ...DWELL_CHOICES].map((m) => {
          const on = dwellOpen && shown ? (dwellOpen === 'from' ? shown.fromDwell : shown.toDwell) === m : false;
          return (
            <Pressable key={String(m)} accessibilityRole="radio" accessibilityState={{ checked: on }}
              onPress={() => { setC((x) => (dwellOpen === 'from' ? { ...x, fromDwell: m } : { ...x, toDwell: m })); setDwellOpen(null); }}
              style={[styles.option, on && { backgroundColor: colors.blueChip }]}>
              <Txt variant="strong" size={16}>{dwellText(m)}</Txt>
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 14, marginBottom: 8 },
  option: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
});
