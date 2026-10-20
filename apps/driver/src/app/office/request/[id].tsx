// Office mode (Phase 8, O1): Approve a request (design 10). The request as list_requests answers it (with "Palitha is also
// looking" from reviewing, said every 20 s while the page is open), the trip card (the plan's stops with their times, the
// totals, Call the requester when their number is known), Who's available (availability at the request's time: the best
// match picked first, a tap picks another; the vehicle fills itself from the driver), then Approve · send to <driver> and
// Decline… with a reason. The decision goes through decide_request (a waiting request) or redecide_request with the
// version it was shown with (a changed booking); "already decided by …" is the server's refusal, shown and the card read
// again. Not in O1 and not shown: Plan on map, Change the trip, Change time, Ask drivers.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Check, Phone } from '@/components/icons';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { durationText, shortDate } from '@/lib/durations';
import { telLink } from '@/lib/format';
import { alreadyDecided, availabilityArgs, canApprove, DECLINE_TEXT, decideCall, declineReason, driverParts, driverPill, firstPick, rankedDrivers, tripView } from '@/office/approveLogic';
import { askTargets } from '@/office/askLogic';
import { requestTitle } from '@/office/homeLogic';
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
  const open = card?.status === 'waiting' || card?.status === 'changed';
  const availArgs = card ? availabilityArgs(card) : null;
  const avail = useTool<Availability>('availability', availArgs ?? {}, { enabled: !!availArgs && !!open, every: 60_000 });

  const [picked, setPicked] = useState<string | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [declining, setDeclining] = useState(false);
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
    try {
      const out = await api.call<DecideResult | RedecideResult>(call.tool, call.input);
      decidedOnce.current = true;
      const warnings = [...(out.warnings ?? []), ...((out as DecideResult).conflicts ?? []).map((c) => c.text)];
      const title = decision === 'approve' ? t('office.request.approvedTitle', { name: driver?.name ?? pick }) : t('office.request.declinedTitle');
      Alert.alert(title, warnings.length ? warnings.join('\n') : undefined, [{ text: t('office.common.ok'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/office')) }]);
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
        {q.data && !card && <ListEmpty text={t('office.request.notFound')} />}
        {card && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pill text={card.status === 'waiting' ? t('office.request.waitingYourOk') : card.status === 'changed' ? t('office.request.changedByRequester') : t(`office.status.${card.status}`)} tone={open ? 'amber' : card.status === 'approved' ? 'green' : 'red'} size={15} />
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
        {card && open && (
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
                <View key={d.username ?? d.name}>
                  {i > 0 && <Divider />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    disabled={!d.username}
                    onPress={() => setPicked(d.username ?? '')}
                    style={({ pressed }) => [styles.driverRow, on && styles.driverOn, pressed && { opacity: 0.8 }]}
                  >
                    <Avatar name={d.name} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Txt variant="strong" size={17}>{d.name}</Txt>
                        {pillKey === 'best' && <Pill text={t('office.request.bestMatch')} tone="amber" size={13} />}
                      </View>
                      <Txt variant="muted" size={15}>{driverParts(d).join(' · ')}</Txt>
                      {d.vehicle && <View style={{ marginTop: 4 }}><Plate regNo={d.vehicle.reg_no} /></View>}
                    </View>
                    {on ? <Check size={26} color={colors.blue} strokeWidth={3} /> : pillKey && pillKey !== 'best' ? <Pill text={t(`office.request.${pillKey}`)} tone={pillKey === 'not_available' ? 'red' : 'muted'} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </Section>
        )}
        {problem && <ErrorNotice error={problem} onRetry={refresh} />}
      </Screen>
      {card && open && (
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
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', minHeight: 64 },
  driverOn: { borderColor: colors.blue, backgroundColor: '#f2f5fb' },
});
