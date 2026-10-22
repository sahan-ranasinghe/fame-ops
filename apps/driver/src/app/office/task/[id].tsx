// Office mode (Phase 8, O1): Task detail (design 14), from task_detail: the status pills, the five steps with their
// times, the driver and the vehicle with Call and WhatsApp, where the driver is now (the ETA) with Live map, the stops
// planned against what happened, Reassign driver (Needs a driver, design 11, through reassign_task), Cancel task… with
// a reason (cancel_task), the requester's line with Call. O2 (item 5): Change time (task/[id]/time, update_task), Change
// stops (the editor's Where and When in mode stops, update_task_stops), Swap vehicle while it runs (task/[id]/swap,
// move_driver_vehicle) and Reopen with a reason (reopen_task, a task completed today); each only with its tool.
// Stage 1 (O3 item 3c–f; components/office/TaskDetailParts.tsx): the warnings (the km nobody logged, the warnings saved
// past) on the screen; a driver-started trip's purpose (Change: task/[id]/purpose, set_trip_purpose); the vehicle swap's
// stretches with "Type the reading" for one still owed (swap_reading); each reached stop's arrival point with "Save as our
// place" for a Google stop (save_arrival_place); and under "More details": charged to, the odometer and fuel with their
// photos, receipts and video pieces (the 1-hour links: an answer read over 50 minutes ago is read again first), the
// problems reported, the history, and "Show the plan on the map" (task/[id]/plan).
// Round 3: the driver card (components/office/DriverRows.tsx TaskDriverCard) shows the driver, the person who drives it
// themselves ("Drives themselves") or someone not in Fame Fleet ("Someone else": their initials, name, Call / WhatsApp);
// the server's sentences (Running late, the status line, the warnings saved past) in the person's language.
// Part B pilot (docs/design-pass.md §5 b): the state chips in the header; needs a driver and missed as StatusBanners;
// Leave by · back · km as the StatsRow; the stops as the RouteStepper (S and B included); one action bar at the bottom
// (the thing to do now, More for the rest: reassign, swap, the driven route, reopen, cancel; each with its tool as before).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { MapPin } from '@/components/icons';
import { TaskDriverCard } from '@/components/office/DriverRows';
import { StopArrival, SwapSegments, TaskMoreDetails, TaskWarnings, TripPurposeCard } from '@/components/office/TaskDetailParts';
import { RouteStepper } from '@/components/patterns/RouteStepper';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { StatsRow } from '@/components/patterns/StatsRow';
import { StatusBanner } from '@/components/patterns/StatusBanner';
import { ReasonSheet } from '@/components/ReasonSheet';
import { SavedNotice } from '@/components/office/SavedNotice';
import { Button, Mono, Txt } from '@/components/ui';
import { useLiveTask } from '@/office/liveTask';
import { useOffice, useTool } from '@/office/state';
import { DETAIL_LINKS_FRESH_MS, type LinkKey, linkOf } from '@/office/taskDetailLogic';
import { extrasFor, REOPEN_TEXT, type ReopenReasonKey, reopenInput } from '@/office/taskExtrasLogic';
import { allowedActions, CANCEL_TEXT, cancelInput, plateOf, steps, type TaskAction, taskActionPlan, taskStateChip } from '@/office/taskLogic';
import type { FleetError, TaskDetail } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { taskSteps } from '@/office/stepsLogic';
import { BackHeader, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { sentenceText } from '@/office/statusWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords, shortWhen, whenWords } from '@/lib/dateWords';

type CancelReasonKey = 'not_needed' | 'plans_changed' | 'no_vehicle' | 'other';
const CANCEL_REASONS: { value: CancelReasonKey; label: string }[] = [
  { value: 'not_needed', label: 'office.task.cancelNotNeeded' },
  { value: 'plans_changed', label: 'office.task.cancelPlansChanged' },
  { value: 'no_vehicle', label: 'office.task.cancelNoVehicle' },
  { value: 'other', label: 'office.task.cancelOther' },
];

const REOPEN_REASONS: { value: ReopenReasonKey; label: string }[] = [
  { value: 'finished_early', label: 'office.task.reopenFinishedEarly' },
  { value: 'wrong_reading', label: 'office.task.reopenWrongReading' },
  { value: 'other', label: 'office.task.cancelOther' },
];

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id }, { every: 30_000 });
  // Round 2: live (the driver's Arrived / Left, any change to the task) without a reload.
  useLiveTask(id, () => void q.refetch());
  const p = q.data;
  const task = p?.task;
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  // Part B: Change time or stops asks which; More holds the rest of the task's actions.
  const [changing, setChanging] = useState(false);
  const [acting, setActing] = useState(false);
  // The action under way (its button shows the spinner; the others wait).
  const [busy, setBusy] = useState<'cancel' | 'reopen' | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);

  // The photo, receipt and video links last an hour: an answer read over 50 minutes ago is read again before one opens,
  // and the link is then taken from the fresh answer.
  const loadedAt = useRef(0);
  useEffect(() => {
    if (q.data) loadedAt.current = Date.now();
  }, [q.data]);
  const [pendingLink, setPendingLink] = useState<LinkKey | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const openUrl = (url: string) => void Linking.openURL(url).catch(() => setLinkNote(t('office.task.linkOpenFailed')));
  useEffect(() => {
    if (!pendingLink || !q.data || Date.now() - loadedAt.current > DETAIL_LINKS_FRESH_MS) return;
    const url = linkOf(q.data, pendingLink);
    setPendingLink(null);
    if (url) {
      setLinkNote(null);
      openUrl(url);
    } else setLinkNote(t('office.task.linkGone'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, pendingLink]);
  // The reading again failed: no link waits for ever (Stage 1 review); the reason in words, Try again by tapping again.
  useEffect(() => {
    if (pendingLink && q.error) {
      setPendingLink(null);
      setLinkNote(q.error.message);
    }
  }, [q.error, pendingLink]);
  function openLink(key: LinkKey) {
    if (!q.data) return;
    if (Date.now() - loadedAt.current > DETAIL_LINKS_FRESH_MS) {
      setLinkNote(t('office.task.linkRenewing'));
      setPendingLink(key);
      void q.reload();
      return;
    }
    const url = linkOf(q.data, key);
    if (url) {
      setLinkNote(null);
      openUrl(url);
    }
  }

  async function cancel(label: string, note: string) {
    if (!task || busy) return;
    setBusy('cancel');
    setProblem(null);
    try {
      await api.call('cancel_task', cancelInput(task.id, label, note));
      // Hotfix O2-H2, Part 1b (Google Calendar's "Event deleted"): back to where the person came from, a snackbar says so.
      if (router.canGoBack()) router.back();
      else router.replace('/office');
      showSnackbar({ text: t('office.saved.cancelled') });
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(null);
    }
  }

  async function reopen(label: string, note: string) {
    if (!task || busy) return;
    setBusy('reopen');
    setProblem(null);
    try {
      await api.call('reopen_task', reopenInput(task.id, label, note));
      showSnackbar({ text: t('office.saved.reopened') });
      await q.reload();
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(null);
    }
  }

  const stops = (p?.stops ?? []).filter((s) => s.status !== 'removed');
  const may = allowedActions(task ?? { status: 'cancelled' });
  const actions = { reassign: may.reassign && me.tools.includes('reassign_task'), cancel: may.cancel && me.tools.includes('cancel_task') };
  const extras = task ? extrasFor(task, me.tools) : { time: false, stops: false, swap: false, reopen: false };

  const started = !!task && (task.status === 'in_progress' || task.status === 'completed');
  // Part B pilot (docs/design-pass.md §5 b): the stops as the RouteStepper, the start (S) and the way back (B) included,
  // each reached stop with its arrival point.
  const routeSteps = task ? taskSteps(t, stops, {
    started,
    start: task.start_place && !stops.some((s) => s.is_start) ? { place: task.start_place, planned: task.leave_by, left: task.started ? shortWhen(t, task.started) : undefined } : undefined,
    back: task.return_to_base && task.start_place ? { place: task.start_place, time: p?.timeline?.totals.ends, line: [p?.timeline?.totals.ends ? t('office.request.about', { time: p.timeline.totals.ends }) : '', task.end_by ? t('office.request.backBy', { time: task.end_by }) : ''].filter(Boolean).join(' · ') } : undefined,
  }).map((st) => {
    const s = stops.find((x) => (x.id ?? `stop-${x.seq}`) === st.key);
    return s ? { ...st, extra: <StopArrival stop={s} onSaved={q.reload} /> } : st;
  }) : [];
  // The action bar (R7): the one thing to do now, then More for the rest; every action only with its tool, as before
  // (office/taskLogic.ts taskActionPlan; a started or finished task has "Show the driven route" with driver_route).
  const plan = task ? taskActionPlan({
    needsDriver: !!task.needs_driver, reassign: actions.reassign, cancel: actions.cancel,
    time: extras.time, stops: extras.stops, swap: extras.swap, reopen: extras.reopen,
    route: (task.status === 'in_progress' || task.status === 'completed') && me.tools.includes('driver_route'),
  }) : { primary: null, more: [] };
  const actionLabel: Record<TaskAction, string> = {
    give: t('office.home.giveDriver'), change: t('office.task.changeTimeOrStops'), time: t('office.task.changeTime'), stops: t('office.task.changeStops'),
    reassign: t('office.task.reassign'), swap: t('office.task.swapVehicle'), route: t('office.history.showDrivenRoute'), reopen: t('office.task.reopen'), cancel: t('office.task.cancel'),
  };
  const act = (a: TaskAction) => {
    if (!task) return;
    setActing(false);
    if (a === 'give' || a === 'reassign') router.push({ pathname: '/office/task/[id]/driver', params: { id: task.id } });
    else if (a === 'change') setChanging(true);
    else if (a === 'time') router.push({ pathname: '/office/task/[id]/time', params: { id: task.id } });
    else if (a === 'stops') router.push({ pathname: '/office/trip/where', params: { mode: 'stops', id: task.id } });
    else if (a === 'swap') router.push({ pathname: '/office/task/[id]/swap', params: { id: task.id } });
    else if (a === 'route') router.push({ pathname: '/office/task/[id]/route', params: { id: task.id } });
    else if (a === 'reopen') setReopening(true);
    else setCancelling(true);
  };
  const km = task?.km ?? task?.gps_km;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        title={task?.title ?? t('office.task.title')}
        subtitle={task ? [t('office.task.task'), task.start, p?.from_request ? t('office.task.askedBy', { name: p.from_request.requested_by }) : task.created_by ? t('office.task.madeBy', { name: task.created_by }) : ''].filter(Boolean).join(' · ') : undefined}
        chips={task ? (
          <>
            {(() => { const c = taskStateChip(task); return <Pill text={t(c.key)} tone={c.tone} size={14} />; })()}
            {task.late_report && <Pill text={sentenceText(t, task.late_report.text)} tone="amber" size={14} />}
            {!task.late_report && task.status === 'in_progress' && task.eta?.late_min ? <Pill text={t('office.chip.late', { min: task.eta.late_min })} tone="amber" size={14} /> : null}
            {task.label && <Pill text={task.label} tone="muted" size={14} />}
            {task.kind === 'self' && <Pill text={t('office.task.driverStarted')} tone="muted" size={14} />}
            {task.finish_flag && <Pill text={task.finish_flag.text} tone="amber" size={14} />}
          </>
        ) : undefined}
      />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {!p && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!p} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !task && <ListEmpty text={t('office.task.notFound')} />}
        <SavedNotice noticeKey={`task:${id}`} />
        {task && task.needs_driver && (
          <StatusBanner
            tone="red"
            testID="needs-driver-banner"
            title={t('office.task.needsDriverSince', { since: dateWords(t, task.needs_driver.since) })}
            line={task.needs_driver.reason === 'declined' ? t('office.task.declinedWhy', { name: task.driver ?? '', why: task.needs_driver.reason_text ?? '' }) : t('office.task.notAccepted', { name: task.driver ?? '' })}
          />
        )}
        {task && task.status === 'cancelled' && task.cancelled_reason && <Txt variant="muted">{t('office.task.cancelledWhy', { why: task.cancelled_reason })}</Txt>}
        {/* Round 3: a missed task says so ("Missed · not started (leave by 08:30)"), never "Cancelled:". */}
        {task && task.status === 'missed' && task.status_line ? <StatusBanner tone="red" testID="missed-line" title={sentenceText(t, task.status_line)} /> : null}
        {p && task && <TaskWarnings p={p} />}
        {task && (
          <StatsRow
            testID="task-stats"
            cells={[
              // The time in the cell, the day under it ("Fri 23 Oct 07:00" → 07:00, "Tomorrow").
              (() => {
                const at = task.leave_by ?? task.start ?? '';
                const m = at.match(/^(.*?)\s*(\d{2}:\d{2})$/);
                return { key: 'leave', label: t('office.request.leaveBy'), value: m ? m[2] : at || '—', sub: m && m[1] ? whenWords(t, m[1]) : undefined };
              })(),
              task.status === 'in_progress' && task.eta?.final
                ? { key: 'back', label: task.return_to_base ? t('office.trip.backAtShort') : t('office.trip.endsShort'), value: task.eta.final, sub: t('office.task.statLive'), tone: 'blue' as const }
                : { key: 'back', label: task.return_to_base ? t('office.trip.backAtShort') : t('office.trip.endsShort'), value: p?.timeline?.totals.ends ?? task.end_by ?? '—', sub: p?.timeline?.totals.ends ? t('office.task.statPlanned') : undefined },
              km != null
                // The odometer's km, the GPS km under it when both are known (the site's task page shows both).
                ? { key: 'km', label: t('office.trip.distance'), value: t('office.trip.kmN', { km }), sub: task.km != null ? [t('office.task.statLogged'), task.gps_km != null ? t('office.task.gpsKm', { km: task.gps_km }) : ''].filter(Boolean).join(' · ') : t('office.task.statGps') }
                : { key: 'km', label: t('office.trip.distance'), value: p?.timeline?.totals.km != null ? t('office.trip.kmN', { km: Math.round(p.timeline.totals.km) }) : '—', sub: p?.timeline?.totals.km != null ? t('office.task.statPlanned') : undefined },
            ]}
          />
        )}
        {task && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {steps(task, stops).map((s) => (
                <View key={s.key} style={{ alignItems: 'center', flex: 1, gap: 4 }}>
                  <View style={[styles.dot, s.state === 'done' && { backgroundColor: colors.blue, borderColor: colors.blue }, s.state === 'now' && { borderColor: colors.amber, borderWidth: 3 }]} />
                  <Txt variant={s.state === 'todo' ? 'small' : 'strong'} size={13} style={{ textAlign: 'center' }} numberOfLines={1}>{t(`office.task.step_${s.key}`)}</Txt>
                  {/* The step's time: alone today, else with its day in words (Round 3 A4, lib/dateWords.ts shortWhen). */}
                  <Mono size={13} color={s.state === 'todo' ? colors.muted : colors.ink} style={{ textAlign: 'center' }}>{shortWhen(t, s.time)}</Mono>
                </View>
              ))}
            </View>
            {(task.approved_by || task.plan_version !== undefined) && (
              <Txt variant="small">{[task.approved_by ? t('office.request.approvedBy', { name: task.approved_by.name, at: task.approved_by.at }) : '', task.plan_version !== undefined ? t('office.task.planVersion', { v: task.plan_version }) : ''].filter(Boolean).join(' · ')}</Txt>
            )}
          </View>
        )}
        {task && (task.driver || task.vehicle || task.vehicle_text) && (
          <View style={styles.card}>
            <TaskDriverCard
              name={task.driver}
              photo={task.driver_photo_url}
              drivenBy={task.driven_by}
              plate={task.vehicle ? plateOf(task.vehicle) : undefined}
              vehicleText={task.vehicle_text}
              details={[task.vehicle?.split(' · ').slice(1).join(' · '), task.start_odometer_km != null ? t('office.task.startOdo', { km: task.start_odometer_km.toLocaleString('en-US') }) : ''].filter(Boolean).join(' · ')}
              call={task.driver_phone?.call}
              whatsapp={task.driver_phone?.whatsapp}
              emptyName={t('office.task.noDriver')}
            />
            {task.status === 'in_progress' && (
              <Pressable accessibilityRole="button" onPress={() => router.navigate({ pathname: '/office/(tabs)/live', params: { driver: task.driver ?? '' } })} style={styles.now}>
                <MapPin size={22} color={colors.blue} />
                <Txt variant="body" size={15} style={{ flex: 1 }}>{[task.eta?.next_stop ? t('office.task.nextStop', { place: task.eta.next_stop }) : '', task.eta?.next ? t('office.request.about', { time: task.eta.next }) : '', task.eta?.final ? t('office.task.backAbout', { time: task.eta.final }) : ''].filter(Boolean).join(' · ') || sentenceText(t, task.status_line) || t('office.task.onTheWayNow')}</Txt>
                <Txt variant="strong" size={16} color={colors.blue}>{t('office.home.liveMap')}</Txt>
              </Pressable>
            )}
            {task.vehicle_taken && <Txt variant="small">{task.vehicle_taken}</Txt>}
            {task.vehicle_changed && <Txt variant="small">{task.vehicle_changed}</Txt>}
          </View>
        )}
        {p && task && <TripPurposeCard p={p} />}
        {p && routeSteps.length > 0 && (
          <Section title={t('office.task.stops')}>
            <View style={{ paddingTop: 8 }}>
              {/* Round 2: the live timeline (planned, arrived, left, late or early, the stops to come re-estimated). */}
              <RouteStepper steps={routeSteps} testID="task-steps" />
            </View>
            {task?.notes ? <Txt variant="muted" size={15} style={{ marginTop: 8 }}>{t('office.request.notes', { note: task.notes })}</Txt> : null}
          </Section>
        )}
        {p && task && <SwapSegments p={p} onSaved={q.reload} />}
        {task && (task.contact?.name || p?.from_request) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Txt variant="small">{t('office.task.requesterPush', { name: p?.from_request?.requested_by ?? task.contact?.name ?? '' })}</Txt>
            {task.contact?.call && (
              <Pressable accessibilityRole="button" onPress={() => open(task.contact!.call!)} hitSlop={10}>
                <Txt variant="strong" size={15} color={colors.blue}>{t('office.request.callRequester', { name: task.contact.name ?? '' })}</Txt>
              </Pressable>
            )}
          </View>
        )}
        {p && task && (
          <TaskMoreDetails p={p} openLink={openLink} linkNote={linkNote}
            onPlan={p.plan ? () => router.push({ pathname: '/office/task/[id]/plan', params: { id: task.id } }) : undefined} />
        )}
        {problem && <ErrorNotice error={problem} onRetry={() => void q.reload()} />}
      </Screen>
      {task && (plan.primary || plan.more.length > 0) && (
        <StickyActions>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {plan.more.length > 0 && <Button kind="outline" label={t('office.common.more')} onPress={() => setActing(true)} disabled={busy !== null} style={{ flex: plan.primary ? 0.7 : 1 }} testID="task-more" />}
            {plan.primary && <Button label={actionLabel[plan.primary]} onPress={() => act(plan.primary!)} disabled={busy !== null} style={{ flex: 1.3 }} testID="task-primary" />}
          </View>
        </StickyActions>
      )}
      {task && (
        <Sheet visible={changing} title={t('office.task.changeTimeOrStops')} onClose={() => setChanging(false)} testID="task-change-sheet">
          <View style={{ gap: 10 }}>
            {extras.time && <Button kind="outline" label={t('office.task.changeTime')} onPress={() => { setChanging(false); act('time'); }} />}
            {extras.stops && <Button kind="outline" label={t('office.task.changeStops')} onPress={() => { setChanging(false); act('stops'); }} />}
          </View>
        </Sheet>
      )}
      {task && (
        <Sheet visible={acting} title={t('office.task.moreTitle')} onClose={() => setActing(false)} testID="task-more-sheet">
          <View style={{ gap: 10 }}>
            {plan.more.map((a) => (
              <View key={a} style={{ gap: 4 }}>
                <Button kind="outline" label={actionLabel[a]} onPress={() => act(a)} busy={(a === 'reopen' && busy === 'reopen') || (a === 'cancel' && busy === 'cancel')}
                  style={a === 'cancel' ? { borderColor: colors.red } : undefined} testID={`task-more-${a}`} />
                {a === 'reopen' && <Txt variant="small">{t('office.task.reopenIntro')}</Txt>}
              </View>
            ))}
          </View>
        </Sheet>
      )}
      <ReasonSheet<CancelReasonKey>
        visible={cancelling}
        title="office.task.cancelTitle"
        question="office.request.declineQuestion"
        notePlaceholder="office.task.cancelNote"
        confirmLabel="office.task.cancelConfirm"
        subtitle={task?.title ?? null}
        reasons={CANCEL_REASONS}
        onConfirm={(reason, note) => {
          setCancelling(false);
          void cancel(CANCEL_TEXT[reason], note);
        }}
        onClose={() => setCancelling(false)}
      />
      <ReasonSheet<ReopenReasonKey>
        visible={reopening}
        title="office.task.reopenTitle"
        question="office.task.reopenQuestion"
        notePlaceholder="office.task.reopenNote"
        confirmLabel="office.task.reopen"
        subtitle={task?.title ?? null}
        reasons={REOPEN_REASONS}
        onConfirm={(reason, note) => {
          setReopening(false);
          void reopen(REOPEN_TEXT[reason], note);
        }}
        onClose={() => setReopening(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ebe9e3', borderWidth: 2, borderColor: '#ebe9e3' },
  iconBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  now: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ebe9e3', borderRadius: 12, padding: 12, minHeight: 56 },
});
