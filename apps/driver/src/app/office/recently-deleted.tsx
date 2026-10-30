// Round 52 (docs/phase8-plan.md §40; Gmail's and Google Drive's bin): Recently deleted under More (users only: list_bin).
// The one search field (what, who or why; sent half a second after the last key), 25 a page with Load more, skeletons, an
// empty state, Try again. Each row: what it was (its kind as a chip), its detail and "Deleted by <who> · <when>", the
// reason, "Restore until <date> (N days)", and Restore (restore_bin_item; it asks nothing): the snackbar "Restored <label>"
// and the row leaves the list; a refusal (a name or plate taken meanwhile, what it belonged to gone) shows the server's
// sentence under that row. The rules: office/binLogic.ts.

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Txt } from '@/components/ui';
import { appendPage, BIN_SEARCH_MS, binArgs, binKindKey, binRowWords } from '@/office/binLogic';
import { useOffice, useTool } from '@/office/state';
import type { BinItem, BinList, FleetError, RestoreBinResult } from '@/office/types';
import { BackHeader, Divider, ErrorNotice, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function RecentlyDeletedScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), BIN_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const q = useTool<BinList>('list_bin', binArgs(search));
  const d = q.data;
  const rows = d?.items ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const mayRestore = me.tools.includes('restore_bin_item');
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ id: string; error: FleetError } | null>(null);

  async function loadMore() {
    const k = q.key;
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<BinList>('list_bin', binArgs(search, d.next));
      q.patch((p) => appendPage(p, page, 'items'), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  async function restore(item: BinItem) {
    if (busy) return;
    setBusy(item.id);
    setRefused(null);
    try {
      const r = await api.call<RestoreBinResult>('restore_bin_item', { id: item.id });
      q.patch((p) => ({ ...p, items: p.items.filter((x) => x.id !== item.id), ...(p.total !== undefined ? { total: Math.max(0, p.total - 1) } : {}) }));
      showSnackbar({ text: t('office.bin.restored', { label: r.restored ?? item.label }) });
    } catch (e) {
      setRefused({ id: item.id, error: e as FleetError });
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.bin.title')} subtitle={t('office.bin.above')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setSearch(''); }} placeholder={t('office.bin.search')} defs={[]} values={{}} onApply={() => undefined} />
        {!d && !q.error && <SkeletonRows rows={5} lines={3} />}
        {q.error && <ListFailed stale={!!d} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t('office.bin.title')} count={d.total ?? rows.length}>
            {rows.length === 0 && <ListEmpty text={search ? t('office.bin.emptySearch', { search }) : t('office.bin.empty')} />}
            {rows.map((item, i) => {
              const w = binRowWords(item, t);
              return (
                <View key={item.id} testID="bin-row">
                  {i > 0 && <Divider />}
                  <Row title={w.title} line={w.line} line2={w.reason} right={<Pill text={t(binKindKey(item.kind))} tone="muted" />} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, flexWrap: 'wrap' }}>
                    <Txt variant="small" color={item.days_left <= 3 ? colors.amberText : colors.muted} style={{ flex: 1, minWidth: 160 }}>{w.until}</Txt>
                    {mayRestore && (
                      <Button kind="outline" label={t('office.bin.restore')} busy={busy === item.id} disabled={busy !== null && busy !== item.id} onPress={() => void restore(item)} compact testID="bin-restore" />
                    )}
                  </View>
                  {refused?.id === item.id && <ErrorNotice error={refused.error} onSignIn={() => void signOut()} />}
                </View>
              );
            })}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {d.next && <LoadMore shown={rows.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        )}
      </Screen>
    </View>
  );
}
