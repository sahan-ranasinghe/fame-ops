// Office mode (Phase 8, O1; Stage 1, O3 rows 2 and 9): the Approve tab. The queue of requests waiting for a decision
// (list_requests waiting, which includes changed = approved and edited since) by default; the search box and one Filter
// (Waiting, Approved, Declined, Cancelled, All) reach every request, 25 at a time with Load more (docs/ui-patterns.md
// §1, §5). A row opens the request's page (Approve a request, design 10, or the decided request with its timeline and
// Tell requester), with "Palitha is reviewing" when another approver has it open. Rules: office/requestsLogic.ts.

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, type ScrollView, StyleSheet, View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Txt } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { requestLine, requestTitle } from '@/office/homeLogic';
import { appendRequests, arrivals, requestsArgs, requestsChoice, requestsFilterDefs, statusTone, withArrivals } from '@/office/requestsLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, RequestCard, RequestsList } from '@/office/types';
import { Avatar, DarkHeader, Divider, ListFailed, Row, Screen, Section, StatusChip } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, shadow } from '@/theme';

const SEARCH_DEBOUNCE_MS = 500;

export default function ApproveTab() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  // A link may name the status (Home's "N waiting": ?status=waiting, with a tap stamp `at`): the tab stays mounted, so
  // every new link puts its status back, whatever the person picked before.
  const params = useLocalSearchParams<{ status?: string; at?: string }>();
  const [values, setValues] = useState<FilterValues>(() => ({ status: params.status || 'waiting' }));
  useEffect(() => {
    if (params.status) setValues({ status: params.status });
  }, [params.status, params.at]);
  const status = requestsChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  // No timer on the list itself: it never jumps by itself (Sahan, 20 October 2026). A quiet look at the first page every
  // minute (below) updates the rows on screen in place and counts the new ones for the "New requests ↑" pill.
  const q = useTool<RequestsList>('list_requests', requestsArgs(status, search));
  // An answer for another filter or search is never shown under the one chosen.
  const shown = q.data && (q.data.status ?? status) === status ? q.data : null;
  const rows = shown?.requests ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const scroll = useRef<ScrollView>(null);
  const [fresh, setFresh] = useState<{ key: string; first: RequestCard[]; ids: string[] } | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const freshHere = fresh && fresh.key === q.key ? fresh : null;
  const look = useRef<() => void>(() => undefined);
  look.current = () => {
    const asked = q.key;
    if (!q.data) return;
    api.call<RequestsList>('list_requests', requestsArgs(status, search)).then((first) => {
      if (asked !== q.key) return;
      const news = arrivals(q.data?.requests ?? [], first.requests).fresh;
      q.patch((p) => ({ ...p, requests: arrivals(p.requests, first.requests).updated, ...(first.total !== undefined ? { total: first.total } : {}) }), asked);
      setFresh(news.length ? { key: asked, first: first.requests, ids: news.map((r) => r.id) } : null);
    }, () => undefined);
  };
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') look.current();
      }, 60_000);
      return () => clearInterval(timer);
    }, []),
  );
  function showNew() {
    if (!freshHere) return;
    const shown = freshHere;
    q.patch((p) => ({ ...p, requests: withArrivals(p.requests, shown.first) }), shown.key);
    setMarked(new Set(shown.ids));
    setFresh(null);
    scroll.current?.scrollTo({ y: 0, animated: true });
  }

  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<RequestsList>('list_requests', requestsArgs(status, search, q.data.next));
      q.patch((p) => appendRequests(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.approve.above')} title={t('office.approve.title')} />
      <Screen refreshing={q.refreshing} onRefresh={() => { setFresh(null); setMarked(new Set()); void q.reload(); }} scrollRef={scroll}>
        {freshHere && (
          <Pressable accessibilityRole="button" onPress={showNew} style={styles.newPill} testID="new-requests">
            <Txt variant="strong" size={15} color="#ffffff">{freshHere.ids.length === 1 ? t('office.approve.newOne') : t('office.approve.newOnes', { n: freshHere.ids.length })}</Txt>
          </Pressable>
        )}
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.requests.search')}
          defs={requestsFilterDefs(t)}
          values={values}
          onApply={setValues}
        />
        {!q.data && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!shown && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.data && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {shown && (
          <Section title={status === 'waiting' ? t('office.approve.waiting') : t(`office.requests.status_${status}`)} count={shown.total ?? rows.length}>
            {rows.length === 0 && <ListEmpty text={search ? t('office.requests.noneMatch') : status === 'waiting' ? t('office.approve.none') : t('office.requests.noneHere')} />}
            {rows.map((r, i) => {
              const reviewing = r.reviewing?.map((x) => x.name).join(', ');
              return (
                <View key={r.id}>
                  {i > 0 && <Divider />}
                  <Row
                    left={<Avatar name={r.requested_by} photo={r.requested_by_photo_url} />}
                    title={requestTitle(r)}
                    line={requestLine(r)}
                    line2={reviewing ? t('office.approve.reviewing', { name: reviewing }) : r.late ? t('office.approve.late') : undefined}
                    right={<View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {marked.has(r.id) && <StatusChip text={t('office.approve.newPill')} tone="blue" />}
                      <StatusChip text={t(`office.requests.status_${r.status}`)} tone={statusTone(r.status)} />
                      {r.asked ? <Txt variant="small" style={{ maxWidth: 100, textAlign: 'right' }} numberOfLines={1}>{r.asked}</Txt> : null}
                    </View>}
                    onPress={() => router.push({ pathname: '/office/request/[id]', params: { id: r.id } })}
                    testID="request-row"
                  />
                </View>
              );
            })}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {q.data?.next && <LoadMore shown={rows.length} total={q.data.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  // The pill at the top (Twitter's, Gmail's): ink, round, centred; the list under it stays where it is.
  newPill: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', ...shadow(3) },
});
