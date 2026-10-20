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
  const args = placesArgs(who, pin, search);
  const key = JSON.stringify(args);
  const q = useTool<PlacesList>('list_places', args);
  // The answer for the filter on screen only (a slow answer for the previous filter is never shown under this one).
  const [shownFor, setShownFor] = useState('');
  useEffect(() => {
    if (q.data && !q.loading) setShownFor(key);
  }, [q.data, q.loading, key]);
  const shown = q.data && shownFor === key ? q.data : null;
  const rows = shown?.places ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  async function loadMore() {
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<PlacesList>('list_places', placesArgs(who, pin, search, q.data.next));
      q.patch((p) => appendPlaces(p, page));
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
                  line2={p.removed ? t('office.places.removedAt', { at: p.removed }) : undefined}
                  right={p.pinned === false ? <Pill text={t('office.places.noPin')} tone="amber" /> : p.operator ? <Pill text={p.operator === 'dialog' ? 'Dialog' : 'Mobitel'} tone="muted" /> : undefined}
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
