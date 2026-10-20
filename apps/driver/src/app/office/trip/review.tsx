// Office mode (Phase 8, O2; Hotfix O2-H1 Part B): the trip editor's step 4, Review (design 09): the plan on the map (the
// driver app's own task map, both engines, Google's line on Google's map only), "Leave by HH:MM" with where it came from,
// the timeline (leave, each stop with its times and its arrive-by, the legs with their road time and source, the totals,
// "back at <start>"), "Updating plan…" while a new plan comes, the conflicts as cards (Open that task, Call / WhatsApp,
// Pick another vehicle / driver), the warnings, the vehicle the plan takes and why, the chips (driver · plate, the
// contact, the notes, the passengers), then Send request / Save as waiting + Book now (with book_vehicle) / Send to
// <driver> or Send for approval (create_task) / Save changes (update_request with the version, update_task_stops with
// the plan version). After the server took it: the outcome card (the site's words: sent or waiting, Leave by, the
// vehicle used, the warnings, the conflicts; Open task, The board / My trips, WhatsApp the driver, Done). A dropped send
// is never repeated by itself: the person sees the sentence and presses again.

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { TaskMap } from '@/components/TaskMap';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { validateAssign } from '@/office/trip/assignLogic';
import { requestFieldsOf, setDraft, updateDraft, useTripDraft } from '@/office/trip/draft';
import { bookOutcome, conflictActions, driverMessage, leaveNote, type Outcome, requestOutcome, taskOutcome, whatsappWithText } from '@/office/trip/formsLogic';
import { previewTask } from '@/office/trip/planMap';
import { legText, stopTimes } from '@/office/trip/planLogic';
import { bookInput, updateRequestInput, validateNewRequest } from '@/office/trip/requestLogic';
import { stopsInput, startInput, hasDeadline } from '@/office/trip/stopsLogic';
import { useTrip } from '@/office/trip/useTrip';
import { ON_THE_DAY } from '@/office/trip/vehicleChoiceLogic';
import { reasonLines, reasonText } from '@/office/trip/words';
import type { BookResult, Conflict, CreateTaskResult, FleetError, SettingsResult, UpdateRequestResult } from '@/office/types';
import { ErrorNotice, Loading, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export default function TripReview() {
  const { t } = useApp();
  const { me, api } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const fallback = useMemo(() => ({ mode: 'request' as const, fields: { date: '', leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' }, rows: [], step: 'review' as const, at: 0 }), []);
  const trip = useTrip(d ?? fallback, settings.data ?? null);
  const [busy, setBusy] = useState<'' | 'send' | 'book'>('');
  const [problem, setProblem] = useState<FleetError | string | null>(null);
  const [outcome, setOutcome] = useState<(Outcome & { waLink?: string; waMissing?: boolean; driverName?: string }) | null>(null);
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;
  const f = d.fields;
  const p = trip.preview;
  const mapTask = p ? previewTask(p) : null;
  const needsApproval = d.mode === 'task' && !has(me.permissions, 'approve') && settings.data?.settings.tasks_need_approval !== false;
  const books = d.mode === 'request' && me.tools.includes('book_vehicle');
  const driverName = d.driverName || f.driver;
  const opensTasks = has(me.permissions, 'assign_tasks');
  const label = d.mode === 'edit' || d.mode === 'stops' ? t('office.trip.saveChanges') : d.mode === 'request' ? (books ? t('office.trip.bookNow') : t('office.trip.sendRequest')) : needsApproval ? t('office.trip.sendForApproval') : t('office.trip.sendTo', { name: driverName });
  const above = d.mode === 'task' ? t('office.trip.assignAbove', { n: 4 }) : d.mode === 'edit' ? t('office.trip.editAbove') : d.mode === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 4 });

  // The call for this draft, or what is missing (the site's rules).
  const call = (): { tool: string; input: Record<string, unknown> } | { error: string } => {
    if (d.mode === 'task') {
      const v = validateAssign({ ...f, vehicle: f.vehicle === ON_THE_DAY ? ON_THE_DAY : f.vehicle }, d.rows, me.name, { defaultVehicle: undefined, base: trip.base });
      return 'error' in v ? v : { tool: 'create_task', input: v.input };
    }
    if (d.mode === 'stops') {
      // update_task_stops: the rows after the reached stops, the start, the switches, a leave time typed by hand (the site's TaskStops).
      const s = stopsInput(f.stops, (d.reached ?? 0) + (f.startPax ? 1 : 0));
      if ('error' in s) return s;
      if (!f.leaveBy.trim() && !hasDeadline(f.stops)) return { error: t('office.trip.reasonLeave') };
      const input: Record<string, unknown> = { task_id: d.taskId, plan_version: d.planVersion ?? 0, stops: s.stops, return_to_base: f.returnToBase, avoid_expressway: f.avoidExpressway };
      const start = startInput(f, trip.base);
      if (start) input.start = start;
      if (f.leaveBy.trim()) input.leave_by = f.leaveBy.trim();
      return { tool: 'update_task_stops', input };
    }
    const rf = requestFieldsOf(d);
    if (d.mode === 'edit') {
      // Only what changed since the request was loaded goes (the site's rule, with the version it was shown with).
      const v = updateRequestInput(d.requestId ?? '', d.version ?? 0, rf, d.was ?? rf, trip.base);
      return 'error' in v ? v : { tool: 'update_request', input: v.input };
    }
    const v = validateNewRequest(rf, trip.base);
    return 'error' in v ? v : { tool: 'create_request', input: v.input };
  };
  const planned = call();
  // Book now (the site's bookInput): the request with its trip plus the pick from the Who step.
  const bookCall = (): { input: Record<string, unknown> } | { error: string } => {
    const rf = requestFieldsOf(d);
    const vehicle = f.vehicle === ON_THE_DAY ? ON_THE_DAY : f.vehicle;
    return bookInput(rf, { vehicle, driver: f.driver, hasCustodian: !!d.book?.hasCustodian, defaultVehicle: d.book?.defaultVehicle }, trip.base);
  };
  const booking = books ? bookCall() : null;

  async function send(kind: 'send' | 'book') {
    if (busy) return;
    const chosen = kind === 'book' ? (booking && 'input' in booking ? { tool: 'book_vehicle', input: booking.input } : null) : ('error' in planned ? null : planned);
    if (!chosen) return;
    setBusy(kind);
    setProblem(null);
    try {
      const out = await api.call<CreateTaskResult & UpdateRequestResult & BookResult & { next?: string }>(chosen.tool, chosen.input);
      const o: Outcome = chosen.tool === 'create_task' ? taskOutcome(out)
        : chosen.tool === 'book_vehicle' ? bookOutcome(out)
        : requestOutcome(chosen.tool === 'create_request' ? 'request_sent' : 'saved', out);
      // The driver's WhatsApp message, when asked for and the task went to them (never for a proposed task).
      const wantsWa = chosen.tool === 'create_task' && f.whatsapp && o.kind === 'sent';
      const waLink = wantsWa && d!.driverWhatsapp ? whatsappWithText(d!.driverWhatsapp, driverMessage(chosen.input, o.leaveBy ? t('office.trip.outcomeLeaveBy', { time: o.leaveBy }) : undefined, {
        pickup: t('office.trip.wa_pickup'), drop: t('office.trip.wa_drop'), visit: t('office.trip.wa_visit'), stop: t('office.trip.wa_stop'), contact: t('office.trip.wa_contact'), open: t('office.trip.wa_open'), newTask: t('office.trip.wa_newTask'),
      })) : '';
      setDraft(null);
      setOutcome({ ...o, waLink: waLink || undefined, waMissing: wantsWa && !waLink, driverName });
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy('');
    }
  }

  function leaveTo(path: '/office/(tabs)/tasks' | '/office/(tabs)/trips' | '/office' | { pathname: '/office/task/[id]'; params: { id: string } }) {
    router.dismissAll();
    router.replace(path as never);
  }

  const leave = p?.timeline?.items.find((x) => x.kind === 'leave');
  const totals = p?.timeline?.totals;
  const items = p?.timeline?.items ?? [];
  const reasons = reasonLines(t, trip.reasons);
  const note = leaveNote(p);

  const conflictCard = (c: Conflict, i: number, picks: boolean) => {
    const a = conflictActions(c, opensTasks);
    const reach = (who: Conflict['requester'] | Conflict['driver']) => who && (who.call || who.whatsapp) ? (
      <>
        {who.call ? <Button kind="outline" label={t('office.trip.callName', { name: who.name.split(' ')[0] })} onPress={() => open(who.call!)} style={styles.smallBtn} /> : null}
        {who.whatsapp ? <Button kind="outline" label={t('office.trip.whatsappName', { name: who.name.split(' ')[0] })} onPress={() => open(who.whatsapp!)} style={styles.smallBtn} /> : null}
      </>
    ) : null;
    return (
      <View key={`${c.kind}-${c.task?.id ?? i}`} style={styles.conflict} testID="conflict-card">
        <Txt variant="strong" size={15} color={colors.red}>{c.text}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {a.openTask ? <Button kind="outline" label={t('office.trip.openThatTask')} onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: a.openTask! } })} style={styles.smallBtn} /> : null}
          {reach(c.requester)}
          {reach(c.driver)}
          {picks && d.mode === 'task' ? <Button kind="dark" label={t(a.pick === 'driver' ? 'office.trip.pickAnotherDriver' : 'office.trip.pickAnotherVehicle')} onPress={() => { updateDraft((x) => ({ ...x, step: 'who' })); router.back(); }} style={styles.smallBtn} /> : null}
        </View>
      </View>
    );
  };

  if (outcome) {
    const title = outcome.kind === 'sent' ? t('office.trip.outcomeSent', { name: outcome.driverName ?? '' })
      : outcome.kind === 'waiting' ? t('office.trip.outcomeWaiting')
      : outcome.kind === 'booked' ? t('office.trip.outcomeBooked')
      : outcome.kind === 'request_sent' ? t('office.trip.outcomeRequestSent')
      : t('office.trip.outcomeSaved');
    const bodyLines = [
      outcome.kind === 'waiting' ? t('office.trip.outcomeWaitingBody') : outcome.kind === 'sent' ? t('office.trip.outcomeInApp') : outcome.next ?? '',
      outcome.leaveBy ? t('office.trip.outcomeLeaveBy', { time: outcome.leaveBy }) : '',
      outcome.vehicle ? t('office.trip.vehicleUsedLine', { text: outcome.vehicle }) : '',
    ].filter(Boolean);
    const home = d.mode === 'task' && has(me.permissions, 'assign_tasks') ? '/office/(tabs)/tasks' : has(me.permissions, 'request') ? '/office/(tabs)/trips' : '/office';
    return (
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <TripHeader step="review" mode={d.mode} above={above} onBack={() => leaveTo(home)} />
        <Screen bottom={16}>
          <View style={styles.outcome} testID="outcome-card">
            <Txt variant="heading">{title}</Txt>
            {bodyLines.map((l, i) => <Txt key={i} variant="body" size={16}>{l}</Txt>)}
            {outcome.warnings.length > 0 && (
              <View style={{ gap: 4 }}>
                <Txt variant="label" color={colors.amberText}>{t('office.trip.warningsTitle').toUpperCase()}</Txt>
                {outcome.warnings.map((w, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{w}</Txt>)}
              </View>
            )}
            {outcome.conflicts.map((c, i) => conflictCard(c, i, false))}
            {outcome.waMissing ? <Txt variant="small">{t('office.trip.whatsappNoPhone')}</Txt> : null}
          </View>
          {outcome.taskId && opensTasks && <Button kind="dark" label={t('office.trip.openTask')} onPress={() => leaveTo({ pathname: '/office/task/[id]', params: { id: outcome.taskId! } })} style={{ minHeight: 56 }} />}
          {outcome.waLink ? <Button kind="outline" label={t('office.trip.whatsappDriver')} onPress={() => open(outcome.waLink!)} style={{ minHeight: 56 }} /> : null}
          <Button label={d.mode === 'task' && has(me.permissions, 'assign_tasks') ? t('office.trip.theBoard') : has(me.permissions, 'request') ? t('office.trip.myTrips') : t('office.trip.done')} onPress={() => leaveTo(home)} style={{ minHeight: 56 }} />
        </Screen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="review" mode={d.mode} above={above} onBack={() => router.back()} />
      <Screen bottom={16} style={{ padding: 0, gap: 0 }}>
        {mapTask && <View style={{ height: 300 }}><TaskMap report={false} mapPackage={me.map?.package} task={mapTask} me={null} googleNoteFor="any" /></View>}
        <View style={{ padding: 16, gap: 14 }}>
          {trip.plan.updating && !p && <Loading text={t('office.trip.planning')} />}
          {trip.plan.updating && p && <Txt variant="small" color={colors.blue} testID="plan-updating">{t('office.trip.updatingPlan')}</Txt>}
          {reasons.filter((r) => !r.note).map((r, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{r.text}</Txt>)}
          {p && leave && leave.kind === 'leave' && (
            <View style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <View>
                  <Txt variant="label" color={colors.muted}>{t('office.request.leaveBy').toUpperCase()}</Txt>
                  <Mono size={34} bold>{leave.at}</Mono>
                </View>
                {totals && (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Txt variant="strong" size={17}>{`${t('office.trip.kmN', { km: Math.round(totals.km) })} · ${durationText(t, totals.drive_min)}`}</Txt>
                    <Txt variant="small">{t('office.trip.endsAt', { place: p.start?.name ?? '', time: totals.ends })}</Txt>
                  </View>
                )}
              </View>
              {note ? <Txt variant="small" testID="leave-note">{[t(note.source === 'plan' ? 'office.trip.leavePlanned' : 'office.trip.leaveTyped'), note.estimate ? t('office.trip.leaveEstimated') : ''].filter(Boolean).join(' · ')}</Txt> : null}
            </View>
          )}
          {p && items.length > 0 && (
            <View style={{ gap: 10, opacity: trip.plan.updating ? 0.75 : 1 }}>
              {items.map((x, i) => {
                if (x.kind === 'stop') {
                  const late = x.late_min != null && x.late_min > 0;
                  return (
                    <View key={`s${x.n}`} style={{ flexDirection: 'row', gap: 12 }}>
                      <Mono size={16} bold style={{ width: 54 }}>{x.planned_arrive}</Mono>
                      <View style={[styles.mark, x.is_start && { backgroundColor: colors.amber }]}><Mono size={13} bold color={x.is_start ? colors.ink : '#ffffff'}>{x.is_start ? 'S' : String(x.n)}</Mono></View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Txt variant="strong">{x.place}</Txt>
                          {x.arrive_by && <Pill text={late ? t('office.task.minLate', { min: x.late_min ?? 0 }) : t('office.trip.onTime')} tone={late ? 'red' : 'blue'} size={13} />}
                        </View>
                        <Txt variant="muted" size={15}>{stopTimes(x)}{x.arrive_by ? ` · ${t('office.request.arriveBy', { time: x.arrive_by })}` : ''}</Txt>
                      </View>
                    </View>
                  );
                }
                if (x.kind === 'leg') return <Txt key={`l${i}`} variant="small" style={{ marginLeft: 66 }}>{[legText(x), x.rush_factor && x.rush_factor !== 1 ? t('office.trip.rushHour', { f: x.rush_factor }) : '', x.via_expressway ? t('office.trip.viaExpressway') : ''].filter(Boolean).join(' · ')}</Txt>;
                return null;
              })}
              {f.returnToBase && totals?.ends && p.start && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Mono size={16} bold style={{ width: 54 }}>{totals.ends}</Mono>
                  <View style={[styles.mark, { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.ink }]}><Mono size={13} bold>B</Mono></View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{t('office.request.backAt', { place: p.start.name })}</Txt>
                    {f.end ? <Txt variant="muted" size={15}>{t(d.mode === 'task' ? 'office.trip.freeBy' : 'office.request.backBy', { time: f.end })}{d.mode === 'task' ? ` ${f.end}` : ''}</Txt> : null}
                  </View>
                </View>
              )}
            </View>
          )}
          {p?.warnings?.map((w, i) => <Txt key={`w${i}`} variant="strong" size={15} color={colors.amberText}>{w}</Txt>)}
          {p?.conflicts?.map((c, i) => conflictCard(c, i, true))}
          {reasons.filter((r) => r.note).map((r, i) => <Txt key={`n${i}`} variant="small">{r.text}</Txt>)}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(d.mode === 'task' || books) && f.driver && (
              <View style={styles.chipRow}>
                <Txt variant="strong" size={15}>{driverName}</Txt>
                {f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? <Plate regNo={f.vehicle} /> : f.vehicle ? <Txt variant="small">{f.vehicle === ON_THE_DAY ? t('office.trip.onTheDay') : f.vehicle}</Txt> : null}
              </View>
            )}
            {(f.cname || f.cphone) && <Pill text={t('office.trip.contactChip', { who: [f.cname, f.cphone].filter(Boolean).join(' · ') })} tone="muted" size={15} />}
            {(f.notes || d.req.note) && <Pill text={t('office.request.notes', { note: f.notes || d.req.note })} tone="muted" size={15} />}
            {f.pax && <Pill text={t('office.trip.paxN', { n: f.pax })} tone="muted" size={15} />}
          </View>
          {p?.vehicle_used && (d.mode === 'task' || books) ? <Txt variant="small" testID="vehicle-used">{t('office.trip.vehicleUsedLine', { text: `${p.vehicle_used.reg_no}${p.vehicle_used.why && p.vehicle_used.why !== 'chosen' ? ` · ${p.vehicle_used.why}` : ''}` })}</Txt> : null}
          {typeof problem === 'string' ? <Txt variant="strong" size={15} color={colors.red}>{problem}</Txt> : problem ? <ErrorNotice error={problem} onRetry={() => void send(busy === 'book' ? 'book' : 'send')} /> : null}
          {trip.plan.input && !trip.plan.updating && <Button kind="outline" label={t('office.trip.planNow')} onPress={trip.plan.planNow} style={{ minHeight: 48 }} />}
        </View>
      </Screen>
      <TripFooter
        label={label}
        onPress={() => void send(books ? 'book' : 'send')}
        disabled={books ? !booking || 'error' in booking : 'error' in planned}
        busy={busy !== ''}
        problem={books ? (booking && 'error' in booking ? reasonText(t, booking.error) : null) : ('error' in planned ? reasonText(t, planned.error) : null)}
        secondary={books ? { label: t('office.trip.saveWaiting'), onPress: () => void send('send'), disabled: 'error' in planned } : undefined}
      >
        {needsApproval && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.trip.approvalNote')}</Txt>}
      </TripFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ebe9e3', borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
  conflict: { borderWidth: 1.5, borderColor: colors.red, borderRadius: 14, padding: 12, gap: 10, backgroundColor: colors.card },
  smallBtn: { minHeight: 44, paddingHorizontal: 12 },
  outcome: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
});
