// Office mode (Phase 8, O1): the My trips tab (design 17): the person's requests, proposals and the tasks they made,
// from 30 days back to 60 days ahead (my_trips, include all), the search bar (my_trips' own `search`) and one Filter button
// (All / Waiting / Coming up / Done with the counts, office/tripsLogic.ts), skeleton rows first.
// A row: the title, the when · back by · need · driver line, the live state pill, "Changed by the office" when the
// office changed an approved trip, "Approved by Palitha · Sun 16:40" with Call, and Withdraw on the person's own waiting
// request (the reasons sheet → cancel_request, then the list is read again). Edit is round O2 and is not shown. A row
// opens the request's page only for an approver (a requester's own request page comes later).
// Round 3 (A6): an expired request (nobody decided it before its day was over) has its own section and filter choice,
// its own badge (the calendar with a cross) and Request again (the trip editor with everything copied but the day).

import { tripChip } from '@/office/statusWords';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { CalendarX, Phone, RotateCcw } from '@/components/icons';
import { ReasonSheet } from '@/components/ReasonSheet';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Notice, Txt } from '@/components/ui';
import { SavedNotice } from '@/components/office/SavedNotice';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { colomboDate } from '@/lib/time';
import { dateWords, whenWords } from '@/lib/dateWords';
import { isCreatedTask, tripLive, tripTitle } from '@/office/homeLogic';
import { canRequestAgain, expiredText } from '@/office/requestsLogic';
import { requestAgainDraft, setDraft } from '@/office/trip/draft';
import { useOffice, useTool } from '@/office/state';
import {
  canEdit, canWithdraw, changedText, type Trip, tripBuckets, tripKey, tripLine, tripRoute, tripsArgs, tripsChoice, tripsFilterDefs,
  WITHDRAW_REASONS, type WithdrawReason, withdrawReason,
} from '@/office/tripsLogic';
import type { FleetError, MyTrips, RequestCard } from '@/office/types';
import { DarkHeader, ErrorNotice, ListFailed, Screen, StatusChip } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** 90 days of one person's trips: well under this (no endless list). */
const LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 500;

interface Withdrawing {
  id: string;
  reason: string;
  busy: boolean;
  error?: FleetError;
}

export default function TripsTab() {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const today = colomboDate();
  const [values, setValues] = useState<FilterValues>({ show: 'all' });
  const filter = tripsChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const [sheet, setSheet] = useState<RequestCard | null>(null);
  const [withdrawing, setWithdrawing] = useState<Withdrawing | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const q = useTool<MyTrips>('my_trips', tripsArgs(today, LIMIT, search));
  const trips = q.data?.trips ?? [];
  const groups = tripBuckets(trips, filter);

  // Request again (Round 3, A6; Airbnb's and Uber's "Book again"): the copy in place, then the trip editor at Where.
  function requestAgain(trip: RequestCard) {
    setDraft(requestAgainDraft(trip, today));
    router.push({ pathname: '/office/trip/where', params: { mode: 'request', again: trip.id } });
  }

  async function withdraw(id: string, reason: string) {
    setWithdrawn(false);
    setWithdrawing({ id, reason, busy: true });
    try {
      await api.call('cancel_request', { request_id: id, reason });
      setWithdrawing(null);
      setWithdrawn(true);
      await q.reload();
    } catch (e) {
      setWithdrawing({ id, reason, busy: false, error: e as FleetError });
    }
  }

  function card(trip: Trip) {
    const live = tripLive(trip);
    const route = tripRoute(trip, me.permissions);
    const changed = changedText(trip);
    const approved = trip.approved_by;
    const mine = withdrawing?.id === trip.id ? withdrawing : null;
    const body = (
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Txt variant="strong" size={17} style={{ flex: 1 }}>{tripTitle(trip)}</Txt>
          {(() => { const k = tripChip(live.state); return <StatusChip text={t(`office.chip.${k.key}`)} tone={k.tone} icon={live.state === 'expired' ? CalendarX : undefined} testID={live.state === 'expired' ? 'trip-expired' : undefined} />; })()}
        </View>
        <Txt variant="muted" size={15}>{tripLine(trip, t('office.trips.backBy'), { self: t('office.who.drivesThemselves'), other: t('office.who.someoneElse') }, (s) => whenWords(t, s))}</Txt>
        {changed ? <Txt variant="strong" size={14} color={colors.amberText}>{changed}</Txt> : null}
        {approved && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt variant="small" style={{ flex: 1 }}>{t('office.trips.approvedBy', { name: approved.name, at: approved.at })}</Txt>
            {approved.call ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('office.trips.callName', { name: approved.name })} onPress={() => void Linking.openURL(approved.call as string)} style={styles.callBtn}>
                <Phone size={20} color={colors.ink} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        )}
        {canEdit(trip) && me.tools.includes('update_request') && (
          <Button kind="outline" label={t('office.trip.edit')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'edit', id: trip.id } })} style={{ minHeight: 48, marginTop: 8 }} />
        )}
        {/* Round 3 (A6): nobody decided it in time; Request again copies everything but the day (tomorrow). */}
        {live.state === 'expired' && <Txt variant="small" testID="trip-expired-line">{expiredText(trip as RequestCard, t, (at) => dateWords(t, at))}</Txt>}
        {!isCreatedTask(trip) && canRequestAgain(trip, me.tools, true) && (
          <Button kind="outline" icon={RotateCcw} label={t('office.requests.requestAgain')} onPress={() => requestAgain(trip)} style={{ minHeight: 48, marginTop: 8 }} testID="trip-request-again" />
        )}
        {canWithdraw(trip) && (
          <>
            {mine?.error && <ErrorNotice error={mine.error} onRetry={() => void withdraw(trip.id, mine.reason)} onSignIn={() => void signOut()} />}
            <Button kind="danger-text" label={t('office.trips.withdraw')} busy={mine?.busy ?? false} onPress={() => setSheet(trip)} style={styles.withdraw} />
          </>
        )}
      </View>
    );
    if (!route) return <View key={tripKey(trip)}>{body}</View>;
    return (
      <Pressable key={tripKey(trip)} accessibilityRole="button" onPress={() => router.push(route as never)} style={({ pressed }) => pressed && { opacity: 0.8 }}>
        {body}
      </Pressable>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.trips.above')} title={t('office.tabs.trips')} />
      {me.tools.includes('create_request') && (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Button label={t('office.trip.requestVehicle')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } })} style={{ minHeight: 56 }} />
        </View>
      )}
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <SavedNotice noticeKey="/office/(tabs)/trips" />
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.trips.search')}
          defs={tripsFilterDefs(q.data ? trips : undefined, t)}
          values={values}
          onApply={setValues}
        />
        {withdrawn && <Notice tone="info" text={t('office.trips.withdrawn')} />}
        {!q.data && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!q.data && !q.error && <SkeletonRows rows={4} lines={3} />}
        {q.data && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && trips.length === 0 && (search
          ? <ListEmpty text={t('office.trips.noneMatch', { search })} />
          : <ListEmpty text={t('office.trips.none')} action={me.tools.includes('create_request') ? t('office.trip.requestVehicle') : undefined} onAction={me.tools.includes('create_request') ? () => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } }) : undefined} />)}
        {q.data && trips.length > 0 && groups.length === 0 && <ListEmpty text={t('office.trips.noneInFilter')} action={t('patterns.clearAll')} onAction={() => setValues({ show: 'all' })} />}
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Txt variant="label" color={colors.muted} style={{ paddingHorizontal: 2 }}>{t(`office.trips.${g.key}`).toUpperCase()}</Txt>
            {g.trips.map(card)}
          </View>
        ))}
      </Screen>
      <ReasonSheet<WithdrawReason>
        visible={sheet !== null}
        title="office.trips.withdrawTitle"
        question="office.trips.withdrawQuestion"
        notePlaceholder="office.trips.withdrawNote"
        confirmLabel="office.trips.withdrawConfirm"
        subtitle={sheet ? tripTitle(sheet) : null}
        reasons={WITHDRAW_REASONS.map((r) => ({ value: r.value, label: r.label }))}
        onConfirm={(reason, note) => {
          if (sheet) void withdraw(sheet.id, withdrawReason(reason, note));
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  callBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  withdraw: { minHeight: 48, alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 0 },
});
