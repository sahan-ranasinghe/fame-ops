// Office mode (Phase 8, O1): Task detail (design 14), from task_detail: the status pills, the five steps with their
// times, the driver and the vehicle with Call and WhatsApp, where the driver is now (the ETA) with Live map, the stops
// planned against what happened, Reassign driver (Needs a driver, design 11, through reassign_task), Cancel task… with
// a reason (cancel_task), the requester's line with Call. O2 (item 5): Change time (task/[id]/time, update_task), Change
// stops (the editor's Where and When in mode stops, update_task_stops), Swap vehicle while it runs (task/[id]/swap,
// move_driver_vehicle) and Reopen with a reason (reopen_task, a task completed today); each only with its tool.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { MapPin, MessageCircle, Phone } from '@/components/icons';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { useOffice, useTool } from '@/office/state';
import { extrasFor, REOPEN_TEXT, type ReopenReasonKey, reopenInput } from '@/office/taskExtrasLogic';
import { allowedActions, CANCEL_TEXT, cancelInput, plateOf, stopLateMin, stopParts, steps, taskStatusKey } from '@/office/taskLogic';
import type { FleetError, TaskDetail } from '@/office/types';
import { Avatar, BackHeader, Empty, ErrorNotice, Loading, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { statusTone } from '@/office/homeLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

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
  const p = q.data;
  const task = p?.task;
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);

  async function cancel(label: string, note: string) {
    if (!task || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.call('cancel_task', cancelInput(task.id, label, note));
      Alert.alert(t('office.task.cancelledTitle'), undefined, [{ text: t('office.common.ok'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/office')) }]);
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(false);
    }
  }

  async function reopen(label: string, note: string) {
    if (!task || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.call('reopen_task', reopenInput(task.id, label, note));
      Alert.alert(t('office.task.reopenedTitle'), t('office.task.reopenedBody'), [{ text: t('office.common.ok') }]);
      await q.reload();
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(false);
    }
  }

  const words = {
    planned: (x: string) => t('office.task.planned', { time: x }),
    left: (x: string) => t('office.task.left', { time: x }),
    arriveBy: (x: string) => t('office.request.arriveBy', { time: x }),
    about: (x: string) => t('office.request.about', { time: x }),
    arrived: (x: string) => t('office.task.arrivedAt', { time: x }),
    done: (x: string) => t('office.task.doneAt', { time: x }),
    late: (min: number) => t('office.task.minLate', { min }),
    there: (min: number) => t('office.request.there', { dur: durationText(t, min) }),
    skipped: (why: string) => t('office.task.skipped', { why }),
  };
  const stops = (p?.stops ?? []).filter((s) => s.status !== 'removed');
  const may = allowedActions(task ?? { status: 'cancelled' });
  const actions = { reassign: may.reassign && me.tools.includes('reassign_task'), cancel: may.cancel && me.tools.includes('cancel_task') };
  const extras = task ? extrasFor(task, me.tools) : { time: false, stops: false, swap: false, reopen: false };
  const statusKey = task ? taskStatusKey(task) : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        title={task?.title ?? t('office.task.title')}
        subtitle={task ? [t('office.task.task'), task.start, p?.from_request ? t('office.task.askedBy', { name: p.from_request.requested_by }) : task.created_by ? t('office.task.madeBy', { name: task.created_by }) : ''].filter(Boolean).join(' · ') : undefined}
      />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} bottom={16}>
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !p && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !task && <Empty text={t('office.task.notFound')} />}
        {task && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pill text={t(`office.status.${statusKey}`)} tone={statusTone(statusKey)} size={15} />
            {task.late_report && <Pill text={task.late_report.text} tone="amber" size={15} />}
            {!task.late_report && task.status === 'in_progress' && task.eta?.late_min ? <Pill text={t('office.status.late', { min: task.eta.late_min })} tone="amber" size={15} /> : null}
            {task.label && <Pill text={task.label} tone="muted" size={15} />}
            {task.kind === 'self' && <Pill text={t('office.task.driverStarted')} tone="muted" size={15} />}
            {task.finish_flag && <Pill text={task.finish_flag.text} tone="amber" size={15} />}
          </View>
        )}
        {task && task.needs_driver && (
          <View style={styles.needs}>
            <Txt variant="strong" color={colors.red}>{[t('office.task.needsDriverSince', { since: task.needs_driver.since }), task.needs_driver.reason === 'declined' ? t('office.task.declinedWhy', { name: task.driver ?? '', why: task.needs_driver.reason_text ?? '' }) : t('office.task.notAccepted', { name: task.driver ?? '' })].join(' · ')}</Txt>
          </View>
        )}
        {task && task.status === 'cancelled' && task.cancelled_reason && <Txt variant="muted">{t('office.task.cancelledWhy', { why: task.cancelled_reason })}</Txt>}
        {task && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {steps(task, stops).map((s) => (
                <View key={s.key} style={{ alignItems: 'center', flex: 1, gap: 4 }}>
                  <View style={[styles.dot, s.state === 'done' && { backgroundColor: colors.blue, borderColor: colors.blue }, s.state === 'now' && { borderColor: colors.amber, borderWidth: 3 }]} />
                  <Txt variant={s.state === 'todo' ? 'small' : 'strong'} size={13} style={{ textAlign: 'center' }} numberOfLines={1}>{t(`office.task.step_${s.key}`)}</Txt>
                  <Mono size={13} color={s.state === 'todo' ? colors.muted : colors.ink}>{s.time}</Mono>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {task.driver ? <Avatar name={task.driver} size={52} /> : null}
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Txt variant="strong" size={18}>{task.driver ?? t('office.task.noDriver')}</Txt>
                  {task.vehicle ? <Plate regNo={plateOf(task.vehicle)} /> : task.vehicle_text ? <Pill text={task.vehicle_text} tone="muted" /> : null}
                </View>
                <Txt variant="muted" size={15}>{[task.vehicle?.split(' · ').slice(1).join(' · '), task.start_odometer_km != null ? t('office.task.startOdo', { km: task.start_odometer_km.toLocaleString('en-US') }) : ''].filter(Boolean).join(' · ')}</Txt>
              </View>
              {task.driver_phone?.call && (
                <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => open(task.driver_phone!.call)} style={styles.iconBtn}><Phone size={22} color={colors.ink} strokeWidth={2.4} /></Pressable>
              )}
              {task.driver_phone?.whatsapp && (
                <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.whatsapp')} onPress={() => open(task.driver_phone!.whatsapp)} style={styles.iconBtn}><MessageCircle size={22} color={colors.ink} strokeWidth={2.4} /></Pressable>
              )}
            </View>
            {task.status === 'in_progress' && (
              <Pressable accessibilityRole="button" onPress={() => router.navigate({ pathname: '/office/(tabs)/live', params: { driver: task.driver ?? '' } })} style={styles.now}>
                <MapPin size={22} color={colors.blue} />
                <Txt variant="body" size={15} style={{ flex: 1 }}>{[task.eta?.next_stop ? t('office.task.nextStop', { place: task.eta.next_stop }) : '', task.eta?.next ? t('office.request.about', { time: task.eta.next }) : '', task.eta?.final ? t('office.task.backAbout', { time: task.eta.final }) : ''].filter(Boolean).join(' · ') || task.status_line || t('office.task.onTheWayNow')}</Txt>
                <Txt variant="strong" size={16} color={colors.blue}>{t('office.home.liveMap')}</Txt>
              </Pressable>
            )}
            {task.vehicle_taken && <Txt variant="small">{task.vehicle_taken}</Txt>}
            {task.vehicle_changed && <Txt variant="small">{task.vehicle_changed}</Txt>}
          </View>
        )}
        {p && stops.length > 0 && (
          <Section title={t('office.task.stops')}>
            <View style={{ gap: 12, paddingTop: 4 }}>
              {task?.start_place && !stops.some((s) => s.is_start) && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={[styles.mark, { backgroundColor: colors.amber }]}><Mono size={14} bold>S</Mono></View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{task.start_place}</Txt>
                    {task.leave_by && <Txt variant="muted" size={15}>{t('office.task.planned', { time: task.leave_by })}{task.started ? ` · ${t('office.task.left', { time: task.started })}` : ''}</Txt>}
                  </View>
                </View>
              )}
              {stops.map((s) => {
                const late = stopLateMin(s);
                const parts = stopParts(s, words);
                return (
                  <View key={s.seq} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={[styles.mark, s.is_start && { backgroundColor: colors.amber }, s.status === 'skipped' && { backgroundColor: colors.muted }]}>
                      <Mono size={14} bold color={s.is_start ? colors.ink : '#ffffff'}>{s.is_start ? 'S' : String(s.n ?? s.seq)}</Mono>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="strong">{s.place || s.address || s.label || ''}</Txt>
                      <Txt variant="muted" size={15}>
                        {parts.join(' · ')}
                        {late > 0 ? <Txt variant="strong" size={15} color={colors.amberText}>{` ${words.late(late)}`}</Txt> : null}
                        {s.is_start && task?.passengers ? ` · ${t('office.task.passengers', { n: task.passengers })}` : ''}
                      </Txt>
                    </View>
                  </View>
                );
              })}
              {task?.return_to_base && task.start_place && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={[styles.mark, { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.ink }]}><Mono size={14} bold>B</Mono></View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{t('office.request.backAt', { place: task.start_place })}</Txt>
                    <Txt variant="muted" size={15}>{[p.timeline?.totals.ends ? t('office.request.about', { time: p.timeline.totals.ends }) : '', task.end_by ? t('office.request.backBy', { time: task.end_by }) : ''].filter(Boolean).join(' · ')}</Txt>
                  </View>
                </View>
              )}
            </View>
            {task?.notes ? <Txt variant="muted" size={15} style={{ marginTop: 8 }}>{t('office.request.notes', { note: task.notes })}</Txt> : null}
          </Section>
        )}
        {task && (task.km != null || task.gps_km != null) && (
          <Txt variant="muted" size={15}>{[task.km != null ? t('office.task.taskKm', { km: task.km }) : '', task.gps_km != null ? t('office.task.gpsKm', { km: task.gps_km }) : ''].filter(Boolean).join(' · ')}</Txt>
        )}
        {task && (actions.reassign || actions.cancel) && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {actions.reassign && <Button kind="outline" label={task.needs_driver ? t('office.home.giveDriver') : t('office.task.reassign')} onPress={() => router.push({ pathname: '/office/task/[id]/driver', params: { id: task.id } })} style={{ flex: 1, minHeight: 56 }} />}
            {actions.cancel && <Button kind="outline" label={t('office.task.cancel')} onPress={() => setCancelling(true)} disabled={busy} style={{ flex: 1, minHeight: 56, borderColor: colors.red }} />}
          </View>
        )}
        {task && (extras.time || extras.stops) && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {extras.time && <Button kind="outline" label={t('office.task.changeTime')} onPress={() => router.push({ pathname: '/office/task/[id]/time', params: { id: task.id } })} disabled={busy} style={{ flex: 1, minHeight: 56 }} />}
            {extras.stops && <Button kind="outline" label={t('office.task.changeStops')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'stops', id: task.id } })} disabled={busy} style={{ flex: 1, minHeight: 56 }} />}
          </View>
        )}
        {task && extras.swap && (
          <Button kind="outline" label={t('office.task.swapVehicle')} onPress={() => router.push({ pathname: '/office/task/[id]/swap', params: { id: task.id } })} disabled={busy} style={{ minHeight: 56 }} />
        )}
        {task && extras.reopen && (
          <View style={styles.card}>
            <Txt variant="strong">{t('office.task.reopenTitle')}</Txt>
            <Txt variant="muted" size={15}>{t('office.task.reopenIntro')}</Txt>
            <Button kind="outline" label={t('office.task.reopen')} onPress={() => setReopening(true)} disabled={busy} style={{ minHeight: 56 }} />
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
        {problem && <ErrorNotice error={problem} onRetry={() => void q.reload()} />}
      </Screen>
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
      {busy && <StickyActions><Loading text={t(reopening || !cancelling ? 'office.task.working' : 'office.task.cancelling')} /></StickyActions>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ebe9e3', borderWidth: 2, borderColor: '#ebe9e3' },
  iconBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  now: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#ebe9e3', borderRadius: 12, padding: 12, minHeight: 56 },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  needs: { backgroundColor: colors.redChip, borderRadius: 12, padding: 12 },
});
