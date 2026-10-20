// Office mode (Phase 8, O2, item 7): Vehicles under More (design 19's row; the list itself is not designed: the site's
// board as rows): the chips All · On a task · Available · In garage · Documents expiring · Returned with the fleet's
// counts, a search box (plate, make, regular driver, custodian, holder: on the server), 25 a page with Load more, a row
// per vehicle (the plate, make · seats, the status pill, the availability line, the document chips). "+ Register
// vehicle" only with register_vehicle; a row opens the vehicle.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Plate, Txt } from '@/components/ui';
import { appendVehicles, docTone, filterCounts, kmLine, VEHICLE_FILTERS, type VehicleFilter, vehiclesArgs, vehicleTone } from '@/office/manageLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleCard, VehiclesList } from '@/office/types';
import { BackHeader, Empty, ErrorNotice, FilterChips, Loading, Pill, Row, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const SEARCH_DEBOUNCE_MS = 400;

export default function VehiclesScreen() {
  const { t, language } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const [filter, setFilter] = useState<VehicleFilter>('all');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setSearch(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [typed]);
  const q = useTool<VehiclesList>('list_vehicles', vehiclesArgs(filter, search), { every: 60_000 });
  const d = q.data;
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const counts = filterCounts(d?.counts);

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
        {me.tools.includes('register_vehicle') && <Button label={t('office.vehicles.register')} onPress={() => router.push('/office/vehicles/form')} style={{ minHeight: 56 }} />}
        <FilterChips<VehicleFilter>
          options={VEHICLE_FILTERS.map((k) => ({ key: k, label: t(`office.vehicles.filter_${k}`), n: counts[k] }))}
          value={filter}
          onChange={setFilter}
        />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder={t('office.vehicles.search')}
          placeholderTextColor="#9aa0a6"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('office.vehicles.search')}
          style={{ minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink, backgroundColor: colors.card, fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }}
        />
        {q.loading && !d && <Loading text={t('office.common.loading')} />}
        {q.error && !d && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && d.vehicles.length === 0 && <Empty text={search ? t('office.vehicles.noneMatch', { text: search }) : t('office.vehicles.none')} />}
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
        {more.error && <ErrorNotice error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
        {d?.next && <Button kind="outline" label={t('office.vehicles.loadMore')} busy={more.busy} onPress={() => void loadMore()} style={{ minHeight: 52 }} />}
        {d && d.vehicles.length > 0 && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.vehicles.shown', { n: d.vehicles.length, total: d.total ?? d.vehicles.length })}</Txt>}
      </Screen>
    </View>
  );
}
