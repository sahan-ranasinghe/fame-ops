// The whole task before accepting (Hotfix 2, I): app/task/[id].tsx shows it for a task still to start, opened from the
// Today card, a list row or a new-task / changed-task notification (Today underneath: back goes there).
//   - the map with the route line and the numbered pins (components/TaskMap.tsx; a Google stop never on the
//     OpenFreeMap map, lib/mapRule.ts);
//   - leave-by with "in 45 min" (lib/durations.ts), the total km and drive time (the plan), every stop in order with its
//     planned arrival and leave times and its deadline, passengers, contact, notes;
//   - the vehicle, or "Your vehicle on the day" / "Any van" (J);
//   - who asked (or gave it) and who approved it, "Approved by Palitha · 10:42" with Call (K), and the call buttons
//     with WhatsApp (F);
//   - a changed task: "Task changed", what changed marked in amber (since the copy the driver last saw, plus what the
//     office's push named); the copy is kept when the driver leaves the screen;
//   - Accept / Can't do this task at the bottom; once accepted, Start task.
//   - Part 3b (H4): once accepted, "Running late" (components/LateSheet.tsx) and "Can't make it" (the same reasons sheet:
//     a decline after accepting); never on a trip the driver started.
// It works offline from the copy on the phone (the tasks and the contacts are kept), and says so.

import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApprovedLine, CallButtons } from '@/components/CallButtons';
import { DeclineSheet } from '@/components/DeclineSheet';
import { RunningLate } from '@/components/LateSheet';
import { Check, ChevronLeft, Play } from '@/components/icons';
import { Thumb, useVehicleThumbs } from '@/components/Photos';
import { ChangedTag, leaveTime, StopTimeline, useDateLabel, useDurations, useNow } from '@/components/task';
import { GOOGLE_MAP_BUILD, TaskMap } from '@/components/TaskMap';
import { taskTitle } from '@/components/taskLines';
import { Button, Mono, Notice, Plate, Txt } from '@/components/ui';
import { approvedBy, askedBy, phoneDisplay, taskCalls } from '@/lib/contacts';
import { canReportLate, declineKey } from '@/lib/late';
import { colomboDate, colomboTime } from '@/lib/time';
import { type ChangeField, hasChanges, planTotals, taskChanges, totalKmText, vehicleLine, vehicleWords } from '@/lib/taskPreview';
import { isSelfTrip } from '@/lib/trips';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function TaskPreview({ task }: { task: TaskWithStops }) {
  const app = useApp();
  const { t } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dateLabel = useDateLabel();
  const { relative, duration } = useDurations();
  const now = useNow();
  const [declining, setDeclining] = useState(false);

  // What changed is measured against the copy the driver saw before opening (kept as it was while the screen is open,
  // so the marks stay); leaving the screen keeps the task as seen now.
  const [baseline] = useState(() => ({ before: app.seenCopyOf(task.id), push: app.pushChangesOf(task.id) }));
  const changes = useMemo(() => taskChanges(baseline.before, task, baseline.push), [baseline, task]);
  const changed = hasChanges(changes);
  const latest = useRef(task);
  latest.current = task;
  const { markPreviewed, loadTaskContacts } = app;
  useEffect(() => () => markPreviewed(latest.current), [markPreviewed]);
  // Who to call: read again when the screen opens (the copy on the phone shows meanwhile, and offline).
  useEffect(() => {
    loadTaskContacts(task.id, true);
  }, [task.id, loadTaskContacts]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goHome = () => {
    if (router.canGoBack()) router.dismissAll();
    router.navigate('/');
  };

  const contacts = app.taskContacts[task.id] ?? null;
  const calls = taskCalls(task, contacts);
  const asked = askedBy(contacts);
  const approved = approvedBy(contacts);
  const approvedAt = approved?.at ?? task.approved_at;
  const approvedText = approved
    ? t('preview.approvedBy', {
      name: approved.name,
      time: approvedAt ? (colomboDate(approvedAt) === colomboDate() ? colomboTime(approvedAt) : `${dateLabel(approvedAt)} ${colomboTime(approvedAt)}`) : '',
    }).replace(/\s*·\s*$/, '')
    : null;
  const totals = planTotals(task.plan_json);
  const totalsText = totals.km !== null
    ? totals.driveMin !== null
      ? t('preview.totals', { km: totalKmText(totals.km), drive: duration(totals.driveMin) })
      : `${totalKmText(totals.km)} ${t('common.km')}`
    : null;
  const line = vehicleLine(task, app.vehicles);
  const vehicle = line.kind === 'vehicle' ? line.vehicle : null;
  const thumbs = useVehicleThumbs(vehicle ? [vehicle.id] : []);
  const offline = app.offline || !app.dataAvailable;
  const otherRunning = app.tasks.some((item) => item.status === 'in_progress' && item.id !== task.id);
  const selfTrip = isSelfTrip(task);
  const accepted = task.accepted_at !== null;
  // "Can't make it" once accepted, "Can't do this task" before (H4).
  const decline = declineKey(task);
  const leave = leaveTime(task);
  const mark = (field: ChangeField) => changes.fields.includes(field);
  const googleNote = !GOOGLE_MAP_BUILD && task.task_stops.some((s) => !!s.google_place_id) ? t('task.googleNotOnMap') : null;
  // "Back by 12:00" once the strings have it (preview.backBy); a changed end time is marked with it.
  const backBy = task.end_by && t('preview.backBy') !== 'preview.backBy' ? t('preview.backBy', { time: colomboTime(task.end_by) }) : null;
  const start = () => router.push({ pathname: '/log-mileage', params: { mode: 'start', taskId: task.id, from: 'task' } });

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={{ height: Math.round(height * 0.32), backgroundColor: colors.mapLand }}>
        <TaskMap task={task} me={null} googleMap={GOOGLE_MAP_BUILD} note={googleNote} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={goBack} style={[styles.back, { top: insets.top + 12 }]}>
          <ChevronLeft size={26} color={colors.ink} strokeWidth={2.6} />
        </Pressable>
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: 24, gap: 16 }}>
        <View style={styles.grabber} />
        <View style={styles.topRow}>
          <Txt variant="label" color={changed ? colors.amberText : colors.blue}>
            {t(changed ? 'preview.changedTitle' : accepted ? 'today.nextTask' : 'preview.title')}
          </Txt>
          <Mono size={18} bold>{`${dateLabel(task.start_at)} ${colomboTime(leave)}`}</Mono>
        </View>

        {offline && <Notice tone="warn" text={t('preview.lastCopy')} />}
        {app.tripProblem && (
          <Pressable accessibilityRole="button" onPress={app.clearTripProblem}>
            <Notice tone="danger" text={t(app.tripProblem.key, { reason: app.tripProblem.reason })} />
          </Pressable>
        )}

        <Marked on={mark('title')}>
          <Txt variant="title" size={28}>{taskTitle(t, task)}</Txt>
        </Marked>

        <Marked on={mark('leave')}>
          <Txt variant="big">{t('preview.leaveBy', { time: colomboTime(leave) })}</Txt>
          <Txt variant="muted">{relative(leave, now)}</Txt>
        </Marked>
        {backBy && (
          <Marked on={mark('endBy')}>
            <Txt variant="strong">{backBy}</Txt>
          </Marked>
        )}
        {totalsText && <Txt variant="strong" color={colors.blue}>{totalsText}</Txt>}

        <View style={{ gap: 10 }}>
          <Marked on={mark('stops')}>
            <Txt variant="label" color={colors.muted}>{t('preview.stops')}</Txt>
          </Marked>
          <StopTimeline stops={task.task_stops} detailed changes={changes.stops} removed={changes.removed} />
        </View>

        {task.passengers != null && task.passengers > 0 && (
          <Marked on={mark('passengers')}>
            <Txt variant="strong">{task.passengers === 1 ? t('common.onePassenger') : t('preview.passengers', { n: task.passengers })}</Txt>
          </Marked>
        )}
        {task.contact_name && (
          <Marked on={mark('contact')}>
            <Txt variant="body">{`${t('today.contact', { name: task.contact_name })} ${task.contact_phone ? phoneDisplay(task.contact_phone) : ''}`.trim()}</Txt>
          </Marked>
        )}
        {task.notes && (
          <Marked on={mark('notes')}>
            <Txt variant="body">{task.notes}</Txt>
          </Marked>
        )}

        <Marked on={mark('vehicle')}>
          <Txt variant="label" color={colors.muted}>{t('preview.vehicle')}</Txt>
          {vehicle ? (
            <View style={styles.vehicleLine}>
              <Thumb uri={thumbs[vehicle.id]} size={52} />
              <Plate regNo={vehicle.reg_no} />
              {vehicle.make_model && <Txt variant="muted" numberOfLines={1} style={{ flex: 1 }}>{vehicle.make_model}</Txt>}
            </View>
          ) : (
            vehicleWords(t, line) && <Txt variant="strong">{vehicleWords(t, line)}</Txt>
          )}
        </Marked>

        {(asked || approvedText) && (
          <View style={{ gap: 4 }}>
            {asked && <Txt variant="muted">{t(asked.key, { name: asked.name })}</Txt>}
            {approvedText && <ApprovedLine text={approvedText} call={approved?.call ?? null} />}
          </View>
        )}

        <CallButtons calls={calls} />

        {accepted && !selfTrip && <Txt variant="strong" color={colors.blue}>{t('task.accepted', { time: colomboTime(task.accepted_at ?? '') })}</Txt>}
        {accepted && canReportLate(task) && <RunningLate task={task} />}
        {/* Starting a task accepts it too: Start task stays here before Accept. */}
        {!accepted && <Button kind="outline" icon={Play} label={t('today.startTask')} disabled={otherRunning} onPress={start} />}
        {/* A trip the driver started is not declined (it would land in the office's "needs a driver" list): a trip
            started by mistake is cancelled instead, before it starts. */}
        {!isSelfTrip(task) && decline && <Button kind="danger-text" label={t(decline)} onPress={() => setDeclining(true)} />}
        {selfTrip && (
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
      </ScrollView>

      {/* Accept, or once accepted Start task: always in reach at the bottom. */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {otherRunning && <Notice tone="warn" text={t('today.finishFirst')} />}
        {accepted
          ? <Button icon={Play} label={t('today.startTask')} disabled={otherRunning} onPress={start} />
          : <Button icon={Check} label={t('task.accept')} onPress={() => app.acceptTask(task)} />}
      </View>
      <DeclineSheet task={declining ? task : null} onClose={() => setDeclining(false)} onDeclined={goHome} />
    </View>
  );
}

/** A part of the task the office changed since the driver last saw it: amber behind it and "Changed". */
function Marked({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <View style={{ gap: 4 }}>{children}</View>;
  return (
    <View style={styles.marked}>
      {children}
      <ChangedTag />
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
  sheet: { flex: 1, marginTop: -22, backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#dcd9d0', marginTop: -6 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  marked: { backgroundColor: '#fdf1d6', borderRadius: 12, padding: 10, gap: 4, marginHorizontal: -10 },
  bottom: { paddingHorizontal: 16, paddingTop: 10, gap: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
});
