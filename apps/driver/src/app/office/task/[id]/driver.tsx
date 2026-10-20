// Office mode (Phase 8, O1): Needs a driver / Give it a driver (design 11, Hotfix 4's rule): the task on top (task_detail:
// the day, leave by, passengers and vehicle, the stops, who asked and who approved, Open task →), Who can take it below
// (availability at the task's time: the best match picked first, never the driver who declined; a tap picks another),
// and "Give to <driver> · <plate>" through reassign_task; Cancel task… with a reason through cancel_task. Back means back.
// Not in O1 and not shown: Move the time, Ask drivers.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Check, Phone } from '@/components/icons';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText, shortDate } from '@/lib/durations';
import { driverParts, driverPill, rankedDrivers } from '@/office/approveLogic';
import { askTargets } from '@/office/askLogic';
import { useOffice, useTool } from '@/office/state';
import { availabilityArgsForTask, CANCEL_TEXT, cancelInput, declinedThisTask, firstPickForTask, leaveIn, plateOf, reassignInput } from '@/office/taskLogic';
import type { Availability, FleetError, TaskDetail } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, BackHeader, Divider, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type CancelReasonKey = 'not_needed' | 'plans_changed' | 'no_vehicle' | 'other';
const CANCEL_REASONS: { value: CancelReasonKey; label: string }[] = [
  { value: 'not_needed', label: 'office.task.cancelNotNeeded' },
  { value: 'plans_changed', label: 'office.task.cancelPlansChanged' },
  { value: 'no_vehicle', label: 'office.task.cancelNoVehicle' },
  { value: 'other', label: 'office.task.cancelOther' },
];

export default function GiveDriverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tList } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id });
  const p = q.data;
  const task = p?.task;
  const availArgs = p ? availabilityArgsForTask(p) : null;
  const avail = useTool<Availability>('availability', availArgs ?? {}, { enabled: !!availArgs, every: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<'give' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Ask drivers (design 13, O2): the sheet beside Who can take it, only for someone who may ask.
  const [asking, setAsking] = useState(false);
  const mayAsk = me.tools.includes('ask_drivers');
  const done = useRef(false);
  const names = { days: tList('days'), months: tList('months') };

  const pick = picked ?? (task ? firstPickForTask(task, avail.data ?? null) : '');
  const drivers = avail.data ? rankedDrivers(avail.data.drivers) : [];
  const pickedDriver = drivers.find((d) => d.username === pick);
  const bestUsername = avail.data?.best?.username ?? drivers.find((d) => d.name === avail.data?.best?.name)?.username ?? '';
  const refresh = useCallback(() => {
    void Promise.all([q.reload(), avail.reload()]);
  }, [q, avail]);

  async function give() {
    if (!task || !pickedDriver?.username || busy || done.current) return;
    setBusy('give');
    setProblem(null);
    try {
      const out = await api.call<{ warnings?: string[]; was?: string }>('reassign_task', reassignInput(task.id, pickedDriver));
      done.current = true;
      Alert.alert(t('office.give.givenTitle', { name: pickedDriver.name }), out.warnings?.length ? out.warnings.join('\n') : undefined, [
        { text: t('office.common.ok'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/office')) },
      ]);
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(null);
    }
  }

  async function cancel(label: string, note: string) {
    if (!task || busy || done.current) return;
    setBusy('cancel');
    setProblem(null);
    try {
      await api.call('cancel_task', cancelInput(task.id, label, note));
      done.current = true;
      Alert.alert(t('office.task.cancelledTitle'), undefined, [{ text: t('office.common.ok'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/office')) }]);
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(null);
    }
  }

  const leave = task ? leaveIn(task.date, task.leave_by ?? task.time, Date.now()) : null;
  const stops = (p?.stops ?? []).filter((s) => s.status !== 'removed');
  const over = task && (task.status === 'completed' || task.status === 'cancelled' || task.status === 'in_progress');
  const mayGive = me.tools.includes('reassign_task');
  const mayCancel = me.tools.includes('cancel_task');

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        title={task?.title ?? t('office.give.title')}
        subtitle={task ? [task.needs_driver ? t('office.home.needsDriver') : t('office.task.reassign'), leave ? t(leave.key === 'leavesIn' ? 'office.give.leavesIn' : 'office.give.passed', { dur: durationText(t, leave.minutes) }) : ''].filter(Boolean).join(' · ') : undefined}
      />
      <Screen refreshing={q.refreshing} onRefresh={refresh} bottom={16}>
        {!p && !q.error && <SkeletonRows rows={2} lines={2} />}
        {q.error && <ListFailed stale={!!p} error={q.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {task && (
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {task.needs_driver && (
              <Pill
                text={task.needs_driver.reason === 'declined' ? t('office.give.declinedLine', { name: task.driver ?? '', why: task.needs_driver.reason_text ?? '', at: task.needs_driver.since }) : t('office.give.notAcceptedLine', { name: task.driver ?? '' })}
                tone="red"
                size={15}
              />
            )}
            {!task.needs_driver && task.driver && <Pill text={t('office.give.nowWith', { name: task.driver })} tone="muted" size={15} />}
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: task.id } })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Txt variant="strong" size={16} color={colors.amberText}>{t('office.common.openTask')}</Txt>
            </Pressable>
          </View>
        )}
        {task && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="label" color={colors.muted}>{(task.date ? shortDate(names, `${task.date}T06:00:00Z`) : task.start).toUpperCase()}</Txt>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Txt variant="heading" size={26}>{t('office.request.leaveBy')}</Txt>
                  <Mono size={26} bold>{(task.leave_by ?? task.time ?? task.start).match(/\d{2}:\d{2}/)?.[0] ?? ''}</Mono>
                </View>
              </View>
              {(task.passengers || task.vehicle_text || task.vehicle) && (
                <Pill text={[task.passengers ? `${task.passengers} pax` : '', task.vehicle ? plateOf(task.vehicle) : task.vehicle_text ?? ''].filter(Boolean).join(' · ')} tone="muted" />
              )}
            </View>
            <View style={{ gap: 12 }}>
              {task.start_place && !stops.some((s) => s.is_start) && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={[styles.mark, { backgroundColor: colors.amber }]}><Mono size={14} bold>S</Mono></View>
                  <View style={{ flex: 1 }}><Txt variant="strong">{task.start_place}</Txt></View>
                </View>
              )}
              {stops.map((s) => (
                <View key={s.seq} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={[styles.mark, s.is_start && { backgroundColor: colors.amber }]}>
                    <Mono size={14} bold color={s.is_start ? colors.ink : '#ffffff'}>{s.is_start ? 'S' : String(s.n ?? s.seq)}</Mono>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{s.place || s.address || s.label || ''}</Txt>
                    <Txt variant="muted" size={15}>
                      {[
                        s.is_start && s.what === 'people' ? t('office.request.passengersHere') : '',
                        s.arrive_by ? t('office.request.arriveBy', { time: s.arrive_by }) : s.planned_arrive ? t('office.request.about', { time: s.planned_arrive }) : '',
                        s.dwell_min && !s.is_start ? t('office.request.there', { dur: durationText(t, s.dwell_min) }) : '',
                      ].filter(Boolean).join(' · ')}
                    </Txt>
                  </View>
                </View>
              ))}
            </View>
            {(p?.from_request || task.approved_by) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={p?.from_request?.requested_by ?? task.approved_by?.name ?? ''} />
                <Txt variant="body" size={15} style={{ flex: 1 }}>
                  {[p?.from_request ? t('office.task.askedBy', { name: p.from_request.requested_by }) : '', task.approved_by ? t('office.request.approvedBy', { name: task.approved_by.name, at: task.approved_by.at }) : ''].filter(Boolean).join(' · ')}
                </Txt>
                {task.contact?.call && (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.call')} onPress={() => void Linking.openURL(task.contact!.call!)} style={styles.iconBtn}><Phone size={22} color={colors.ink} strokeWidth={2.4} /></Pressable>
                )}
              </View>
            )}
          </View>
        )}
        {task && over && <ErrorNotice error={{ code: 'tool_error', message: t('office.give.over') }} />}
        {task && !over && (
          <Section
            title={t('office.give.whoCanTakeIt')}
            count={avail.data?.counts.free}
            link={mayAsk && drivers.length > 0 ? t('office.ask.open') : undefined}
            onLink={mayAsk && drivers.length > 0 ? () => setAsking(true) : undefined}
          >
            {!availArgs && <ListEmpty text={t('office.request.noTime')} />}
            {availArgs && !avail.data && !avail.error && <SkeletonRows rows={3} lines={2} />}
            {avail.error && <ListFailed stale={!!avail.data} error={avail.error} onRetry={refresh} onSignIn={() => void signOut()} />}
            {avail.data && drivers.length === 0 && <ListEmpty text={t('office.request.nobody')} />}
            {drivers.map((d, i) => {
              const on = !!d.username && d.username === pick;
              const declined = declinedThisTask(task, d);
              const pillKey = declined ? 'declined' : driverPill(d, bestUsername);
              return (
                <View key={d.username ?? d.name}>
                  {i > 0 && <Divider />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    disabled={!d.username || declined}
                    onPress={() => setPicked(d.username ?? '')}
                    style={({ pressed }) => [styles.driverRow, on && styles.driverOn, pressed && { opacity: 0.8 }, declined && { opacity: 0.6 }]}
                  >
                    <Avatar name={d.name} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Txt variant="strong" size={17}>{d.name}</Txt>
                        {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
                      </View>
                      <Txt variant="muted" size={15}>{declined ? t('office.give.declinedThis', { why: task.needs_driver?.reason_text ?? '' }) : driverParts(d).join(' · ')}</Txt>
                      {d.vehicle && !declined && <View style={{ marginTop: 4 }}><Plate regNo={d.vehicle.reg_no} /></View>}
                    </View>
                    {on ? <Check size={26} color={colors.blue} strokeWidth={3} /> : pillKey && pillKey !== 'best' ? <Pill text={t(`office.give.${pillKey}`)} tone={pillKey === 'declined' || pillKey === 'not_available' ? 'red' : pillKey === 'busy' ? 'blue' : 'muted'} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </Section>
        )}
        {problem && <ErrorNotice error={problem} onRetry={refresh} />}
      </Screen>
      {task && !over && (
        <StickyActions>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Button
              label={pickedDriver ? t('office.give.giveTo', { name: pickedDriver.name, plate: pickedDriver.vehicle?.reg_no ?? '' }).replace(/\s·\s*$/, '') : t('office.give.pickDriver')}
              onPress={() => void give()}
              disabled={!pickedDriver || !mayGive || busy === 'cancel'}
              busy={busy === 'give'}
              style={{ flex: 1 }}
            />
          </View>
          {mayCancel && <Button kind="outline" label={t('office.task.cancel')} onPress={() => setCancelling(true)} disabled={busy !== null} style={{ borderColor: colors.red, minHeight: 56 }} />}
        </StickyActions>
      )}
      {mayAsk && task && !over && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargets(drivers)}
          context={{
            date: task.date,
            from: (task.leave_by ?? task.time ?? task.start).match(/\d{2}:\d{2}/)?.[0],
            to: task.end_by?.match(/\d{2}:\d{2}/)?.[0],
            note: stops.find((s) => !s.is_start)?.place ?? stops[0]?.place,
            task_id: task.id,
          }}
          onUse={(username) => setPicked(username)}
        />
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  iconBtn: { width: 52, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', minHeight: 64 },
  driverOn: { borderColor: colors.blue, backgroundColor: '#f2f5fb' },
});
