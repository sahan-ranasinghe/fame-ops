// Office mode, Round 48 (item 1): the request page for a CHANGE to an existing task proposed by someone without the
// approve permission (reassign_task, update_task's day / time / end / driver / vehicle, update_task_stops). The pattern is
// the changed booking's decide-again flow (Phase 6 Part 2: a proposal in the queue, the live thing untouched until the
// decision) and the site's ChangeDecide: one job on the screen (docs/phase8-plan.md §16): the task's title, who proposes
// what, each change as from → to, then ONE sticky primary button, Approve the change (decide_request approve with the
// version the page loaded; the server applies the same tool as the approver), with Decline… and its reason beside it.
// To do something else than proposed, the approver opens the task and changes it there. The proposer (no approve) reads
// "The fleet admin will approve or decline this change" and may withdraw it while it waits (cancel_request), as a
// proposed task can; the server's refusal (decided by someone else, the task moved on) is shown as it is and the card is
// read again. After a decision the page stays with the outcome and Done (Hotfix O2-H2, Part 1b).

import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CalendarX, Check, Clock, type LucideIcon, X } from '@/components/icons';
import { ChangeLines } from '@/components/office/ChangeParts';
import { BarRow, barButton, barDanger } from '@/components/patterns/BottomActionBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { look } from '@/components/patterns/look';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { BannerLine, StatusBanner } from '@/components/patterns/StatusBanner';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Mono, Txt } from '@/components/ui';
import { dateWords, whenWords } from '@/lib/dateWords';
import { shortDate } from '@/lib/durations';
import { declineReason } from '@/office/approveLogic';
import { CHANGE_DECLINE_TEXT, type ChangeDeclineKey, changeDecideInput, changeLine, changeStateKey, changeView } from '@/office/changeLogic';
import { type BannerIcon, requestBanner } from '@/office/detailBanner';
import { CANCEL_TEXT, cancelReason, eventLine } from '@/office/requestsLogic';
import { useOffice } from '@/office/state';
import type { DecideResult, FleetError, RequestCard } from '@/office/types';
import { Avatar, BackHeader, ErrorNotice, ListFailed, Pill, Screen, Section, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const DECLINE_REASONS: { value: ChangeDeclineKey; label: string }[] = [
  { value: 'keep', label: 'office.change.declineKeep' },
  { value: 'not_approved', label: 'office.change.declineNotApproved' },
  { value: 'other', label: 'office.change.declineOther' },
];

export function ChangeDecide({ card, others, refreshing, error, reload, onSignIn }: {
  card: RequestCard | null;
  /** Who else has it open ("Palitha is also looking"), from the page's reviewing ping. */
  others: string[];
  refreshing: boolean;
  error: FleetError | null;
  reload: () => void;
  onSignIn: () => void;
}) {
  const { t, tList } = useApp();
  const { me, api } = useOffice();
  const router = useRouter();
  const names = { days: tList('days'), months: tList('months') };
  const view = card ? changeView(card, me) : { decides: false, withdraw: false, own: false };
  const [busy, setBusy] = useState<'approve' | 'decline' | 'withdraw' | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [declining, setDeclining] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // After a decision the page stays: the outcome's words, then Done (the decision buttons go).
  const [outcome, setOutcome] = useState<{ title: string; taskId?: string } | null>(null);
  const decidedOnce = useRef(false);
  const change = card?.change;
  const taskId = change?.task_id;
  const mayOpenTask = !!taskId && me.tools.includes('task_detail');
  const openTask = () => router.push({ pathname: '/office/task/[id]', params: { id: taskId ?? '' } });

  async function decide(decision: 'approve' | 'decline', reason?: string) {
    if (!card || busy || decidedOnce.current) return;
    setBusy(decision);
    setProblem(null);
    try {
      const out = await api.call<DecideResult & { task_id?: string; applied?: unknown }>('decide_request', changeDecideInput(card, decision, reason));
      decidedOnce.current = true;
      if (decision === 'decline') {
        // Gmail's triage: a decline goes back to where the person came from; the snackbar says the task is as it was.
        showSnackbar({ text: t('office.change.declinedTitle') });
        if (router.canGoBack()) router.back();
        else router.replace('/office');
        return;
      }
      const applied = out.task_id ?? taskId;
      const title = t('office.change.approvedTitle');
      setOutcome({ title, taskId: applied });
      showSnackbar(applied && me.tools.includes('task_detail')
        ? { text: title, action: { label: t('office.saved.view'), onPress: () => router.push({ pathname: '/office/task/[id]', params: { id: applied } }) } }
        : { text: title });
      reload();
    } catch (e) {
      // Refused (another approver decided it, the task moved on): the server's words, and the card as it is now.
      setProblem(e as FleetError);
      reload();
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(reason: string) {
    if (!card || busy) return;
    setBusy('withdraw');
    setProblem(null);
    try {
      await api.call('cancel_request', { request_id: card.id, reason });
      const title = t('office.change.withdrawnTitle');
      setOutcome({ title });
      showSnackbar({ text: title });
      reload();
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(null);
    }
  }

  const open = view.decides && !outcome;
  const banner = card ? requestBanner(card, open, me.permissions.includes('approve')) : null;
  const state = changeStateKey(card?.status);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader
        above={card ? [t('office.change.above'), card.fields?.date ? shortDate(names, `${card.fields.date}T06:00:00Z`) : ''].filter(Boolean).join(' · ') : t('office.change.above')}
        title={card?.title || change?.task_title || t('office.change.approveTitle')}
      />
      <Screen refreshing={refreshing} onRefresh={reload} bottom={16} style={{ paddingTop: 4, gap: 12 }}>
        {!card && !error && <SkeletonRows rows={3} lines={2} />}
        {error && <ListFailed stale={!!card} error={error} onRetry={reload} onSignIn={onSignIn} />}
        {!card && !error && !refreshing && <ListEmpty text={t('office.request.notFound')} />}
        {card && banner && (
          <StatusBanner
            tone={banner.tone}
            icon={BANNER_ICON[banner.icon]}
            title={banner.title === 'waiting' ? cap(t('office.request.waitingYourOk')) : t(`office.requests.status_${card.status}`)}
            line={(
              <BannerLine tone={banner.tone} testID="change-banner-line">
                {card.status === 'waiting'
                  ? [t('office.change.proposedBy', { name: card.requested_by }), whenWords(t, card.asked)].filter(Boolean).join(' · ')
                  : card.approved_by ? t('office.request.approvedBy', { name: card.approved_by.name, at: card.approved_by.at })
                  : card.declined_by ? t('office.request.declinedBy', { name: card.declined_by.name, at: card.declined_by.at, reason: card.declined_by.reason ?? card.decline_reason ?? '' })
                  : card.cancelled_by ? t('office.request.cancelledBy', { name: card.cancelled_by?.name ?? '', at: card.cancelled_by?.at ?? '', reason: card.cancelled_by?.reason ?? card.cancel_reason ?? '' })
                  : whenWords(t, card.asked)}
              </BannerLine>
            )}
            testID="change-banner"
          />
        )}
        {card && (others.length > 0 || card.late) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {others.length > 0 && <Pill text={t('office.request.alsoLooking', { name: others.join(', ') })} tone="muted" size={14} />}
            {card.late && <Pill text={t('office.approve.late')} tone="red" size={14} />}
          </View>
        )}
        {card && (
          <View style={[styles.card, styles.asker]} testID="change-proposer">
            <Avatar name={card.requested_by} size={40} photo={card.requested_by_photo_url} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="strong" size={16} numberOfLines={1}>{card.requested_by}</Txt>
              <Txt variant="small" numberOfLines={2}>{t('office.change.proposedBy', { name: card.requested_by })}</Txt>
            </View>
          </View>
        )}
        {card && (
          <View style={[styles.card, { gap: 12 }]} testID="change-card">
            <Txt variant="strong" size={19} testID="change-task">{card.title || change?.task_title || t('office.change.aChange')}</Txt>
            <Txt variant="muted" size={15} testID="change-line">{changeLine(card, t)}</Txt>
            <Txt variant="body" size={15} testID="change-state">
              {[t(`office.change.${state}`), state === 'untouched' && change?.task_was === 'declined' ? t('office.change.needsDriver') : ''].filter(Boolean).join(' ')}
            </Txt>
            <ChangeLines changes={change?.changes} />
            <View style={{ gap: 6 }}>
              {card.when ? <Fact label={t('office.decide.day')} value={card.when} /> : null}
              {card.back_by ? <Fact label={t('office.decide.backBy')} value={card.back_by} /> : null}
              {card.route ? <Fact label={t('office.decide.from')} value={card.route} /> : null}
              {card.proposed?.driver ? <Fact label={t('office.change.driverWouldBe')} value={card.proposed.driver} /> : null}
              {card.proposed?.vehicle || card.proposed?.vehicle_text ? <Fact label={t('office.change.vehicleWouldBe')} value={card.proposed.vehicle ?? card.proposed.vehicle_text ?? ''} mono={!!card.proposed.vehicle} /> : null}
            </View>
            {mayOpenTask && (
              <Pressable accessibilityRole="button" onPress={openTask} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID="change-open-task">
                <Txt variant="strong" size={16} color={colors.amberText}>{t('office.change.openTask')}</Txt>
              </Pressable>
            )}
          </View>
        )}
        {card && card.status === 'waiting' && !view.decides && !outcome && (
          <View style={styles.info} testID="change-will-decide">
            <Txt variant="body" size={15}>{t('office.change.willDecide')}</Txt>
          </View>
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
        {problem && <ErrorNotice error={problem} onRetry={reload} />}
      </Screen>
      {outcome && (
        <StickyActions>
          <Button kind="dark" label={t('office.decide.done')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office'))} testID="change-done" />
        </StickyActions>
      )}
      {card && open && (
        <StickyActions>
          <BarRow>
            <Button kind="danger-text" label={t('office.change.decline')} onPress={() => setDeclining(true)} disabled={busy !== null} style={barDanger} testID="change-decline" compact />
            <Button label={t('office.change.approve')} icon={busy === 'approve' ? undefined : Check} onPress={() => void decide('approve')} disabled={busy === 'decline'} busy={busy === 'approve'} style={[barButton, { flex: 1 }]} testID="change-approve" compact />
          </BarRow>
        </StickyActions>
      )}
      {card && view.withdraw && !outcome && (
        <StickyActions>
          <Button kind="danger-text" label={t('office.change.withdraw')} busy={busy === 'withdraw'} disabled={busy !== null && busy !== 'withdraw'} onPress={() => setWithdrawing(true)} style={barDanger} testID="change-withdraw" compact />
        </StickyActions>
      )}
      <ReasonSheet<ChangeDeclineKey>
        visible={declining}
        title="office.change.declineTitle"
        question="office.request.declineQuestion"
        notePlaceholder="office.change.declineNote"
        confirmLabel="office.change.declineConfirm"
        subtitle={card?.title ?? change?.task_title ?? null}
        reasons={DECLINE_REASONS}
        onConfirm={(reason, note) => {
          setDeclining(false);
          void decide('decline', declineReason(CHANGE_DECLINE_TEXT[reason], note));
        }}
        onClose={() => setDeclining(false)}
      />
      <ReasonSheet<keyof typeof CANCEL_TEXT>
        visible={withdrawing}
        title="office.change.withdrawTitle"
        question="office.requests.cancelQuestion"
        notePlaceholder="office.requests.cancelNote"
        confirmLabel="office.change.withdrawConfirm"
        subtitle={card?.title ?? change?.task_title ?? null}
        reasons={[
          { value: 'not_needed', label: 'office.requests.reasonNotNeeded' },
          { value: 'vehicle_problem', label: 'office.requests.reasonVehicle' },
          { value: 'other', label: 'office.requests.reasonOther' },
        ]}
        onConfirm={(reason, note) => {
          setWithdrawing(false);
          void withdraw(cancelReason(CANCEL_TEXT[reason], note));
        }}
        onClose={() => setWithdrawing(false)}
      />
    </View>
  );
}

/** One fact row: "DAY · Thu 29 Oct 10:00". */
function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Txt variant="label" color={colors.muted} style={{ minWidth: 96 }}>{label.toUpperCase()}</Txt>
      {mono ? <Mono size={15} bold style={{ flex: 1 }}>{value}</Mono> : <Txt variant="strong" size={15} style={{ flex: 1 }}>{value}</Txt>}
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
  info: { backgroundColor: colors.blueChip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  inner: { padding: 14, gap: 4 },
  event: { flexDirection: 'row', gap: 10, paddingVertical: 8, minHeight: 44 },
});
