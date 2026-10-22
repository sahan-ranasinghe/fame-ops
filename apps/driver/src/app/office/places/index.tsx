// Office mode (Stage 1, O3 row 8): Places (More → Places): the office's own places, the operators' sites and the removed
// ones (list_places) with the search box and one Filter (whose places, with or without a pin), 50 a page with Load more,
// skeletons, empty states, Try again (docs/ui-patterns.md §1, §5). A row opens the place's page. The rules:
// office/placesLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { appendPlaces, placeLine, placesArgs, placesChoice, placesFilterDefs, type PlacesList } from '@/office/placesLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { datesInWords } from '@/lib/dateWords';

const SEARCH_DEBOUNCE_MS = 500;

export default function PlacesScreen() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>({ who: 'ours', pin: 'any' });
  const { who, pin } = placesChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  // useTool keeps an answer with the args that asked for it: a previous filter's places never show under this one.
  const q = useTool<PlacesList>('list_places', placesArgs(who, pin, search));
  const shown = q.data;
  const rows = shown?.places ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<PlacesList>('list_places', placesArgs(who, pin, search, q.data.next));
      q.patch((p) => appendPlaces(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.places.title')} subtitle={t('office.places.subtitle')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setSearch(''); }} placeholder={t('office.places.search')} defs={placesFilterDefs(t)} values={values} onApply={setValues} />
        {!shown && !q.error && <SkeletonRows rows={5} lines={2} />}
        {q.error && <ListFailed stale={!!shown} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {shown && (
          <Section title={t(`office.places.who_${who}`)} count={shown.total ?? rows.length}>
            {rows.length === 0 && <ListEmpty text={search ? t('office.places.noneMatch') : t(`office.places.none_${who}`)} />}
            {rows.map((p, i) => (
              <View key={p.id ?? `${p.name}-${i}`}>
                {i > 0 && <Divider />}
                <Row
                  title={p.name}
                  line={placeLine(p) || undefined}
                  line2={p.removed ? t('office.places.removedAt', { at: datesInWords(t, p.removed) }) : undefined}
                  // Round 4–7 (item 8): the operator only where the section does not say it already (Dialog sites, Mobitel sites).
                  right={p.pinned === false ? <Pill text={t('office.places.noPin')} tone="amber" /> : p.operator && p.operator !== who ? <Pill text={p.operator === 'dialog' ? 'Dialog' : 'Mobitel'} tone="muted" /> : undefined}
                  onPress={p.id ? () => router.push({ pathname: '/office/places/[id]', params: { id: p.id! } }) : undefined}
                  testID="place-row"
                />
              </View>
            ))}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {q.data?.next && shown && <LoadMore shown={rows.length} total={q.data.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        )}
      </Screen>
    </View>
  );
}
