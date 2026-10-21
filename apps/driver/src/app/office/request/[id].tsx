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

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Phone } from '@/components/icons';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ChoiceRow } from '@/components/patterns/Select';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { SavedNotice } from '@/components/office/SavedNotice';
import { TellRequester } from '@/components/office/TellRequester';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText, shortDate } from '@/lib/durations';
import { telLink } from '@/lib/format';
import { alreadyDecided, availabilityArgs, canApprove, DECLINE_TEXT, decideCall, declineReason, driverParts, driverPill, firstPick, rankedDrivers, tripView } from '@/office/approveLogic';
import { askTargets } from '@/office/askLogic';
import { askedOf, availabilityAt, decideTimes, hasChange, redecideTimes, shownOf } from '@/office/decideLogic';
import { CANCEL_TEXT, canCancelBooking, cancelReason, canWithdrawOwn, decides, eventLine } from '@/office/requestsLogic';
import { canEdit as canEditTrip } from '@/office/tripsLogic';
import { decideStore, useTimeChange } from '@/office/decideStore';
import { requestTitle } from '@/office/homeLogic';
import { setSavedNotice } from '@/office/savedNotice';
import { useOffice, useTool } from '@/office/state';
import type { Availability, DecideResult, FleetError, RedecideResult, RequestCard, RequestsList } from '@/office/types';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Avatar, BackHeader, Divider, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

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

  const [picked, setPicked] = useState<string | null>(null);
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

  // The first pick once the card and Who's available are known: the proposal's driver, else the best match.
  const pick = picked ?? (card ? firstPick(card, avail.data ?? null) : '');

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
    const call = decideCall(card, decision, { driver: pick || undefined, vehicle: driver?.vehicle?.reg_no, reason });
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
      const title = decision === 'approve' ? t('office.request.approvedTitle', { name: driver?.name ?? pick }) : t('office.request.declinedTitle');
      // Hotfix O2-H2, Part 1b, merged with O3's Tell requester: the page stays on the decided request (telling the
      // requester is the next job), the snackbar says what happened (with View when the approval made a task this person
      // may open), and the warnings wait on the request in the shared notice.
      const taskId = (out as DecideResult).task_id ?? (out as RedecideResult).task?.task_id;
      const view = decision === 'approve' && taskId && me.tools.includes('task_detail') ? taskId : null;
      setOutcome({ title, warnings });
      setSavedNotice(`request:${id}`, warnings);
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        title={card ? requestTitle(card) : t('office.request.title')}
        subtitle={card ? [card.kind === 'task' ? t('office.request.proposedTask') : t('office.request.request'), card.requested_by, card.asked].filter(Boolean).join(' · ') : undefined}
      />
      <Screen refreshing={q.refreshing} onRefresh={refresh} bottom={16}>
        {!q.data && !q.error && <SkeletonRows rows={3} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        <SavedNotice noticeKey={`request:${id}`} />
        {q.data && !card && <ListEmpty text={t('office.request.notFound')} />}
        {card && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pill text={card.status === 'waiting' ? t('office.request.waitingYourOk') : card.status === 'changed' ? t('office.request.changedByRequester') : t(`office.requests.status_${card.status}`)} tone={open ? 'amber' : card.status === 'approved' ? 'green' : 'red'} size={15} />
            {others.length > 0 && <Pill text={t('office.request.alsoLooking', { name: others.join(', ') })} tone="muted" size={15} />}
            {card.late && <Pill text={t('office.approve.late')} tone="red" size={15} />}
          </View>
        )}
        {card && !open && (card.approved_by || card.declined_by || card.cancelled_by) && (
          <Section title={t('office.request.decided')}>
            <Txt variant="strong">
              {card.approved_by ? t('office.request.approvedBy', { name: card.approved_by.name, at: card.approved_by.at })
                : card.declined_by ? t('office.request.declinedBy', { name: card.declined_by.name, at: card.declined_by.at, reason: card.declined_by.reason ?? card.decline_reason ?? '' })
                : t('office.request.cancelledBy', { name: card.cancelled_by?.name ?? '', at: card.cancelled_by?.at ?? '', reason: card.cancelled_by?.reason ?? card.cancel_reason ?? '' })}
            </Txt>
          </Section>
        )}
        {card && trip && (
          <View style={styles.tripCard}>
            {trip.date && <Txt variant="label" color={colors.muted}>{shortDate(names, `${trip.date}T06:00:00Z`).toUpperCase()}</Txt>}
            {trip.leaveBy && (
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Txt variant="heading" size={28}>{t('office.request.leaveBy')}</Txt>
                <Mono size={28} bold>{trip.leaveBy}</Mono>
              </View>
            )}
            {!trip.leaveBy && card.when && <Txt variant="heading" size={22}>{card.when}</Txt>}
            <View style={{ gap: 12, marginTop: 4 }}>
              {trip.rows.map((r, i) => (
                <View key={`${r.mark}-${i}`} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <View style={[styles.mark, r.kind === 'start' && { backgroundColor: colors.amber }, r.kind === 'back' && { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.ink }]}>
                    <Mono size={14} bold color={r.kind === 'stop' ? '#ffffff' : colors.ink}>{r.mark}</Mono>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="strong">{r.place}</Txt>
                    {r.parts.length > 0 && <Txt variant="muted" size={15}>{r.parts.join(' · ')}</Txt>}
                  </View>
                </View>
              ))}
            </View>
            <Txt variant="muted" size={15}>
              {[
                trip.totals ? `${trip.totals.km} km · ${durationText(t, trip.totals.driveMin)}` : '',
                card.need ? t('office.request.needs', { need: card.need }) : '',
                card.note ? t('office.request.notes', { note: card.note }) : '',
                card.proposed?.notes ? t('office.request.notes', { note: card.proposed.notes }) : '',
              ].filter(Boolean).join(' · ')}
            </Txt>
            {card.on_behalf_of && <Txt variant="small">{t('office.request.onBehalfOf', { name: card.on_behalf_of })}</Txt>}
            {callLink && (
              <Button kind="outline" icon={Phone} label={t('office.request.callRequester', { name: card.requested_by })} onPress={() => void Linking.openURL(callLink)} style={{ minHeight: 56 }} />
            )}
          </View>
        )}
        {card && open && !outcome && shown && (
          <View style={{ gap: 8 }}>
            {changed && (
              <View style={styles.changed} testID="decide-changed">
                <Txt variant="strong" size={15} style={{ flex: 1 }} color={colors.blue}>
                  {t('office.decide.newTime', { day: shortDate(names, `${shown.date}T06:00:00Z`), leave: shown.leaveBy || '—', back: shown.back || '—' })}
                </Txt>
                <Pressable accessibilityRole="button" onPress={() => decideStore.set(id, null)} style={{ minHeight: 44, justifyContent: 'center' }} testID="decide-undo">
                  <Txt variant="strong" size={15} color={colors.blue}>{t('office.decide.undo')}</Txt>
                </Pressable>
              </View>
            )}
            {me.tools.includes(card.status === 'changed' ? 'redecide_request' : 'decide_request') && (
              <Button kind="outline" label={t('office.decide.changeTime')} onPress={() => router.push({ pathname: '/office/request/[id]/time', params: { id } })} style={{ minHeight: 52 }} testID="decide-change-time" />
            )}
          </View>
        )}
        {card && decider && (outcome || !open) && <TellRequester key={`${card.id}-${card.version ?? 0}-${card.status}`} q={card} onSaved={() => void q.reload()} />}
        {card && open && !outcome && (
          <Section
            title={t('office.request.whosAvailable')}
            count={avail.data ? avail.data.counts.free : undefined}
            link={mayAsk && drivers.length > 0 ? t('office.ask.open') : undefined}
            onLink={mayAsk && drivers.length > 0 ? () => setAsking(true) : undefined}
          >
            {!availArgs && <ListEmpty text={t('office.request.noTime')} />}
            {availArgs && !avail.data && !avail.error && <SkeletonRows rows={3} lines={2} />}
            {avail.error && <ListFailed stale={!!avail.data} error={avail.error} onRetry={refresh} onSignIn={() => void signOut()} />}
            {avail.data && drivers.length === 0 && <ListEmpty text={t('office.request.nobody')} />}
            {drivers.map((d, i) => {
              const on = d.username === pick && !!d.username;
              const pillKey = driverPill(d, bestUsername);
              return (
                <ChoiceRow
                  key={d.username ?? d.name}
                  selected={on}
                  onPress={() => setPicked(d.username ?? '')}
                  disabled={!d.username}
                  disabledReason={d.username ? undefined : t('office.ask.noAccount')}
                  leading={<Avatar name={d.name} size={44} photo={d.photo_url} />}
                  mark="end"
                  trailing={pillKey && pillKey !== 'best' ? <Pill text={t(`office.request.${pillKey}`)} tone={pillKey === 'not_available' ? 'red' : 'muted'} /> : null}
                  accessibilityLabel={d.name}
                  testID={`approve-row-${d.username ?? d.name}`}
                  style={i > 0 ? { marginTop: 8 } : undefined}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Txt variant="strong" size={17}>{d.name}</Txt>
                    {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
                  </View>
                  <Txt variant="muted" size={15}>{driverParts(d).join(' · ')}</Txt>
                  {d.vehicle && <View style={{ marginTop: 4 }}><Plate regNo={d.vehicle.reg_no} /></View>}
                </ChoiceRow>
              );
            })}
          </Section>
        )}
        {card && (card.events?.length ?? 0) > 0 && (
          <Section title={t('office.requests.timeline')} count={card.events!.length}>
            {card.events!.map((e, i) => (
              <View key={`${e.at}-${e.action}-${i}`} style={styles.event} testID="request-event">
                <Mono size={13} color={colors.muted} style={{ width: 92 }}>{e.at}</Mono>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="strong" size={15}>{eventLine(e, t)}</Txt>
                  {e.note ? <Txt variant="small">{e.note}</Txt> : null}
                </View>
              </View>
            ))}
          </Section>
        )}
        {card && !outcome && canCancelBooking(card, me.permissions, me.tools) && card.status !== 'waiting' && (
          <Button kind="danger-text" label={t('office.requests.cancelBooking')} busy={cancelBusy} onPress={() => setCancelling(true)} style={{ minHeight: 52 }} testID="cancel-booking" />
        )}
        {card && !outcome && !decider && (
          <View style={{ gap: 8 }}>
            {canEditTrip(card) && me.tools.includes('update_request') && (
              <Button kind="outline" label={t('office.trip.edit')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'edit', id: card.id } })} style={{ minHeight: 52 }} />
            )}
            {canWithdrawOwn(card, me.permissions, me.tools) && (
              <Button kind="danger-text" label={t('office.trips.withdraw')} busy={cancelBusy} onPress={() => setCancelling(true)} style={{ minHeight: 52 }} testID="withdraw-request" />
            )}
          </View>
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
          <Button
            label={pickedDriver ? t('office.request.approveSend', { name: pickedDriver.name }) : t('office.request.approve')}
            onPress={() => void decide('approve')}
            disabled={!canApprove(card, pick) || busy === 'decline'}
            busy={busy === 'approve'}
          />
          <Button kind="outline" label={t('office.request.decline')} onPress={() => setDeclining(true)} disabled={busy !== null} style={{ borderColor: colors.red, minHeight: 56 }} />
        </StickyActions>
      )}
      {mayAsk && card && open && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargets(drivers)}
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

const styles = StyleSheet.create({
  tripCard: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 18, gap: 10 },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  changed: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.blueChip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6 },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 8, minHeight: 44 },
});
