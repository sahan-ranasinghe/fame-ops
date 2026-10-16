// Today (designed: design/png/Driver · Today.png).

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GoogleCredit } from '@/components/GoogleCredit';
import { Check, ChevronRight, Play } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguagePill } from '@/components/LanguageSwitch';
import { DeclineSheet } from '@/components/DeclineSheet';
import { DutyHeader, DutyNotices } from '@/components/DutyCard';
import { leaveTime, StopTimeline, useDateLabel, usePeopleLine } from '@/components/task';
import { PhoneSetupCard } from '@/components/PhoneSetupCard';
import { TrackingNotice } from '@/components/tracking';
import { Button, Card, Mono, Notice, Txt } from '@/components/ui';
import { firstName } from '@/lib/format';
import { colomboDate, colomboHour, colomboTime } from '@/lib/time';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

function greetingKey(): string {
  const hour = colomboHour();
  return hour < 12 ? 'today.morning' : hour < 17 ? 'today.afternoon' : 'today.evening';
}

export default function TodayScreen() {
  const app = useApp();
  const { t, me, tasks, waitingTasks } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  const peopleLine = usePeopleLine();

  const today = colomboDate();
  const [declining, setDeclining] = useState<TaskWithStops | null>(null);
  const running = tasks.find((task) => task.status === 'in_progress');
  const assigned = tasks
    .filter((task) => task.status === 'assigned')
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const next: TaskWithStops | undefined = running ?? assigned[0];
  const rest = assigned.filter((task) => task !== next);
  const laterToday = rest.filter((task) => colomboDate(task.start_at) <= today);
  const upcoming = rest.filter((task) => colomboDate(task.start_at) > today);

  // "Seen by driver": recorded the first time a task is on screen.
  const unseen = tasks.filter((task) => task.status === 'assigned' && !task.seen_at).map((task) => task.id).join(',');
  const { markSeen, refresh } = app;
  useFocusEffect(
    useCallback(() => {
      if (unseen !== '') markSeen(unseen.split(','));
    }, [unseen, markSeen]),
  );

  function openNext() {
    if (!next) return;
    if (next.status === 'in_progress') router.push({ pathname: '/task/[id]', params: { id: next.id } });
    else {
      // Location must be on to start a task; the cover asks for it first, then the odometer screen opens.
      void app.requireLocation('start', () => {
        router.push({ pathname: '/log-mileage', params: { mode: 'start', taskId: next.id, from: 'today' } });
      });
    }
  }

  const people = next ? peopleLine(next) : null;

  return (
    <View style={styles.page}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={refresh} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        <View style={[styles.header, { paddingTop: insets.top + 22 }]}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Txt variant="muted" color="#b9bec4">{dateLabel(new Date())}</Txt>
              <Txt variant="title" size={28} color="#ffffff" numberOfLines={2}>
                {t(greetingKey(), { name: firstName(me?.name ?? '') })}
              </Txt>
            </View>
            <LanguagePill />
          </View>

          {/* Phase 7: the duty state in place of the "On duty" switch (Start work / Change vehicle / Finish work). */}
          <DutyHeader />
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          {app.offline && <Notice tone="warn" text={t('common.savedOffline')} />}
          <DutyNotices />
          {app.notice && (
            <Pressable accessibilityRole="button" onPress={app.clearNotice}>
              <Notice tone="info" text={t(app.notice)} />
            </Pressable>
          )}
          <TrackingNotice />
          <PhoneSetupCard />
          {app.queue.points > 0 && (!app.dataAvailable || app.offline) && (
            <Txt variant="small" color={colors.amberText}>{t('today.offlineWaiting', { n: app.queue.points })}</Txt>
          )}

          {next ? (
            <View style={styles.nextCard}>
              <View style={styles.nextTop}>
                <Txt variant="label" color={next.status === 'in_progress' ? colors.blue : colors.amberText}>
                  {t(next.status === 'in_progress' ? 'today.inProgress' : 'today.nextTask')}
                </Txt>
                <Mono size={24} bold>{colomboTime(leaveTime(next))}</Mono>
              </View>
              <Txt variant="muted">{[colomboDate(next.start_at) !== today ? dateLabel(next.start_at) : null, next.status === 'assigned' ? t('today.leaveBy', { time: colomboTime(leaveTime(next)) }) : null].filter(Boolean).join(' · ')}</Txt>
              <Txt variant="title" size={27} style={{ marginTop: 4, marginBottom: 14 }}>{next.title}</Txt>
              <StopTimeline stops={next.task_stops} compact />
              {people && <Txt variant="muted" style={{ marginTop: 14 }}>{people}</Txt>}
              {waitingTasks.has(next.id) && <Txt variant="small" color={colors.amberText} style={{ marginTop: 8 }}>{t('today.notSentYet')}</Txt>}
              {next.status === 'assigned' && next.accepted_at && (
                <Txt variant="strong" color={colors.blue} style={{ marginTop: 14 }}>{t('task.accepted', { time: colomboTime(next.accepted_at) })}</Txt>
              )}
              {next.status === 'assigned' && !next.accepted_at ? (
                <>
                  <Button label={t('task.accept')} icon={Check} onPress={() => app.acceptTask(next)} style={{ marginTop: 18 }} />
                  <Button label={t('today.startTask')} kind="outline" icon={Play} onPress={openNext} style={{ marginTop: 10 }} />
                </>
              ) : (
                <Button
                  label={t(next.status === 'in_progress' ? 'today.openTask' : 'today.startTask')}
                  icon={next.status === 'in_progress' ? undefined : Play}
                  onPress={openNext}
                  style={{ marginTop: 18 }}
                />
              )}
              {next.status === 'assigned' && <Button kind="danger-text" label={t('task.cantDo')} onPress={() => setDeclining(next)} />}
            </View>
          ) : (
            <Card style={{ alignItems: 'center', paddingVertical: 34, gap: 6 }}>
              <Txt variant="heading">{t('today.noTasks')}</Txt>
              <Txt variant="muted" style={{ textAlign: 'center' }}>{t('today.noTasksHint')}</Txt>
            </Card>
          )}

          <TaskList title={t('today.laterToday')} tasks={laterToday} />
          <TaskList title={t('today.upcoming')} tasks={upcoming} showDate />
        </View>
      </ScrollView>
      <DeclineSheet task={declining} onClose={() => setDeclining(null)} />
    </View>
  );
}

function TaskList({ title, tasks, showDate = false }: { title: string; tasks: TaskWithStops[]; showDate?: boolean }) {
  const { t } = useApp();
  const router = useRouter();
  const dateLabel = useDateLabel();
  if (tasks.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="heading" style={{ marginLeft: 6 }}>{title}</Txt>
      <Card style={{ padding: 0 }}>
        {tasks.map((task, index) => (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
            style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
          >
            <View style={{ width: 62 }}>
              <Mono size={18} bold>{colomboTime(leaveTime(task))}</Mono>
              {showDate && <Txt variant="small">{dateLabel(task.start_at)}</Txt>}
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="strong" size={18}>{task.title}</Txt>
              {task.task_stops[0] && <Txt variant="muted">{t('today.from', { place: task.task_stops[0].place_name })}</Txt>}
              <GoogleCredit show={task.task_stops.some((s) => !!s.google_place_id)} />
              {task.status === 'assigned' && (
                <Txt variant="small" color={task.accepted_at ? colors.blue : colors.amberText}>{t(task.accepted_at ? 'today.accepted' : 'today.notAccepted')}</Txt>
              )}
            </View>
            <ChevronRight size={22} color={colors.ink} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 22, gap: 18 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextCard: { backgroundColor: colors.card, borderWidth: 2.5, borderColor: colors.ink, borderRadius: 22, padding: 20 },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 72 },
});
