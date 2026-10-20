// Office mode (Stage 1, O3 item 3a): Tasks → History, the site's Task history (/tasks/history) on a phone, through
// list_tasks (assign_tasks). The date range pattern (one button, the presets, at most 366 days; Last 7 days at first), the
// search bar with the one Filter button (driver, vehicle, status, kind; the chips in use under it), the whole range's
// totals, then the tasks newest first, 25 at a time with Load more on the cursor; skeleton rows while the first answer
// comes (and while other days load: never the old days' rows), the empty state that says why, the error with Try again,
// pull to refresh. A row opens the task (/office/task/[id]). Reached from the Tasks tab's History button, and from More
// for a person whose bar has no Tasks tab. The rules: office/taskHistoryLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DateRangeButton } from '@/components/patterns/Calendar';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Mono, Txt } from '@/components/ui';
import { rangeWords } from '@/lib/patterns/calendarLogic';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { colomboDate } from '@/lib/time';
import {
  appendHistory, defaultHistoryRange, emptyHistoryValues, emptyKey, HISTORY_MAX_DAYS, HISTORY_SEARCH_MS, historyArgs, historyChoice, historyFilterDefs,
  historyTone, routeText, rowSub, sameRange, statusKey, totalsLine,
} from '@/office/taskHistoryLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriversList, FleetError, TaskHistory, VehiclesList } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TaskHistoryScreen() {
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const today = colomboDate();
  const [range, setRange] = useState(() => defaultHistoryRange(today));
  const [values, setValues] = useState<FilterValues>(emptyHistoryValues);
  const choice = historyChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  // The words typed go to the server half a second after the last key (every key would be a call).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), HISTORY_SEARCH_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const allowed = me.tools.includes('list_tasks');
  const q = useTool<TaskHistory>('list_tasks', historyArgs(range, choice, search), { enabled: allowed });
  const drivers = useTool<DriversList>('list_drivers', { limit: 100 }, { enabled: allowed && me.tools.includes('list_drivers') });
  const vehicles = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { enabled: allowed && me.tools.includes('list_vehicles') });
  const defs = historyFilterDefs(drivers.data?.drivers ?? [], vehicles.data?.vehicles ?? [], t);
  // The answer shown is the range chosen (other days on their way: the skeleton).
  const d = sameRange(q.data, range) ? q.data : null;
  const names = { days: tList('days'), months: tList('months') };

  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<TaskHistory>('list_tasks', historyArgs(range, choice, search, d.next));
      q.patch((p) => appendHistory(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const reload = () => void q.reload();

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.history2.title')} subtitle={t('office.history2.above')} />
      <Screen refreshing={q.refreshing} onRefresh={reload}>
        <DateRangeButton value={range} onChange={setRange} max={today} maxDays={HISTORY_MAX_DAYS} testID="history-range" />
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.history2.search')}
          defs={defs}
          values={values}
          onApply={setValues}
          testID="history-filter"
        />
        {!allowed && <ListEmpty text={t('office.history2.noAccess')} />}
        {allowed && !d && q.error && <ListFailed error={q.error} onRetry={reload} onSignIn={() => void signOut()} />}
        {allowed && !d && !q.error && <SkeletonRows rows={5} lines={2} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={reload} onSignIn={() => void signOut()} />}
        {d && <Txt variant="muted" size={15} testID="history-totals">{totalsLine(d, t)}</Txt>}
        {d?.more ? <Txt variant="small" color={colors.amberText}>{d.more}</Txt> : null}
        {d && (
          <Section title={t('office.history2.title')} count={d.total ?? d.count}>
            {d.tasks.length === 0 && <ListEmpty text={t(emptyKey(search, choice), { search })} />}
            {d.tasks.map((x, i) => {
              const key = statusKey(x.status);
              return (
                <View key={x.id}>
                  {i > 0 && <Divider />}
                  <Row
                    testID="history-row"
                    left={(
                      <View style={{ width: 62 }}>
                        <Mono size={16} bold>{x.time}</Mono>
                        <Txt variant="small" numberOfLines={1}>{rangeWords({ from: x.date, to: x.date }, names)}</Txt>
                      </View>
                    )}
                    title={x.title}
                    line={[x.driver, x.vehicle, routeText(x, t)].filter(Boolean).join(' · ')}
                    line2={rowSub(x, t) || undefined}
                    right={<Pill text={key ? t(key) : x.status} tone={historyTone(x.status)} size={13} />}
                    onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: x.id } })}
                  />
                </View>
              );
            })}
            {(d.next || more.error) && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <LoadMore shown={d.tasks.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
              </View>
            )}
          </Section>
        )}
      </Screen>
    </View>
  );
}
