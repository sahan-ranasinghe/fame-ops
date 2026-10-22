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
// Round 4–7 (6): who rides in the chips ("Asha, Kamal +3"); the names go as passenger_list (none with the switch off).
// Round 4–7, item 12 (the approved mockup 2): restyled, nothing removed. The map in a rounded card; "Leave by · Fri 23 Oct"
// with the big time, its note and ⓘ (how it was planned: each leg's source and the rush hour, as before); the facts row
// (distance, driving, back or ends, people); the plan as the route stepper (components/office/PlanStepper.tsx); the
// conflict cards and warnings; the people card (the driver with the plate, "✓ Checked" when today's vehicle check is in,
// Change; who drives with no app; who rides with their avatars and Edit; the projects; the contact; the note); Back and the
// one primary button in the bottom bar.

import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Briefcase, Clock, MessageCircle, Phone, Road, TriangleAlert, Undo2, Users } from '@/components/icons';
import { HolderLine } from '@/components/office/HolderParts';
import { AvatarStack } from '@/components/office/Passengers';
import { PlanInfo, PlanStepper, planWords } from '@/components/office/PlanStepper';
import { RowIcon, RowPlate } from '@/components/patterns/ListRow';
import { look } from '@/components/patterns/look';
import { StatsRow } from '@/components/patterns/StatsRow';
import { TripFooter, TripHeader } from '@/components/office/TripShell';
import { TimeField } from '@/components/patterns/TimeField';
import { TaskMap } from '@/components/TaskMap';
import { Button, Mono, Txt } from '@/components/ui';
import { whatsappLink } from '@/lib/contacts';
import { durationText, shortDate } from '@/lib/durations';
import { colomboDate } from '@/lib/time';
import { phoneLocal } from '@/lib/profile';
import { conflictResource } from '@/office/holderLogic';
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
import { passengersOn, ridersLine } from '@/office/trip/passengersLogic';
import { whoOfDraft } from '@/office/trip/whoWords';
import { legTextT, reasonLines, reasonText } from '@/office/trip/words';
import { planNotes, planRows } from '@/office/stepperRows';
import { sentenceText } from '@/office/statusWords';
import type { BookResult, Conflict, CreateTaskResult, FleetError, SettingsResult, TimelineItem, UpdateRequestResult, VehiclesList } from '@/office/types';
import { Avatar, Divider, ErrorNotice, Loading, Row, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
type SendKind = 'send' | 'book';

export default function TripReview() {
  const { t, tList } = useApp();
  const { me, api } = useOffice();
  const router = useRouter();
  const d = useTripDraft();
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: me.tools.includes('get_settings') });
  // Round 4–7, item 12 (feature 4 on Review): the picked vehicle's check today, for "✓ Checked" beside it.
  const pickedPlate = d?.fields.vehicle && d.fields.vehicle !== ON_THE_DAY && !/^any /.test(d.fields.vehicle) ? d.fields.vehicle : '';
  const vehicleCheck = useTool<VehiclesList>('list_vehicles', { filter: 'all', search: pickedPlate, limit: 5 }, { enabled: !!pickedPlate && me.tools.includes('list_vehicles') });
  const fallback = useMemo(() => ({ mode: 'request' as const, fields: { date: '', leaveBy: '', stops: [], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: '', buffer: '', driver: '', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, req: { behalf: '', project: '', need: '', tools: false, note: '', requesterPhone: '' }, rows: [], step: 'review' as const, at: 0 }), []);
  const trip = useTrip(d ?? fallback, settings.data ?? null);
  const [busy, setBusy] = useState<'' | SendKind>('');
  const lastKind = useRef<SendKind>('send');
  const [problem, setProblem] = useState<FleetError | string | null>(null);
  const mode: TripMode = d?.mode ?? 'request';
  const opensTasks = has(me.permissions, 'assign_tasks');
  const aboveFor = (m: TripMode) => m === 'task' ? t('office.trip.assignAbove', { n: 4 }) : m === 'edit' ? t('office.trip.editAbove') : m === 'stops' ? t('office.trip.stopsAbove') : t('office.trip.newAbove', { n: 4 });

  // Round 4–7 (7): the trip being planned (Ask for it asks for its day and times) and what the conflict is about.
  const tripWanted = () => {
    const leaveAt = trip.preview?.timeline?.items.find((x) => x.kind === 'leave');
    return { date: d?.fields.date, from: leaveAt?.kind === 'leave' ? leaveAt.at : d?.fields.leaveBy, until: trip.preview?.timeline?.totals.ends };
  };
  const conflictWhat = (c: Conflict) => (c.kind === 'driver' ? d?.driverName || d?.fields.driver : d?.fields.vehicle && d.fields.vehicle !== ON_THE_DAY && !/^any /.test(d.fields.vehicle) ? d.fields.vehicle : undefined) || undefined;
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <TriangleAlert size={18} color={colors.red} strokeWidth={2.2} />
          <Txt variant="strong" size={15} color={colors.red} style={{ flex: 1 }}>{sentenceText(t, c.text)}</Txt>
        </View>
        {/* Round 4–7 (7): who holds it (Google Calendar's room booking), with Call, WhatsApp and Ask for it for this trip. */}
        {c.holder && conflictResource(c) ? <HolderLine holder={c.holder} resource={conflictResource(c)!} what={conflictWhat(c)} wanted={tripWanted()} testID={`conflict-holder-${i}`} /> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {a.openTask ? <Button kind="outline" label={t('office.trip.openThatTask')} onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: a.openTask! } })} style={styles.smallBtn} /> : null}
          {reach(c.requester)}
          {reach(c.driver)}
          {picks && mode === 'task' ? <Button kind="dark" label={t(a.pick === 'driver' ? 'office.trip.pickAnotherDriver' : 'office.trip.pickAnotherVehicle')} onPress={() => { updateDraft((x) => ({ ...x, step: 'who' })); router.back(); }} style={styles.smallBtn} /> : null}
        </View>
      </View>
    );
  };

  if (!d) return <View style={{ flex: 1, backgroundColor: colors.page }}><Screen><Loading text={t('office.common.loading')} /></Screen></View>;
  const f = d.fields;
  const p = trip.preview;
  const mapTask = p ? previewTask(p) : null;
  const needsApproval = d.mode === 'task' && !has(me.permissions, 'approve') && settings.data?.settings.tasks_need_approval !== false;
  const books = d.mode === 'request' && me.tools.includes('book_vehicle');
  // Round 3: who drives (self-drive switched off = a driver, whatever an older draft said).
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const who = selfDrive ? whoOfDraft(d.req) : emptyWho();
  // Round 4–7 (6): the passengers switch off: no names are sent (an edit leaves them as they are).
  const riding = passengersOn(settings.data);
  const noNames = riding ? {} : { riders: undefined };
  const noAppTrip = who.by !== 'driver';
  const driverName = noAppTrip ? (who.by === 'other' ? who.name.trim() : me.name) : d.driverName || f.driver;
  const label = d.mode === 'edit' ? (d.wasApproved ? t('office.trip.saveReapproval') : t('office.trip.saveChanges')) : d.mode === 'stops' ? t('office.trip.saveChanges') : d.mode === 'request' ? (books ? t('office.trip.bookNow') : t('office.trip.sendRequest')) : needsApproval ? t('office.trip.sendForApproval') : noAppTrip ? t('office.who.saveTrip') : t('office.trip.sendTo', { name: driverName });

  // The call for this draft, or what is missing (the site's rules).
  const call = (): { tool: string; input: Record<string, unknown> } | { error: string } => {
    if (d.mode === 'task') {
      // The driver's default vehicle from the Who step: known, known to be none (a vehicle must be picked), or not known yet.
      const v = validateAssign({ ...f, vehicle: f.vehicle === ON_THE_DAY ? ON_THE_DAY : f.vehicle, who, ...noNames }, d.rows, me.name, { defaultVehicle: d.book?.defaultVehicle, base: trip.base });
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
    const rf = { ...requestFieldsOf(d), ...(selfDrive ? {} : { who: emptyWho() }), ...noNames };
    if (d.mode === 'edit') {
      // Only what changed since the request was loaded goes (the site's rule, with the version it was shown with).
      // An edit draft saved before the shared rules holds { choice } in was: read it as the draft's own answer is read.
      const was = d.was ? { ...d.was, who: whoOfDraft(d.was) } : rf;
      const v = updateRequestInput(d.requestId ?? '', d.version ?? 0, rf, was, trip.base);
      return 'error' in v ? v : { tool: 'update_request', input: v.input };
    }
    const v = validateNewRequest(rf, trip.base);
    return 'error' in v ? v : { tool: 'create_request', input: v.input };
  };
  const planned = call();
  // Book now (the site's bookInput): the request with its trip plus the pick from the Who step.
  const bookCall = (): { input: Record<string, unknown> } | { error: string } => {
    const rf = { ...requestFieldsOf(d), ...(selfDrive ? {} : { who: emptyWho() }), ...noNames };
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
      setSavedNotice(s.noticeKey, notice, undefined, o.conflicts);
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
  // Round 4–7, item 12 (the approved mockup 2): the plan as the route stepper (S, the stops with their planned times, one meta
  // line each, the legs under them, B back at base), the facts as one row, the explanations behind ⓘ.
  const names = { days: tList('days'), months: tList('months') };
  const backRow = f.returnToBase && totals?.ends && p?.start
    ? { time: totals.ends, place: p.start.name, meta: f.end ? (d.mode === 'task' || d.mode === 'stops' ? `${t('office.trip.freeBy')} ${f.end}` : t('office.request.backBy', { time: f.end })) : undefined }
    : null;
  const rows = p ? planRows(items, { startName: p.start?.name, offset: d.reached ?? 0, back: backRow }, planWords(t)) : [];
  const legLine = (x: Extract<TimelineItem, { kind: 'leg' }>) => [legTextT(t, x, p?.start?.name), x.rush_factor && x.rush_factor !== 1 ? t('office.trip.rushHour', { f: x.rush_factor }) : '', x.via_expressway ? t('office.trip.viaExpressway') : ''].filter(Boolean).join(' · ');
  const people = Math.max(parseInt(f.pax, 10) || 0, riding ? f.riders?.length ?? 0 : 0);
  const plate = f.vehicle && f.vehicle !== ON_THE_DAY && !/^any /.test(f.vehicle) ? f.vehicle : '';
  // Today's vehicle check (feature 4): "✓ Checked" beside the vehicle when the trip is today and the check is in.
  const check = vehicleCheck.data?.vehicles?.find((v) => v.reg_no === plate)?.check_today;
  const toWho = () => { updateDraft((x) => ({ ...x, step: 'who' })); router.back(); };
  const showsDriver = (d.mode === 'task' || books) && !!f.driver && !noAppTrip;
  const projects = d.mode === 'task' ? d.rows.filter((r) => r.project.trim()) : d.req.project ? [{ project: d.req.project, percent: '' }] : [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <TripHeader step="review" mode={d.mode} above={aboveFor(d.mode)} onBack={() => router.back()} />
      <Screen bottom={16} style={{ paddingTop: 4, gap: 12 }}>
        {mapTask && <View style={styles.map}><TaskMap report={false} mapPackage={me.map?.package} task={mapTask} me={null} googleNoteFor="any" /></View>}
        {d.mode === 'edit' && d.wasApproved ? <Txt variant="strong" size={15} color={colors.amberText} testID="reapproval-notice">{t('office.trip.reapprovalNotice')}</Txt> : null}
        {trip.plan.updating && !p && <Loading text={t('office.trip.planning')} />}
        {trip.plan.updating && p && <Txt variant="small" color={colors.blue} testID="plan-updating">{t('office.trip.updatingPlan')}</Txt>}
        {reasons.filter((r) => !r.note).map((r, i) => (
          <View key={i} style={styles.warn} testID="review-warning">
            <TriangleAlert size={18} color={colors.amberText} strokeWidth={2.2} />
            <Txt variant="strong" size={15} color={colors.amberText} style={{ flex: 1 }}>{r.text}</Txt>
          </View>
        ))}
        {/* Round 1 review: Next on When needs only the stops, so a trip with no time at all gets its one time here (the leave
            time; an arrive-by is set on When), never a dead end. */}
        {!d.running && !f.leaveBy.trim() && !hasDeadline(f.stops) && (
          <View style={[styles.card, { gap: 6 }]} testID="review-leave">
            <TimeField label={t('office.request.leaveBy')} value={f.leaveBy} onCommit={trip.setLeave} placeholder={t('office.trip.leaveAuto')} testID="review-leave-by" />
            <Txt variant="small">{t('office.trip.reasonLeave')}</Txt>
          </View>
        )}
        {p && leave && leave.kind === 'leave' && (
          <View style={styles.card} testID="review-leave-card">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="small" size={13}>{[t('office.request.leaveBy'), f.date ? shortDate(names, `${f.date}T06:00:00Z`) : ''].filter(Boolean).join(' · ')}</Txt>
                <Mono size={40} bold style={{ lineHeight: 46 }}>{leave.at}</Mono>
                {note ? <Txt variant="small" testID="leave-note">{[t(note.source === 'plan' ? 'office.trip.leavePlanned' : 'office.trip.leaveTyped'), note.estimate ? t('office.trip.leaveEstimated') : ''].filter(Boolean).join(' · ')}</Txt> : null}
              </View>
              <PlanInfo lines={planNotes(items, null, legLine)} />
            </View>
            {totals && (
              <StatsRow variant="facts" framed={false} testID="review-facts" items={[
                { key: 'km', icon: Road, value: t('office.trip.kmN', { km: Math.round(totals.km) }), label: t('office.ui3.factDistance') },
                { key: 'drive', icon: Clock, value: durationText(t, totals.drive_min), label: t('office.ui3.factDriving') },
                { key: 'ends', icon: Undo2, value: totals.ends, label: t(f.returnToBase ? 'office.ui3.factBack' : 'office.ui3.factEnds') },
                ...(people > 0 ? [{ key: 'people', icon: Users, value: String(people), label: t('office.ui3.factPeople') }] : []),
              ]} />
            )}
          </View>
        )}
        {p && rows.length > 0 && (
          <View style={{ opacity: trip.plan.updating ? 0.75 : 1 }}>
            <PlanStepper rows={rows} testID="review-stepper" />
          </View>
        )}
        {p?.conflicts?.map((c, i) => conflictCard(c, i, true))}
        {reasons.filter((r) => r.note).map((r, i) => <Txt key={`n${i}`} variant="small">{r.text}</Txt>)}
        {(showsDriver || (noAppTrip && (d.mode === 'request' || d.mode === 'task' || d.mode === 'edit')) || people > 0 || projects.length > 0 || f.cname || f.cphone || f.notes || d.req.note) ? (
          <View style={styles.list} testID="review-people">
            {showsDriver && (
              <Row
                inset
                left={<Avatar name={driverName} />}
                title={driverName}
                titleAfter={plate ? <RowPlate regNo={plate} /> : undefined}
                line={[t('office.ui3.driverRole'), !plate && f.vehicle ? (f.vehicle === ON_THE_DAY ? t('office.trip.onTheDay') : f.vehicle) : ''].filter(Boolean).join(' · ')}
                chip={check && f.date === colomboDate() ? { text: check.result === 'problem' ? t('office.ui3.checkProblem') : t('office.ui3.checked'), tone: check.result === 'problem' ? 'red' : 'green' } : null}
                right={d.mode === 'task' ? <LinkText label={t('office.trip.change')} onPress={toWho} testID="review-change-driver" /> : undefined}
                testID="review-driver"
              />
            )}
            {noAppTrip && (d.mode === 'request' || d.mode === 'task' || d.mode === 'edit') ? (
              <Row
                inset
                left={<Avatar name={who.by === 'other' ? who.name.trim() || '?' : me.name} />}
                title={who.by === 'self' ? t('office.who.reviewSelf') : t('office.who.reviewOther', { name: who.name.trim(), phone: phoneLocal(who.phone) })}
                titleAfter={(d.mode === 'task' || books) && plate ? <RowPlate regNo={plate} /> : undefined}
                testID="who-chip"
              />
            ) : null}
            {p?.vehicle_used && (d.mode === 'task' || books) ? <Txt variant="small" style={styles.insetText} testID="vehicle-used">{t('office.trip.vehicleUsedLine', { text: `${p.vehicle_used.reg_no}${p.vehicle_used.why && p.vehicle_used.why !== 'chosen' ? ` · ${p.vehicle_used.why}` : ''}` })}</Txt> : null}
            {people > 0 && (
              <>
                {(showsDriver || noAppTrip) && <Divider soft />}
                <Row
                  inset
                  left={riding && f.riders?.length ? <AvatarStack people={f.riders} /> : <RowIcon icon={Users} tone="quiet" />}
                  title={t('office.task.passengers', { n: people })}
                  line={riding && f.riders?.length ? ridersLine(f.riders.map((r) => r.name), parseInt(f.pax, 10) || null) : t('office.trip.paxN', { n: f.pax })}
                  right={<LinkText label={t('office.trip.edit')} onPress={toWho} testID="review-edit-riders" />}
                  testID="review-riders"
                />
              </>
            )}
            {projects.map((r, i) => (
              <View key={`p${i}`}>
                <Divider soft />
                <Row inset left={<RowIcon icon={Briefcase} tone="quiet" />} title={r.project} line={[t('office.trip.projectLabel'), r.percent !== '' ? `${r.percent}%` : ''].filter(Boolean).join(' · ')} />
              </View>
            ))}
            {(f.cname || f.cphone) && (
              <>
                <Divider soft />
                <Row inset left={<RowIcon icon={Phone} tone="quiet" />} title={t('office.trip.contactChip', { who: [f.cname, f.cphone].filter(Boolean).join(' · ') })} />
              </>
            )}
            {(f.notes || d.req.note) && (
              <>
                <Divider soft />
                <View style={styles.noteRow}>
                  <MessageCircle size={20} color={colors.muted} strokeWidth={2} />
                  <Txt variant="body" size={15} style={{ flex: 1 }}>{f.notes || d.req.note}</Txt>
                </View>
              </>
            )}
          </View>
        ) : null}
        {typeof problem === 'string' ? <Txt variant="strong" size={15} color={colors.red}>{problem}</Txt> : problem ? <ErrorNotice error={problem} onRetry={() => void send(lastKind.current)} /> : null}
      </Screen>
      <TripFooter
        label={label}
        onPress={() => void send(books ? 'book' : 'send')}
        disabled={books ? !booking || 'error' in booking : 'error' in planned}
        busy={busy !== ''}
        problem={books ? (booking && 'error' in booking ? reasonText(t, booking.error) : null) : ('error' in planned ? reasonText(t, planned.error) : null)}
        secondary={books ? { label: t('office.trip.saveWaiting'), onPress: () => void send('send'), disabled: 'error' in planned } : undefined}
        onBack={() => router.back()}
      >
        {needsApproval && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.trip.approvalNote')}</Txt>}
      </TripFooter>
    </View>
  );
}

/** A small blue link at a row's right ("Change", "Edit"), 44 px tall. */
function LinkText({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID={testID}>
      <Txt variant="strong" size={15} color={colors.blue}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: { height: 200, borderRadius: look.radius, overflow: 'hidden', borderWidth: 1, borderColor: look.border, backgroundColor: colors.mapLand },
  card: { backgroundColor: colors.card, borderRadius: look.radius, borderWidth: 1, borderColor: look.border, padding: 16, gap: 14 },
  list: { backgroundColor: colors.card, borderRadius: look.radius, borderWidth: 1, borderColor: look.border, overflow: 'hidden' },
  insetText: { paddingHorizontal: 14, paddingBottom: 10, marginTop: -6 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#fffaf0', borderRadius: 12, borderWidth: 1, borderColor: colors.amberEdge, paddingHorizontal: 14, paddingVertical: 10 },
  conflict: { borderWidth: 1, borderColor: '#f0c4bf', borderRadius: look.radius, padding: 14, gap: 10, backgroundColor: colors.card },
  smallBtn: { minHeight: 44, paddingHorizontal: 12 },
});
