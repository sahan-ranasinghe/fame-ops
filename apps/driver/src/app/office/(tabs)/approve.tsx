// Office mode (Phase 8, O1; Stage 1, O3 rows 2 and 9): the Approve tab. The queue of requests waiting for a decision
// (list_requests waiting, which includes changed = approved and edited since) by default; the search box and one Filter
// (Waiting, Approved, Declined, Cancelled, All) reach every request, 25 at a time with Load more (docs/ui-patterns.md
// §1, §5). A row opens the request's page (Approve a request, design 10, or the decided request with its timeline and
// Tell requester), with "Palitha is reviewing" when another approver has it open. Rules: office/requestsLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Txt } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { requestLine, requestTitle } from '@/office/homeLogic';
import { appendRequests, requestsArgs, requestsChoice, requestsFilterDefs, statusTone } from '@/office/requestsLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, RequestsList } from '@/office/types';
import { Avatar, DarkHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const SEARCH_DEBOUNCE_MS = 500;

export default function ApproveTab() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>({ status: 'waiting' });
  const status = requestsChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const q = useTool<RequestsList>('list_requests', requestsArgs(status, search), { every: 60_000 });
  // An answer for another filter or search is never shown under the one chosen.
  const shown = q.data && (q.data.status ?? status) === status ? q.data : null;
  const rows = shown?.requests ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

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
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
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
                    left={<Avatar name={r.requested_by} />}
                    title={requestTitle(r)}
                    line={requestLine(r)}
                    line2={reviewing ? t('office.approve.reviewing', { name: reviewing }) : r.late ? t('office.approve.late') : undefined}
                    right={<View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Pill text={t(`office.requests.status_${r.status}`)} tone={statusTone(r.status)} />
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
