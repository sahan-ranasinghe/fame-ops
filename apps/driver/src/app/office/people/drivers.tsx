// Office mode (Phase 8, O2, item 7): People → Drivers (design 19's "Drivers · add, reset PIN, switch off" row): list_drivers
// with the search bar (name, username, code or plate, sent half a second after the last key), one Filter button (Active /
// With switched off: include_inactive), skeleton rows first, 25 a page with Load more on the cursor, pull to refresh. A row (the avatar, the name, the code and
// phone, on duty since · the plate, the active pill, the licence chip) opens Manage a driver (design 20). "+ Add driver"
// only with create_driver. The rules: office/peopleLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Button } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { activePill, appendDrivers, driverLine, driverLine2, driversArgs, includeInactiveOf, licenceTone, longDate, peopleDriverDefs, SEARCH_DEBOUNCE_MS } from '@/office/peopleLogic';
import { useOffice, useTool } from '@/office/state';
import type { Driver, DriversList, FleetError } from '@/office/types';
import { Avatar, BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function DriversPeople() {
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const names = { days: tList('days'), months: tList('months') };
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [values, setValues] = useState<FilterValues>({ show: 'active' });
  const filter = includeInactiveOf(values) ? 'all' : 'active';
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = useTool<DriversList>('list_drivers', driversArgs(search, filter === 'all'));
  const d = q.data;
  const canAdd = me.tools.includes('create_driver');

  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<DriversList>('list_drivers', driversArgs(search, filter === 'all', d.next));
      q.patch((p) => appendDrivers(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const renderRow = (x: Driver) => {
    const pill = activePill(x.active);
    const licence = x.licence?.expiry ? t('office.people.licence', { date: longDate(names, x.licence.expiry) }) : t('office.people.licenceNone');
    return (
      <Row
        left={<Avatar name={x.name} size={44} />}
        title={x.name}
        line={driverLine(x, t('office.people.noPhone'))}
        line2={driverLine2(x, t)}
        right={
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Pill text={t(`office.people.${pill.key}`)} tone={pill.tone} size={13} />
            <Pill text={licence} tone={x.licence?.expiry ? licenceTone(x.licence.chip) : 'muted'} size={12} />
          </View>
        }
        onPress={() => router.push({ pathname: '/office/people/driver/[username]', params: { username: x.username } })}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.people.drivers')} subtitle={t('office.people.driversAbove')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {canAdd && <Button kind="primary" label={t('office.people.addDriver')} onPress={() => router.push('/office/people/driver-new')} style={{ minHeight: 56 }} />}
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.people.search')}
          defs={peopleDriverDefs(t)}
          values={values}
          onApply={setValues}
        />
        {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!d && !q.error && <SkeletonRows rows={5} lines={2} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t('office.people.drivers')} count={d.total ?? d.drivers.length}>
            {d.drivers.length === 0
              ? (search
                ? <ListEmpty text={t('office.people.emptySearch', { search })} />
                : <ListEmpty text={t('office.people.emptyDrivers')} action={canAdd ? t('office.people.addDriver') : undefined} onAction={canAdd ? () => router.push('/office/people/driver-new') : undefined} />)
              : d.drivers.map((x, i) => <View key={x.username}>{i > 0 && <Divider />}{renderRow(x)}</View>)}
            {d.total !== undefined && d.total > d.drivers.length && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <LoadMore shown={d.drivers.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
              </View>
            )}
          </Section>
        )}
      </Screen>
    </View>
  );
}
