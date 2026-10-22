// Round 4–7, §33.6 (Google Pay / Revolut / PickMe's history; Sahan, 22 October 2026): "See all" from the Fuel tab (kind
// fuel) or the Mileage tab (kind all, with the chips All · Odometer · Fuel: the one chip row of the app). My fills and my
// readings, every vehicle, grouped by month (newest first), 20 at a time with Load more; each row as on the tabs'
// Recent card (components/LogRows.tsx). The server's pages come below the oldest row held (lib/api.ts fetchFuelBefore,
// fetchOdometerBefore); two lists merged show only what is certain (lib/history.ts mergeSafe). The fills and readings
// still on the phone show first; with no connection the month's copy kept on the phone, with "Couldn't refresh · Try
// again". A page pushed over its tab: back returns there; nothing is typed here (no "Discard changes?").

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft } from '@/components/icons';
import { LogRow, uploadsByFill } from '@/components/LogRows';
import { ListEmpty, ListError, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { ChoiceChips } from '@/components/patterns/Select';
import { Card, Txt } from '@/components/ui';
import { fetchFuelBefore, fetchOdometerBefore, type Mileage } from '@/lib/api';
import { monthWords } from '@/lib/dateWords';
import {
  addPage,
  byMonth,
  cursorOf,
  fuelEntry,
  HISTORY_FILTERS,
  HISTORY_PAGE,
  type HistoryFilter,
  type LogEntry,
  type LogKind,
  mergeSafe,
  odometerEntry,
  ofKind,
  type Stream,
  streamsFor,
} from '@/lib/history';
import { getJson } from '@/lib/kv';
import { windowOf } from '@/lib/lists';
import { withTimeout } from '@/lib/patterns/listLogic';
import { supabase } from '@/lib/supabase';
import { flushNow, pendingFuelLogs, pendingOdometerLogs, retryVideo } from '@/sync';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** A page waits this long for the server (the list rules: every call has a timeout). */
const READ_TIMEOUT_MS = 20_000;
const FILTER_KEY: Record<HistoryFilter, string> = { all: 'logHistory.all', odometer: 'mileage.odometer', fuel: 'mileage.fuel' };
const EMPTY_KEY: Record<HistoryFilter, string> = { all: 'logHistory.empty', odometer: 'logHistory.emptyOdometer', fuel: 'logHistory.emptyFuel' };

type Streams = Record<LogKind, Stream | null>;

async function fetchPage(kind: LogKind, stream: Stream | null): Promise<Stream> {
  const before = cursorOf(stream);
  const cursor = before ? { at: before.at, id: before.id } : null;
  if (kind === 'fuel') {
    const page = await withTimeout(fetchFuelBefore(supabase, cursor, HISTORY_PAGE), READ_TIMEOUT_MS);
    return addPage(stream, page.rows.map((row) => fuelEntry(row)), page.more);
  }
  const page = await withTimeout(fetchOdometerBefore(supabase, cursor, HISTORY_PAGE), READ_TIMEOUT_MS);
  return addPage(stream, page.rows.map((row) => odometerEntry(row)), page.more);
}

export default function HistoryScreen() {
  const app = useApp();
  const { t, me } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();
  const fuelOnly = params.kind === 'fuel';
  const [filter, setFilter] = useState<HistoryFilter>(fuelOnly ? 'fuel' : 'all');
  const [streams, setStreams] = useState<Streams>({ odometer: null, fuel: null });
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const [shown, setShown] = useState(HISTORY_PAGE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [, bump] = useState(0);
  // Only the newest load's answer counts (a refresh starts the lists again).
  const asked = useRef(0);

  /** The next page of each list the filter shows that has more (or its first page). */
  const load = useCallback(async (kinds: LogKind[], from: Streams) => {
    const mine = ++asked.current;
    const wanted = kinds.filter((k) => !from[k]?.done);
    if (wanted.length === 0) {
      setPulling(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const pages = await Promise.all(wanted.map((k) => fetchPage(k, from[k])));
      if (mine !== asked.current) return;
      const next = { ...from };
      wanted.forEach((k, i) => (next[k] = pages[i]));
      setStreams(next);
    } catch {
      if (mine === asked.current) setFailed(true);
    } finally {
      if (mine === asked.current) {
        setBusy(false);
        setPulling(false);
      }
    }
  }, []);

  // The first page of each list the filter shows, when it is not held yet.
  useEffect(() => {
    const kinds = streamsFor(filter).filter((k) => streamsRef.current[k] === null);
    if (kinds.length > 0) void load(kinds, streamsRef.current);
  }, [filter, load]);

  if (!me) return <Redirect href="/login" />;

  // The phone's own entries (still to be sent) first; the month's copy kept on the phone last (for no connection).
  const pending = [
    ...pendingOdometerLogs().map((log) => odometerEntry(log, true)),
    ...pendingFuelLogs().map((log) => fuelEntry(log, true)),
  ];
  const kept = getJson<Mileage>('cache.mileage');
  const cached = [...(kept?.odometer ?? []).map((log) => odometerEntry(log)), ...(kept?.fuel ?? []).map((log) => fuelEntry(log))];
  const kinds = streamsFor(filter);
  const merged = mergeSafe(kinds.map((k) => streams[k]), ofKind(pending, filter), ofKind(cached, filter));
  const visible = windowOf(merged.rows, shown);
  const groups = byMonth(visible);
  const more = visible.length < merged.rows.length || !merged.complete;
  const uploads = uploadsByFill();
  const firstLoad = busy && merged.rows.length === 0;

  function loadMore() {
    const target = shown + HISTORY_PAGE;
    setShown(target);
    if (target > merged.rows.length && !merged.complete && !busy) void load(kinds, streamsRef.current);
  }

  function refresh() {
    const fresh: Streams = { odometer: null, fuel: null };
    setPulling(true);
    setStreams(fresh);
    setShown(HISTORY_PAGE);
    void load(kinds, fresh);
  }

  function retry(entry: LogEntry) {
    if (retryVideo(entry.id)) {
      bump((n) => n + 1);
      void flushNow(true);
    }
  }

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 28, gap: 16 }}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={colors.amber} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>{t(fuelOnly ? 'logHistory.fuelTitle' : 'logHistory.title')}</Txt>
        </View>

        {!fuelOnly && (
          <ChoiceChips
            options={HISTORY_FILTERS.map((key) => ({ key, label: t(FILTER_KEY[key]) }))}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setShown(HISTORY_PAGE);
            }}
            testID="history-filter"
          />
        )}

        {failed && <ListError message={t('logHistory.failed')} onRetry={() => void load(kinds, streamsRef.current)} stale={merged.rows.length > 0} />}
        {firstLoad && <SkeletonRows rows={4} lines={2} testID="history-skeleton" />}
        {!firstLoad && merged.rows.length === 0 && !failed && (
          <ListEmpty text={t(EMPTY_KEY[filter])} />
        )}

        {groups.map((group) => (
          <View key={group.month} style={{ gap: 8 }}>
            <Txt variant="label" color={colors.muted} style={{ marginLeft: 6 }}>{monthWords(t, group.month)}</Txt>
            <Card style={{ padding: 0 }}>
              {group.rows.map((entry, index) => (
                <LogRow key={entry.id} entry={entry} first={index === 0} upload={uploads.get(entry.id)} onRetry={retry} />
              ))}
            </Card>
          </View>
        ))}

        {more && merged.rows.length > 0 && <LoadMore shown={visible.length} busy={busy} onPress={loadMore} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
