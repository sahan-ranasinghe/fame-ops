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
// Part B pilot (docs/design-pass.md §5 d): under way the sheet is components/RunningSheet.tsx, as designed: three numbers
// (Distance left, Arrive about, Start odo), Navigate and Call contact right under them, then the stops as the compact
// RouteStepper (the current stop with its slide), the rest, Complete task, Report a problem.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from '@/components/icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrivalButton, useHere, useStopSlides } from '@/components/ArrivalButton';
import { GeofenceCard } from '@/components/GeofenceCard';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { type Step } from '@/components/patterns/RouteStepper';
import { RunningSheet } from '@/components/RunningSheet';
import { StopProgressLine } from '@/components/StopProgressLine';
import { ApprovedLine, CallButtons } from '@/components/CallButtons';
import { GoogleCredit } from '@/components/GoogleCredit';
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
import { arrivalCheck, canMarkDone, lastStopOpen, stopNumber, stretchStartKm } from '@/lib/dayRules';
import { approvedBy, taskCalls } from '@/lib/contacts';
import { allStopsLink, distanceKm, navigateLink, telLink, thousands } from '@/lib/format';
import { canReportLate } from '@/lib/late';
import { isMissed } from '@/lib/lists';
import { colomboDate, colomboTime } from '@/lib/time';
import { stopProgress } from '@/lib/stopProgress';
import { setTaskOnScreen } from '@/lib/arrival';
import { arrivalUndoneStops } from '@/lib/stopCorrections';
import { canAddStop } from '@/lib/trips';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TaskScreen() {
  const app = useApp();
  const { t, tasks, sharing, gpsKm } = app;
  const engine = useMapEngine();
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const here = useHere(running);
  const hereLat = here.fix?.lat;
  const hereLng = here.fix?.lng;
  const me = useMemo((): LatLng | null => (hereLat != null && hereLng != null ? { lat: hereLat, lng: hereLng } : null), [hereLat, hereLng]);
  const [skipping, setSkipping] = useState<TaskStop | null>(null);
  const slides = useStopSlides();
  // Who to call about the task (F, K): read when the screen opens; the copy on the phone shows meanwhile and offline.
  const { loadTaskContacts } = app;
  const found = task !== undefined;
  useEffect(() => {
    if (found && id) loadTaskContacts(id, true);
  }, [found, id, loadTaskContacts]);
  // Round 2b: the card is on screen for this task, so no notification doubles it.
  useEffect(() => {
    if (!running || !id) return;
    setTaskOnScreen(id);
    return () => setTaskOnScreen(null);
  }, [running, id]);

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

  const stop = nextStop(task);
  // Distance left by road (the plan's road km, §20); the straight line to the current stop only when the plan has none.
  const roadKm = running ? roadKmLeft(task, me) : null;
  const km = me && stop?.lat != null && stop.lng != null ? distanceKm(me, { lat: stop.lat, lng: stop.lng }) : null;
  const navigate = stop ? navigateLink({ lat: stop.lat, lng: stop.lng, text: stop.address ?? stop.place_name }) : null;
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
  // "Arrive about" (the review, finding 4): at the stop already, when it was reached; else its new estimate once something
  // was confirmed; else the planned arrival while it is still ahead (marked planned); else a dash (all done, or planned
  // in the past with no estimate).
  const cur = stop ? progress.get(stop.id) : undefined;
  const stopOver = !stop || stop.status === 'done' || stop.status === 'skipped';
  const arrivedAt = !stopOver && stop?.status === 'arrived' ? cur?.arrived ?? null : null;
  const plannedAhead = cur?.planned_arrive && new Date(cur.planned_arrive).getTime() > here.now ? cur.planned_arrive : null;
  const arriveCell = stopOver ? { value: '–' }
    : arrivedAt ? { label: t('task.arrived'), value: colomboTime(arrivedAt) }
    : cur?.estimate ? { value: colomboTime(cur.estimate.arrive) }
    : plannedAhead ? { value: colomboTime(plannedAhead), sub: t('task.plannedSub') }
    : { value: '–' };
  // Part B (§4.5): each stop as a step of the compact RouteStepper; the current one with its slide (the arrive slide by the
  // distance rule, then the leave slide; the last stop's finishes the task), a stop further down with its slides when
  // they apply (visited out of order), Skip beside every stop still open.
  const steps: Step[] = ordered.map((item) => {
    const done = item.status === 'done';
    const skipped = item.status === 'skipped';
    const current = stop?.id === item.id;
    const timeAt = stopTimeAt(t, item);
    const detail = [
      timeAt,
      item.arrive_by ? t('task.arriveBy', { time: colomboTime(item.arrive_by) }) : null,
      timeAt === null && item.dwell_min != null ? t('task.minutesThere', { n: item.dwell_min, duration: duration(item.dwell_min) }) : null,
      item.is_start ? t('stop.start') : null,
    ].filter(Boolean).join(' · ');
    const nearHere = !done && !skipped && !current && !canMarkDone(item) ? arrivalCheck(item, here.fix) : null;
    const outOfOrder = !current && !done && !skipped && (canMarkDone(item) || nearHere?.state === 'ok');
    return {
      key: item.id,
      mark: item.is_start ? 'S' : String(stopNumber(task, item.id)),
      state: done ? 'done' : skipped ? 'skipped' : current ? (item.status === 'arrived' ? 'here' : 'next') : 'todo',
      place: item.place_name,
      type: stopLabel(t, task, item),
      time: item.planned_arrive_at ? colomboTime(item.planned_arrive_at) : undefined,
      times: detail || undefined,
      note: item.note ?? undefined,
      noteTone: 'amber',
      // Done and skipped say so in words too (R3: never the colour alone).
      stateWord: done ? t('task.stopDone') : skipped ? t('task.skipped') : undefined,
      keepOpen: outOfOrder,
      aside: !done && !skipped ? (
        <Pressable accessibilityRole="button" onPress={() => setSkipping(item)} hitSlop={8} style={styles.skip}>
          <Txt variant="small" color={colors.red}>{t('task.skip')}</Txt>
        </Pressable>
      ) : undefined,
      extra: (
        <View style={{ gap: 8, paddingTop: 4 }}>
          <GoogleCredit show={!!item.google_place_id} />
          {!skipped && <StopProgressLine progress={progress.get(item.id)} corrected={undone.includes(item.id)} />}
          {!done && !skipped && current && <ArrivalButton key={item.id} stop={item} here={here} last={item.id === lastId} onFinish={finishTask} />}
          {!current && canMarkDone(item) && (
            <SlideToConfirm tone="dark" label={t('task.slideLeave', { stop: item.place_name })} onConfirm={() => slides.leave(item)} testID={`slide-leave-${item.id}`} />
          )}
          {nearHere?.state === 'ok' && (
            <SlideToConfirm label={t('task.slideArrive', { stop: item.place_name })} onConfirm={() => slides.arrive(item, nearHere)} testID={`slide-arrive-${item.id}`} />
          )}
        </View>
      ),
    };
  });

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

  const overlay = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={goBack} style={[styles.back, { top: insets.top + 12 }]}>
        <ChevronLeft size={26} color={colors.ink} strokeWidth={2.6} />
      </Pressable>
      {running && (
        <Pressable
          accessibilityRole="button"
          onPress={() => { if (!sharing) void app.startWork(task.vehicle_id).then((r) => { if (r === 'no_permission') router.push('/permissions'); }); }}
          style={[styles.sharingPill, { top: insets.top + 16 }]}
        >
          <View style={[styles.pillDot, { backgroundColor: sharing ? colors.blue : colors.red }]} />
          <Txt variant="strong" size={15} color={sharing ? colors.ink : colors.red}>{t(sharing ? 'task.sharingLocation' : 'task.notSharing')}</Txt>
        </Pressable>
      )}
    </>
  );

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={{ height: running ? Math.round(height * 0.4) : insets.top + 76, backgroundColor: colors.mapLand }}>
        {running && (
          <TaskMap task={task} me={me} googleNoteFor="current" />
        )}
        {overlay}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View style={styles.grabber} />
        {running ? (
          // Part B pilot (docs/design-pass.md §5 d): the sheet as designed, the stops as the compact RouteStepper.
          <RunningSheet
            lineNote={lineNote(task, engine === 'google') ? t(lineNote(task, engine === 'google') === 'googleOnly' ? 'task.lineGoogleOnly' : 'task.noRouteLine') : undefined}
            startedLine={task.started_at ? t('task.started', { time: colomboTime(task.started_at) }) : undefined}
            title={stop?.place_name ?? taskTitle(t, task)}
            googleCredit={!!stop?.google_place_id}
            subtitle={[taskTitle(t, task), people].filter(Boolean).join(' · ')}
            notices={(
              <>
                {/* A trip or stop the phone kept and the server refused (Phase 7 §13): why, until tapped. */}
                {app.tripProblem && (
                  <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
                    <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
                  </Pressable>
                )}
                <TrackingNotice />
                <GeofenceCard task={task} here={here} onSkip={setSkipping} />
                <SwapCard task={task} />
              </>
            )}
            stats={[
              roadKm !== null
                ? { key: 'left', label: t('task.distanceLeft'), value: `${kmText(roadKm)} ${t('common.km')}`, sub: t('task.byRoad') }
                : { key: 'left', label: t('task.distanceLeft'), value: km === null ? '–' : `≈ ${kmText(km)} ${t('common.km')}`, sub: km !== null ? t('task.straightLine') : undefined },
              { key: 'arrive', label: t('task.arriveAbout'), ...arriveCell },
              { key: 'odo', label: t('task.startOdo'), value: startOdo === null ? '–' : thousands(startOdo) },
            ]}
            gpsLine={gpsKm.taskId === task.id ? (
              <View style={styles.gpsLine}>
                <Txt variant="muted" size={15}>{t('tracking.gpsKm')}</Txt>
                <Txt variant="strong">{`≈ ${gpsKm.taskKm < 10 ? gpsKm.taskKm.toFixed(1) : Math.round(gpsKm.taskKm)} ${t('common.km')}`}</Txt>
                <Txt variant="small">{t('tracking.approx')}</Txt>
              </View>
            ) : undefined}
            steps={steps}
            focus={stop?.id}
            onNavigate={navigate ? () => void Linking.openURL(navigate) : undefined}
            onCall={call ? () => void Linking.openURL(call) : undefined}
            // Phase 7 §13: a trip of the driver's own takes stops on the way (the new one comes last).
            onAddStop={canAddStop(task) ? () => router.push({ pathname: '/add-stop', params: { taskId: task.id } }) : undefined}
            onAllStops={allStops ? openAllStops : undefined}
            more={(
              <>
                {/* Hotfix 2 (F): the contact's WhatsApp (Call contact is beside Navigate), then the requester, the fleet admin, the office. */}
                <CallButtons calls={calls} callHidden={['contact']} />
                {/* Hotfix 2 (K): who approved the task, with Call (the office when they have no number). */}
                {approvedText && <ApprovedLine text={approvedText} call={approved?.call ?? null} />}
                {/* Part 3b (H4): running late during the task (not on a trip the driver started). */}
                {canReportLate(task) && <RunningLate task={task} />}
              </>
            )}
            lastOpen={lastOpen !== null}
            onComplete={() => finishTask()}
            onReport={() => router.push({ pathname: '/report-problem', params: { taskId: task.id, ...(task.vehicle_id ? { vehicleId: task.vehicle_id } : {}) } })}
          />
        ) : (
          <>
            <View style={styles.topRow}>
              <Txt variant="label" color={colors.amberText}>
                {t(task.status === 'cancelled' ? 'task.cancelled' : task.status === 'declined' ? 'task.declined' : 'task.completed')}
              </Txt>
              <Mono size={18} bold>{`${dateLabel(task.start_at)} ${colomboTime(leaveTime(task))}`}</Mono>
            </View>
            <Txt variant="title" size={28}>{taskTitle(t, task)}</Txt>
            {app.tripProblem && (
              <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
                <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
              </Pressable>
            )}
            <StopTimeline stops={task.task_stops} />
            {people && <Txt variant="muted">{people}</Txt>}
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
          </>
        )}
      </ScrollView>
      <SkipSheet stop={skipping} onClose={() => setSkipping(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  back: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  sharingPill: {
    position: 'absolute',
    right: 16,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 4,
  },
  pillDot: { width: 10, height: 10, borderRadius: 5 },
  sheet: { flex: 1, marginTop: -22, backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#dcd9d0', marginTop: -6 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  gpsLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4, marginTop: -6 },
  skip: { minHeight: 32, justifyContent: 'center' },
});
