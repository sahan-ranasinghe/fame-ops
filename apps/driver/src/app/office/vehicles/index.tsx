// Office mode (Phase 8, O2, item 7; the standard patterns in O3, docs/ui-patterns.md): Vehicles under More (design 19's
// row; the list itself is not designed: the site's board as rows): the search bar (plate, make, regular driver,
// custodian, holder: on the server), one Filter button (All · On a task · Available · In garage · Documents expiring ·
// Returned, list_vehicles' own `filter`, with the fleet's counts in the sheet), the chip in use under it, skeleton rows
// while the first answer comes, 25 a page with Load more, a row per vehicle (the plate, make · seats, the status pill,
// the availability line, the document chips). "+ Register vehicle" only with register_vehicle (also as the empty
// list's action); a row opens the vehicle.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Plate } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { appendVehicles, docTone, kmLine, vehicleChoice, vehicleFilterDefs, vehiclesArgs, vehiclesEmpty, vehicleTone } from '@/office/manageLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleCard, VehiclesList } from '@/office/types';
import { BackHeader, ListFailed, Pill, Row, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const SEARCH_DEBOUNCE_MS = 400;

export default function VehiclesScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>({ filter: 'all' });
  const filter = vehicleChoice(values);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [typed]);
  const q = useTool<VehiclesList>('list_vehicles', vehiclesArgs(filter, search), { every: 60_000 });
  const d = q.data;
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const mayRegister = me.tools.includes('register_vehicle');
  const register = () => router.push('/office/vehicles/form');
  const empty = vehiclesEmpty(filter, search, mayRegister);

  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<VehiclesList>('list_vehicles', vehiclesArgs(filter, search, d.next));
      q.patch((p) => appendVehicles(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const docs = (v: VehicleCard) => {
    const list = [['lic', v.documents?.lic], ['ins', v.documents?.ins], ['emi', v.documents?.emi]] as const;
    return (
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
        {list.map(([k, dc]) => <Pill key={k} text={t(`office.vehicles.doc_${k}`)} tone={docTone(dc?.chip)} size={12} />)}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.vehicles.title')} subtitle={d?.total !== undefined ? t('office.vehicles.count', { n: d.total }) : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {me.tools.includes('register_vehicle') && <Button label={t('office.vehicles.register')} onPress={register} style={{ minHeight: 56 }} />}
        <FilterBar
          search={typed}
          onSearch={(v) => { setTyped(v); if (!v) setSearch(''); }}
          placeholder={t('office.vehicles.search')}
          defs={vehicleFilterDefs(d?.counts, t)}
          values={values}
          onApply={setValues}
        />
        {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!d && !q.error && <SkeletonRows rows={5} lines={2} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && d.vehicles.length === 0 && (
          <ListEmpty
            text={empty === 'noneMatch' ? t('office.vehicles.noneMatch', { text: search }) : t(`office.vehicles.${empty}`)}
            action={empty === 'noneRegister' ? t('office.vehicles.register') : undefined}
            onAction={empty === 'noneRegister' ? register : undefined}
          />
        )}
        {d && d.vehicles.length > 0 && (
          <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 4 }}>
            {d.vehicles.map((v, i) => {
              const km = kmLine(v);
              return (
                <View key={v.reg_no} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.line } : undefined}>
                  <Row
                    left={<Plate regNo={v.reg_no} />}
                    title={[v.make_model, v.seats ? t('office.vehicles.seats', { n: v.seats }) : ''].filter(Boolean).join(' · ') || v.reg_no}
                    line={[v.availability, v.held_by ? t('office.vehicles.heldBy', { name: v.held_by }) : v.assigned_to ? t('office.vehicles.assignedTo', { name: v.assigned_to }) : '', km.allow ? t('office.vehicles.kmOf', { used: km.used.toLocaleString('en-US'), allow: km.allow.toLocaleString('en-US') }) : ''].filter(Boolean).join(' · ')}
                    right={<Pill text={v.active === false ? t('office.vehicles.returned') : v.status ?? ''} tone={vehicleTone(v)} />}
                    onPress={() => router.push({ pathname: '/office/vehicles/[reg]', params: { reg: v.reg_no } })}
                  />
                  <View style={{ paddingHorizontal: 12, paddingBottom: 10, marginTop: -6 }}>{docs(v)}</View>
                </View>
              );
            })}
          </View>
        )}
        {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
        {d?.next && <LoadMore shown={d.vehicles.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
      </Screen>
    </View>
  );
}
