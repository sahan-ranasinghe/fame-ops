// Office mode (Phase 8, O1): the My trips tab (design 17): the person's requests, proposals and the tasks they made,
// from 30 days back to 60 days ahead (my_trips, include all), as All / Waiting / Coming up / Done (office/tripsLogic.ts).
// A row: the title, the when · back by · need · driver line, the live state pill, "Changed by the office" when the
// office changed an approved trip, "Approved by Palitha · Sun 16:40" with Call, and Withdraw on the person's own waiting
// request (the reasons sheet → cancel_request, then the list is read again). Edit is round O2 and is not shown. A row
// opens the request's page only for an approver (a requester's own request page comes later).

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Phone } from '@/components/icons';
import { ReasonSheet } from '@/components/ReasonSheet';
import { Button, Notice, Txt } from '@/components/ui';
import { SavedNotice } from '@/components/office/SavedNotice';
import { addDays, colomboDate } from '@/lib/time';
import { statusTone, tripLive, tripTitle } from '@/office/homeLogic';
import { useOffice, useTool } from '@/office/state';
import {
  bucketCounts, canEdit, canWithdraw, changedText, type Trip, type TripFilter, tripBuckets, tripKey, tripLine, tripRoute, TRIPS_DAYS_AHEAD, TRIPS_DAYS_BACK,
  WITHDRAW_REASONS, type WithdrawReason, withdrawReason,
} from '@/office/tripsLogic';
import type { FleetError, MyTrips, RequestCard } from '@/office/types';
import { DarkHeader, Empty, ErrorNotice, FilterChips, Loading, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** 90 days of one person's trips: well under this (no endless list). */
const LIMIT = 100;

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
  const [filter, setFilter] = useState<TripFilter>('all');
  const [sheet, setSheet] = useState<RequestCard | null>(null);
  const [withdrawing, setWithdrawing] = useState<Withdrawing | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const q = useTool<MyTrips>('my_trips', { from: addDays(today, -TRIPS_DAYS_BACK), to: addDays(today, TRIPS_DAYS_AHEAD), include: 'all', limit: LIMIT });
  const trips = q.data?.trips ?? [];
  const counts = bucketCounts(trips);
  const groups = tripBuckets(trips, filter);

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
          <Pill text={live.text} tone={statusTone(live.state)} />
        </View>
        <Txt variant="muted" size={15}>{tripLine(trip, t('office.trips.backBy'))}</Txt>
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
        <FilterChips<TripFilter>
          options={[
            { key: 'all', label: t('office.common.all'), n: trips.length },
            { key: 'waiting', label: t('office.trips.waiting'), n: counts.waiting },
            { key: 'coming', label: t('office.trips.coming'), n: counts.coming },
            { key: 'done', label: t('office.trips.done'), n: counts.done },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {withdrawn && <Notice tone="info" text={t('office.trips.withdrawn')} />}
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !q.data && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && trips.length === 0 && <Empty text={t('office.trips.none')} />}
        {q.data && trips.length > 0 && groups.length === 0 && <Empty text={t('office.common.nothingHere')} />}
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
