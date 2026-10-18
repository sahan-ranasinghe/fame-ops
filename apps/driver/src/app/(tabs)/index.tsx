// Today (designed: design/png/Driver · Today.png).
// Phase 7 Part 2: the card's stops are named by their place in the order with the time there
// (components/task.tsx), and a running task the office moved to another vehicle says so
// ("Vehicle changed: WP KL-1234") until both odometers are logged on the task screen.
// Part 3 (§6): the card shows the task's vehicle with its photo.
// Part 4 (item 7): no Phone setup card here any more; the brand's steps are in the first-run Permissions
// flow and on Me → Phone setup (app/phone-setup.tsx).
// Part 4 (§13): on duty with no task in progress, "Start a trip" (app/start-trip.tsx); a trip of the driver's own
// reads "Your trip · Company work" where the office's title would be, and has no "Can't do this task".
// Hotfix 2: the card lists every stop (the first four and "Show all"), "Leave by 09:00 · in 45 min" (lib/durations.ts),
// the vehicle or "Your vehicle on the day" / "Any van" (J), Call contact / requester / fleet admin / office with
// WhatsApp (F), and "Changed" when the office changed the task since it was last seen (I). Tapping the card opens the
// whole task (the preview on app/task/[id].tsx) before accepting.

import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GoogleCredit } from '@/components/GoogleCredit';
import { Check, ChevronRight, Play, Route } from '@/components/icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguagePill } from '@/components/LanguageSwitch';
import { DeclineSheet } from '@/components/DeclineSheet';
import { DutyHeader, DutyNotices } from '@/components/DutyCard';
import { CallButtons } from '@/components/CallButtons';
import { ChangedTag, leaveTime, StopTimeline, useDateLabel, useDurations, useNow, usePeopleLine } from '@/components/task';
import { Thumb, useVehicleThumbs } from '@/components/Photos';
import { PlateText } from '@/components/PlateText';
import { plateOf } from '@/components/SwapCard';
import { swapCard, taskTitle } from '@/components/taskLines';
import { TrackingNotice } from '@/components/tracking';
import { Button, Card, Mono, Notice, Plate, Txt } from '@/components/ui';
import { taskCalls } from '@/lib/contacts';
import { firstName } from '@/lib/format';
import { hasChanges, vehicleLine, vehicleWords } from '@/lib/taskPreview';
import { colomboDate, colomboHour, colomboTime } from '@/lib/time';
import { isSelfTrip } from '@/lib/trips';
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
  const { relative } = useDurations();
  const now = useNow();

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
  const { markSeen, refresh, rememberShown, loadTaskContacts } = app;
  useFocusEffect(
    useCallback(() => {
      if (unseen !== '') markSeen(unseen.split(','));
    }, [unseen, markSeen]),
  );
  // Hotfix 2 (I): the first copy of each task on screen is kept, so a later change by the office shows as "Changed".
  const shownKey = tasks.filter((task) => task.status === 'assigned').map((task) => task.id).join(',');
  useFocusEffect(
    useCallback(() => {
      rememberShown(tasksOnScreen(app.tasks));
      // Only when the list of tasks changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownKey, rememberShown]),
  );
  // Who to call about the next task (kept on the phone: shown offline too).
  const nextId = running?.id ?? assigned[0]?.id;
  useEffect(() => {
    if (nextId) loadTaskContacts(nextId);
  }, [nextId, loadTaskContacts]);

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
  const nextVehicle = next ? app.vehicles.find((v) => v.id === next.vehicle_id) ?? null : null;
  // J: a task made without a vehicle says "Your vehicle on the day" or "Any van" where the plate would be.
  const noVehicleWords = next && !nextVehicle ? vehicleWords(t, vehicleLine(next, app.vehicles)) : null;
  const calls = next ? taskCalls(next, app.taskContacts[next.id] ?? null) : [];
  const nextChanged = next?.status === 'assigned' && hasChanges(app.changesFor(next));
  const openCard = () => next && router.push({ pathname: '/task/[id]', params: { id: next.id } });
  const thumbs = useVehicleThumbs(nextVehicle ? [nextVehicle.id] : []);
  // The office swapped the running task's vehicle: the readings wait on the task screen (Open task).
  const swap = next?.status === 'in_progress' ? swapCard(next) : null;

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
          {/* A trip or stop the phone kept and the server refused (Phase 7 §13): why, until tapped. */}
          {app.tripProblem && (
            <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
              <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
            </Pressable>
          )}
          <TrackingNotice />
          {app.queue.points > 0 && (!app.dataAvailable || app.offline) && (
            <Txt variant="small" color={colors.amberText}>{t('today.offlineWaiting', { n: app.queue.points })}</Txt>
          )}

          {next ? (
            <View style={styles.nextCard}>
              {/* Hotfix 2 (I): the card opens the whole task (the preview before accepting; the task screen once under way). */}
              <Pressable accessibilityRole="button" onPress={openCard}>
                <View style={styles.nextTop}>
                  <Txt variant="label" color={next.status === 'in_progress' ? colors.blue : colors.amberText}>
                    {t(next.status === 'in_progress' ? 'today.inProgress' : 'today.nextTask')}
                  </Txt>
                  <Mono size={24} bold>{colomboTime(leaveTime(next))}</Mono>
                </View>
                <Txt variant="muted">
                  {next.status === 'assigned'
                    ? [t('today.leaveBy', { time: colomboTime(leaveTime(next)) }), relative(leaveTime(next), now)].join(' · ')
                    : colomboDate(next.start_at) !== today ? dateLabel(next.start_at) : ''}
                </Txt>
                {nextChanged && <ChangedTag />}
                <Txt variant="title" size={27} style={{ marginTop: 4, marginBottom: 14 }}>{taskTitle(t, next)}</Txt>
              </Pressable>
              <StopTimeline stops={next.task_stops} compact />
              {people && <Txt variant="muted" style={{ marginTop: 14 }}>{people}</Txt>}
              {/* Phase 7 §6: the task's vehicle, with its photo when it has one. */}
              {nextVehicle && (
                <View style={styles.vehicleLine}>
                  {thumbs[nextVehicle.id] && <Thumb uri={thumbs[nextVehicle.id]} size={52} />}
                  <Plate regNo={nextVehicle.reg_no} />
                  {nextVehicle.make_model && <Txt variant="muted" numberOfLines={1} style={{ flex: 1 }}>{nextVehicle.make_model}</Txt>}
                </View>
              )}
              {noVehicleWords && (
                <View style={styles.vehicleLine}>
                  <Thumb uri={null} size={52} />
                  <Txt variant="strong" style={{ flex: 1 }}>{noVehicleWords}</Txt>
                </View>
              )}
              {/* Hotfix 2 (F): who to call, each with WhatsApp; none without a number. */}
              {calls.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  <CallButtons calls={calls} compact />
                </View>
              )}
              {waitingTasks.has(next.id) && <Txt variant="small" color={colors.amberText} style={{ marginTop: 8 }}>{t('today.notSentYet')}</Txt>}
              {swap && (
                <View style={{ marginTop: 14 }}>
                  <PlateText text={t('swap.title')} plate={plateOf(app.vehicles, swap.newVehicleId)} variant="strong" color={colors.amberText} />
                </View>
              )}
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
              {/* A trip the driver started is not declined (it would land in the office's "needs a driver" list). */}
              {next.status === 'assigned' && !isSelfTrip(next) && <Button kind="danger-text" label={t('task.cantDo')} onPress={() => setDeclining(next)} />}
            </View>
          ) : (
            <Card style={{ alignItems: 'center', paddingVertical: 34, gap: 6 }}>
              <Txt variant="heading">{t('today.noTasks')}</Txt>
              <Txt variant="muted" style={{ textAlign: 'center' }}>{t('today.noTasksHint')}</Txt>
            </Card>
          )}

          {/* Phase 7 §13: on duty with nothing under way, a trip of the driver's own (the main action when there is no task). */}
          {app.sharing && !running && (
            <Button kind={next ? 'dark' : 'primary'} icon={Route} label={t('trip.start')} onPress={() => router.push('/start-trip')} />
          )}

          <TaskList title={t('today.laterToday')} tasks={laterToday} />
          <TaskList title={t('today.upcoming')} tasks={upcoming} showDate />
        </View>
      </ScrollView>
      <DeclineSheet task={declining} onClose={() => setDeclining(null)} />
    </View>
  );
}

/** The tasks Today shows that are still to start (their first copy is kept: lib/taskPreview.ts). */
function tasksOnScreen(tasks: TaskWithStops[]): TaskWithStops[] {
  return tasks.filter((task) => task.status === 'assigned');
}

function TaskList({ title, tasks, showDate = false }: { title: string; tasks: TaskWithStops[]; showDate?: boolean }) {
  const { t, changesFor } = useApp();
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
              <Txt variant="strong" size={18}>{taskTitle(t, task)}</Txt>
              {/* A trip of the driver's own goes to its stop: there is no "from". */}
              {isSelfTrip(task)
                ? task.task_stops.length > 0 && <Txt variant="muted">{task.task_stops[task.task_stops.length - 1].place_name}</Txt>
                : task.task_stops[0] && <Txt variant="muted">{t('today.from', { place: task.task_stops[0].place_name })}</Txt>}
              <GoogleCredit show={task.task_stops.some((s) => !!s.google_place_id)} />
              {task.status === 'assigned' && (
                <Txt variant="small" color={task.accepted_at ? colors.blue : colors.amberText}>{t(task.accepted_at ? 'today.accepted' : 'today.notAccepted')}</Txt>
              )}
              {task.status === 'assigned' && hasChanges(changesFor(task)) && <ChangedTag />}
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
  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 72 },
});
