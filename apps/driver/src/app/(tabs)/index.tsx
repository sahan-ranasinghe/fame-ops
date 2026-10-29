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
// Round 4–7 (§33.1): on duty with a vehicle that has no check by this driver today, the "Vehicle check · WP CAB-4521" card
// with Check now (components/VehicleCheckCard.tsx) under the duty notices, until it is answered (lib/vehicleCheck.ts).
// Round 4–7 (§33.3): under the card's "5 passengers · Contact: …" the riders' names ("Nimal Perera, Kamal Silva +3 more").
// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 5; the same features restyled, docs in the round's report):
//   - the thin top bar in place of the dark header: the date, "Good morning, Kanishka", the language pill (the mockup's
//     round control at the top right: the driver app has no notification centre for a bell to open);
//   - two tiles in place of the duty card (components/DutyCard.tsx DutyTiles): On duty with its switch (Finish work) or
//     Off duty with Start work; the vehicle with its check ("✓ Checked" / "Check needed", which opens the check, as the
//     check card did), the plate and "model · Change";
//   - the notices under the tiles, as before (offline, the vehicle taken, the duty ended, the tracking notice, the
//     office's question, the points waiting);
//   - "Next task" with its chip (lib/todayCard.ts leaveChip: Leave in 25 min, Leave now, 12 min late, Tomorrow), the card:
//     the big leave time "leave from <start>", the title, the stops on the one route stepper (NextStops below:
//     components/patterns/RouteStepper.tsx, compact, the time on the right, fed by lib/todayCard.ts todaySteps), "3
//     people · 197 km" with the call link (and ⋯: every call and WhatsApp in a sheet), the riders, the task's vehicle when
//     it is not the one held, Accept / Start task / Running late / Can't do this task as before;
//   - "Later today · N" and "Coming up" as list rows (components/TaskRows.tsx), "All today's tasks".
// Round 50 (§37.4): an office person in Driving mode (their own trips only, lib/drivingMode.ts) has the Driving mode card
// (components/DrivingCard.tsx: what it records, Back to office) where the duty tiles are, no duty notices, no Start a trip,
// no Can't do this task / Running late / Can't make it (they booked the trip), and "No trips to drive" when there is none.

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronDown, ChevronRight, Ellipsis, IdCard, MessageCircle, Phone, Play, Road, Route, User } from '@/components/icons';
import { type ReactNode, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguagePill } from '@/components/LanguageSwitch';
import { DeclineSheet } from '@/components/DeclineSheet';
import { DutyNotices, DutyTiles } from '@/components/DutyCard';
import { RunningLate } from '@/components/LateSheet';
import { CallButtons } from '@/components/CallButtons';
import { GoogleCredit } from '@/components/GoogleCredit';
import { RowChip } from '@/components/patterns/ListRow';
import { RouteStepper, type StepperRow } from '@/components/patterns/RouteStepper';
import { Sheet } from '@/components/patterns/Sheet';
import { ChangedTag, leaveTime, useDateLabel, useNow, usePeopleLine } from '@/components/task';
import { Thumb, useVehicleThumbs } from '@/components/Photos';
import { PlateText } from '@/components/PlateText';
import { plateOf } from '@/components/SwapCard';
import { swapCard, taskTitle } from '@/components/taskLines';
import { TaskList, useMarkShown } from '@/components/TaskRows';
import { TrackingNotice } from '@/components/tracking';
import { Button, Mono, Notice, Plate, Txt } from '@/components/ui';
import { bannerAsk } from '@/lib/asks';
import { taskCalls } from '@/lib/contacts';
import { firstName } from '@/lib/format';
import { canReportLate, declineKey } from '@/lib/late';
import { todayLists } from '@/lib/lists';
import { namesLine } from '@/lib/passengers';
import { stopProgress } from '@/lib/stopProgress';
import { nextAbout } from '@/lib/stopProgressWords';
import { hasChanges, vehicleLine, vehicleWords } from '@/lib/taskPreview';
import { colomboHour, colomboTime } from '@/lib/time';
import { type Chip, contactWithoutCall, greetingKey, leaveChip, leaveFromWords, peopleWords, rowChipTone, todaySteps, tripKmText } from '@/lib/todayCard';
import { isSelfTrip } from '@/lib/trips';
import { driverParts } from '@/lib/drivingMode';
import { DrivingCard } from '@/components/DrivingCard';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, hoverStyle, setWebThemeColor } from '@/theme';

export default function TodayScreen() {
  const app = useApp();
  const { t, me, tasks, waitingTasks } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();
  // The count line of the task (usePeopleLine: "5 passengers · Contact: Ashan W. 077 123 4567") is read aloud with the card.
  const peopleLine = usePeopleLine();
  const now = useNow();

  const [declining, setDeclining] = useState<TaskWithStops | null>(null);
  const [callsOpen, setCallsOpen] = useState(false);
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
  // The browser's bar the colour of the page's top (the light top bar; /m/ has no driver side, the design page does).
  useEffect(() => setWebThemeColor(colors.page), []);

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

  const people = next ? peopleWords(t, next.passengers) : null;
  const km = next ? tripKmText(next.plan_json) : null;
  // Round 4–7 (§33.3): who rides, under the count ("Nimal Perera, Kamal Silva +3 more").
  const riders = next ? namesLine(t, next.task_passengers, app.settings.passengers) : null;
  const nextVehicle = next ? app.vehicles.find((v) => v.id === next.vehicle_id) ?? null : null;
  // The task's vehicle, when it is not the one in the vehicle tile (on duty with it): the plate and its photo.
  const heldId = app.sharing ? app.vehicle?.id ?? null : null;
  const showVehicle = nextVehicle !== null && nextVehicle.id !== heldId;
  // J: a task made without a vehicle says "Your vehicle on the day" or "Any van" where the plate would be.
  const noVehicleWords = next && !nextVehicle ? vehicleWords(t, vehicleLine(next, app.vehicles)) : null;
  const calls = next ? taskCalls(next, app.taskContacts[next.id] ?? null) : [];
  const firstCall = calls[0] ?? null;
  // A contact with a name and no number to call: their name on the card, no call link.
  const contactName = next ? contactWithoutCall(next, calls) : null;
  const nextChanged = next?.status === 'assigned' && hasChanges(app.changesFor(next));
  // Round 2: under way, the next stop's "about HH:MM" once the trip has been re-estimated (lib/stopProgress.ts).
  const nextEta = (() => {
    if (next?.status !== 'in_progress') return null;
    const about = nextAbout(stopProgress(next.task_stops, new Date(now)));
    const stop = about ? next.task_stops.find((s) => s.id === about.id) : undefined;
    return about && stop ? { place: stop.place_name, time: about.time } : null;
  })();
  const openCard = () => next && router.push({ pathname: '/task/[id]', params: { id: next.id } });
  const thumbs = useVehicleThumbs(showVehicle && nextVehicle ? [nextVehicle.id] : []);
  // The office swapped the running task's vehicle: the readings wait on the task screen (Open task).
  const swap = next?.status === 'in_progress' ? swapCard(next) : null;
  // Part 3b (H3): the open question not answered yet that closes soonest.
  const ask = bannerAsk(app.asks, now);
  const decline = next ? declineKey(next) : null;
  const chip = next ? leaveChip(t, next, now, (at) => dateLabel(at)) : null;
  const underWay = next?.status === 'in_progress';
  // Round 50 (§37.4): what an office person's Driving mode leaves out (duty, Start a trip, Can't do this task, Running late).
  const parts = driverParts(app.officeDriver);

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={refresh} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        {/* The thin top bar (no big dark header): the date, the greeting, the language. */}
        <View style={[styles.top, { paddingTop: insets.top + 20 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="small" size={13}>{dateLabel(new Date())}</Txt>
            <Txt variant="heading" size={24} numberOfLines={2}>{t(greetingKey(colomboHour()), { name: firstName(me?.name ?? '') })}</Txt>
          </View>
          <LanguagePill light />
        </View>

        <View style={styles.body}>
          {/* Phase 7: the duty state and the vehicle (Start work / Finish work, Change vehicle, the vehicle check). Round 50
              (§37.4): an office person in Driving mode has no duty: the Driving mode card with Back to office instead. */}
          {parts.duty ? <DutyTiles /> : <DrivingCard />}

          {app.offline && <Notice tone="warn" text={t('common.savedOffline')} />}
          {parts.duty && <DutyNotices />}
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
              <MessageCircle size={24} color="#ffffff" />
              <Txt variant="strong" size={16} color="#ffffff" style={{ flex: 1 }}>{t('ask.banner')}</Txt>
              <View style={styles.askButton}>
                <Txt variant="button" size={16}>{t('ask.answer')}</Txt>
              </View>
            </Pressable>
          )}
          {app.queue.points > 0 && (!app.dataAvailable || app.offline) && (
            <Txt variant="small" color={colors.amberText}>{t('today.offlineWaiting', { n: app.queue.points })}</Txt>
          )}

          {next ? (
            <>
              <SectionHead title={t(underWay ? 'todayCard.inProgress' : 'todayCard.nextTask')} chip={chip} />
              <View style={styles.nextCard} testID="next-task-card">
                {/* Hotfix 2 (I): the card opens the whole task (the preview before accepting; the task screen once under way). */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={[taskTitle(t, next), peopleLine(next)].filter(Boolean).join(' · ')}
                  onPress={openCard}
                  style={{ gap: 14 }}
                  testID="next-task-open"
                >
                  <View style={styles.timeLine}>
                    <Mono size={34} bold>{colomboTime(underWay && next.started_at ? next.started_at : leaveTime(next))}</Mono>
                    <Txt variant="muted" size={14} numberOfLines={1} style={{ flex: 1 }}>{underWay ? t('todayCard.started') : leaveFromWords(t, next)}</Txt>
                  </View>
                  <View style={{ gap: 4 }}>
                    <Txt variant="strong" size={18}>{taskTitle(t, next)}</Txt>
                    {nextChanged && <ChangedTag />}
                  </View>
                </Pressable>
                <NextStops task={next} />
                {nextEta && (
                  <Txt variant="strong" size={15} color={colors.blue} testID="today-next-about">{t('today.nextStopAbout', { stop: nextEta.place, time: nextEta.time })}</Txt>
                )}
                {(people || km || firstCall || contactName) && (
                  <View style={styles.facts}>
                    {people && <Fact icon={<User size={16} color={colors.iconInk} strokeWidth={2} />} text={people} />}
                    {km && <Fact icon={<Road size={16} color={colors.iconInk} strokeWidth={2} />} text={`${km} ${t('common.km')}`} mono />}
                    {contactName && <Fact icon={<IdCard size={16} color={colors.iconInk} strokeWidth={2} />} text={t('today.contact', { name: contactName })} testID="today-contact" />}
                    {/* Hotfix 2 (F): who to call; the first one here, every one (with WhatsApp) behind ⋯. */}
                    {firstCall && (
                      <View style={styles.callWrap}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t(firstCall.label)} ${[firstCall.name, firstCall.display].filter(Boolean).join(' · ')}`}
                          onPress={() => void Linking.openURL(firstCall.tel).catch(() => undefined)}
                          hitSlop={8}
                          style={(state) => [styles.callLink, hoverStyle(state), state.pressed && { opacity: 0.7 }]}
                          testID="today-call"
                        >
                          <Phone size={16} color={colors.blue} strokeWidth={2} />
                          <Txt variant="strong" size={14} color={colors.blue} numberOfLines={1} style={{ flexShrink: 1 }}>{firstCall.name ?? t(firstCall.label)}</Txt>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('todayCard.moreCalls')}
                          onPress={() => setCallsOpen(true)}
                          hitSlop={8}
                          style={(state) => [styles.more, hoverStyle(state), state.pressed && { opacity: 0.7 }]}
                          testID="today-calls-more"
                        >
                          <Ellipsis size={18} color={colors.muted} strokeWidth={2} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
                {riders && <Txt variant="small" numberOfLines={2} testID="today-riders">{riders}</Txt>}
                {/* Phase 7 §6: the task's vehicle, with its photo when it has one (when it is not the one held). */}
                {showVehicle && nextVehicle && (
                  <View style={styles.vehicleLine}>
                    {thumbs[nextVehicle.id] && <Thumb uri={thumbs[nextVehicle.id]} size={44} />}
                    <Plate regNo={nextVehicle.reg_no} />
                    {nextVehicle.make_model && <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{nextVehicle.make_model}</Txt>}
                  </View>
                )}
                {noVehicleWords && (
                  <View style={styles.vehicleLine}>
                    <Thumb uri={null} size={44} />
                    <Txt variant="strong" size={15} style={{ flex: 1 }}>{noVehicleWords}</Txt>
                  </View>
                )}
                {waitingTasks.has(next.id) && <Txt variant="small" color={colors.amberText}>{t('today.notSentYet')}</Txt>}
                {swap && (
                  <PlateText text={t('swap.title')} plate={plateOf(app.vehicles, swap.newVehicleId)} variant="strong" color={colors.amberText} />
                )}
                {next.status === 'assigned' && next.accepted_at && (
                  <Txt variant="strong" size={15} color={colors.blue}>{t('task.accepted', { time: colomboTime(next.accepted_at) })}</Txt>
                )}
                {next.status === 'assigned' && !next.accepted_at ? (
                  <View style={{ gap: 10 }}>
                    <Button compact label={t('task.accept')} icon={Check} onPress={() => app.acceptTask(next)} testID="today-accept" />
                    <Button compact label={t('today.startTask')} kind="outline" icon={Play} onPress={openNext} testID="today-start" />
                  </View>
                ) : (
                  <Button
                    compact
                    label={t(next.status === 'in_progress' ? 'today.openTask' : 'today.startTask')}
                    icon={next.status === 'in_progress' ? undefined : Play}
                    onPress={openNext}
                    testID="today-start"
                  />
                )}
                {/* Part 3b (H4): running late once accepted, before the start (under way it is on the task screen). */}
                {parts.declineAndLate && next.status === 'assigned' && next.accepted_at && canReportLate(next) && <RunningLate task={next} />}
                {/* A trip the driver started is not declined (it would land in the office's "needs a driver" list). Once
                    accepted it reads "Can't make it" (H4). */}
                {parts.declineAndLate && next.status === 'assigned' && !isSelfTrip(next) && decline && <Button kind="danger-text" label={t(decline)} onPress={() => setDeclining(next)} style={styles.decline} testID="today-decline" />}
              </View>
            </>
          ) : (
            <View style={[styles.nextCard, { alignItems: 'center', paddingVertical: 30, gap: 6 }]} testID="today-empty">
              <Txt variant="heading" size={20}>{t(parts.duty ? 'today.noTasks' : 'driving.noTrips')}</Txt>
              <Txt variant="muted" size={15} style={{ textAlign: 'center' }}>{t(parts.duty ? 'today.noTasksHint' : 'driving.noTripsHint')}</Txt>
            </View>
          )}

          {/* Phase 7 §13: on duty with nothing under way, a trip of the driver's own (the main action when there is no task). */}
          {parts.startTrip && app.sharing && !running && (
            <Button compact kind={next ? 'outline' : 'primary'} icon={Route} label={t('trip.start')} onPress={() => router.push('/start-trip')} testID="today-start-trip" />
          )}

          <View style={{ marginTop: 10, gap: 12 }}>
            <TaskList title={t('todayCard.laterToday', { n: lists.laterToday.length })} tasks={shownToday} />
            <TaskList title={t('today.upcoming')} tasks={shownUpcoming} showDate />
            {/* Hotfix 3 (L6): the whole list on its own screen, pushed over Today (back returns here as it was). */}
            {lists.allRow && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/today-tasks')}
                style={(state) => [styles.allRow, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
                testID="today-all-tasks"
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="strong" size={15}>{t('today.allTasks')}</Txt>
                  {moreToday > 0 && <Txt variant="small" size={13}>{t('today.moreLater', { n: moreToday })}</Txt>}
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>
      <DeclineSheet task={declining} onClose={() => setDeclining(null)} />
      {/* Hotfix 2 (F): every person to call about the next task, each with WhatsApp. */}
      <Sheet visible={callsOpen && calls.length > 0} title={t('todayCard.callsTitle')} onClose={() => setCallsOpen(false)} testID="today-calls-sheet">
        <CallButtons calls={calls} />
      </Sheet>
    </View>
  );
}

/** "Next task" with its chip ("Leave in 25 min"). */
function SectionHead({ title, chip }: { title: string; chip: Chip | null }) {
  return (
    <View style={styles.sectionHead}>
      <Txt variant="strong" size={16} style={{ flexShrink: 1 }}>{title}</Txt>
      {chip && <RowChip text={chip.text} tone={rowChipTone(chip.tone)} wide testID="next-task-chip" />}
    </View>
  );
}

/**
 * Round 4–7, item 12 (mockup 5): the Next task card's stops on the one route stepper, compact with the time on the right: S
 * where the trip starts, each stop by its number, B "Back at base"; one line each ("Fame Global Solutions · pickup"), a
 * stop's deadline ("by 11:00", amber) and the plan's time on the right. Under way, the stops behind the driver are ticked
 * and the one being driven to is marked. Up to four stops, then "Show all N stops" opens the rest in place (Hotfix 2). The
 * Google credit under the list when a stop is a Google place.
 */
function NextStops({ task }: { task: TaskWithStops }) {
  const { t } = useApp();
  const [expanded, setExpanded] = useState(false);
  const { steps, showAllAfter, total, google } = todaySteps(t, task, expanded);
  const rows: StepperRow[] = steps.map((step, i) => ({
    ...step,
    after: i === showAllAfter ? (
      <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.showAll} testID="stepper-show-all">
        <Txt variant="strong" size={14} color={colors.blue} style={{ flexShrink: 1 }}>{t('preview.showAll', { n: total })}</Txt>
        <ChevronDown size={16} color={colors.blue} strokeWidth={2.6} />
      </Pressable>
    ) : undefined,
  }));
  return (
    <View>
      <RouteStepper rows={rows} timeSide="right" compact framed={false} testID="stop-stepper" />
      <GoogleCredit show={google} />
    </View>
  );
}

/** One fact of the card's line: an icon and its words ("3 people", "197 km"). */
function Fact({ icon, text, mono = false, testID }: { icon: ReactNode; text: string; mono?: boolean; testID?: string }) {
  return (
    <View style={styles.fact} testID={testID}>
      {icon}
      {mono ? <Mono size={14} color={colors.iconInk}>{text}</Mono> : <Txt size={14} color={colors.iconInk}>{text}</Txt>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  body: { paddingHorizontal: 16, gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
  nextCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardLine, borderRadius: 20, padding: 16, gap: 14 },
  timeLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  facts: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 16, rowGap: 6, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  callWrap: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  callLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, flexShrink: 1 },
  more: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  decline: { minHeight: 44, marginTop: -6 },
  showAll: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  askBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.blue, borderRadius: 16, paddingHorizontal: 14,
    paddingVertical: 12, minHeight: 64,
  },
  askButton: { backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  allRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
    borderColor: colors.cardLine, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60,
  },
});
