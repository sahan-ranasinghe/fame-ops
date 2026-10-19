// Office mode (Phase 8, O2): the trip editor's step 4, Review (design 09): the plan on the map (the driver app's own task
// map, both engines, Google's line on Google's map only) with the timeline under it (leave, each stop with its times,
// the legs, the totals, "back at <start> HH:MM"), the warnings and conflicts read out, the chips (driver · plate, the
// contact, the notes), then Send request (create_request) / Send to <driver> or Send for approval (create_task) / Save
// changes (update_request with the version). The draft goes once the server took it. A dropped send is never repeated
// by itself: the person sees the sentence and presses again.

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { TaskMap } from '@/components/TaskMap';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { assignOutcome, validateAssign } from '@/office/trip/assignLogic';
import { requestFieldsOf, setDraft, useTripDraft } from '@/office/trip/draft';
import { previewTask } from '@/office/trip/planMap';
import { legText, stopTimes } from '@/office/trip/planLogic';
import { updateRequestInput, validateNewRequest } from '@/office/trip/requestLogic';
import { stopsInput, startInput, hasDeadline } from '@/office/trip/stopsLogic';
import { useTrip } from '@/office/trip/useTrip';
import { ON_THE_DAY } from '@/office/trip/vehicleChoiceLogic';
import { reasonLines, reasonText } from '@/office/trip/words';
import type { CreateTaskResult, FleetError, SettingsResult, UpdateRequestResult } from '@/office/types';
import { ErrorNotice, Loading, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TripReview() {
  const { t } = useApp();
  const { me, api } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const fallback = useMemo(() => ({ mode: 'request' as const, fields: { date: '', leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: true, requesterPhone: '' }, rows: [], step: 'review' as const, at: 0 }), []);
  const trip = useTrip(d ?? fallback, settings.data ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | string | null>(null);
  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;
  const f = d.fields;
  const p = trip.preview;
  const mapTask = p ? previewTask(p) : null;
  const needsApproval = d.mode === 'task' && !has(me.permissions, 'approve') && settings.data?.settings.tasks_need_approval !== false;
  const driverName = f.driver;
  const label = d.mode === 'edit' || d.mode === 'stops' ? t('office.trip.saveChanges') : d.mode === 'request' ? t('office.trip.sendRequest') : needsApproval ? t('office.trip.sendForApproval') : t('office.trip.sendTo', { name: driverName });
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

  async function send() {
    if (busy || 'error' in planned) return;
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<CreateTaskResult & UpdateRequestResult & { next?: string }>(planned.tool, planned.input);
      setDraft(null);
      const warnings = [...(out.warnings ?? []), ...(((out as CreateTaskResult).conflicts ?? []).map((c) => c.text))];
      const title = d!.mode === 'task' ? assignOutcome(out, driverName).head : d!.mode === 'edit' || d!.mode === 'stops' ? t('office.trip.savedTitle') : t('office.trip.requestSentTitle');
      const body = [out.next, ...warnings].filter(Boolean).join('\n');
      Alert.alert(title, body || undefined, [{
        text: t('office.common.ok'),
        onPress: () => {
          router.dismissAll();
          if (d!.mode === 'stops' && d!.taskId) router.replace({ pathname: '/office/task/[id]', params: { id: d!.taskId } });
          else router.replace(d!.mode === 'task' && has(me.permissions, 'assign_tasks') ? '/office/(tabs)/tasks' : has(me.permissions, 'request') ? '/office/(tabs)/trips' : '/office');
        },
      }]);
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  const leave = p?.timeline?.items.find((x) => x.kind === 'leave');
  const totals = p?.timeline?.totals;
  const items = p?.timeline?.items ?? [];
  const reasons = reasonLines(t, trip.reasons);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="review" above={above} onBack={() => router.back()} />
      <Screen bottom={16} style={{ padding: 0, gap: 0 }}>
        {mapTask && <View style={{ height: 300 }}><TaskMap task={mapTask} me={null} googleNoteFor="any" /></View>}
        <View style={{ padding: 16, gap: 14 }}>
          {trip.plan.updating && !p && <Loading text={t('office.trip.planning')} />}
          {reasons.filter((r) => !r.note).map((r, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{r.text}</Txt>)}
          {p && leave && leave.kind === 'leave' && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <Txt variant="label" color={colors.muted}>{t('office.request.leaveBy').toUpperCase()}</Txt>
                <Mono size={34} bold>{leave.at}</Mono>
              </View>
              {totals && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="strong" size={17}>{`${Math.round(totals.km)} km · ${durationText(t, totals.drive_min)}`}</Txt>
                  <Txt variant="small">{t('office.trip.endsAt', { place: p.start?.name ?? '', time: totals.ends })}</Txt>
                </View>
              )}
            </View>
          )}
          {p && items.length > 0 && (
            <View style={{ gap: 10 }}>
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
                if (x.kind === 'leg') return <Txt key={`l${i}`} variant="small" style={{ marginLeft: 66 }}>{[legText(x), x.rush_factor ? t('office.trip.rushHour', { f: x.rush_factor }) : '', x.via_expressway ? t('office.trip.viaExpressway') : ''].filter(Boolean).join(' · ')}</Txt>;
                return null;
              })}
              {f.returnToBase && totals?.ends && p.start && (
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Mono size={16} bold style={{ width: 54 }}>{totals.ends}</Mono>
                  <View style={[styles.mark, { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.ink }]}><Mono size={13} bold>B</Mono></View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{t('office.request.backAt', { place: p.start.name })}</Txt>
                    {f.end ? <Txt variant="muted" size={15}>{t('office.request.backBy', { time: f.end })}</Txt> : null}
                  </View>
                </View>
              )}
            </View>
          )}
          {p?.conflicts?.map((c, i) => <Txt key={`c${i}`} variant="strong" size={15} color={colors.red}>{c.text}</Txt>)}
          {reasons.filter((r) => r.note).map((r, i) => <Txt key={`n${i}`} variant="small">{r.text}</Txt>)}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {d.mode === 'task' && f.driver && (
              <View style={styles.chipRow}>
                <Txt variant="strong" size={15}>{f.driver}</Txt>
                {f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? <Plate regNo={f.vehicle} /> : f.vehicle ? <Txt variant="small">{f.vehicle === ON_THE_DAY ? t('office.trip.onTheDay') : f.vehicle}</Txt> : null}
              </View>
            )}
            {(f.cname || f.cphone) && <Pill text={t('office.trip.contactChip', { who: [f.cname, f.cphone].filter(Boolean).join(' · ') })} tone="muted" size={15} />}
            {(f.notes || d.req.note) && <Pill text={t('office.request.notes', { note: f.notes || d.req.note })} tone="muted" size={15} />}
            {f.pax && <Pill text={`${f.pax} pax`} tone="muted" size={15} />}
          </View>
          {typeof problem === 'string' ? <Txt variant="strong" size={15} color={colors.red}>{problem}</Txt> : problem ? <ErrorNotice error={problem} /> : null}
          {trip.plan.input && !trip.plan.updating && <Button kind="outline" label={t('office.trip.planNow')} onPress={trip.plan.planNow} style={{ minHeight: 48 }} />}
        </View>
      </Screen>
      <TripFooter label={label} onPress={() => void send()} disabled={'error' in planned} busy={busy} problem={'error' in planned ? reasonText(t, planned.error) : null}>
        {needsApproval && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.trip.approvalNote')}</Txt>}
      </TripFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ebe9e3', borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
});
