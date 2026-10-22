// Office mode (Stage 1, O3 row 6): Maintenance, the vehicle problems drivers reported (list_vehicle_reports, the issues
// permission): the search box and one Filter (Not closed by default, Open, In garage, Closed, All), 25 a page with Load
// more, skeletons, empty states, Try again (docs/ui-patterns.md §1, §5). A row opens the report's page
// (maintenance/[id]). The rules: office/maintenanceLogic.ts.
//
// Round 4–7 (item 8, §33.7; Fleetio): the screen's first view is "Service and documents": the summary, then ONE card per
// vehicle (list_vehicles): the service due by km and by date with its bar, the documents as chips (ok / expiring /
// expired / missing; the rental's end), the ones that need attention first (All vehicles shows every one), a card to
// the vehicle. "Problem reports" (the segment, with list_vehicle_reports; ?view=reports from the Issues header) is the
// list above, unchanged. What the old reminders also counted (the km allowance, missed tasks, odometer checks…) is in
// Issues: one line counts it and opens Issues.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Check } from '@/components/icons';
import { CareCard, CareSummary } from '@/components/office/VehicleCare';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Plate, Segmented, Txt } from '@/components/ui';
import { colomboDate } from '@/lib/time';
import { isReminderKind } from '@/office/overviewLogic';
import { careCards, careCounts } from '@/office/vehicleCareLogic';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { appendReports, categoryKey, handReport, reportsArgs, reportsChoice, reportsFilterDefs, reportTone } from '@/office/maintenanceLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, Overview, VehicleReports, VehiclesList } from '@/office/types';
import { BackHeader, Divider, ListFailed, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords } from '@/lib/dateWords';

const SEARCH_DEBOUNCE_MS = 500;

/** The cards shown 25 at a time (Load more). */
const CARDS_PAGE = 25;

export default function MaintenanceScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  // Round 4–7 (item 8): Service and documents first; Problem reports with their tool (the Issues header opens them).
  const mayReports = me.tools.includes('list_vehicle_reports');
  const [view, setView] = useState<'service' | 'reports'>(params.view === 'reports' && mayReports ? 'reports' : 'service');
  const [show, setShow] = useState<'attention' | 'all'>('attention');
  const [cardsShown, setCardsShown] = useState(CARDS_PAGE);
  const vehicles = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { enabled: view === 'service' && me.tools.includes('list_vehicles'), every: 60_000 });
  const overview = useTool<Overview>('fleet_overview', {}, { enabled: view === 'service' && me.tools.includes('fleet_overview') });
  const cards = careCards(vehicles.data?.vehicles ?? [], colomboDate());
  const shownCards = show === 'all' ? cards : cards.filter((c) => c.level > 0);
  const elsewhere = (overview.data?.needs_attention ?? []).filter((a) => !isReminderKind(a.kind) && a.kind !== 'vehicle_report').length;
  const [values, setValues] = useState<FilterValues>({ status: 'not_closed' });
  const status = reportsChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const q = useTool<VehicleReports>('list_vehicle_reports', reportsArgs(status, search), { every: 60_000, enabled: mayReports && view === 'reports' });
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
      <BackHeader title={t('office.maint.title')} subtitle={view === 'reports' ? t('office.maint.subtitle') : t('office.care.view.service')} />
      {view === 'service' ? (
        <Screen refreshing={vehicles.refreshing} onRefresh={() => void Promise.all([vehicles.reload(), overview.reload()])}>
          {mayReports && <Segmented options={[{ value: 'service', label: t('office.care.view.service') }, { value: 'reports', label: t('office.care.view.reports') }]} value={view} onChange={setView} />}
          {!vehicles.data && !vehicles.error && <SkeletonRows rows={4} lines={3} />}
          {vehicles.error && <ListFailed stale={!!vehicles.data} error={vehicles.error} onRetry={() => void vehicles.reload()} onSignIn={() => void signOut()} />}
          {vehicles.data && (
            <>
              <CareSummary counts={careCounts(cards)} />
              <Segmented options={[{ value: 'attention', label: t('office.care.show.attention') }, { value: 'all', label: t('office.care.show.all') }]} value={show} onChange={(v) => { setShow(v); setCardsShown(CARDS_PAGE); }} />
              <Section title={t(`office.care.title.${show}`)} count={shownCards.length}>
                {shownCards.length === 0 && <ListEmpty icon={Check} text={t(`office.care.empty.${show}`)} />}
              </Section>
              {shownCards.slice(0, cardsShown).map((c) => (
                <CareCard key={c.reg_no} c={c} onPress={() => router.push({ pathname: '/office/vehicles/[reg]', params: { reg: c.reg_no } })} />
              ))}
              {shownCards.length > cardsShown && <LoadMore shown={cardsShown} total={shownCards.length} busy={false} onPress={() => setCardsShown((n) => n + CARDS_PAGE)} />}
            </>
          )}
          {elsewhere > 0 && (
            <Row
              title={elsewhere === 1 ? t('office.care.issuesLineOne') : t('office.care.issuesLine', { n: elsewhere })}
              line={t('office.care.issuesLineSub')}
              right={<Txt variant="strong" size={15} color={colors.blue}>{t('office.care.openIssues')}</Txt>}
              onPress={() => router.push('/office/issues')}
              testID="maintenance-issues"
            />
          )}
        </Screen>
      ) : (
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <Segmented options={[{ value: 'service', label: t('office.care.view.service') }, { value: 'reports', label: t('office.care.view.reports') }]} value={view} onChange={setView} />
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
                  line={[r.driver, dateWords(t, r.reported), r.photos.length ? t('office.maint.photosN', { n: r.photos.length }) : ''].filter(Boolean).join(' · ')}
                  line2={r.note ?? undefined}
                  chip={{ text: t(`office.maint.status_${r.status}`), tone: reportTone(r.status) }}
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
      )}
    </View>
  );
}
