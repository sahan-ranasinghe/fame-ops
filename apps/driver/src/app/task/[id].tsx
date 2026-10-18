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
// road line on Google's map only, the phone, the compass; "Distance left by road" from the plan's road km
// (components/taskMapLogic.ts), the straight line only when the plan has no km.
// Phase 7 Part 4 (§13): a trip the driver started reads "Your trip · Company work" where the office's title would be,
// has "Add a stop" while under way (app/add-stop.tsx) and no "Can't do this task". Item 18's stop rules are the same;
// with no plan there is no odometer check at Complete (lib/dayRules.ts earlyFinish). A Google stop stays off the
// OpenFreeMap map (lib/mapRule.ts), also on the phone's own copy of a trip (its google_place_id is set from the pick).

import Constants from 'expo-constants';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, MapPin, Navigation, Phone, Play, Plus } from '@/components/icons';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrivalButton, useHere } from '@/components/ArrivalButton';
import { DeclineSheet } from '@/components/DeclineSheet';
import { GoogleCredit } from '@/components/GoogleCredit';
import { SkipSheet } from '@/components/SkipSheet';
import { TaskMap } from '@/components/TaskMap';
import { hasRouteLine, kmText, roadKmLeft, type LatLng } from '@/components/taskMapLogic';
import { Stretches, SwapCard } from '@/components/SwapCard';
import { leaveTime, nextStop, StopTimeline, useDateLabel, usePeopleLine } from '@/components/task';
import { shownTaskKm, stopLabel, stopTimeAt, taskTitle } from '@/components/taskLines';
import { TrackingNotice } from '@/components/tracking';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { arrivalCheck, arrivalRecord, canMarkDone, lastStopOpen, stretchStartKm } from '@/lib/dayRules';
import { allStopsLink, distanceKm, navigateLink, telLink, thousands } from '@/lib/format';
import { colomboTime } from '@/lib/time';
import { canAddStop, isSelfTrip } from '@/lib/trips';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** The build carries the Google key (app.config.ts): the task map is Google's (Part 5). */
const GOOGLE_MAP = (Constants.expoConfig?.extra as { googleMapsAndroid?: boolean } | undefined)?.googleMapsAndroid === true;

export default function TaskScreen() {
  const app = useApp();
  const { t, tasks, sharing, gpsKm } = app;
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dateLabel = useDateLabel();
  const peopleLine = usePeopleLine();

  const task: TaskWithStops | undefined = tasks.find((item) => item.id === id);
  const running = task?.status === 'in_progress';
  // The phone's position while this screen is open: the map and the Arrived rule (nothing is recorded here).
  const here = useHere(running);
  const hereLat = here.fix?.lat;
  const hereLng = here.fix?.lng;
  const me = useMemo((): LatLng | null => (hereLat != null && hereLng != null ? { lat: hereLat, lng: hereLng } : null), [hereLat, hereLng]);
  const [skipping, setSkipping] = useState<TaskStop | null>(null);
  const [declining, setDeclining] = useState(false);

  if (!app.me) return <Redirect href="/login" />;

  // The arrow and the system back return to where the task was opened; "Back to Today" always lands on Today.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goHome = () => {
    if (router.canGoBack()) router.dismissAll();
    router.navigate('/');
  };

  if (!task) {
    return (
      <View style={[styles.page, { padding: 20, paddingTop: insets.top + 40, gap: 16 }]}>
        <StatusBar style="dark" />
        <Notice tone="warn" text={t('task.gone')} />
        <Button kind="outline" label={t('task.backToToday')} onPress={goHome} />
      </View>
    );
  }

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
  const otherRunning = tasks.some((item) => item.status === 'in_progress' && item.id !== task.id);
  // Complete task waits for the last stop (Done or Skipped); open stops before it become "not visited".
  const lastOpen = running ? lastStopOpen(task) : null;
  // After a vehicle swap: the start of the stretch in the vehicle now (null until its start reading is logged).
  const startOdo = stretchStartKm(task);
  const finishedKm = shownTaskKm(task);

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
          <TaskMap
            task={task}
            me={me}
            googleMap={GOOGLE_MAP}
            note={!GOOGLE_MAP && stop?.google_place_id ? t('task.googleNotOnMap') : null}
          />
        )}
        {overlay}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View style={styles.grabber} />
        {running && !hasRouteLine(task) && <Txt variant="small" style={{ marginTop: -6 }}>{t('task.noRouteLine')}</Txt>}

        <View style={styles.topRow}>
          <Txt variant="label" color={running ? colors.blue : colors.amberText}>
            {t(running ? 'today.inProgress' : task.status === 'assigned' ? 'today.nextTask' : task.status === 'cancelled' ? 'task.cancelled' : task.status === 'declined' ? 'task.declined' : 'task.completed')}
          </Txt>
          {running && task.started_at
            ? <Mono size={16} color={colors.muted}>{t('task.started', { time: colomboTime(task.started_at) })}</Mono>
            : <Mono size={18} bold>{`${dateLabel(task.start_at)} ${colomboTime(leaveTime(task))}`}</Mono>}
        </View>

        <View>
          <Txt variant="title" size={28}>{running ? stop?.place_name ?? taskTitle(t, task) : taskTitle(t, task)}</Txt>
          {running && <GoogleCredit show={!!stop?.google_place_id} />}
          {running && <Txt variant="muted" size={18}>{[taskTitle(t, task), people].filter(Boolean).join(' · ')}</Txt>}
        </View>

        {/* A trip or stop the phone kept and the server refused (Phase 7 §13): why, until tapped. */}
        {app.tripProblem && (
          <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
            <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
          </Pressable>
        )}

        {running ? (
          <>
            <TrackingNotice />
            <SwapCard task={task} />
            <View style={styles.stats}>
              <View style={{ flex: 1 }}>
                {roadKm !== null ? (
                  <>
                    <Txt variant="muted" size={15}>{t('task.distanceLeftRoad')}</Txt>
                    <Txt variant="heading" size={24}>{`${kmText(roadKm)} ${t('common.km')}`}</Txt>
                  </>
                ) : (
                  <>
                    <Txt variant="muted" size={15}>{t('task.distanceLeft')}</Txt>
                    <Txt variant="heading" size={24}>{km === null ? '–' : `≈ ${kmText(km)} ${t('common.km')}`}</Txt>
                    {km !== null && <Txt variant="small">{t('task.straightLine')}</Txt>}
                  </>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="muted" size={15}>{t('task.startOdo')}</Txt>
                <Mono size={23} bold>{startOdo === null ? '–' : thousands(startOdo)}</Mono>
              </View>
            </View>
            {gpsKm.taskId === task.id && (
              <View style={styles.gpsLine}>
                <Txt variant="muted" size={15}>{t('tracking.gpsKm')}</Txt>
                <Txt variant="strong">{`≈ ${gpsKm.taskKm < 10 ? gpsKm.taskKm.toFixed(1) : Math.round(gpsKm.taskKm)} ${t('common.km')}`}</Txt>
                <Txt variant="small">{t('tracking.approx')}</Txt>
              </View>
            )}

            <View style={{ gap: 8 }}>
              {task.task_stops.map((item) => {
                const done = item.status === 'done' || item.status === 'skipped';
                const current = stop?.id === item.id;
                // "09:00–10:30 at Kurunegala site" when the plan has the times; else the place and "15 min there".
                const timeAt = stopTimeAt(t, item);
                const detail = [
                  item.arrive_by ? t('task.arriveBy', { time: colomboTime(item.arrive_by) }) : null,
                  timeAt === null && item.dwell_min != null ? t('task.minutesThere', { n: item.dwell_min }) : null,
                  item.status === 'skipped' ? t('task.skipped') : item.status === 'arrived' && item.arrived_at ? `${t('task.arrived')} ${colomboTime(item.arrived_at)}` : null,
                ].filter(Boolean).join(' · ');
                // A stop further down (visited out of order): Done once arrived, Arrived only when the phone is there.
                const nearHere = !done && !current && !canMarkDone(item) ? arrivalCheck(item, here.fix) : null;
                return (
                  <View key={item.id} style={[styles.stopCard, current && styles.stopRowCurrent, done && { opacity: 0.6 }]}>
                    <View style={styles.stopRow}>
                      <View style={{ flex: 1 }}>
                        <Txt variant="muted" size={14}>
                          {current ? `${t('task.currentStop')} · ` : ''}{stopLabel(t, task, item)}
                        </Txt>
                        <Txt variant="strong">{timeAt ?? item.place_name}</Txt>
                        <GoogleCredit show={!!item.google_place_id} />
                        {item.is_start && <Txt variant="small">{t('stop.start')}</Txt>}
                        {detail !== '' && <Txt variant="small">{detail}</Txt>}
                        {item.note && <Txt variant="small" color={colors.amberText}>{item.note}</Txt>}
                      </View>
                      {done ? (
                        <View style={styles.doneBadge}><Check size={18} color={colors.blue} strokeWidth={3} /></View>
                      ) : (
                        <View style={{ gap: 6, alignItems: 'flex-end' }}>
                          {!current && canMarkDone(item) && (
                            <Pressable accessibilityRole="button" onPress={() => app.markStopDone(item)} style={[styles.doneButton, { backgroundColor: colors.ink }]}>
                              <Txt variant="strong" size={15} color="#ffffff">{t('task.done')}</Txt>
                            </Pressable>
                          )}
                          {nearHere?.state === 'ok' && (
                            <Pressable accessibilityRole="button" onPress={() => app.markStopArrived(item, arrivalRecord(nearHere))} style={styles.doneButton}>
                              <Txt variant="strong" size={15}>{t('task.arrived')}</Txt>
                            </Pressable>
                          )}
                          <Pressable accessibilityRole="button" onPress={() => setSkipping(item)} hitSlop={8} style={styles.skip}>
                            <Txt variant="small" color={colors.red}>{t('task.skip')}</Txt>
                          </Pressable>
                        </View>
                      )}
                    </View>
                    {/* The current stop: Arrived by the distance rule, then Done (keyed by stop: the GPS wait starts again per stop). */}
                    {!done && current && <ArrivalButton key={item.id} stop={item} here={here} />}
                  </View>
                );
              })}
            </View>

            {/* Phase 7 §13: a trip of the driver's own takes stops on the way (the new one comes last). */}
            {canAddStop(task) && (
              <Button kind="outline" icon={Plus} label={t('trip.addStop')} onPress={() => router.push({ pathname: '/add-stop', params: { taskId: task.id } })} />
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button kind="outline" icon={Navigation} label={t('task.navigate')} disabled={!navigate} onPress={() => navigate && Linking.openURL(navigate)} style={{ flex: 1 }} />
              <Button kind="outline" icon={Phone} label={t('task.callContact')} disabled={!call} onPress={() => call && Linking.openURL(call)} style={{ flex: 1 }} />
            </View>
            {allStops && <Button kind="outline" icon={MapPin} label={t('task.allStops')} onPress={openAllStops} />}
            {lastOpen && <Notice tone="warn" text={t('complete.needsLastStop')} />}
            <Button
              kind="dark"
              icon={Check}
              label={t('task.complete')}
              disabled={lastOpen !== null}
              onPress={() => {
                const open = task.task_stops.filter((item) => item.status === 'pending' || item.status === 'arrived').length;
                const finish = () => router.push({ pathname: '/log-mileage', params: { mode: 'finish', taskId: task.id } });
                if (open === 0) finish();
                else {
                  Alert.alert(t('task.stopsLeftTitle', { n: open }), t('task.stopsLeftBody'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('task.finishAnyway'), style: 'destructive', onPress: finish },
                  ]);
                }
              }}
            />
            <Button
              kind="danger-text"
              label={t('task.reportProblem')}
              onPress={() => router.push({ pathname: '/report-problem', params: { taskId: task.id, vehicleId: task.vehicle_id } })}
            />
          </>
        ) : (
          <>
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
            {task.status === 'assigned' && task.accepted_at && (
              <Txt variant="strong" color={colors.blue}>{t('task.accepted', { time: colomboTime(task.accepted_at) })}</Txt>
            )}
            {task.status === 'assigned' && !task.accepted_at && (
              <Button label={t('task.accept')} icon={Check} onPress={() => app.acceptTask(task)} />
            )}
            {(task.status === 'completed' || task.status === 'cancelled' || task.status === 'declined') && (
              <Button label={t('task.backToToday')} onPress={goHome} style={{ marginTop: 8 }} />
            )}
            {task.status === 'assigned' && (
              <>
                {otherRunning && <Notice tone="warn" text={t('today.finishFirst')} />}
                <Button
                  icon={Play}
                  label={t('today.startTask')}
                  disabled={otherRunning}
                  onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'start', taskId: task.id, from: 'task' } })}
                />
                {call && <Button kind="outline" icon={Phone} label={t('task.callContact')} onPress={() => Linking.openURL(call)} />}
                {/* A trip the driver started is not declined (it would land in the office's "needs a driver" list): a trip
                    started by mistake is cancelled instead, before it starts. */}
                {!isSelfTrip(task) && <Button kind="danger-text" label={t('task.cantDo')} onPress={() => setDeclining(true)} />}
                {isSelfTrip(task) && (
                  <Button
                    kind="danger-text"
                    label={t('trip.cancel')}
                    onPress={() => Alert.alert(t('trip.cancelConfirm'), '', [
                      { text: t('common.no'), style: 'cancel' },
                      {
                        text: t('common.yes'),
                        style: 'destructive',
                        onPress: () => void app.cancelTrip(task).then((out) => {
                          if (out.kind === 'cancelled') {
                            Alert.alert(t('trip.cancelled'));
                            goHome();
                          } else if (out.kind === 'offline') {
                            Alert.alert(t('trip.cancelOffline'));
                          } else if (out.message) {
                            Alert.alert(t('trip.cancelFailed', { reason: out.message }));
                          }
                        }),
                      },
                    ])}
                  />
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      <SkipSheet stop={skipping} onClose={() => setSkipping(null)} />
      <DeclineSheet task={declining ? task : null} onClose={() => setDeclining(false)} onDeclined={goHome} />
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
  stats: { backgroundColor: colors.page, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 12 },
  gpsLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4, marginTop: -6 },
  stopCard: { gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skip: { minHeight: 32, justifyContent: 'center' },
  stopRowCurrent: { borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.blueChip },
  doneButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
});
