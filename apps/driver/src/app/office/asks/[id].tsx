// Office mode (Stage 1, O3 item 7): one question to drivers (ask_answers {ask_id}): the question, who asked and when,
// the counts, and every driver's answer (waiting · seen HH:MM · Yes · No · Call me · a time · a place) with Call and Map;
// the task or the request it is about opens its page (only for who may open it). Read again every 10 s while it is
// open and someone has still to answer. Opened from a notification ("Kamal answered") and from Questions under More.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SkeletonRows } from '@/components/patterns/ListState';
import { MapPin, Phone } from '@/components/icons';
import { Txt } from '@/components/ui';
import { answerLabel, answerOf, askCountsLine, keepPolling } from '@/office/askLogic';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { AskAnswers } from '@/office/types';
import { Avatar, BackHeader, Divider, ListFailed, Pill, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function AskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const first = useTool<AskAnswers>('ask_answers', { ask_id: id });
  const ask = first.data?.ask;
  // Read again every 10 s only while someone has still to answer (the sheet's rule).
  useTool<AskAnswers>('ask_answers', { ask_id: id }, { every: 10_000, enabled: !!ask && keepPolling(ask) });

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title={t('office.asks.one')} subtitle={ask ? t('office.asks.askedBy', { name: ask.asked_by, when: ask.asked }) : undefined} />
      <Screen refreshing={first.refreshing} onRefresh={() => void first.reload()}>
        {first.loading && !ask && <SkeletonRows rows={4} />}
        {first.error && !ask && <ListFailed error={first.error} onRetry={() => void first.reload()} />}
        {ask && (
          <>
            <View style={styles.card}>
              <Txt variant="heading" size={20}>{ask.question}</Txt>
              {ask.note ? <Txt variant="muted">{ask.note}</Txt> : null}
              <Txt variant="strong" size={15}>{askCountsLine(ask.counts, t)}</Txt>
              {ask.expired ? <Pill text={t('office.asks.closed')} tone="muted" /> : null}
              {ask.task_id && has(me.permissions, 'assign_tasks') && (
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: ask.task_id! } })} hitSlop={8}>
                  <Txt variant="strong" size={15} color={colors.blue}>{t('office.asks.openTask')}</Txt>
                </Pressable>
              )}
              {ask.request_id && has(me.permissions, 'approve') && (
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/office/request/[id]', params: { id: ask.request_id! } })} hitSlop={8}>
                  <Txt variant="strong" size={15} color={colors.blue}>{t('office.asks.openRequest')}</Txt>
                </Pressable>
              )}
            </View>
            <Section title={t('office.asks.answers')} count={ask.drivers.length}>
              {ask.drivers.map((r, i) => {
                const a = answerOf(r);
                return (
                  <View key={`${r.username ?? r.name}-${i}`}>
                    {i > 0 && <Divider />}
                    <View style={styles.row} testID="ask-answer">
                      <Avatar name={r.name} size={40} photo={r.photo_url} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Txt variant="strong">{r.name}</Txt>
                        <View style={{ flexDirection: 'row' }}><Pill text={answerLabel(a, t)} tone={a.tone === 'green' ? 'green' : a.tone === 'red' ? 'red' : a.tone === 'amber' ? 'amber' : a.tone === 'blue' ? 'blue' : 'muted'} /></View>
                      </View>
                      {(a.call ?? r.links?.call) ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open((a.call ?? r.links?.call)!)} style={styles.iconBtn}><Phone size={20} color={colors.ink} /></Pressable>
                      ) : null}
                      {a.map ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={t('office.ask.maps')} onPress={() => open(a.map!)} style={styles.iconBtn}><MapPin size={20} color={colors.ink} /></Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </Section>
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  iconBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
