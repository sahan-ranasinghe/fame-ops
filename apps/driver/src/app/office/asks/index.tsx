// Office mode (Stage 1, O3 item 7): the questions asked to drivers in the last 7 days (ask_answers without an ask_id),
// newest first, 20 a page with Load more: the question, who asked and when, "3 of 5 answered · 2 yes", a row opens the
// question's page. With approve or assign_tasks (the tools ask_drivers / ask_answers). The list pattern
// (docs/ui-patterns.md §5): skeletons, pull to refresh, an empty state, Try again.
// Round 4–7 (item 10, per person): the person's OWN questions by default (ask_answers answers only those); someone with
// approve has "Mine · Everyone's" (ask_answers all: true), the site's switch (office/askLogic.ts asksArgs).

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ListEmpty, ListError, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { listView } from '@/lib/patterns/listLogic';
import { Segmented } from '@/components/ui';
import { appendAsks, askCountsLine, asksArgs, type Whose } from '@/office/askLogic';
import { useOffice, useTool } from '@/office/state';
import type { AskAnswers, FleetError } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';

export default function AsksScreen() {
  const { t } = useApp();
  const { api, me } = useOffice();
  const router = useRouter();
  const approver = me.permissions.includes('approve');
  const [whose, setWhose] = useState<Whose>('mine');
  const args = asksArgs(whose, approver);
  const q = useTool<AskAnswers>('ask_answers', { ...args, limit: 20 }, { every: 30_000 });
  const asks = q.data?.asks ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const view = listView({ loading: q.loading, hasData: !!q.data, count: asks.length, error: !!q.error });

  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<AskAnswers>('ask_answers', { ...args, limit: 20, cursor: q.data.next });
      q.patch((p) => appendAsks(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <BackHeader title={t('office.asks.title')} subtitle={t('office.asks.subtitle')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {approver && (
          <View accessibilityLabel={t('office.asks.whose')} testID="asks-whose">
            <Segmented<Whose> options={[{ value: 'mine', label: t('office.asks.mine') }, { value: 'all', label: t('office.asks.everyone') }]} value={whose} onChange={setWhose} />
          </View>
        )}
        {view === 'skeleton' && <SkeletonRows rows={4} />}
        {view === 'error' && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} />}
        {view === 'empty' && <ListEmpty text={t('office.asks.empty')} />}
        {(view === 'rows' || view === 'rows_stale') && (
          <>
            {view === 'rows_stale' && <ListError stale message="" onRetry={() => void q.reload()} />}
            <Section title={approver && whose === 'all' ? t('office.asks.everyoneLastDays') : t('office.asks.lastDays')} count={q.data?.total ?? asks.length}>
              {asks.map((a, i) => (
                <View key={a.id}>
                  {i > 0 && <Divider />}
                  <Row
                    title={a.question}
                    line={[t('office.asks.askedBy', { name: a.asked_by, when: a.asked }), a.note].filter(Boolean).join(' · ')}
                    line2={askCountsLine(a.counts, t)}
                    right={a.expired ? <Pill text={t('office.asks.closed')} tone="muted" /> : a.counts.yes > 0 ? <Pill text={t('office.asks.yesN', { n: a.counts.yes })} tone="green" /> : undefined}
                    onPress={() => router.push({ pathname: '/office/asks/[id]', params: { id: a.id } })}
                    testID="ask-row"
                  />
                </View>
              ))}
            </Section>
            {more.error && <ListFailed stale error={more.error} onRetry={() => void loadMore()} />}
            {q.data?.next && <LoadMore shown={asks.length} total={q.data.total} busy={more.busy} onPress={() => void loadMore()} />}
          </>
        )}
      </Screen>
    </View>
  );
}
