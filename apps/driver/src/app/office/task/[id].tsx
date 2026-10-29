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
// Round 4–7 (4): the vehicle check lines (with the photos) and Completed · not confirmed (grey).
// Round 4–7, item 12 (the approved mockup 4): restyled, nothing removed. While on the way the map comes first (the plan and
// the driver's position from live_drivers; Google → the free map → "Map not available" as TaskMap does) with a floating
// back button, the page as a sheet over it; ONE status banner ("On the way to <stop>" · arrives about · back about, the
// late chip, a tap opens Live with the driver); the driver card with Call and WhatsApp; the five steps; the stops on the
// route stepper (start, the live timeline, back at base); who rides (their avatars, then a row each); the trip's holder
// (task_detail.task.holder: asked by / assigned by, Call, WhatsApp); the fuel card; the vehicle check; the rest as before.
// The bar: the two actions used most (office/detailBanner.ts taskActions: Give a driver when it needs one, Change the task,
// Reassign driver, Change stops, Swap vehicle, Reopen), the rest and Show the driven route and Cancel task under ⋯ More;
// never ⋯ More alone (with none of those, the others go on the bar themselves).
// Review of Round 4–7: the fleet's switches (office/switches.ts) hide their parts here too (passengers: who rides; the
// vehicle check; holder_contact: the holder's words, Call and WhatsApp, and the asks; the fuel card); while on the way the
// trip's row says who made it ("Made by", "Asked by") when no holder is shown, as the header does in the other states.
// Sahan's removals (22 October 2026): the five-steps card (Approved · Accepted · On the way · Arrived · Done) is gone. Its
// facts are on the timeline's first lines (who approved it with the plan version; Sent · Seen · Accepted with their times;
// Left when no start row says it); arriving is on each stop's row, done on the banner.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Briefcase, CalendarX, Check, ChevronLeft, Clock, Flag, Fuel, type LucideIcon, MessageCircle, Navigation, Phone, Send, UserCog, Users, UserX, X } from '@/components/icons';
import { AvatarStack } from '@/components/office/Passengers';
import { BarMore, BarRow, barSecondary } from '@/components/patterns/BottomActionBar';
import { RowIcon } from '@/components/patterns/ListRow';
import { look, TINT } from '@/components/patterns/look';
import { Sheet } from '@/components/patterns/Sheet';
import { StatusBanner } from '@/components/patterns/StatusBanner';
import { RoundButton } from '@/components/patterns/TopBar';
import { TaskMap } from '@/components/TaskMap';
import { mapHeight } from '@/lib/mapLayout';
import { type BannerIcon, lateMinutes, type TaskAction, taskActions, taskBanner } from '@/office/detailBanner';
import { holderTitle, reachOf, windowWords } from '@/office/holderLogic';
import { TaskDriverCard } from '@/components/office/DriverRows';
import { isSelfDriveTrip } from '@/office/webTripLogic';
import { TaskAsksLink } from '@/components/office/HolderParts';
import { TaskCheckLines } from '@/components/office/VehicleChecks';
import { PassengerRows } from '@/components/office/Passengers';
import { countWithNames } from '@/office/trip/passengersLogic';
import { StopTimeline } from '@/components/office/StopTimeline';
import { StopArrival, SwapSegments, TaskMoreDetails, TaskWarnings, TripPurposeCard } from '@/components/office/TaskDetailParts';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ReasonSheet } from '@/components/ReasonSheet';
import { SavedNotice } from '@/components/office/SavedNotice';
import { PendingChangeLine } from '@/components/office/ChangeParts';
import { Button, Txt } from '@/components/ui';
import { handToPlayer, startPiece } from '@/office/fuelPlayer';
import { useLiveTask } from '@/office/liveTask';
import { useOffice, useTool } from '@/office/state';
import { useSwitch } from '@/office/switches';
import { DETAIL_LINKS_FRESH_MS, detailTask, fuelCardParts, type LinkKey, linkOf, planDrawable } from '@/office/taskDetailLogic';
import { extrasFor, REOPEN_TEXT, type ReopenReasonKey, reopenInput } from '@/office/taskExtrasLogic';
import { allowedActions, approvedParts, CANCEL_TEXT, cancelInput, dispatchParts, plateOf, taskStatusKey } from '@/office/taskLogic';
import type { FleetError, FuelCard, LiveDrivers, TaskDetail } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { BackHeader, ErrorNotice, ListFailed, Pill, Row, Screen, Section, StickyActions } from '@/office/ui';
import { sentenceText, taskLineText } from '@/office/statusWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords, shortWhen } from '@/lib/dateWords';

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
  // Release 1.4.0: a fill's video plays in the app (office/fuel-video.tsx), from the piece tapped; photos still open as links.
  function openFound(data: TaskDetail, key: LinkKey, url: string) {
    setLinkNote(null);
    const fill = key.kind === 'video' ? data.fuel[key.i] : undefined;
    if (!fill?.video) return openUrl(url);
    const plate = data.task?.vehicle ? plateOf(data.task.vehicle) : '';
    handToPlayer({ title: dateWords(t, fill.at), sub: [plate, data.task?.driver ?? ''].filter(Boolean).join(' · '), video: fill.video, start: key.kind === 'video' ? startPiece(fill.video, key.n) : 0 });
    router.push('/office/fuel-video');
  }
  useEffect(() => {
    if (!pendingLink || !q.data || Date.now() - loadedAt.current > DETAIL_LINKS_FRESH_MS) return;
    const url = linkOf(q.data, pendingLink);
    setPendingLink(null);
    if (url) openFound(q.data, pendingLink, url);
    else setLinkNote(t('office.task.linkGone'));
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
    if (url) openFound(q.data, key, url);
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
  const statusKey = task ? taskStatusKey(task) : '';
  // Sahan's removals (22 October 2026): the five-steps card's facts on the timeline (office/taskLogic.ts dispatchParts). The
  // start row (S) says "Left HH:MM" itself when the task has a start place and a leave-by.
  const startRowLeft = stops.length > 0 && !!task?.start_place && !stops.some((s) => s.is_start) && !!task?.leave_by;
  const dispatch = task ? dispatchParts(task, startRowLeft) : [];
  const approved = task ? approvedParts(task) : {};
  const approvedLine = [approved.approvedBy ? t('office.request.approvedBy', approved.approvedBy) : '', approved.planVersion !== undefined ? t('office.task.planVersion', { v: approved.planVersion }) : ''].filter(Boolean).join(' · ');

  // Round 4–7, item 12 (the approved mockup 4): while the trip is on the way the map comes first with the driver's position
  // (live_drivers, as Live reads it), then ONE status banner, the people, the route stepper, the rest; the office's actions
  // in the bottom bar (two) and under ⋯ More (office/detailBanner.ts taskActions).
  const banner = task ? taskBanner(task) : null;
  const late = task ? lateMinutes(task) : null;
  const showMap = !!p && !!task && task.status === 'in_progress' && planDrawable(p);
  const live = useTool<LiveDrivers>('live_drivers', {}, { enabled: showMap && me.tools.includes('live_drivers'), every: 30_000 });
  const here = live.data?.drivers?.find((d) => d.driver === task?.driver && typeof d.lat === 'number' && typeof d.lng === 'number');
  const mapTask = useMemo(() => (p && showMap ? detailTask(p) : null), [p, showMap]);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [moreOpen, setMoreOpen] = useState(false);
  const plan = taskActions({
    reassign: actions.reassign,
    time: extras.time,
    stops: extras.stops,
    swap: extras.swap,
    reopen: extras.reopen,
    cancel: actions.cancel,
    route: !!task && (task.status === 'in_progress' || task.status === 'completed') && me.tools.includes('driver_route'),
  }, !!task?.needs_driver);
  // The fleet's switches (office/switches.ts): a part switched off is not shown, whatever an older answer still carries.
  const ridersOn = useSwitch('passengers');
  const checksOn = useSwitch('vehicle_check');
  const holdersOn = useSwitch('holder_contact');
  const fuelCardOn = useSwitch('fuel_card');
  const holder = holdersOn ? task?.holder : undefined;
  const holderReach = holder ? reachOf(holder, me.name) : {};
  // Who asked for it or made it, as the header says in the other states (the header is not drawn over the map).
  const madeBy = p?.from_request ? t('office.ui3.askedBy', { name: p.from_request.requested_by }) : task?.created_by ? t('office.task.madeBy', { name: task.created_by }) : undefined;
  const openLive = task ? () => router.navigate({ pathname: '/office/(tabs)/live', params: { driver: task.driver ?? '' } }) : undefined;

  // One action as a button: on the bar (outlined, half the width) or in the ⋯ sheet (full width). Each opens its own screen
  // or sheet as before; Cancel and Reopen keep their spinner on the button pressed.
  const action = (a: TaskAction, inSheet: boolean): ReactNode => {
    if (!task) return null;
    const style = inSheet ? styles.sheetBtn : [barSecondary, { flex: 1 }];
    const from = (fn: () => void) => () => { setMoreOpen(false); fn(); };
    switch (a) {
      case 'giveDriver':
      case 'reassign':
        return actions.reassign && <Button key={a} kind={a === 'giveDriver' && !inSheet ? 'primary' : 'outline'} icon={UserCog} label={task.needs_driver ? t('office.home.giveDriver') : t('office.task.reassign')} onPress={from(() => router.push({ pathname: '/office/task/[id]/driver', params: { id: task.id } }))} disabled={busy !== null} style={style} testID="task-reassign" compact />;
      case 'time':
        return extras.time && <Button key={a} kind="outline" icon={Clock} label={t('office.task.changeTime')} onPress={from(() => router.push({ pathname: '/office/task/[id]/time', params: { id: task.id } }))} disabled={busy !== null} style={style} testID="task-change-time" compact />;
      case 'stops':
        return extras.stops && <Button key={a} kind="outline" label={t('office.task.changeStops')} onPress={from(() => router.push({ pathname: '/office/trip/where', params: { mode: 'stops', id: task.id } }))} disabled={busy !== null} style={style} testID="task-change-stops" compact />;
      case 'swap':
        return extras.swap && <Button key={a} kind="outline" label={t('office.task.swapVehicle')} onPress={from(() => router.push({ pathname: '/office/task/[id]/swap', params: { id: task.id } }))} disabled={busy !== null} style={style} testID="task-swap" compact />;
      case 'reopen':
        return extras.reopen && <Button key={a} kind="outline" label={t('office.task.reopen')} onPress={from(() => setReopening(true))} busy={busy === 'reopen'} disabled={busy !== null} style={style} testID="task-reopen" compact />;
      case 'cancel':
        return actions.cancel && <Button key={a} kind="danger-text" label={t('office.task.cancel')} onPress={from(() => setCancelling(true))} busy={busy === 'cancel'} disabled={busy !== null} style={[style, styles.cancelBtn]} testID="task-cancel" compact />;
      case 'route':
        return <Button key={a} kind="outline" label={t('office.history.showDrivenRoute')} onPress={from(() => router.push({ pathname: '/office/task/[id]/route', params: { id: task.id } }))} style={style} testID="task-route" compact />;
      default:
        return null;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {!showMap && (
        <BackHeader
          title={task?.title ?? t('office.task.title')}
          subtitle={task ? [t('office.task.task'), task.start, p?.from_request ? t('office.task.askedBy', { name: p.from_request.requested_by }) : task.created_by ? t('office.task.madeBy', { name: task.created_by }) : ''].filter(Boolean).join(' · ') : undefined}
        />
      )}
      {/* Round 48 (item 2, Google Maps Timeline / Airbnb's split view): the map at a fixed height, outside the scroll (a pinch
          zooms it, the page's scroll never does); the sheet's rounded top overlaps its foot. */}
      {showMap && mapTask && (
        <View style={[styles.map, { height: mapHeight(height) }]} testID="task-map">
          <TaskMap report={false} mapPackage={me.map?.package} task={mapTask} me={here ? { lat: here.lat as number, lng: here.lng as number } : null} googleNoteFor="current" />
        </View>
      )}
      <View style={[{ flex: 1 }, showMap && styles.sheetOverMap]}>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16} style={{ padding: 0, gap: 0 }}>
        <View style={[styles.sheet, showMap && { paddingTop: 10 }]}>
          {showMap && <View style={styles.grab} />}
          {!p && !q.error && <SkeletonRows rows={4} lines={2} />}
          {q.error && <ListFailed stale={!!p} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
          {q.data && !task && <ListEmpty text={t('office.task.notFound')} />}
          <SavedNotice noticeKey={`task:${id}`} />
          {task && banner && (
            <StatusBanner
              tone={banner.tone}
              icon={BANNER_ICON[banner.icon]}
              title={banner.title === 'onTheWay'
                ? (task.eta?.next_stop ? t('office.ui3.onTheWayTo', { place: task.eta.next_stop }) : t('office.task.onTheWayNow'))
                : banner.title === 'needsDriver' && task.needs_driver ? t('office.task.needsDriverSince', { since: dateWords(t, task.needs_driver.since) })
                : cap(t(`office.status.${statusKey}`))}
              chip={task.late_report ? { text: sentenceText(t, task.late_report.text), tone: 'amber' } : late ? { text: t('office.task.minLate', { min: late }), tone: 'amber' } : null}
              onPress={task.status === 'in_progress' ? openLive : undefined}
              testID="task-banner"
            >
              <Txt variant="body" size={14} color={TINT[banner.tone].sub} testID="task-banner-line">
                {banner.title === 'onTheWay'
                  ? ([task.eta?.next ? t('office.ui3.arrivesAbout', { time: task.eta.next }) : '', task.eta?.final ? t('office.task.backAbout', { time: task.eta.final }) : ''].filter(Boolean).join(' · ') || taskLineText(t, task) || t('office.task.onTheWayNow'))
                  : banner.title === 'needsDriver' && task.needs_driver ? (task.needs_driver.reason === 'declined' ? t('office.task.declinedWhy', { name: task.driver ?? '', why: task.needs_driver.reason_text ?? '' }) : t('office.task.notAccepted', { name: task.driver ?? '' }))
                  : task.status === 'cancelled' && task.cancelled_reason ? t('office.task.cancelledWhy', { why: task.cancelled_reason })
                  : taskLineText(t, task) || task.start}
              </Txt>
              {task.status === 'in_progress' && <Txt variant="strong" size={14} color={colors.blue}>{t('office.home.liveMap')}</Txt>}
            </StatusBanner>
          )}
          {/* Round 48 (item 1): a change proposed by someone without approve waits for the fleet admin; the task is as it was. */}
          {task?.pending_change && <PendingChangeLine change={task.pending_change} />}
          {task && (task.label || task.kind === 'self' || task.finish_flag) && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {task.label && <Pill text={task.label} tone="muted" size={14} />}
              {task.kind === 'self' && <Pill text={t('office.task.driverStarted')} tone="muted" size={14} />}
              {/* Round 4–7 (4b): a trip nobody drives with the app closed without its odometer: Completed · not confirmed, grey. */}
              {task.finish_flag && (task.finish_flag.kind === 'not_confirmed'
                ? <Pill text={t('office.checks.notConfirmed')} tone="muted" size={14} />
                : <Pill text={task.finish_flag.text} tone="amber" size={14} />)}
            </View>
          )}
          {/* Round 3: a missed task says so ("Missed · not started (leave by 08:30)"), never "Cancelled:". */}
          {task && task.status === 'missed' && task.status_line ? <Txt variant="muted" testID="missed-line">{sentenceText(t, task.status_line)}</Txt> : null}
          {p && task && <TaskWarnings p={p} />}
          {/* Round 4–7 (7): the asks for this trip's driver or vehicle, when there are any. */}
          {task && <TaskAsksLink taskId={task.id} />}
          {task && (task.driver || task.vehicle || task.vehicle_text) && (
            <View style={styles.card}>
              <TaskDriverCard
                name={task.driver}
                photo={task.driver_photo_url}
                drivenBy={task.driven_by}
                selfDrive={isSelfDriveTrip(task)}
                plate={task.vehicle ? plateOf(task.vehicle) : undefined}
                vehicleText={task.vehicle_text}
                details={[task.vehicle?.split(' · ').slice(1).join(' · '), task.start_odometer_km != null ? t('office.task.startOdo', { km: task.start_odometer_km.toLocaleString('en-US') }) : ''].filter(Boolean).join(' · ')}
                call={task.driver_phone?.call}
                whatsapp={task.driver_phone?.whatsapp}
                emptyName={t('office.task.noDriver')}
              />
              {task.vehicle_taken && <Txt variant="small">{task.vehicle_taken}</Txt>}
              {task.vehicle_changed && <Txt variant="small">{task.vehicle_changed}</Txt>}
            </View>
          )}
          {p && task && (stops.length > 0 || approvedLine || dispatch.length > 0) && (
            <View style={styles.card} testID="task-stops">
              {/* Sahan's removals (22 October 2026): the five-steps card is gone; its facts open the timeline: who approved
                  it with the plan version (the card's own line), then "Sent 12:08 · Seen 12:10 · Accepted 12:15" (and "Left"
                  when no start row says it), each time alone today, else with its day in words (lib/dateWords.ts shortWhen). */}
              {(approvedLine || dispatch.length > 0) && (
                <View style={{ gap: 2 }} testID="task-dispatch">
                  {approvedLine ? <Txt variant="small" testID="task-approved">{approvedLine}</Txt> : null}
                  {dispatch.length > 0 ? <Txt variant="small" testID="task-dispatch-line">{dispatch.map((s) => t(s.key, { time: shortWhen(t, s.time) })).join(' · ')}</Txt> : null}
                </View>
              )}
              {/* Round 2: the live timeline (planned, arrived, left, late or early, the stops to come re-estimated), on the
                  route stepper with the start and back at base. */}
              {stops.length > 0 && <StopTimeline
                stops={stops}
                live={task?.status === 'in_progress'}
                extra={(s) => <StopArrival stop={s} onSaved={q.reload} />}
                before={task?.start_place && !stops.some((s) => s.is_start) ? {
                  key: 'start',
                  mark: 'S',
                  kind: 'start',
                  state: task.started ? 'done' : 'todo',
                  time: task.leave_by && /\d{2}:\d{2}$/.test(task.leave_by) ? task.leave_by.slice(-5) : undefined,
                  title: task.start_place,
                  meta: task.leave_by ? [{ text: `${t('office.task.planned', { time: task.leave_by })}${task.started ? ` · ${t('office.task.left', { time: shortWhen(t, task.started) })}` : ''}` }] : undefined,
                } : null}
                after={task?.return_to_base && task.start_place ? {
                  key: 'back',
                  mark: 'B',
                  kind: 'back',
                  time: p.timeline?.totals.ends,
                  title: t('office.request.backAt', { place: task.start_place }),
                  meta: [p.timeline?.totals.ends ? t('office.request.about', { time: p.timeline.totals.ends }) : '', task.end_by ? t('office.request.backBy', { time: task.end_by }) : ''].filter(Boolean).map((text) => ({ text })),
                } : null}
              />}
              {stops.length > 0 && task?.notes ? <Txt variant="muted" size={15} style={{ marginTop: 8 }}>{t('office.request.notes', { note: task.notes })}</Txt> : null}
            </View>
          )}
          {/* Round 4–7 (6): the passengers (the count never under the names), a row each; Share trip for someone without an account. */}
          {task && ridersOn && (task.passengers || task.passengers_list?.length) ? (
            <View style={styles.list} testID="task-passengers">
              <View style={styles.summary}>
                {task.passengers_list?.length ? <AvatarStack people={task.passengers_list} /> : <RowIcon icon={Users} tone="quiet" />}
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt variant="strong" size={16} numberOfLines={1}>{t('office.task.passengers', { n: countWithNames(task.passengers, task.passengers_list?.length ?? 0) ?? task.passengers_list?.length ?? 0 })}</Txt>
                  {task.passengers_list?.length ? <Txt variant="muted" size={14} numberOfLines={1}>{task.passengers_list.map((x) => x.name).join(', ')}</Txt> : null}
                </View>
              </View>
              {task.passengers_list?.length ? <View style={styles.inner}><PassengerRows list={task.passengers_list} /></View> : null}
              {(task.passengers ?? 0) > (task.passengers_list?.length ?? 0) && task.passengers_list?.length
                ? <Txt variant="small" style={styles.innerText} testID="passengers-unnamed">{t('office.passengers.unnamed', { n: (task.passengers ?? 0) - task.passengers_list.length })}</Txt>
                : null}
            </View>
          ) : null}
          {/* Round 4–7, item 12: the trip's holder (feature 7: the requester, else who assigned it), with Call and WhatsApp. */}
          {task && (showMap || holder || p?.from_request) ? (
            <View style={styles.list} testID="task-holder">
              <Row
                inset
                left={<RowIcon icon={Briefcase} tone="quiet" />}
                title={task.title}
                line={holder ? [t(holder.by === 'asked' ? 'office.ui3.askedBy' : 'office.ui3.assignedBy', { name: holderTitle(holder, me.name, t) }), windowWords(holder, t)].filter(Boolean).join(' · ') : madeBy}
                testID="task-holder-row"
                onPress={p?.from_request && me.permissions.includes('approve') ? () => router.push({ pathname: '/office/request/[id]', params: { id: p.from_request!.id } }) : undefined}
                right={(
                  <>
                    {holderReach.call ? <RoundButton icon={<Phone size={18} color={colors.blue} strokeWidth={2} />} label={`${t('office.common.call')} ${holder?.name ?? ''}`} onPress={() => open(holderReach.call!)} size={40} testID="task-holder-call" /> : null}
                    {holderReach.whatsapp ? <RoundButton icon={<MessageCircle size={18} color={colors.green} strokeWidth={2} />} label={`${t('office.common.whatsapp')} ${holder?.name ?? ''}`} onPress={() => open(holderReach.whatsapp!)} size={40} testID="task-holder-whatsapp" /> : null}
                  </>
                )}
              />
            </View>
          ) : null}
          {/* Round 4–7 (5): the fuel card the driver saw at Start task and their answer (nothing when the task has none). */}
          {fuelCardOn && task?.fuel_card ? <FuelCardSection card={task.fuel_card} started={!!task.started || task.status === 'in_progress' || task.status === 'completed'} /> : null}
          {/* Round 4–7 (4): the vehicle check of the task's day by its person, with the photos. */}
          {checksOn && task?.vehicle_checks?.length ? <Section look="list" title={t('office.checks.title')}><View style={styles.inner}><TaskCheckLines checks={task.vehicle_checks} /></View></Section> : null}
          {p && task && <TripPurposeCard p={p} />}
          {task && (task.km != null || task.gps_km != null) && (
            <Txt variant="muted" size={15}>{[task.km != null ? t('office.task.taskKm', { km: task.km }) : '', task.gps_km != null ? t('office.task.gpsKm', { km: task.gps_km }) : ''].filter(Boolean).join(' · ')}</Txt>
          )}
          {p && task && <SwapSegments p={p} onSaved={q.reload} />}
          {task && extras.reopen && (
            <View style={styles.card} testID="reopen-card">
              <Txt variant="strong">{t('office.task.reopenTitle')}</Txt>
              <Txt variant="muted" size={15}>{t('office.task.reopenIntro')}</Txt>
            </View>
          )}
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
        </View>
      </Screen>
      </View>
      {showMap && (
        <View style={[styles.floatBack, { top: insets.top + 12 }]}>
          <RoundButton icon={<ChevronLeft size={22} color={colors.ink} strokeWidth={2.4} />} label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office'))} testID="task-back" />
        </View>
      )}
      {task && (plan.bar.length > 0 || plan.more.length > 0) && (
        <StickyActions>
          <BarRow>
            {plan.bar.map((a) => action(a, false))}
            {plan.more.length > 0 && <BarMore label={t('office.common.more')} onPress={() => setMoreOpen(true)} testID="task-more" />}
          </BarRow>
        </StickyActions>
      )}
      <Sheet visible={moreOpen} title={t('office.common.more')} onClose={() => setMoreOpen(false)} testID="task-more-sheet">
        <View style={{ gap: 10 }}>
          {plan.more.map((a) => action(a, true))}
        </View>
      </Sheet>
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

/** Round 4–7 (5): "Enough fuel · 07:42" with the estimate under it; before the start the estimate alone. */
function FuelCardSection({ card, started }: { card: FuelCard; started: boolean }) {
  const { t } = useApp();
  const w = fuelCardParts(card, started, t);
  if (!w.answer && !w.estimate) return null;
  // Round 4–7, item 12: one list row (a fuel pump, the answer, the estimate under it).
  return (
    <View style={[styles.list, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }]} testID="fuel-card">
      <RowIcon icon={Fuel} tone={w.tone === 'amber' ? 'amber' : 'quiet'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="small" size={13}>{t('office.fuel.label')}</Txt>
        {w.answer
          ? <Txt variant="strong" color={w.tone === 'amber' ? colors.amberText : w.tone === 'muted' ? colors.muted : colors.ink}>{w.answer}</Txt>
          : <Txt variant="muted" size={15}>{t('office.fuel.askedAtStart')}</Txt>}
        {w.estimate ? <Txt variant="small">{w.estimate}</Txt> : null}
      </View>
    </View>
  );
}

/** "on the way" → "On the way" (English only; Sinhala has no capitals). */
const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

/** The banner's icon by its name (office/detailBanner.ts). */
const BANNER_ICON: Record<BannerIcon, LucideIcon> = { clock: Clock, check: Check, x: X, calendarX: CalendarX, navigation: Navigation, userX: UserX, send: Send, flag: Flag };

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
  list: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, overflow: 'hidden' },
  inner: { paddingHorizontal: 14, paddingBottom: 8 },
  innerText: { paddingHorizontal: 14, paddingBottom: 12 },
  map: { backgroundColor: colors.mapLand },
  sheet: { padding: 16, gap: 12, backgroundColor: colors.page },
  sheetOverMap: { marginTop: -24, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', backgroundColor: colors.page },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: look.rail, alignSelf: 'center' },
  floatBack: { position: 'absolute', left: 16 },
  sheetBtn: { minHeight: 56 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  cancelBtn: { borderWidth: 1.5, borderColor: '#e3b8b4', backgroundColor: colors.card },
});
