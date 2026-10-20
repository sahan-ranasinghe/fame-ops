// Office mode (Stage 1, O3 row 6): Maintenance, the vehicle problems drivers reported (list_vehicle_reports, the issues
// permission): the search box and one Filter (Not closed by default, Open, In garage, Closed, All), 25 a page with Load
// more, skeletons, empty states, Try again (docs/ui-patterns.md §1, §5). A row opens the report's page
// (maintenance/[id]). The rules: office/maintenanceLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Plate } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { appendReports, categoryKey, handReport, reportsArgs, reportsChoice, reportsFilterDefs, reportTone } from '@/office/maintenanceLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, VehicleReports } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const SEARCH_DEBOUNCE_MS = 500;

export default function MaintenanceScreen() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>({ status: 'not_closed' });
  const status = reportsChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const q = useTool<VehicleReports>('list_vehicle_reports', reportsArgs(status, search), { every: 60_000 });
  const shown = q.data && q.data.status === status ? q.data : null;
  const rows = shown?.reports ?? [];
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<VehicleReports>('list_vehicle_reports', reportsArgs(status, search, q.data.next));
      q.patch((p) => appendReports(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.maint.title')} subtitle={t('office.maint.subtitle')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setSearch(''); }} placeholder={t('office.maint.search')} defs={reportsFilterDefs(t)} values={values} onApply={setValues} />
        {!shown && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {shown && (
          <Section title={t(`office.maint.filter_${status}`)} count={shown.total ?? rows.length}>
            {rows.length === 0 && <ListEmpty text={search ? t('office.maint.noneMatch') : t(`office.maint.none_${status}`)} />}
            {rows.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider />}
                <Row
                  left={r.vehicle ? <Plate regNo={r.vehicle} /> : undefined}
                  title={t(categoryKey(r.category))}
                  line={[r.driver, r.reported, r.photos.length ? t('office.maint.photosN', { n: r.photos.length }) : ''].filter(Boolean).join(' · ')}
                  line2={r.note ?? undefined}
                  right={<Pill text={t(`office.maint.status_${r.status}`)} tone={reportTone(r.status)} />}
                  onPress={() => { handReport(r); router.push({ pathname: '/office/maintenance/[id]', params: { id: r.id } }); }}
                  testID="report-row"
                />
              </View>
            ))}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {q.data?.next && <LoadMore shown={rows.length} total={q.data.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        )}
      </Screen>
    </View>
  );
}
