// Office mode (Phase 8, O2; Hotfix O2-H1 Part B): the trip editor's step 4, Review (design 09): the plan on the map (the
// driver app's own task map, both engines, Google's line on Google's map only), "Leave by HH:MM" with where it came from,
// the timeline (leave, each stop with its times and its arrive-by, the legs with their road time and source, the totals,
// "back at <start>"), "Updating plan…" while a new plan comes, the conflicts as cards (Open that task, Call / WhatsApp,
// Pick another vehicle / driver), the warnings, the vehicle the plan takes and why, the chips (driver · plate, the
// contact, the notes, the passengers), then Send request / Save as waiting + Book now (with book_vehicle) / Send to
// <driver> or Send for approval (create_task) / Save changes (update_request with the version, update_task_stops with
// the plan version). After the server took it (Hotfix O2-H2, Part 1b; Gmail's "Sent"): the form closes, the new or
// changed item opens (office/trip/successLogic.ts), a snackbar says what happened (WhatsApp the driver as its action when
// asked for) and the warnings and conflicts wait on the screen landed on (SavedNotice). A dropped send is never repeated by
// itself: the person sees the sentence and presses again, and Try again sends the same call (a booking stays a booking).
// Round 3: who drives shows in the chips ("You drive it yourself", "Kamal Silva · someone else · 077…"); with no app
// the task's button is "Save trip" and Book now needs the plate (the reason under the button until there is one).
// Part B pilot (docs/design-pass.md §5 a): Leave by · distance · driving · back as the StatsRow, the plan as the
// RouteStepper (S, the stops, B, the legs between), the reapproval, the plan's reasons and the conflicts as StatusBanners,
// a skeleton while the first plan comes.

import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { SkeletonRows } from '@/components/patterns/ListState';
import { RouteStepper } from '@/components/patterns/RouteStepper';
import { StatsRow } from '@/components/patterns/StatsRow';
import { StatusBanner } from '@/components/patterns/StatusBanner';
import { TimeField } from '@/components/patterns/TimeField';
import { TaskMap } from '@/components/TaskMap';
import { Button, Plate, Txt } from '@/components/ui';
import { whatsappLink } from '@/lib/contacts';
import { durationText } from '@/lib/durations';
import { phoneLocal } from '@/lib/profile';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { validateAssign } from '@/office/trip/assignLogic';
import { requestFieldsOf, setDraft, type TripMode, updateDraft, useTripDraft } from '@/office/trip/draft';
import { bookOutcome, conflictActions, driverMessage, leaveNote, type Outcome, requestOutcome, taskOutcome, whatsappWithText } from '@/office/trip/formsLogic';
import { requestIdOf, successOf } from '@/office/trip/successLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { previewTask } from '@/office/trip/planMap';
import { bookInput, updateRequestInput, validateNewRequest } from '@/office/trip/requestLogic';
import { stopsInput, startInput, hasDeadline } from '@/office/trip/stopsLogic';
import { useTrip } from '@/office/trip/useTrip';
import { ON_THE_DAY } from '@/office/trip/vehicleChoiceLogic';
import { emptyWho } from '@/office/trip/whoDrivesLogic';
import { whoOfDraft } from '@/office/trip/whoWords';
import { planSteps } from '@/office/stepsLogic';
import { reasonLines, reasonText } from '@/office/trip/words';
import { sentenceText } from '@/office/statusWords';
import type { BookResult, Conflict, CreateTaskResult, FleetError, SettingsResult, UpdateRequestResult } from '@/office/types';
import { ErrorNotice, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
type SendKind = 'send' | 'book';

export default function TripReview() {
  const { t } = useApp();
  const { me, api } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  const fallback = useMemo(() => ({ mode: 'request' as const, fields: { date: '', leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', requesterPhone: '' }, rows: [], step: 'review' as const, at: 0 }), []);
  const trip = useTrip(d ?? fallback, settings.data ?? null);
  const [busy, setBusy] = useState<'' | SendKind>('');
  const lastKind = useRef<SendKind>('send');
  const [problem, setProblem] = useState<FleetError | string | null>(null);
  const mode: TripMode = d?.mode ?? 'request';
  const opensTasks = has(me.permissions, 'assign_tasks');
  const aboveFor = (m: TripMode) => m === 'task' ? t('office.trip.assignAbove', { n: 4 }) : m === 'edit' ? t('office.trip.editAbove') : m === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 4 });

  const conflictCard = (c: Conflict, i: number, picks: boolean) => {
    const a = conflictActions(c, opensTasks);
    const reach = (who: Conflict['requester'] | Conflict['driver']) => who && (who.call || who.whatsapp) ? (
      <>
        {who.call ? <Button kind="outline" label={t('office.trip.callName', { name: who.name.split(' ')[0] })} onPress={() => open(who.call!)} style={styles.smallBtn} /> : null}
        {who.whatsapp ? <Button kind="outline" label={t('office.trip.whatsappName', { name: who.name.split(' ')[0] })} onPress={() => open(who.whatsapp!)} style={styles.smallBtn} /> : null}
      </>
    ) : null;
    return (
      <StatusBanner key={`${c.kind}-${c.task?.id ?? i}`} tone="red" title={sentenceText(t, c.text)} testID="conflict-card">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          {a.openTask ? <Button kind="outline" label={t('office.trip.openThatTask')} onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: a.openTask! } })} style={styles.smallBtn} /> : null}
          {reach(c.requester)}
          {reach(c.driver)}
          {picks && mode === 'task' ? <Button kind="dark" label={t(a.pick === 'driver' ? 'office.trip.pickAnotherDriver' : 'office.trip.pickAnotherVehicle')} onPress={() => { updateDraft((x) => ({ ...x, step: 'who' })); router.back(); }} style={styles.smallBtn} /> : null}
        </View>
      </StatusBanner>
    );
  };

  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }} accessibilityLabel={t('office.common.loading')}><Screen><SkeletonRows rows={4} lines={2} /></Screen></View>;
  const f = d.fields;
  const p = trip.preview;
  const mapTask = p ? previewTask(p) : null;
  const needsApproval = d.mode === 'task' && !has(me.permissions, 'approve') && settings.data?.settings.tasks_need_approval !== false;
  const books = d.mode === 'request' && me.tools.includes('book_vehicle');
  // Round 3: who drives (self-drive switched off = a driver, whatever an older draft said).
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const who = selfDrive ? whoOfDraft(d.req) : emptyWho();
  const noAppTrip = who.by !== 'driver';
  const driverName = noAppTrip ? (who.by === 'other' ? who.name.trim() : me.name) : d.driverName || f.driver;
  const label = d.mode === 'edit' ? (d.wasApproved ? t('office.trip.saveReapproval') : t('office.trip.saveChanges')) : d.mode === 'stops' ? t('office.trip.saveChanges') : d.mode === 'request' ? (books ? t('office.trip.bookNow') : t('office.trip.sendRequest')) : needsApproval ? t('office.trip.sendForApproval') : noAppTrip ? t('office.who.saveTrip') : t('office.trip.sendTo', { name: driverName });

  // The call for this draft, or what is missing (the site's rules).
  const call = (): { tool: string; input: Record<string, unknown> } | { error: string } => {
    if (d.mode === 'task') {
      // The driver's default vehicle from the Who step: known, known to be none (a vehicle must be picked), or not known yet.
      const v = validateAssign({ ...f, vehicle: f.vehicle === ON_THE_DAY ? ON_THE_DAY : f.vehicle, who }, d.rows, me.name, { defaultVehicle: d.book?.defaultVehicle, base: trip.base });
      return 'error' in v ? v : { tool: 'create_task', input: v.input };
    }
    if (d.mode === 'stops') {
      // update_task_stops: the rows after the reached stops, the start, the switches, a leave time typed by hand (the site's TaskStops).
      const s = stopsInput(f.stops, (d.reached ?? 0) + (f.startPax ? 1 : 0));
      if ('error' in s) return s;
      if (!d.running && !f.leaveBy.trim() && !hasDeadline(f.stops)) return { error: t('office.trip.reasonLeave') };
      const input: Record<string, unknown> = { task_id: d.taskId, plan_version: d.planVersion ?? 0, stops: s.stops, return_to_base: f.returnToBase, avoid_expressway: f.avoidExpressway };
      const start = startInput(f, trip.base);
      if (start) input.start = start;
      if (!d.running && f.leaveBy.trim()) input.leave_by = f.leaveBy.trim();
      return { tool: 'update_task_stops', input };
    }
    const rf = { ...requestFieldsOf(d), ...(selfDrive ? {} : { who: emptyWho() }) };
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
    const rf = { ...requestFieldsOf(d), ...(selfDrive ? {} : { who: emptyWho() }) };
    const vehicle = f.vehicle === ON_THE_DAY ? ON_THE_DAY : f.vehicle;
    return bookInput(rf, { vehicle, driver: f.driver, defaultVehicle: d.book?.defaultVehicle }, trip.base);
  };
  const booking = books ? bookCall() : null;

  async function send(kind: SendKind) {
    if (busy) return;
    const chosen = kind === 'book' ? (booking && 'input' in booking ? { tool: 'book_vehicle', input: booking.input } : null) : ('error' in planned ? null : planned);
    if (!chosen) return;
    lastKind.current = kind;
    setBusy(kind);
    setProblem(null);
    try {
      const out = await api.call<CreateTaskResult & UpdateRequestResult & BookResult & { next?: string }>(chosen.tool, chosen.input);
      const o: Outcome = chosen.tool === 'create_task' ? taskOutcome(out)
        : chosen.tool === 'book_vehicle' ? bookOutcome(out)
        : requestOutcome(chosen.tool === 'create_request' ? 'request_sent' : 'saved', out);
      // The driver's WhatsApp message, when asked for and the task went to them (never for a proposed task).
      const wantsWa = chosen.tool === 'create_task' && f.whatsapp && o.kind === 'sent' && who.by !== 'self';
      // Someone else drives: their own number (Round 3).
      const waBase = who.by === 'other' ? whatsappLink(who.phone) ?? undefined : d!.driverWhatsapp;
      const waLink = wantsWa && waBase ? whatsappWithText(waBase, driverMessage(chosen.input, o.leaveBy ? t('office.trip.outcomeLeaveBy', { time: o.leaveBy }) : undefined, {
        pickup: t('office.trip.wa_pickup'), drop: t('office.trip.wa_drop'), visit: t('office.trip.wa_visit'), stop: t('office.trip.wa_stop'), contact: t('office.trip.wa_contact'), open: t('office.trip.wa_open'), newTask: t('office.trip.wa_newTask'),
      })) : '';
      // Hotfix O2-H2, Part 1b (Gmail "Sent", Google Calendar "Event saved"): the form closes, the new or changed item opens,
      // a snackbar says what happened, the warnings wait on the screen landed on; then the draft goes (nothing under the
      // new screen reads it any more).
      const s = successOf(
        { ...o, mode: d!.mode, requestId: o.requestId ?? requestIdOf(out), taskId: o.taskId ?? (d!.mode === 'stops' ? d!.taskId : undefined) },
        { openTasks: opensTasks, openRequests: has(me.permissions, 'approve'), request: has(me.permissions, 'request') },
      );
      const notice = [...s.notice, ...(wantsWa && !waLink ? [t('office.trip.whatsappNoPhone')] : [])];
      setSavedNotice(s.noticeKey, notice);
      // Change stops was opened from the task: back to that same screen (and what was under it). A new trip or an edited
      // request: the editor's steps go and the item opens on the tab the person was on.
      if (d!.mode === 'stops' && s.target.kind === 'task') {
        router.dismissTo({ pathname: '/office/task/[id]', params: { id: s.target.id } });
      } else {
        if (router.canDismiss()) router.dismissAll();
        if (s.target.kind === 'task') router.push({ pathname: '/office/task/[id]', params: { id: s.target.id } });
        else if (s.target.kind === 'request') router.push({ pathname: '/office/request/[id]', params: { id: s.target.id } });
        else router.navigate(s.target.path as never);
      }
      showSnackbar({
        // Round 3: nothing is sent to an app when the person drives it themselves or someone else does.
        text: t(`office.saved.${noAppTrip && s.snack === 'taskAssigned' ? 'taskNoApp' : s.snack}`, { name: driverName }),
        ...(waLink ? { action: { label: t('office.saved.whatsapp'), onPress: () => open(waLink) } } : {}),
      });
      setDraft(null);
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy('');
    }
  }

  const leave = p?.timeline?.items.find((x) => x.kind === 'leave');
  const totals = p?.timeline?.totals;
  const items = p?.timeline?.items ?? [];
  const reasons = reasonLines(t, trip.reasons);
  const note = leaveNote(p);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="review" mode={d.mode} above={aboveFor(d.mode)} onBack={() => router.back()} />
      <Screen bottom={16} style={{ padding: 0, gap: 0 }}>
        {mapTask && <View style={{ height: 300 }}><TaskMap report={false} mapPackage={me.map?.package} task={mapTask} me={null} googleNoteFor="any" /></View>}
        <View style={{ padding: 16, gap: 14 }}>
          {d.mode === 'edit' && d.wasApproved ? <StatusBanner tone="amber" title={t('office.trip.reapprovalNotice')} testID="reapproval-notice" /> : null}
          {trip.plan.updating && !p && <View accessibilityLabel={t('office.trip.planning')}><SkeletonRows rows={3} lines={2} /></View>}
          {trip.plan.updating && p && <Txt variant="small" color={colors.blue} testID="plan-updating">{t('office.trip.updatingPlan')}</Txt>}
          {(() => {
            const blocking = reasons.filter((r) => !r.note);
            return blocking.length ? (
              <StatusBanner tone="amber" title={blocking[0].text} testID="plan-reasons">
                {blocking.slice(1).map((r, i) => <Txt key={i} variant="body" size={15}>{r.text}</Txt>)}
              </StatusBanner>
            ) : null;
          })()}
          {/* Round 1 review: Next on When needs only the stops, so a trip with no time at all gets its one time here (the leave
              time; an arrive-by is set on When), never a dead end. */}
          {!d.running && !f.leaveBy.trim() && !hasDeadline(f.stops) && (
            <View style={{ gap: 6 }} testID="review-leave">
              <TimeField label={t('office.request.leaveBy')} value={f.leaveBy} onCommit={trip.setLeave} placeholder={t('office.trip.leaveAuto')} testID="review-leave-by" />
              <Txt variant="small">{t('office.trip.reasonLeave')}</Txt>
            </View>
          )}
          {p && leave && leave.kind === 'leave' && (
            <View style={{ gap: 6 }}>
              <StatsRow
                testID="review-stats"
                cells={[
                  { key: 'leave', label: t('office.request.leaveBy'), value: leave.at },
                  ...(totals ? [
                    { key: 'km', label: t('office.trip.distance'), value: t('office.trip.kmN', { km: Math.round(totals.km) }) },
                    { key: 'drive', label: t('office.trip.driving'), value: durationText(t, totals.drive_min), words: true },
                    { key: 'ends', label: f.returnToBase ? t('office.trip.backAtShort') : t('office.trip.endsShort'), value: totals.ends },
                  ] : []),
                ]}
              />
              {note ? <Txt variant="small" testID="leave-note">{[t(note.source === 'plan' ? 'office.trip.leavePlanned' : 'office.trip.leaveTyped'), note.estimate ? t('office.trip.leaveEstimated') : ''].filter(Boolean).join(' · ')}</Txt> : null}
            </View>
          )}
          {p && items.length > 0 && (
            <View style={{ opacity: trip.plan.updating ? 0.75 : 1 }}>
              <RouteStepper
                testID="review-steps"
                steps={planSteps(t, items, {
                  reached: d.reached,
                  startName: p.start?.name,
                  back: f.returnToBase && totals?.ends && p.start
                    ? { place: p.start.name, time: totals.ends, line: f.end ? (d.mode === 'task' || d.mode === 'stops' ? `${t('office.trip.freeBy')} ${f.end}` : t('office.request.backBy', { time: f.end })) : undefined }
                    : undefined,
                })}
              />
            </View>
          )}
          {p?.conflicts?.map((c, i) => conflictCard(c, i, true))}
          {reasons.filter((r) => r.note).map((r, i) => <Txt key={`n${i}`} variant="small">{r.text}</Txt>)}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(d.mode === 'task' || books) && f.driver && !noAppTrip && (
              <View style={styles.chipRow}>
                <Txt variant="strong" size={15}>{driverName}</Txt>
                {f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? <Plate regNo={f.vehicle} /> : f.vehicle ? <Txt variant="small">{f.vehicle === ON_THE_DAY ? t('office.trip.onTheDay') : f.vehicle}</Txt> : null}
              </View>
            )}
            {noAppTrip && (d.mode === 'request' || d.mode === 'task' || d.mode === 'edit') ? (
              <View style={styles.chipRow} testID="who-chip">
                <Txt variant="strong" size={15}>{who.by === 'self' ? t('office.who.reviewSelf') : t('office.who.reviewOther', { name: who.name.trim(), phone: phoneLocal(who.phone) })}</Txt>
                {(d.mode === 'task' || books) && f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? <Plate regNo={f.vehicle} /> : null}
              </View>
            ) : null}
            {(f.cname || f.cphone) && <Pill text={t('office.trip.contactChip', { who: [f.cname, f.cphone].filter(Boolean).join(' · ') })} tone="muted" size={15} />}
            {(f.notes || d.req.note) && <Pill text={t('office.request.notes', { note: f.notes || d.req.note })} tone="muted" size={15} />}
            {f.pax && <Pill text={t('office.trip.paxN', { n: f.pax })} tone="muted" size={15} />}
          </View>
          {p?.vehicle_used && (d.mode === 'task' || books) ? <Txt variant="small" testID="vehicle-used">{t('office.trip.vehicleUsedLine', { text: `${p.vehicle_used.reg_no}${p.vehicle_used.why && p.vehicle_used.why !== 'chosen' ? ` · ${p.vehicle_used.why}` : ''}` })}</Txt> : null}
          {typeof problem === 'string' ? <Txt variant="strong" size={15} color={colors.red}>{problem}</Txt> : problem ? <ErrorNotice error={problem} onRetry={() => void send(lastKind.current)} /> : null}
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
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ebe9e3', borderRadius: 999, paddingHorizontal: 12, minHeight: 40 },
  smallBtn: { minHeight: 44, paddingHorizontal: 12 },
});
