// Round 4–7, feature 7 (Sahan, 22 October 2026): Asks, the asks for a busy driver or vehicle of the last 14 days
// (holder_asks): To me · By me, and All for the people who approve. Each row (the list row of the approved mockups): the
// person's photo, what is wanted on which trip, a grey line (when it is wanted, who asked or who holds it, the note) and the
// answer chip (Yes, No, Waiting). An ask to the person not answered yet has Yes / No under it (answer_holder_ask; a failed
// answer says it may not have been saved, with Try again: never sent again by itself). A row opens its trip for who may
// open tasks. ?task=<id> (a task page's link) shows that trip's asks only, with Show all. Reached from More and from the
// notification centre (a holder.* item the person cannot open as a task). The rules: office/holderLogic.ts.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { showSnackbar } from '@/components/patterns/Snackbar';
import { whenWords } from '@/lib/dateWords';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Segmented, Txt } from '@/components/ui';
import { actionWords, answeredAsk, askChip, askMeta, askTitle, asksEmptyKey, asksFor, asksTab, asksTabs, type AsksWhich, canAnswer } from '@/office/holderLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, HolderAsks } from '@/office/types';
import { Avatar, BackHeader, Divider, ErrorNotice, ListFailed, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

const TAB_KEY: Record<AsksWhich, string> = { to_me: 'office.holders.toMe', by_me: 'office.holders.byMe', all: 'office.common.all' };

export default function HolderAsksScreen() {
  const params = useLocalSearchParams<{ which?: string; task?: string }>();
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const [which, setWhich] = useState<AsksWhich>(() => asksTab(params.which, me.permissions));
  const [taskId, setTaskId] = useState<string | undefined>(params.task || undefined);
  const q = useTool<HolderAsks>('holder_asks', { which }, { every: 60_000 });
  // One answer at a time; its error stays under its row with Try again (the same press again).
  const [answering, setAnswering] = useState<{ id: string; answer: 'yes' | 'no'; busy: boolean; error: FleetError | null } | null>(null);
  const opensTasks = me.permissions.includes('assign_tasks');
  const asks = asksFor(q.data?.asks ?? [], taskId);
  // Dates in words, in the person's language ("Fri 24 Oct 09:00" → "Tomorrow 09:00").
  const when = (s: string) => whenWords(t, s);

  async function answer(id: string, value: 'yes' | 'no') {
    if (answering?.busy) return;
    setAnswering({ id, answer: value, busy: true, error: null });
    try {
      await api.call('answer_holder_ask', { ask_id: id, answer: value });
      q.patch((list) => answeredAsk(list, id, value));
      setAnswering(null);
      showSnackbar({ text: t('office.holders.youSaid', { answer: actionWords(value, t) }) });
    } catch (e) {
      setAnswering({ id, answer: value, busy: false, error: e as FleetError });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.holders.asksTitle')} subtitle={t('office.holders.asksSubtitle')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <Segmented<AsksWhich>
          options={asksTabs(me.permissions).map((k) => ({ value: k, label: t(TAB_KEY[k]) }))}
          value={which}
          onChange={(k) => { setWhich(k); setAnswering(null); }}
        />
        {taskId ? (
          <View style={styles.filter} testID="holder-asks-task-filter">
            <Txt variant="strong" size={15} style={{ flex: 1 }}>{t('office.holders.thisTripOnly')}</Txt>
            <Pressable accessibilityRole="button" onPress={() => setTaskId(undefined)} style={(state) => [styles.linkBtn, hoverStyle(state)]}>
              <Txt variant="strong" size={15} color={colors.blue}>{t('office.holders.showAll')}</Txt>
            </Pressable>
          </View>
        ) : null}
        {!q.data && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && asks.length === 0 && <ListEmpty text={t(asksEmptyKey(which))} />}
        {asks.length > 0 && (
          <Section title={t(TAB_KEY[which])} count={asks.length}>
            {asks.map((a, i) => {
              const chip = askChip(a, t);
              const person = which === 'by_me' ? a.holder : a.asked_by;
              const mine = answering?.id === a.id ? answering : null;
              return (
                <View key={a.id} testID="holder-ask-row">
                  {i > 0 && <Divider />}
                  <Row
                    left={<Avatar name={person ?? a.what ?? '?'} size={40} />}
                    title={askTitle(a, t)}
                    line={askMeta(a, which, t, when)}
                    line2={a.answered_by && a.answer ? t('office.holders.answeredBy', { name: a.answered_by, at: when(a.answered_at ?? '') }) : t('office.holders.askedAt', { at: when(a.asked_at) })}
                    chip={chip}
                    onPress={opensTasks ? () => router.push({ pathname: '/office/task/[id]', params: { id: a.task_id } }) : undefined}
                  />
                  {canAnswer(a, which) && (
                    <View style={{ gap: 6 }}>
                      <View style={styles.answers}>
                        <Button kind="dark" label={t('office.holders.yes')} onPress={() => void answer(a.id, 'yes')} busy={mine?.busy === true && mine.answer === 'yes'} disabled={!!answering?.busy} style={styles.answerBtn} testID={`holder-ask-yes-${a.id}`} />
                        <Button kind="outline" label={t('office.holders.no')} onPress={() => void answer(a.id, 'no')} busy={mine?.busy === true && mine.answer === 'no'} disabled={!!answering?.busy} style={styles.answerBtn} testID={`holder-ask-no-${a.id}`} />
                      </View>
                      {mine?.error && <ErrorNotice error={mine.error} onRetry={() => void answer(a.id, mine.answer)} onSignIn={() => void signOut()} />}
                    </View>
                  )}
                </View>
              );
            })}
          </Section>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  filter: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.blueChip, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
  answers: { flexDirection: 'row', gap: 8, paddingLeft: 52, paddingBottom: 8 },
  answerBtn: { minHeight: 44, paddingHorizontal: 20 },
});
