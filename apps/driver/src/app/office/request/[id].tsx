// Office mode (Phase 8, O1): Approve a request (design 10). The request as list_requests answers it (with "Palitha is also
// looking" from reviewing, said every 20 s while the page is open), the trip card (the plan's stops with their times, the
// totals, Call the requester when their number is known), Who's available (availability at the request's time: the best
// match picked first, a tap picks another; the vehicle fills itself from the driver), then Approve · send to <driver> and
// Decline… with a reason. The decision goes through decide_request (a waiting request) or redecide_request with the
// version it was shown with (a changed booking); "already decided by …" is the server's refusal, shown and the card read
// again. Stage 1 (O3 row 1): Change time (request/[id]/time: another day, leave-by, back-by, the start, the minutes at
// From / To; Who's available is asked at the new time; only what changed is sent, a line with Undo shows it), and after a
// decision the page stays (Tell requester: the WhatsApp text, the requester's phone), the snackbar says what happened and
// the warnings wait in the shared notice (Hotfix O2-H2).
// O3 row 2: the timeline (request_events) for everyone who may open it; Cancel booking with a reason for an approver on
// an approved or changed request (cancel_request: the task is cancelled too); the person who asked (no approve) opens
// their own request from My trips: the trip, the timeline, Edit and Withdraw while it waits, no decision buttons.
// Round 3 (docs/phase8-plan.md §30): the asker's photo beside "Asked by"; Who drives as asked, in words ("Nimali drives it
// herself", "Someone else: Kamal Silva · 077 123 4567", "The vehicle's custodian drives"). Such a request starts with no
// driver picked: the approver picks the vehicle (the server refuses an approval with neither a driver nor a vehicle) and
// may still give a driver instead (two pick-one rows: as asked · give a driver). The drivers are the driver-first cards
// (components/office/DriverRows.tsx: the photo, the vehicle chip under the name); the button is disabled with the reason
// under it until the approval is complete.
// Round 4–7, item 12 (the approved mockup 3): restyled, nothing removed. The thin top bar ("Request · Fri 23 Oct" over the
// route), ONE status banner (waiting for your OK amber with the leave time and when it was asked; approved / declined /
// cancelled with who and when), the requester with Call and WhatsApp, the facts row, the trip as the route stepper, the
// note, who drives, who rides, the best match first with "Choose another" opening the rest in place, the timeline; Decline,
// Approve and ⋯ (Change time, Ask drivers, Cancel booking of a changed booking) in the bottom bar; Cancel booking of an
// approved one, and the asker's Edit and Withdraw, in the bottom bar too.
// Round 3 Part A: a self-drive request says the asker's licence on the trip's day (A5: "Self-drive · licence on file ✓" /
// "no licence on file" / "licence expired", amber for the last two, never a block); an expired request (A6) has its badge
// with the icon, the line "Expired · nobody decided it in time" and, for the person who asked, Request again.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { CalendarX, Check, Clock, type LucideIcon, MessageCircle, Phone, Road, RotateCcw, Undo2, Users, X } from '@/components/icons';
import { PlanStepper, planWords } from '@/components/office/PlanStepper';
import { BarMore, BarRow, barButton, barDanger } from '@/components/patterns/BottomActionBar';
import { look } from '@/components/patterns/look';
import { Sheet } from '@/components/patterns/Sheet';
import { StatsRow } from '@/components/patterns/StatsRow';
import { BannerLine, StatusBanner } from '@/components/patterns/StatusBanner';
import { RoundButton } from '@/components/patterns/TopBar';
import { whatsappLink } from '@/lib/contacts';
import { planRows, requestRows } from '@/office/stepperRows';
import { type BannerIcon, requestBanner } from '@/office/detailBanner';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ChoiceRow } from '@/components/patterns/Select';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { DriverChoiceRow, TaskDriverCard } from '@/components/office/DriverRows';
import { ConflictCard, HolderStrip } from '@/components/office/HolderParts';
import { VehicleGroups } from '@/components/office/VehicleGroups';
import { SavedNotice } from '@/components/office/SavedNotice';
import { TellRequester } from '@/components/office/TellRequester';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Txt } from '@/components/ui';
import { dateWords } from '@/lib/dateWords';
import { durationText, shortDate } from '@/lib/durations';
import { colomboDate } from '@/lib/time';
import { selfDriveLine } from '@/office/licenceLogic';
import { requestAgainDraft, setDraft } from '@/office/trip/draft';
import { telLink } from '@/lib/format';
import { alreadyDecided, approveProblem, availabilityArgs, DECLINE_TEXT, decideCall, declineReason, driverParts, driverPill, firstPick, presenceLine, rankedDrivers, tripView } from '@/office/approveLogic';
import { askTargets } from '@/office/askLogic';
import { askedOf, availabilityAt, decideTimes, hasChange, redecideTimes, shownOf } from '@/office/decideLogic';
import { CANCEL_TEXT, canCancelBooking, cancelReason, canRequestAgain, canWithdrawOwn, decides, eventLine, expiredText, isExpired } from '@/office/requestsLogic';
import { canEdit as canEditTrip } from '@/office/tripsLogic';
import { decideStore, useTimeChange } from '@/office/decideStore';
import { requestTitle } from '@/office/homeLogic';
import { holderOf, wantedOfWindow } from '@/office/holderLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { useOffice, useTool } from '@/office/state';
import { sentenceText } from '@/office/statusWords';
import { groupRows } from '@/office/trip/formsLogic';
import { askedKey, asksNoDriver } from '@/office/trip/whoWords';
import type { Availability, DecideResult, FleetError, RedecideResult, RequestCard, RequestsList, SettingsResult } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, BackHeader, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { PassengerRows } from '@/components/office/Passengers';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { whenWords } from '@/lib/dateWords';

const REVIEWING_EVERY_MS = 20_000;

type DeclineReasonKey = 'no_vehicle' | 'not_approved' | 'other';
const DECLINE_REASONS: { value: DeclineReasonKey; label: string }[] = [
  { value: 'no_vehicle', label: 'office.request.declineNoVehicle' },
  { value: 'not_approved', label: 'office.request.declineNotApproved' },
  { value: 'other', label: 'office.request.declineOther' },
];

export default function ApproveRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<RequestsList>('list_requests', { status: 'all', id, limit: 1 });
  const card: RequestCard | null = q.data?.requests[0] ?? null;
  // The approver decides; the person who asked reads their own request (O3 row 2).
  const decider = decides(me.permissions);
  const open = decider && (card?.status === 'waiting' || card?.status === 'changed');
  // Change time (O3 row 1): the approver's new day and times, held for this request until decided or undone.
  const change = useTimeChange(id);
  // A change left without a decision is gone when the page closes (never a surprise on the next open).
  useEffect(() => () => decideStore.set(id, null), [id]);
  const asked = card ? askedOf(card) : null;
  const shown = asked ? shownOf(change, asked) : null;
  const changed = !!asked && hasChange(change, asked);
  const availArgs = card && shown ? availabilityAt(availabilityArgs(card), shown) : null;
  const avail = useTool<Availability>('availability', availArgs ?? {}, { enabled: !!availArgs && !!open, every: 60_000 });
  const settings = useTool<SettingsResult>('get_settings', {}, { enabled: !!open && me.tools.includes('get_settings') });
  const onDay = settings.data?.settings.vehicle_on_the_day === true;

  const [picked, setPicked] = useState<string | null>(null);
  // Round 3: a request that asks for no driver (the asker drives, someone else does, the custodian): approved as asked with
  // the vehicle the approver picks, or the approver gives a driver instead.
  const noDriverAsked = !!card && asksNoDriver(card);
  const [giveDriver, setGiveDriver] = useState(false);
  // Self-drive switched off since it was asked: it can only go with a driver (the server refuses it as asked).
  const selfDriveOff = settings.data?.settings.self_drive_allowed === false;
  const asAsked = noDriverAsked && !giveDriver && !selfDriveOff;
  const [vehiclePick, setVehiclePick] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [declining, setDeclining] = useState(false);
  // After a decision the page stays with Tell requester (the card is read again); the decision buttons go.
  const [outcome, setOutcome] = useState<{ title: string; warnings: string[] } | null>(null);
  // Cancel booking (an approver) or Withdraw (the person who asked): one reason sheet, cancel_request.
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [lastCancel, setLastCancel] = useState<string | null>(null);
  async function cancel(reason: string) {
    if (!card || cancelBusy) return;
    setCancelBusy(true);
    setProblem(null);
    setLastCancel(reason);
    try {
      const out = await api.call<{ note?: string; task_cancelled?: string }>('cancel_request', { request_id: card.id, reason });
      setLastCancel(null);
      const done = decider ? t('office.requests.cancelledTitle') : t('office.requests.withdrawnTitle');
      const notes = [out.task_cancelled, out.note].filter((x): x is string => !!x);
      setOutcome({ title: done, warnings: notes });
      setSavedNotice(`request:${id}`, notes);
      showSnackbar({ text: done });
      void q.reload();
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setCancelBusy(false);
    }
  }
  // Ask drivers (design 13, O2): the sheet beside Who's available, only for someone who may ask.
  const [asking, setAsking] = useState(false);
  const mayAsk = me.tools.includes('ask_drivers');
  const names = { days: tList('days'), months: tList('months') };

  // The first pick once the card and Who's available are known: the proposal's driver, else the best match; nobody for a
  // request that asks for no driver (the best match once the approver gives a driver instead).
  const pick = asAsked ? '' : picked ?? (card ? firstPick(noDriverAsked ? { proposed: card.proposed } : card, avail.data ?? null) : '');
  // The vehicle for a request approved as asked with no driver: the one picked, else a proposed task's own.
  const vehicle = vehiclePick ?? (card?.kind === 'task' ? card.proposed?.vehicle ?? '' : '');

  // "Palitha is also looking": said every 20 s while a decision is still to be made (a keyed write: never harmful twice).
  useEffect(() => {
    if (!open || !me.tools.includes('reviewing')) return;
    let alive = true;
    const ping = () => {
      api.call<{ reviewing?: { name: string }[] }>('reviewing', { request_id: id }).then((r) => {
        if (alive) setOthers((r.reviewing ?? []).map((x) => x.name));
      }, () => undefined);
    };
    ping();
    const timer = setInterval(ping, REVIEWING_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, id, open, me.tools]);

  const refresh = useCallback(() => {
    void Promise.all([q.reload(), avail.reload()]);
  }, [q, avail]);

  const decidedOnce = useRef(false);
  async function decide(decision: 'approve' | 'decline', reason?: string) {
    if (!card || busy || decidedOnce.current) return;
    setBusy(decision);
    setProblem(null);
    const driver = avail.data?.drivers.find((d) => d.username === pick);
    const call = decideCall(card, decision, asAsked
      ? { vehicle: vehiclePick ?? undefined, reason }
      : { driver: pick || undefined, vehicle: driver?.vehicle?.reg_no, reason });
    // The new time, only what differs from the request (a changed booking: the day and times as a change).
    if (decision === 'approve' && asked && changed) {
      if (call.tool === 'decide_request') call.input = { ...call.input, ...decideTimes(change, asked) };
      else if (Object.keys(redecideTimes(change, asked)).length) call.input = { ...call.input, decision: 'change', ...redecideTimes(change, asked) };
    }
    try {
      const out = await api.call<DecideResult | RedecideResult>(call.tool, call.input);
      decidedOnce.current = true;
      decideStore.set(id, null);
      const warnings = [...(out.warnings ?? []), ...((out as DecideResult).conflicts ?? []).map((c) => c.text)];
      const title = decision === 'approve'
        ? (asAsked ? t('office.request.approvedTitle', { name: askedName ?? vehicle }) : t('office.request.approvedTitle', { name: driver?.name ?? pick }))
        : t('office.request.declinedTitle');
      // Hotfix O2-H2, Part 1b, merged with O3's Tell requester: the page stays on the decided request (telling the
      // requester is the next job), the snackbar says what happened (with View when the approval made a task this person
      // may open), and the warnings wait on the request in the shared notice.
      const taskId = (out as DecideResult).task_id ?? (out as RedecideResult).task?.task_id;
      const view = decision === 'approve' && taskId && me.tools.includes('task_detail') ? taskId : null;
      setOutcome({ title, warnings });
      // Round 4–7 (7): the conflicts that name who holds the driver or vehicle wait as cards (Call, WhatsApp, Ask for it).
      setSavedNotice(`request:${id}`, warnings, undefined, (out as DecideResult).conflicts);
      showSnackbar(view
        ? { text: title, action: { label: t('office.saved.view'), onPress: () => router.push({ pathname: '/office/task/[id]', params: { id: view } }) } }
        : { text: title });
      void q.reload();
    } catch (e) {
      const error = e as FleetError;
      setProblem(error);
      // Decided by someone else, or edited since the page opened (the version): the card again, with who did what.
      if (error.code === 'tool_error' || alreadyDecided(error)) void q.reload();
    } finally {
      setBusy(null);
    }
  }

  const trip = card ? tripView(card, {
    passengersHere: t('office.request.passengersHere'),
    arriveBy: (x) => t('office.request.arriveBy', { time: x }),
    there: (min) => t('office.request.there', { dur: durationText(t, min) }),
    leave: (x) => t('office.request.leaveAt', { time: x }),
    about: (x) => t('office.request.about', { time: x }),
    backBy: (x) => t('office.request.backBy', { time: x }),
    backAt: (place) => t('office.request.backAt', { place }),
  }) : null;
  const callLink = card?.requester_phone ? telLink(card.requester_phone) : null;
  const drivers = avail.data ? rankedDrivers(avail.data.drivers) : [];
  const pickedDriver = drivers.find((d) => d.username === pick);
  const bestUsername = avail.data?.best?.username ?? drivers.find((d) => d.name === avail.data?.best?.name)?.username ?? '';
  const whoAsked = card ? askedKey(card) : null;
  const selfLicence = card ? selfDriveLine(card) : null;
  // Request again (Round 3, A6; Airbnb's and Uber's "Book again"): the copy in place, then the trip editor at Where.
  const requestAgain = () => {
    if (!card) return;
    setDraft(requestAgainDraft(card, colomboDate()));
    router.push({ pathname: '/office/trip/where', params: { mode: 'request', again: card.id } });
  };
  // The name in "Approved · <name>" when approved as asked: the asker, someone else, or the vehicle.
  const askedName = card?.driven_by === 'other' ? card.driver_name : card?.driven_by === 'self' ? card.requested_by : undefined;
  const approveReason = card ? approveProblem(card, { asAsked, driver: pick, vehicle }) : null;
  // The vehicles for an approval as asked: the free ones first (availability's groups); the custodian drives only one of
  // their own (a vehicle assigned to someone).
  const vehicleRows = groupRows(avail.data ? { groups: avail.data.vehicles.groups, vehicles: [] } : null)
    .map((g) => ({ ...g, rows: card?.driven_by === 'custodian' || (card && !card.driven_by && card.driver_required === false) ? g.rows.filter((v) => !!v.assigned_to) : g.rows }))
    .filter((g) => g.rows.length > 0);

  // Round 4–7, item 12 (the approved mockup 3): one status banner, the requester with Call / WhatsApp, the facts row, the trip
  // as the route stepper, who drives and who rides, the best match (the rest one tap away), and Decline · Approve · ⋯ in the
  // bottom bar (Change time and Ask drivers under ⋯).
  const banner = card ? requestBanner(isExpired(card) ? { status: 'expired' } : card, open, decider) : null;
  const planned = card?.trip?.timeline?.items.length ? card.trip.timeline : null;
  const backAt = card?.trip?.return_to_base && card.trip.start
    ? { time: planned?.totals.ends, place: card.trip.start.name, meta: (card.fields?.back_by ?? card.back_by) ? t('office.request.backBy', { time: (card.fields?.back_by ?? card.back_by) as string }) : undefined }
    : null;
  const stepRows = card && planned ? planRows(planned.items, { startName: card.trip?.start?.name, back: backAt }, planWords(t)) : trip ? requestRows(trip.rows) : [];
  const pax = card ? Math.max(card.fields?.pax ?? 0, card.passengers_list?.length ?? 0) : 0;
  const waLink = card?.requester_phone ? whatsappLink(card.requester_phone) : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const [allDrivers, setAllDrivers] = useState(false);
  const shownDrivers = allDrivers || !pick ? drivers : drivers.filter((d) => d.username === pick);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        above={card ? [card.kind === 'task' ? t('office.request.proposedTask') : t('office.request.request'), trip?.date ? shortDate(names, `${trip.date}T06:00:00Z`) : ''].filter(Boolean).join(' · ') : undefined}
        title={card ? requestTitle(card) : t('office.request.title')}
      />
      <Screen refreshing={q.refreshing} onRefresh={refresh} bottom={16} style={{ paddingTop: 4, gap: 12 }}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        <SavedNotice noticeKey={`request:${id}`} />
        {q.data && !card && <ListEmpty text={t('office.request.notFound')} />}
        {card && banner && (
          <StatusBanner
            tone={banner.tone}
            icon={BANNER_ICON[banner.icon]}
            title={banner.title === 'waiting' ? cap(t('office.request.waitingYourOk')) : banner.title === 'changed' ? cap(t('office.request.changedByRequester')) : t(`office.requests.status_${card.status}`)}
            line={(
              <BannerLine tone={banner.tone} testID="request-banner-line">
                {open || card.status === 'waiting'
                  ? [trip?.leaveBy ? t('office.ui3.leaves', { time: trip.leaveBy }) : whenWords(t, card.when), whenWords(t, card.asked)].filter(Boolean).join(' · ')
                  : card.approved_by ? t('office.request.approvedBy', { name: card.approved_by.name, at: card.approved_by.at })
                  : card.declined_by ? t('office.request.declinedBy', { name: card.declined_by.name, at: card.declined_by.at, reason: card.declined_by.reason ?? card.decline_reason ?? '' })
                  : card.cancelled_by ? t('office.request.cancelledBy', { name: card.cancelled_by?.name ?? '', at: card.cancelled_by?.at ?? '', reason: card.cancelled_by?.reason ?? card.cancel_reason ?? '' })
                  : whenWords(t, card.when)}
              </BannerLine>
            )}
            testID="request-banner"
          />
        )}
        {card && (others.length > 0 || card.late) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {others.length > 0 && <Pill text={t('office.request.alsoLooking', { name: others.join(', ') })} tone="muted" size={14} />}
            {card.late && <Pill text={t('office.approve.late')} tone="red" size={14} />}
          </View>
        )}
        {/* Round 3 (A6): nobody decided it before its day was over; the person who asked may request it again. */}
        {card && isExpired(card) && (
          <View style={styles.card}>
            <Txt variant="strong" testID="request-expired-line">{expiredText(card, t, (at) => dateWords(t, at))}</Txt>
            {canRequestAgain(card, me.tools, !decider || card.requested_by === me.name) && (
              <Button kind="outline" icon={RotateCcw} label={t('office.requests.requestAgain')} onPress={requestAgain} style={{ minHeight: 52, marginTop: 10 }} testID="request-again" />
            )}
          </View>
        )}
        {card && (
          <View style={[styles.card, styles.asker]} testID="request-asker">
            <Avatar name={card.requested_by} size={40} photo={card.requested_by_photo_url} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="strong" size={16} numberOfLines={1}>{card.requested_by}</Txt>
              <Txt variant="small" numberOfLines={2}>{[card.need ? t('office.request.needs', { need: card.need }) : '', card.project ?? '', card.on_behalf_of ? t('office.request.onBehalfOf', { name: card.on_behalf_of }) : ''].filter(Boolean).join(' · ') || t('office.task.askedBy', { name: card.requested_by })}</Txt>
            </View>
            {callLink ? <RoundButton icon={<Phone size={20} color={colors.blue} strokeWidth={2} />} label={t('office.request.callRequester', { name: card.requested_by })} onPress={() => void Linking.openURL(callLink)} testID="request-call" /> : null}
            {waLink ? <RoundButton icon={<MessageCircle size={20} color={colors.green} strokeWidth={2} />} label={`${t('office.common.whatsapp')} ${card.requested_by}`} onPress={() => void Linking.openURL(waLink)} testID="request-whatsapp" /> : null}
          </View>
        )}
        {card && trip?.totals && (
          <StatsRow variant="facts" testID="request-facts" items={[
            { key: 'km', icon: Road, value: `${trip.totals.km} km`, label: t('office.ui3.factDistance') },
            { key: 'drive', icon: Clock, value: durationText(t, trip.totals.driveMin), label: t('office.ui3.factDriving') },
            ...(trip.totals.ends ? [{ key: 'ends', icon: Undo2, value: trip.totals.ends, label: t(card.trip?.return_to_base ? 'office.ui3.factBack' : 'office.ui3.factEnds') }] : []),
            ...(pax > 0 ? [{ key: 'people', icon: Users, value: String(pax), label: t('office.ui3.factPeople') }] : []),
          ]} />
        )}
        {card && !trip?.totals && trip?.leaveBy && (
          <View style={styles.card}>
            <Txt variant="small" size={13}>{t('office.request.leaveBy')}</Txt>
            <Mono size={28} bold>{trip.leaveBy}</Mono>
          </View>
        )}
        {card && stepRows.length > 0 && <PlanStepper rows={stepRows} testID="request-stepper" />}
        {card && (card.note || card.proposed?.notes) ? (
          <View style={[styles.card, styles.noteRow]} testID="request-note">
            <MessageCircle size={20} color={colors.muted} strokeWidth={2} />
            <Txt variant="body" size={15} style={{ flex: 1 }}>{[card.note, card.proposed?.notes].filter(Boolean).join(' · ')}</Txt>
          </View>
        ) : null}
        {card && open && !outcome && shown && changed && (
          <View style={styles.changed} testID="decide-changed">
            <Txt variant="strong" size={15} style={{ flex: 1 }} color={colors.blue}>
              {t('office.decide.newTime', { day: shortDate(names, `${shown.date}T06:00:00Z`), leave: shown.leaveBy || '—', back: shown.back || '—' })}
            </Txt>
            <Pressable accessibilityRole="button" onPress={() => decideStore.set(id, null)} style={{ minHeight: 44, justifyContent: 'center' }} testID="decide-undo">
              <Txt variant="strong" size={15} color={colors.blue}>{t('office.decide.undo')}</Txt>
            </Pressable>
          </View>
        )}
        {card && decider && (outcome || !open) && <TellRequester key={`${card.id}-${card.version ?? 0}-${card.status}`} q={card} onSaved={() => void q.reload()} />}
        {/* Round 4–7 (7): the proposal's conflicts as cards, with who holds the driver or vehicle (Ask for it for this trip). */}
        {card && open && !outcome && decider && (card.proposed?.conflicts?.length ?? 0) > 0 && (
          <View style={{ gap: 8 }} testID="approve-conflicts">
            {card.proposed!.conflicts!.map((c, i) => (
              <ConflictCard key={`${c.kind}-${c.task?.id ?? i}`} c={c} wanted={{ date: trip?.date, from: trip?.leaveBy }} what={c.kind === 'driver' ? card.proposed?.driver : card.proposed?.vehicle} testID={`approve-conflict-${i}`} />
            ))}
          </View>
        )}
        {card && (whoAsked || card.assigned) && (
          <Section look="list" title={t('office.who.title')}>
            <View style={styles.inner}>
              {whoAsked && <Txt variant="strong" testID="request-who-asked">{t(whoAsked.key, whoAsked.vars)}</Txt>}
              {/* Round 3 (A5, Zipcar for Business): the asker's driving licence on the trip's day; amber when missing or
                  expired, never a block. */}
              {selfLicence && <Txt variant="strong" size={15} color={selfLicence.warn ? colors.amberText : colors.green} style={{ marginTop: 4 }} testID="request-self-licence">{t(selfLicence.key)}</Txt>}
              {/* Round 3: the outcome, once approved: who drives (the driver, the asker, someone else), the vehicle, Call / WhatsApp. */}
              {card.assigned && (
                <View style={{ marginTop: whoAsked ? 10 : 0 }} testID="request-assigned">
                  <TaskDriverCard
                    name={card.assigned.driver || undefined}
                    photo={card.assigned.photo_url}
                    drivenBy={card.assigned.driven_by}
                    plate={card.assigned.vehicle || undefined}
                    vehicleText={card.assigned.vehicle_text}
                    details={card.assigned.make_model}
                    call={card.assigned.call ?? undefined}
                    whatsapp={card.assigned.whatsapp ?? undefined}
                    emptyName={t('office.task.noDriver')}
                  />
                </View>
              )}
              {whoAsked && open && !outcome && selfDriveOff && <Txt variant="small" color={colors.amberText} style={{ marginTop: 6 }} testID="approve-self-drive-off">{t('office.who.selfDriveOff')}</Txt>}
              {whoAsked && open && !outcome && !selfDriveOff && (
                <View accessibilityRole="radiogroup" style={{ gap: 8, marginTop: 10 }}>
                  <ChoiceRow selected={!giveDriver} onPress={() => setGiveDriver(false)} accessibilityLabel={t('office.who.approveAsAsked')} testID="approve-as-asked">
                    <Txt variant="strong" size={16}>{t('office.who.approveAsAsked')}</Txt>
                    <Txt variant="small">{t('office.who.approveAsAskedHint')}</Txt>
                  </ChoiceRow>
                  <ChoiceRow selected={giveDriver} onPress={() => setGiveDriver(true)} accessibilityLabel={t('office.who.giveDriverInstead')} testID="approve-give-driver">
                    <Txt variant="strong" size={16}>{t('office.who.giveDriverInstead')}</Txt>
                  </ChoiceRow>
                </View>
              )}
            </View>
          </Section>
        )}
        {/* Round 4–7 (6): who rides by name (a registered person with their photo; someone without an account with Call / WhatsApp). */}
        {card?.passengers_list?.length ? (
          <Section look="list" title={t('office.passengers.title')} count={card.passengers_list.length}>
            <View style={styles.inner}>
              <PassengerRows list={card.passengers_list} />
            </View>
          </Section>
        ) : null}
        {card && open && !outcome && asAsked && (
          <Section look="list" title={t('office.trip.vehicle')}>
            <View style={styles.inner}>
              {card.kind === 'task' && card.proposed?.vehicle ? <Txt variant="small">{t('office.who.proposedVehicle', { plate: card.proposed.vehicle })}</Txt> : <Txt variant="small">{t('office.who.plateNeeded')}</Txt>}
              {!availArgs && <ListEmpty text={t('office.request.noTime')} />}
              {availArgs && !avail.data && !avail.error && <SkeletonRows rows={3} lines={2} />}
              {avail.error && <ListFailed stale={!!avail.data} error={avail.error} onRetry={refresh} onSignIn={() => void signOut()} />}
              {avail.data && <VehicleGroups rows={vehicleRows} picked={vehicle} onPick={setVehiclePick} empty={t('office.trip.noFreeVehicles')} testID="approve-vehicles" wanted={wantedOfWindow(avail.data.window)} ignoreTask={card.task_id ?? undefined} />}
            </View>
          </Section>
        )}
        {card && open && !outcome && !asAsked && (
          <Section
            look="list"
            title={pick && !allDrivers && pick === bestUsername ? cap(t('office.request.bestMatch')) : t('office.request.whosAvailable')}
            count={avail.data ? avail.data.counts.free : undefined}
            link={mayAsk && drivers.length > 0 ? t('office.ask.open') : undefined}
            onLink={mayAsk && drivers.length > 0 ? () => setAsking(true) : undefined}
          >
            <View style={styles.inner}>
              {!availArgs && <ListEmpty text={t('office.request.noTime')} />}
              {availArgs && !avail.data && !avail.error && <SkeletonRows rows={3} lines={2} />}
              {avail.error && <ListFailed stale={!!avail.data} error={avail.error} onRetry={refresh} onSignIn={() => void signOut()} />}
              {avail.data && drivers.length === 0 && <ListEmpty text={t('office.request.nobody')} />}
              <View style={{ gap: 8 }}>
                {shownDrivers.map((d) => {
                  const pillKey = driverPill(d, bestUsername);
                  // Round 4–7 (7): a busy driver's holder under the row, with Ask for it for this request's time.
                  const holder = holderOf(d);
                  return (
                    <View key={d.username ?? d.name} style={{ gap: 2 }}>
                      <DriverChoiceRow
                        d={d}
                        card={false}
                        selected={d.username === pick && !!d.username}
                        onPress={() => setPicked(d.username ?? '')}
                        onDay={onDay}
                        lines={driverParts(d, t)}
                        best={pillKey === 'best'}
                        bestWhy={avail.data?.best?.why ? sentenceText(t, avail.data.best.why) : undefined}
                        pill={pillKey && pillKey !== 'best' ? { text: t(`office.request.${pillKey}`), tone: pillKey === 'not_available' ? 'red' : 'muted' } : null}
                        disabled={!d.username}
                        disabledReason={d.username ? undefined : t('office.ask.noAccount')}
                        presence={presenceLine(d, t)}
                        testID={`approve-row-${d.username ?? d.name}`}
                      />
                      {holder && !d.free && holder.task_id !== card.task_id ? <HolderStrip holder={holder} resource="driver" what={d.name} wanted={wantedOfWindow(avail.data?.window)} testID={`approve-holder-${d.username ?? d.name}`} /> : null}
                    </View>
                  );
                })}
              </View>
              {/* The best match first (the approved mockup 3); every other driver one tap away, in place. */}
              {!allDrivers && pick && drivers.length > shownDrivers.length && (
                <Pressable accessibilityRole="button" onPress={() => setAllDrivers(true)} style={styles.chooseAnother} testID="choose-another">
                  <Txt variant="strong" size={15} color={colors.blue}>{t('office.ui3.chooseAnother', { n: drivers.length - shownDrivers.length })}</Txt>
                </Pressable>
              )}
            </View>
          </Section>
        )}
        {card && (card.events?.length ?? 0) > 0 && (
          <Section look="list" title={t('office.requests.timeline')} count={card.events!.length}>
            <View style={styles.inner}>
              {card.events!.map((e, i) => (
                <View key={`${e.at}-${e.action}-${i}`} style={styles.event} testID="request-event">
                  <Mono size={13} color={colors.muted} style={{ width: 92 }}>{dateWords(t, e.at)}</Mono>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="strong" size={15}>{eventLine(e, t)}</Txt>
                    {e.note ? <Txt variant="small">{e.note}</Txt> : null}
                  </View>
                </View>
              ))}
            </View>
          </Section>
        )}
        {problem && <ErrorNotice error={problem} onRetry={lastCancel ? () => void cancel(lastCancel) : refresh} />}
      </Screen>
      {outcome && (
        <StickyActions>
          <Button kind="dark" label={t('office.decide.done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office'))} />
        </StickyActions>
      )}
      {card && open && !outcome && (
        <StickyActions>
          <BarRow>
            <Button kind="danger-text" label={t('office.request.decline')} onPress={() => setDeclining(true)} disabled={busy !== null} style={barDanger} testID="decline-button" />
            <Button
              label={asAsked ? (vehicle ? t('office.who.approveVehicle', { plate: vehicle }) : t('office.request.approve')) : pickedDriver ? t('office.request.approveSend', { name: pickedDriver.name }) : t('office.request.approve')}
              icon={busy === 'approve' ? undefined : Check}
              onPress={() => void decide('approve')}
              disabled={!!approveReason || busy === 'decline'}
              busy={busy === 'approve'}
              testID="approve-button"
              style={[barButton, { flex: 1 }]}
            />
            {(me.tools.includes(card.status === 'changed' ? 'redecide_request' : 'decide_request') || mayAsk || (canCancelBooking(card, me.permissions, me.tools) && card.status !== 'waiting')) && (
              <BarMore label={t('office.common.more')} onPress={() => setMoreOpen(true)} testID="request-more" />
            )}
          </BarRow>
          {approveReason ? <Txt variant="small" style={{ textAlign: 'center' }} testID="approve-reason">{t(approveReason)}</Txt> : null}
        </StickyActions>
      )}
      {card && !outcome && !open && canCancelBooking(card, me.permissions, me.tools) && card.status !== 'waiting' && (
        <StickyActions>
          <Button kind="danger-text" label={t('office.requests.cancelBooking')} busy={cancelBusy} onPress={() => setCancelling(true)} style={barDanger} testID="cancel-booking" />
        </StickyActions>
      )}
      {card && !outcome && !decider && ((canEditTrip(card) && me.tools.includes('update_request')) || canWithdrawOwn(card, me.permissions, me.tools)) && (
        <StickyActions>
          <BarRow>
            {canWithdrawOwn(card, me.permissions, me.tools) && (
              <Button kind="danger-text" label={t('office.trips.withdraw')} busy={cancelBusy} onPress={() => setCancelling(true)} style={barDanger} testID="withdraw-request" />
            )}
            {canEditTrip(card) && me.tools.includes('update_request') && (
              <Button kind="outline" label={t('office.trip.edit')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'edit', id: card.id } })} style={[barButton, { flex: 1 }]} testID="edit-request" />
            )}
          </BarRow>
        </StickyActions>
      )}
      {card && open && (
        <Sheet visible={moreOpen} title={t('office.common.more')} onClose={() => setMoreOpen(false)} testID="request-more-sheet">
          <View style={{ gap: 10 }}>
            {me.tools.includes(card.status === 'changed' ? 'redecide_request' : 'decide_request') && (
              <Button kind="outline" label={t('office.decide.changeTime')} onPress={() => { setMoreOpen(false); router.push({ pathname: '/office/request/[id]/time', params: { id } }); }} style={{ minHeight: 56 }} testID="decide-change-time" />
            )}
            {mayAsk && drivers.length > 0 && !asAsked && (
              <Button kind="outline" label={t('office.ask.open')} onPress={() => { setMoreOpen(false); setAsking(true); }} style={{ minHeight: 56 }} testID="request-ask-drivers" />
            )}
            {/* A changed booking (still open): Cancel booking stays one tap away, under ⋯. */}
            {canCancelBooking(card, me.permissions, me.tools) && card.status !== 'waiting' && (
              <Button kind="danger-text" label={t('office.requests.cancelBooking')} busy={cancelBusy} onPress={() => { setMoreOpen(false); setCancelling(true); }} style={{ minHeight: 56 }} testID="cancel-booking" />
            )}
          </View>
        </Sheet>
      )}
      {mayAsk && card && open && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargets(drivers, t)}
          context={{
            date: trip?.date ?? card.fields?.date,
            from: trip?.leaveBy,
            to: card.fields?.back_by && trip?.leaveBy && card.fields.back_by > trip.leaveBy ? card.fields.back_by : undefined,
            note: trip?.rows.find((r) => r.kind === 'stop')?.place,
            request_id: card.id,
          }}
          onUse={(username) => setPicked(username)}
        />
      )}
      <ReasonSheet<keyof typeof CANCEL_TEXT>
        visible={cancelling}
        title={decider ? 'office.requests.cancelTitle' : 'office.requests.withdrawTitle'}
        question="office.requests.cancelQuestion"
        notePlaceholder="office.requests.cancelNote"
        confirmLabel={decider ? 'office.requests.cancelConfirm' : 'office.requests.withdrawConfirm'}
        subtitle={card ? requestTitle(card) : null}
        reasons={[
          { value: 'not_needed', label: 'office.requests.reasonNotNeeded' },
          { value: 'vehicle_problem', label: 'office.requests.reasonVehicle' },
          { value: 'other', label: 'office.requests.reasonOther' },
        ]}
        onConfirm={(reason, note) => {
          setCancelling(false);
          void cancel(cancelReason(CANCEL_TEXT[reason], note));
        }}
        onClose={() => setCancelling(false)}
      />
      <ReasonSheet<DeclineReasonKey>
        visible={declining}
        title="office.request.declineTitle"
        question="office.request.declineQuestion"
        notePlaceholder="office.request.declineNote"
        confirmLabel="office.request.declineConfirm"
        subtitle={card ? requestTitle(card) : null}
        reasons={DECLINE_REASONS}
        onConfirm={(reason, note) => {
          setDeclining(false);
          void decide('decline', declineReason(DECLINE_TEXT[reason], note));
        }}
        onClose={() => setDeclining(false)}
      />
    </View>
  );
}

/** "waiting for your OK" → "Waiting for your OK" (English only; Sinhala has no capitals). */
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The banner's icon by its name (office/detailBanner.ts). */
const BANNER_ICON: Record<BannerIcon, LucideIcon> = { clock: Clock, check: Check, x: X, calendarX: CalendarX, navigation: Clock, userX: X, send: Clock, flag: Clock };

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14 },
  asker: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  inner: { padding: 14, gap: 4 },
  chooseAnother: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  changed: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.blueChip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 8, minHeight: 44 },
});
