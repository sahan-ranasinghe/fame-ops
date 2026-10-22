// One task. In progress it is the designed screen (design/png/Driver · Task in
// progress.png): map, destination, distance left, Navigate, Call contact,
// Complete task. Before it starts it shows the details and "Start task".
// Phase 7 (item 18): Arrived needs the phone near the stop (components/ArrivalButton.tsx),
// Done only after Arrived, Complete task only once the last stop is Done or Skipped.
// Phase 7 Part 2: stops named by their place in the order ("Stop 2 · Drop") with the time there
// ("09:00–10:30 at Kurunegala site"); after the office's vehicle swap the card asking for both
// odometers (components/SwapCard.tsx), the start odo of the stretch in the vehicle now, and on the
// finished task each vehicle's km.
// Phase 7 Part 2b (§20, §24): the task map (components/TaskMap.tsx): every stop numbered with its time, Google's planned
// road line on Google's map only, the phone, the compass (Part 6: Google's map or the free map, components/TaskMap.tsx); "Distance left by road" from the plan's road km
// (components/taskMapLogic.ts), the straight line only when the plan has no km.
// Phase 7 Part 4 (§13): a trip the driver started reads "Your trip · Company work" where the office's title would be,
// has "Add a stop" while under way (app/add-stop.tsx) and no "Can't do this task". Item 18's stop rules are the same;
// with no plan there is no odometer check at Complete (lib/dayRules.ts earlyFinish). A Google stop stays off the
// OpenFreeMap map (lib/mapRule.ts), also on the phone's own copy of a trip (its google_place_id is set from the pick).
// Hotfix 2: a task still to start is the whole-task preview (components/TaskPreview.tsx: every stop, the map, the
// totals, the vehicle or "Your vehicle on the day", who asked and who approved, Accept / Can't do). Under way: Call
// contact beside Navigate as designed, then Call requester / fleet admin / office with WhatsApp (F), "Approved by
// Palitha · 10:42" with Call (K), and the time at a stop as a duration ("1 h 30 min there", lib/durations.ts).
// Hotfix 3: a missed task (lib/lists.ts isMissed) is not shown: "This task is no longer assigned to you."
// Part 3b (H4): "Running late" under way (components/LateSheet.tsx: 10 · 15 · 30 · Other, queued), with "You said 15 min
// late at 08:52"; before the start it is on the preview, with "Can't make it" once accepted. Never on a self trip.
// Round 2 (21 October 2026): the current stop is slides, never taps (components/patterns/SlideToConfirm.tsx): "Slide when
// you arrive at …" (the 300 m rule and its override as before), then "Slide when you leave …"; the last stop's is "Slide
// to finish", which opens Log mileage as Complete task does. Each slide has Undo for 6 s. A stop further down (visited out
// of order) gets the same slides under its row, only when the phone is there or once it is Arrived. Each row shows its
// progress ("Planned 10:30 · Arrived 10:52 · Left 11:40 · 22 min late", "about 12:10": lib/stopProgress.ts), and the
// arrival card (components/GeofenceCard.tsx) asks after 60 s within 150 m.
// Round 2b: the card also asks about a stop driven past ("Did you stop at …?": Yes, I was there / Skip it, the skip sheet);
// a stop whose Arrived was undone and marked again reads "Arrived 10:52 · corrected"; while this screen is in front the
// background arrival notification stays quiet for this task (lib/arrival.ts setTaskOnScreen).
// Round 4–7: "Fill up on the way · Log fuel" while the driver said so at the start and no fill is logged on the task
// (§33.2, lib/fuelCard.ts); the passengers' names with Call for those with a phone (§33.3, components/Passengers.tsx).
// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 6; the same functions, placed in the mockup's layout): under way,
// the map takes the top half with "● In progress since 08:21" (red "Off duty" when not sharing: a tap starts work, as the
// old pill did) beside the back button; the sheet below says "Next stop · 2 of 3", the stop's name (the task's title and
// people under it), the grey stats box (km left by road, approx., or in a straight line; arrive about: the re-estimate,
// else the plan; be there by), Navigate (blue), Call contact and the stops button, the current stop's slide (the short
// words "Slide when you arrive"; the 300 m rule, the override, leave, finish and Undo unchanged), Complete task once the
// last stop is done, "Fill up on the way · Log fuel", "Problem with the vehicle?". The arrival card, the swap card, the
// tracking notice and a refused trip stay at the top of the sheet. The stops button opens the full list in a sheet: every
// stop with its progress line, Skip and the out-of-order slides, Add a stop, All stops in Google Maps, the start odometer
// and the GPS km, the passengers, every call with WhatsApp, Approved by, Running late, Complete task.
// The design page (src/design/DriverTask.tsx) draws it with a still map and a fixed position (TaskView's `design`).

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Fuel, ListChecks, MapPin, Navigation, Phone, Plus, TriangleAlert } from '@/components/icons';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrivalButton, type Here, useHere, useStopSlides } from '@/components/ArrivalButton';
import { GeofenceCard } from '@/components/GeofenceCard';
import { Sheet } from '@/components/patterns/Sheet';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { StopProgressLine } from '@/components/StopProgressLine';
import { ApprovedLine, CallButtons } from '@/components/CallButtons';
import { GoogleCredit } from '@/components/GoogleCredit';
import { PassengerList } from '@/components/Passengers';
import { RunningLate } from '@/components/LateSheet';
import { SkipSheet } from '@/components/SkipSheet';
import { TaskMap, useMapEngine } from '@/components/TaskMap';
import { TaskPreview } from '@/components/TaskPreview';
import { kmText, lineNote, roadKmLeft, type LatLng } from '@/components/taskMapLogic';
import { Stretches, SwapCard } from '@/components/SwapCard';
import { leaveTime, nextStop, StopTimeline, useDateLabel, useDurations, usePeopleLine } from '@/components/task';
import { shownTaskKm, stopLabel, stopTimeAt, taskTitle } from '@/components/taskLines';
import { TrackingNotice } from '@/components/tracking';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { arrivalCheck, canMarkDone, lastStopOpen, stretchStartKm } from '@/lib/dayRules';
import { approvedBy, taskCalls } from '@/lib/contacts';
import { allStopsLink, distanceKm, navigateLink, telLink, thousands } from '@/lib/format';
import { canReportLate } from '@/lib/late';
import { namesLine } from '@/lib/passengers';
import { isMissed } from '@/lib/lists';
import { colomboDate, colomboTime } from '@/lib/time';
import { stopProgress } from '@/lib/stopProgress';
import { openStop, sheetStats, stopPosition } from '@/lib/todayCard';
import { setTaskOnScreen } from '@/lib/arrival';
import { arrivalUndoneStops } from '@/lib/stopCorrections';
import { canAddStop } from '@/lib/trips';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, hoverStyle, shadow } from '@/theme';

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskView id={id} />;
}

/**
 * One task. `design` (the design page only, src/design/DriverTask.tsx): a still picture in place of the map and a fixed
 * position in place of the phone's GPS; nothing else differs.
 */
export function TaskView({ id, design }: { id: string | undefined; design?: { here: Here; map: ReactNode } }) {
  const app = useApp();
  const { t, tasks, sharing, gpsKm } = app;
  const engine = useMapEngine();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dateLabel = useDateLabel();
  const peopleLine = usePeopleLine();
  const { duration } = useDurations();

  // Hotfix 3: a missed task (never started, its leave-by over a day ago) has left the driver's list: "no longer yours".
  const task: TaskWithStops | undefined = tasks.find((item) => item.id === id && !isMissed(item, Date.now()));
  const running = task?.status === 'in_progress';
  // The phone's position while this screen is open: the map and the Arrived rule (nothing is recorded here).
  const phoneHere = useHere(running && !design);
  const here = design?.here ?? phoneHere;
  const hereLat = here.fix?.lat;
  const hereLng = here.fix?.lng;
  const me = useMemo((): LatLng | null => (hereLat != null && hereLng != null ? { lat: hereLat, lng: hereLng } : null), [hereLat, hereLng]);
  const [skipping, setSkipping] = useState<TaskStop | null>(null);
  // The full stop list and everything else of the running task (the stops button).
  const [stopsOpen, setStopsOpen] = useState(false);
  const slides = useStopSlides();
  // Who to call about the task (F, K): read when the screen opens; the copy on the phone shows meanwhile and offline.
  const { loadTaskContacts } = app;
  const found = task !== undefined;
  useEffect(() => {
    if (found && id) loadTaskContacts(id, true);
  }, [found, id, loadTaskContacts]);
  // Round 2b: the card is on screen for this task, so no notification doubles it.
  useEffect(() => {
    if (!running || !id || design) return;
    setTaskOnScreen(id);
    return () => setTaskOnScreen(null);
  }, [running, id, design]);

  if (!app.me) return <Redirect href="/login" />;

  // The arrow and the system back return to where the task was opened; "Back to Today" always lands on Today.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goHome = () => {
    if (router.canGoBack()) router.dismissAll();
    router.navigate('/');
  };

  // Opened from a notification before the list has the task: it is being read.
  if (!task && app.refreshing) {
    return (
      <View style={[styles.page, { padding: 20, paddingTop: insets.top + 80, alignItems: 'center' }]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={[styles.page, { padding: 20, paddingTop: insets.top + 40, gap: 16 }]}>
        <StatusBar style="dark" />
        <Notice tone="warn" text={t('task.gone')} />
        <Button kind="outline" label={t('task.backToToday')} onPress={goHome} />
      </View>
    );
  }

  // Hotfix 2 (I): a task still to start is shown whole before it is accepted.
  if (task.status === 'assigned') return <TaskPreview task={task} />;

  // The stop being driven to (or stood at); null once every stop is done or skipped (its slide and its stats).
  const stop = openStop(task.task_stops);
  // Navigate, the straight line and the list's "Now" go to that stop, else (all done) the last one, as before.
  const target = nextStop(task);
  // Distance left by road (the plan's road km, §20); the straight line to the current stop only when the plan has none.
  const roadKm = running ? roadKmLeft(task, me) : null;
  const km = me && target?.lat != null && target.lng != null ? distanceKm(me, { lat: target.lat, lng: target.lng }) : null;
  const navigate = target ? navigateLink({ lat: target.lat, lng: target.lng, text: target.address ?? target.place_name }) : null;
  // Every stop still to do, in order, for Google Maps (the first ten; the screen says when some are left out).
  const remaining = [...task.task_stops].sort((a, b) => a.seq - b.seq).filter((s) => s.status === 'pending' || s.status === 'arrived');
  const allStops = remaining.length > 1 ? allStopsLink(remaining) : null;
  const openAllStops = () => {
    if (!allStops) return;
    if (allStops.left > 0) {
      Alert.alert(t('task.allStopsLeftTitle'), t('task.allStopsLeftBody', { n: allStops.left }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('task.allStops'), onPress: () => void Linking.openURL(allStops.url) },
      ]);
    } else void Linking.openURL(allStops.url);
  };
  const call = telLink(task.contact_phone);
  const people = peopleLine(task);
  // Round 4–7 (§33.3): a finished task names who rode (no Call: the trip is over).
  const names = namesLine(t, task.task_passengers, app.settings.passengers);
  const contacts = app.taskContacts[task.id] ?? null;
  const calls = taskCalls(task, contacts);
  const approved = approvedBy(contacts);
  const approvedAt = approved?.at ?? task.approved_at;
  const approvedText = approved
    ? t('preview.approvedBy', {
      name: approved.name,
      time: approvedAt ? (colomboDate(approvedAt) === colomboDate() ? colomboTime(approvedAt) : `${dateLabel(approvedAt)} ${colomboTime(approvedAt)}`) : '',
    }).replace(/\s*·\s*$/, '')
    : null;
  // Complete task waits for the last stop (Done or Skipped); open stops before it become "not visited".
  const lastOpen = running ? lastStopOpen(task) : null;
  // After a vehicle swap: the start of the stretch in the vehicle now (null until its start reading is logged).
  const startOdo = stretchStartKm(task);
  const finishedKm = shownTaskKm(task);
  // Round 2: each stop planned against what happened, the stops to come estimated again (the shared rule).
  const progress = new Map(stopProgress(task.task_stops, new Date(here.now)).map((p) => [p.id, p]));
  const ordered = task.task_stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
  const lastId = ordered[ordered.length - 1]?.id;
  const undone = arrivalUndoneStops();
  // The sheet's head and stats (mockup 6): "Next stop · 2 of 3", km left, arrive about (the re-estimate, else the plan), be there by.
  const position = stopPosition(task, stop?.id);
  const estimate = stop ? progress.get(stop.id)?.estimate?.arrive ?? null : null;
  const stats = sheetStats(stop, roadKm, km, estimate ? colomboTime(estimate) : null, kmText);
  const note = running ? lineNote(task, engine === 'google') : null;

  // Complete task (and the last stop's "Slide to finish", which closes that stop on the way): open stops left = the
  // question first; then Log mileage.
  const finishTask = (closing?: TaskStop) => {
    const open = task.task_stops.filter((item) => (item.status === 'pending' || item.status === 'arrived') && item.id !== closing?.id).length;
    const finish = () => {
      if (closing) app.markStopDone(closing);
      router.push({ pathname: '/log-mileage', params: { mode: 'finish', taskId: task.id } });
    };
    if (open === 0) finish();
    else {
      Alert.alert(t('task.stopsLeftTitle', { n: open }), t('task.stopsLeftBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('task.finishAnyway'), style: 'destructive', onPress: finish },
      ]);
    }
  };
  // From the stops sheet: the sheet closes first (a screen pushed or another sheet opened goes on top of the task, not under the sheet).
  const fromSheet = (action: () => void) => () => {
    setStopsOpen(false);
    action();
  };
  const reportProblem = () => router.push({ pathname: '/report-problem', params: { taskId: task.id, ...(task.vehicle_id ? { vehicleId: task.vehicle_id } : {}) } });

  const overlay = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={goBack} style={[styles.back, { top: insets.top + 12 }, shadow(4)]} testID="task-back">
        <ChevronLeft size={24} color={colors.ink} strokeWidth={2.6} />
      </Pressable>
      {running && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sharing ? `${t('task.sharingLocation')}, ${t('todayCard.inProgress')}` : t('task.notSharing')}
          onPress={() => { if (!sharing) void app.startWork(task.vehicle_id).then((r) => { if (r === 'no_permission') router.push('/permissions'); }); }}
          style={[styles.statusPill, { top: insets.top + 14 }, shadow(3)]}
          testID="task-status-pill"
        >
          <View style={[styles.pillDot, { backgroundColor: sharing ? colors.blue : colors.red }]} />
          {sharing ? (
            <>
              <Txt variant="strong" size={13}>{t('todayCard.inProgress')}</Txt>
              {task.started_at && <SinceTime text={t('todayCard.since', { time: '\u0001' })} time={colomboTime(task.started_at)} />}
            </>
          ) : (
            <Txt variant="strong" size={13} color={colors.red}>{t('task.notSharing')}</Txt>
          )}
        </Pressable>
      )}
    </>
  );

  // The stops sheet's list: every stop, as the task screen listed them (the current one's slide is on the sheet below the map).
  const stopList = (
    <View style={{ gap: 8 }}>
      {task.task_stops.map((item) => {
        const done = item.status === 'done' || item.status === 'skipped';
        const current = target?.id === item.id;
        // "09:00–10:30 at Kurunegala site" when the plan has the times; else the place and "15 min there".
        const timeAt = stopTimeAt(t, item);
        const detail = [
          item.arrive_by ? t('task.arriveBy', { time: colomboTime(item.arrive_by) }) : null,
          timeAt === null && item.dwell_min != null ? t('task.minutesThere', { n: item.dwell_min, duration: duration(item.dwell_min) }) : null,
          item.status === 'skipped' ? t('task.skipped') : null,
        ].filter(Boolean).join(' · ');
        // A stop further down (visited out of order): the leave slide once arrived, the arrive slide only when the phone is there.
        const nearHere = !done && !current && !canMarkDone(item) ? arrivalCheck(item, here.fix) : null;
        return (
          <View key={item.id} style={[styles.stopCard, current && styles.stopRowCurrent, done && { opacity: 0.6 }]} testID={`stop-row-${item.id}`}>
            <View style={styles.stopRow}>
              <View style={{ flex: 1 }}>
                <Txt variant="muted" size={14}>
                  {current ? `${t('task.currentStop')} · ` : ''}{stopLabel(t, task, item)}
                </Txt>
                <Txt variant="strong">{timeAt ?? item.place_name}</Txt>
                <GoogleCredit show={!!item.google_place_id} />
                {item.is_start && <Txt variant="small">{t('stop.start')}</Txt>}
                {detail !== '' && <Txt variant="small">{detail}</Txt>}
                {item.status !== 'skipped' && <StopProgressLine progress={progress.get(item.id)} corrected={undone.includes(item.id)} />}
                {item.note && <Txt variant="small" color={colors.amberText}>{item.note}</Txt>}
              </View>
              {done ? (
                <View style={styles.doneBadge}><Check size={18} color={colors.blue} strokeWidth={3} /></View>
              ) : (
                <View style={{ gap: 6, alignItems: 'flex-end' }}>
                  <Pressable accessibilityRole="button" onPress={fromSheet(() => setSkipping(item))} hitSlop={8} style={styles.skip} testID={`stop-skip-${item.id}`}>
                    <Txt variant="small" color={colors.red}>{t('task.skip')}</Txt>
                  </Pressable>
                </View>
              )}
            </View>
            {/* A stop further down, visited out of order: the same slides, only when they apply. */}
            {!current && canMarkDone(item) && (
              <SlideToConfirm tone="dark" label={t('task.slideLeave', { stop: item.place_name })} onConfirm={() => slides.leave(item)} testID={`slide-leave-${item.id}`} />
            )}
            {nearHere?.state === 'ok' && (
              <SlideToConfirm label={t('task.slideArrive', { stop: item.place_name })} onConfirm={() => slides.arrive(item, nearHere)} testID={`slide-arrive-${item.id}`} />
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={{ height: running ? Math.round(height * 0.5) : insets.top + 76, backgroundColor: colors.mapLand }}>
        {running && (design?.map ?? <TaskMap task={task} me={me} googleNoteFor="current" />)}
        {overlay}
      </View>

      {running ? (
        <ScrollView style={[styles.sheet, shadow(8, true)]} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 20, gap: 14 }} testID="task-sheet">
          <View style={styles.grabber} />
          {/* A trip or stop the phone kept and the server refused (Phase 7 §13): why, until tapped. */}
          {app.tripProblem && (
            <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
              <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
            </Pressable>
          )}
          <TrackingNotice />
          <GeofenceCard task={task} here={here} onSkip={setSkipping} />
          <SwapCard task={task} />

          <View style={{ gap: 4 }}>
            <Txt variant="small" size={13} testID="task-next-stop-label">
              {position ? t('taskSheet.nextStop', { n: position.n, total: position.total }) : t('taskSheet.allDone')}
            </Txt>
            <Txt variant="heading" size={22}>{stop?.place_name ?? taskTitle(t, task)}</Txt>
            <GoogleCredit show={!!stop?.google_place_id} />
            <Txt variant="small" size={13} numberOfLines={2}>{[taskTitle(t, task), people].filter(Boolean).join(' · ')}</Txt>
          </View>

          {stop && (
            <View style={styles.stats} testID="task-stats">
              <Stat value={stats.km ? `${stats.km.text} ${t('common.km')}` : '–'} label={t(stats.km?.kind === 'straight' ? 'taskSheet.leftStraight' : 'taskSheet.leftApprox')} />
              {stats.about && <Stat value={stats.about} label={t('taskSheet.arriveAbout')} />}
              {stats.by && <Stat value={stats.by} label={t('taskSheet.beThereBy')} />}
            </View>
          )}
          {note && <Txt variant="small" size={13} style={{ marginTop: -6 }}>{t(note === 'googleOnly' ? 'task.lineGoogleOnly' : 'task.noRouteLine')}</Txt>}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !navigate }}
              disabled={!navigate}
              onPress={() => navigate && Linking.openURL(navigate)}
              style={(state) => [styles.navigate, !navigate && { opacity: 0.45 }, hoverStyle(state), state.pressed && { opacity: 0.85 }]}
              testID="task-navigate"
            >
              <Navigation size={18} color="#ffffff" strokeWidth={2} />
              <Txt variant="strong" size={16} color="#ffffff" numberOfLines={1} style={{ flexShrink: 1 }}>{t('task.navigate')}</Txt>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('task.callContact')}
              accessibilityState={{ disabled: !call }}
              disabled={!call}
              onPress={() => call && Linking.openURL(call)}
              style={(state) => [styles.square, !call && { opacity: 0.45 }, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
              testID="task-call"
            >
              <Phone size={20} color={colors.blue} strokeWidth={2} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('taskSheet.stopsMore')}
              onPress={() => setStopsOpen(true)}
              style={(state) => [styles.square, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
              testID="task-stops"
            >
              <ListChecks size={20} color={colors.ink} strokeWidth={2} />
            </Pressable>
          </View>

          {/* The current stop: the arrive slide by the distance rule, then the leave slide (keyed by stop: the GPS wait
              starts again per stop); the last stop's leave slide finishes the task. */}
          {stop && <ArrivalButton key={stop.id} stop={stop} here={here} last={stop.id === lastId} onFinish={finishTask} short />}
          {/* Once the last stop is done (or skipped): Complete task, the same finish. */}
          {lastOpen === null && (
            <Button icon={Check} label={t('task.complete')} onPress={() => finishTask()} testID="task-complete" />
          )}
          {/* Round 4–7 (§33.2): "I'll fill up on the way" at the start, and no fill logged on the task yet. */}
          {app.fillOnWay(task) && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'fuel', taskId: task.id } })}
              style={({ pressed }) => [styles.fillLine, pressed && { opacity: 0.85 }]}
              testID="fill-on-way"
            >
              <Fuel size={22} color={colors.amberText} strokeWidth={2.4} />
              <Txt variant="strong" color={colors.amberText} style={{ flex: 1 }}>{t('fuelCard.fillLine')}</Txt>
              <Txt variant="strong" color={colors.blue}>{t('log.titleFuel')}</Txt>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('task.reportProblem')}
            onPress={reportProblem}
            style={(state) => [styles.problem, hoverStyle(state), state.pressed && { opacity: 0.7 }]}
            testID="task-problem"
          >
            <TriangleAlert size={16} color={colors.muted} strokeWidth={2} />
            <Txt variant="strong" size={14} color={colors.muted}>{t('taskSheet.problem')}</Txt>
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}>
          <View style={styles.grabber} />
          <View style={styles.topRow}>
            <Txt variant="label" color={colors.amberText}>
              {t(task.status === 'cancelled' ? 'task.cancelled' : task.status === 'declined' ? 'task.declined' : 'task.completed')}
            </Txt>
            <Mono size={18} bold>{`${dateLabel(task.start_at)} ${colomboTime(leaveTime(task))}`}</Mono>
          </View>
          <Txt variant="title" size={28}>{taskTitle(t, task)}</Txt>
          {/* A trip or stop the phone kept and the server refused (Phase 7 §13): why, until tapped. */}
          {app.tripProblem && (
            <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
              <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
            </Pressable>
          )}
          <StopTimeline stops={task.task_stops} />
          {people && <Txt variant="muted">{people}</Txt>}
          {names && <Txt variant="muted">{names}</Txt>}
          {task.notes && <Txt variant="body">{task.notes}</Txt>}
          {task.status === 'completed' && finishedKm !== null && (
            <View style={{ gap: 6 }}>
              <Mono size={20} bold>{`${thousands(finishedKm)} ${t('common.km')}`}</Mono>
              <Stretches task={task} />
            </View>
          )}
          {task.status === 'cancelled' && task.cancelled_reason && <Notice tone="warn" text={task.cancelled_reason} />}
          {task.status === 'declined' && <Notice tone="warn" text={t('task.declinedBody')} />}
          {(task.status === 'completed' || task.status === 'cancelled' || task.status === 'declined') && (
            <Button label={t('task.backToToday')} onPress={goHome} style={{ marginTop: 8 }} />
          )}
        </ScrollView>
      )}

      {running && (
        <Sheet visible={stopsOpen} title={t('task.stops')} onClose={() => setStopsOpen(false)} testID="task-stops-sheet">
          {stopList}
          {/* Phase 7 §13: a trip of the driver's own takes stops on the way (the new one comes last). */}
          {canAddStop(task) && (
            <Button kind="outline" icon={Plus} label={t('trip.addStop')} onPress={fromSheet(() => router.push({ pathname: '/add-stop', params: { taskId: task.id } }))} />
          )}
          {allStops && <Button kind="outline" icon={MapPin} label={t('task.allStops')} onPress={openAllStops} />}
          <View style={styles.stats}>
            <Stat value={startOdo === null ? '–' : thousands(startOdo)} label={t('task.startOdo')} />
            {gpsKm.taskId === task.id && (
              <Stat value={`≈ ${gpsKm.taskKm < 10 ? gpsKm.taskKm.toFixed(1) : Math.round(gpsKm.taskKm)} ${t('common.km')}`} label={`${t('tracking.gpsKm')} · ${t('tracking.approx')}`} />
            )}
          </View>
          {/* Round 4–7 (§33.3): who rides, each with Call when they have a phone. */}
          <PassengerList task={task} />
          {/* Hotfix 2 (F): the contact's WhatsApp (Call contact is beside Navigate), then the requester, the fleet admin, the office. */}
          <CallButtons calls={calls} callHidden={['contact']} />
          {/* Hotfix 2 (K): who approved the task, with Call (the office when they have no number). */}
          {approvedText && <ApprovedLine text={approvedText} call={approved?.call ?? null} />}
          {/* Part 3b (H4): running late during the task (not on a trip the driver started). */}
          {canReportLate(task) && <RunningLate task={task} />}
          {lastOpen && <Notice tone="warn" text={t('complete.needsLastStop')} />}
          <Button
            kind="dark"
            icon={Check}
            label={t('task.complete')}
            disabled={lastOpen !== null}
            onPress={fromSheet(() => finishTask())}
            testID="stops-complete"
          />
        </Sheet>
      )}
      <SkipSheet stop={skipping} onClose={() => setSkipping(null)} />
    </View>
  );
}

/** One fact of the grey stats box: the number in mono, its words under it. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Mono size={18} bold numberOfLines={1}>{value}</Mono>
      <Txt variant="small" size={12} numberOfLines={2}>{label}</Txt>
    </View>
  );
}

/** "since 08:21" with the time in mono, in the order of the language ("08:21 සිට"): `text` has \u0001 where the time goes. */
function SinceTime({ text, time }: { text: string; time: string }) {
  const [before, after = ''] = text.split('\u0001');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      {before !== '' && <Txt variant="small" size={13}>{before}</Txt>}
      <Mono size={13} color={colors.muted}>{time}</Mono>
      {after !== '' && <Txt variant="small" size={13}>{after}</Txt>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  back: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The mockup's pill over the map: "● In progress since 08:21".
  statusPill: {
    position: 'absolute',
    left: 68,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  sheet: { flex: 1, marginTop: -24, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.rail },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stats: { backgroundColor: colors.page, borderRadius: 14, padding: 12, flexDirection: 'row', gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  navigate: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: colors.blue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  square: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.rail, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  problem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  stopCard: { gap: 12, borderWidth: 1, borderColor: colors.cardLine, borderRadius: 12, padding: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skip: { minHeight: 32, justifyContent: 'center' },
  stopRowCurrent: { borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.blueChip },
  doneBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  fillLine: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.amberChip },
});
