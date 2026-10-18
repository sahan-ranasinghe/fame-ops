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
// Hotfix 3 (L6): after the card at most 3 later tasks (later today first, then coming up) and the row "All today's tasks"
// ("2 more later today" when Today leaves some out), which pushes app/today-tasks.tsx; a missed task is shown nowhere
// (lib/lists.ts). Only the rows on screen count as seen (components/TaskRows.tsx).
// Part 3b: a banner while a question from the office is open and not answered (H3: "The office asked you a question ·
// Answer", pushed app/ask/[id].tsx; refreshed with Today, by the question's push and by Realtime); on an accepted task
// "Running late" and "Can't make it" (H4; never on a trip the driver started).

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronRight, MessageCircle, Play, Route } from '@/components/icons';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguagePill } from '@/components/LanguageSwitch';
import { DeclineSheet } from '@/components/DeclineSheet';
import { DutyHeader, DutyNotices } from '@/components/DutyCard';
import { RunningLate } from '@/components/LateSheet';
import { CallButtons } from '@/components/CallButtons';
import { ChangedTag, leaveTime, StopTimeline, useDateLabel, useDurations, useNow, usePeopleLine } from '@/components/task';
import { Thumb, useVehicleThumbs } from '@/components/Photos';
import { PlateText } from '@/components/PlateText';
import { plateOf } from '@/components/SwapCard';
import { swapCard, taskTitle } from '@/components/taskLines';
import { TaskList, useMarkShown } from '@/components/TaskRows';
import { TrackingNotice } from '@/components/tracking';
import { Button, Card, Mono, Notice, Plate, Txt } from '@/components/ui';
import { bannerAsk } from '@/lib/asks';
import { taskCalls } from '@/lib/contacts';
import { firstName } from '@/lib/format';
import { canReportLate, declineKey } from '@/lib/late';
import { todayLists } from '@/lib/lists';
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
  // Hotfix 3 (L6): the card, at most 3 later tasks, then "All today's tasks"; never a missed task.
  const lists = todayLists(tasks, now);
  const { running, next, shownToday, shownUpcoming, moreToday } = lists;

  // "Seen by driver" (recorded the first time a task is on screen) and the first copy of each, so a later change by the
  // office shows as "Changed" (Hotfix 2, I): the card and the rows shown.
  const { refresh, loadTaskContacts } = app;
  useMarkShown([...(next ? [next] : []), ...shownToday, ...shownUpcoming]);
  // Who to call about the next task (kept on the phone: shown offline too).
  const nextId = next?.id;
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
  // Part 3b (H3): the open question not answered yet that closes soonest.
  const ask = bannerAsk(app.asks, now);
  const decline = next ? declineKey(next) : null;

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
          {ask && (
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ask/[id]', params: { id: ask.ask_id } })} style={styles.askBanner}>
              <MessageCircle size={26} color="#ffffff" />
              <Txt variant="strong" size={18} color="#ffffff" style={{ flex: 1 }}>{t('ask.banner')}</Txt>
              <View style={styles.askButton}>
                <Txt variant="button" size={17}>{t('ask.answer')}</Txt>
              </View>
            </Pressable>
          )}
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
              {/* Part 3b (H4): running late once accepted, before the start (under way it is on the task screen). */}
              {next.status === 'assigned' && next.accepted_at && canReportLate(next) && (
                <View style={{ marginTop: 10 }}>
                  <RunningLate task={next} />
                </View>
              )}
              {/* A trip the driver started is not declined (it would land in the office's "needs a driver" list). Once
                  accepted it reads "Can't make it" (H4). */}
              {next.status === 'assigned' && !isSelfTrip(next) && decline && <Button kind="danger-text" label={t(decline)} onPress={() => setDeclining(next)} />}
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

          <TaskList title={t('today.laterToday')} tasks={shownToday} />
          <TaskList title={t('today.upcoming')} tasks={shownUpcoming} showDate />
          {/* Hotfix 3 (L6): the whole list on its own screen, pushed over Today (back returns here as it was). */}
          {lists.allRow && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/today-tasks')} style={styles.allRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="strong" size={18}>{t('today.allTasks')}</Txt>
                {moreToday > 0 && <Txt variant="muted">{t('today.moreLater', { n: moreToday })}</Txt>}
              </View>
              <ChevronRight size={22} color={colors.ink} />
            </Pressable>
          )}
        </View>
      </ScrollView>
      <DeclineSheet task={declining} onClose={() => setDeclining(null)} />
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
  askBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.blue, borderRadius: 18, paddingHorizontal: 16,
    paddingVertical: 14, minHeight: 72,
  },
  askButton: { backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 16, minHeight: 48, justifyContent: 'center' },
  allRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1,
    borderColor: colors.line, paddingHorizontal: 16, paddingVertical: 16, minHeight: 72,
  },
});
