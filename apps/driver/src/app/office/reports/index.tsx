// Office mode (Phase 8, O2, item 7; the standard patterns in O3, docs/ui-patterns.md): Reports under More (design 19's
// row), read-only, as the site's Mileage, Fuel and Duty log pages: Mileage · Fuel · Duty log as a segmented control, the
// days as one date range button (the presets Today, Yesterday, Last 7 days, This month, Last month, and one calendar;
// a whole month is asked as `month`, other days as from/to; the duty log at most 62 days). Mileage (mileage_summary): the
// tiles, personal km, each vehicle's rows, the biggest gaps, unlogged km and the odometer checks; beside a shorter
// range the month that contains the last day with the allowance. Fuel (list_fuel): the totals, a row per fill with its
// video's state, Load more. Duty log (duty_log): the totals, a row per duty period (clock in, clock out and how, the
// vehicles held, the tasks, hours, km), Load more. Each section only with its tool; filters by vehicle or driver and
// the videos themselves are laptop work.

import { useState } from 'react';
import { View } from 'react-native';

import { DateRangeButton } from '@/components/patterns/Calendar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Mono, Plate, Segmented, Txt } from '@/components/ui';
import { presetRange } from '@/lib/patterns/calendarLogic';
import { colomboDate } from '@/lib/time';
import {
  appendDuty, appendFuel, clockOut, dutyArgs, heldLine, hoursText, mileageView, outHowKey, outsideKm, rangeArgs, rangeFits, REPORT_MAX_DAYS, type ReportSection, reportSections, rowCells,
  videoChip, videoLine,
} from '@/office/manageLogic';
import { useOffice, useTool } from '@/office/state';
import type { DutyLog, FleetError, FuelList, MileageSummary, Row } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ReportsScreen() {
  const { t } = useApp();
  const { me } = useOffice();
  const sections = reportSections(me.tools);
  const [section, setSection] = useState<ReportSection>(sections[0] ?? 'mileage');
  const today = colomboDate();
  // The days: This month by default (the 1st to today), as before.
  const [range, setRange] = useState(() => presetRange('this_month', today));
  const { from, to } = range;
  const fits = rangeFits(section, from, to);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.reports.title')} />
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10, backgroundColor: colors.page }}>
        {sections.length > 1 && <Segmented<ReportSection> options={sections.map((k) => ({ value: k, label: t(`office.reports.${k}`) }))} value={section} onChange={setSection} />}
        {sections.length > 0 && <DateRangeButton value={range} onChange={setRange} max={today} maxDays={REPORT_MAX_DAYS[section]} testID="reports-range" />}
      </View>
      {sections.length === 0 ? (
        <Screen><ListEmpty text={t('office.reports.nothing')} /></Screen>
      ) : !fits ? (
        <Screen><ListEmpty text={t('office.reports.tooLong', { n: REPORT_MAX_DAYS[section] })} /></Screen>
      ) : section === 'mileage' ? (
        <Mileage from={from} to={to} />
      ) : section === 'fuel' ? (
        <Fuel from={from} to={to} />
      ) : (
        <Duty from={from} to={to} />
      )}
    </View>
  );
}

function Tile({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: 'amber' }) {
  return (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: colors.card, borderColor: tone === 'amber' ? colors.amber : colors.line, borderWidth: 1, borderRadius: 16, padding: 12, gap: 2 }}>
      <Txt variant="label" color={colors.muted} numberOfLines={1}>{label.toUpperCase()}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Mono size={24} bold>{value}</Mono>
        {unit ? <Txt variant="muted" size={14}>{unit}</Txt> : null}
      </View>
      {sub ? <Txt variant="small" numberOfLines={2}>{sub}</Txt> : null}
    </View>
  );
}

/** A generic table as rows of "key: value" lines (the server's column names, worded where the app knows them). */
function Rows({ rows, hide, empty }: { rows: Row[]; hide?: readonly string[]; empty: string }) {
  const { t } = useApp();
  if (rows.length === 0) return <ListEmpty text={empty} />;
  // A column the app has no word for is shown by its name.
  const word = (key: string) => { const k = `office.reports.col_${key}`; const w = t(k); return w === k ? key.replace(/_/g, ' ') : w; };
  return (
    <View>
      {rows.map((r, i) => {
        const cells = rowCells(r, hide);
        const head = cells.find((c) => c.key === 'vehicle' || c.key === 'driver') ?? cells[0];
        return (
          <View key={i} style={{ paddingVertical: 10, gap: 4 }}>
            {i > 0 && <Divider />}
            {head && (head.key === 'vehicle' ? <Plate regNo={head.value} /> : <Txt variant="strong">{head.value}</Txt>)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {cells.filter((c) => c !== head).map((c) => (
                <View key={c.key} style={{ flexDirection: 'row', gap: 4, alignItems: 'baseline' }}>
                  <Txt variant="small">{word(c.key)}</Txt>
                  <Mono size={15} bold>{c.value}</Mono>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Mileage({ from, to }: { from: string; to: string }) {
  const { t } = useApp();
  const { signOut } = useOffice();
  const q = useTool<MileageSummary>('mileage_summary', rangeArgs(from, to));
  const v = q.data ? mileageView(q.data) : null;
  const n = (x: number) => (Number(x) || 0).toLocaleString('en-US');
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
      {!v && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {!v && !q.error && <SkeletonRows rows={4} lines={2} />}
      {v && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {v && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Tile label={t('office.reports.completedTasks')} value={n(v.totals.tasks)} />
            <Tile label={t('office.reports.taskKm')} value={n(v.totals.task_km)} unit="km" sub={t('office.reports.fromOdometer')} />
            <Tile label={t('office.reports.outsideKm')} value={n(outsideKm(v.totals))} unit="km" tone={outsideKm(v.totals) > 0 ? 'amber' : undefined} sub={outsideKm(v.totals) ? t('office.reports.outsideSub', { between: n(v.totals.between_tasks_km), overnight: n(v.totals.overnight_km) }) : t('office.reports.outsideNone')} />
            <Tile label={t('office.reports.fuel')} value={n(v.totals.fuel_litres)} unit={t('office.reports.litres')} sub={`LKR ${n(v.totals.fuel_lkr)}`} />
          </View>
          {v.totals.personal_km ? <Txt variant="muted" size={15}>{t('office.reports.personalKm', { km: n(v.totals.personal_km) })}</Txt> : null}
          <Section title={t('office.reports.byVehicle')} count={v.vehicles.length}>
            <Txt variant="small">{t(v.month ? 'office.reports.byVehicleNoteRange' : 'office.reports.byVehicleNote')}</Txt>
            <Rows rows={v.vehicles} hide={v.month ? ['km_allowance', 'over_allowance'] : []} empty={t('office.reports.noneLogged')} />
          </Section>
          {v.month && (
            <Section title={t('office.reports.monthAllowance', { month: v.month.month })} count={v.month.rows.length}>
              <Txt variant="small">{t('office.reports.monthAllowanceNote')}</Txt>
              <Rows rows={v.month.rows} empty={t('office.reports.noneLogged')} />
            </Section>
          )}
          <Section title={t('office.reports.biggestGaps')} count={v.biggest_gaps.length}>
            <Txt variant="small">{t('office.reports.gapsNote')}</Txt>
            <Rows rows={v.biggest_gaps} empty={t('office.reports.noGaps')} />
          </Section>
          <Section title={t('office.reports.unloggedKm')} count={v.unlogged_km.length}>
            <Txt variant="small">{t('office.reports.unloggedNote')}</Txt>
            <Rows rows={v.unlogged_km} empty={t('office.reports.none')} />
          </Section>
          <Section title={t('office.reports.odometerChecks')} count={v.check_odometer.length}>
            <Txt variant="small">{t('office.reports.checksNote')}</Txt>
            <Rows rows={v.check_odometer} empty={t('office.reports.checksNone')} />
          </Section>
        </>
      )}
    </Screen>
  );
}

function Fuel({ from, to }: { from: string; to: string }) {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const q = useTool<FuelList>('list_fuel', rangeArgs(from, to, { limit: 25 }));
  const d = q.data;
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const n = (x: number | null | undefined) => (Number(x) || 0).toLocaleString('en-US');
  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<FuelList>('list_fuel', rangeArgs(from, to, { limit: 25, cursor: d.next }));
      q.patch((p) => appendFuel(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
      {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {!d && !q.error && <SkeletonRows rows={4} lines={2} />}
      {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {d && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Tile label={t('office.reports.fills')} value={n(d.totals.entries)} />
            <Tile label={t('office.reports.litres')} value={n(d.totals.litres)} sub={`LKR ${n(d.totals.lkr)}`} />
            <Tile label={t('office.reports.videos')} value={n(d.totals.videos)} sub={[d.totals.videos_waiting ? t('office.reports.videosWaiting', { n: d.totals.videos_waiting }) : '', d.totals.videos_missing ? t('office.reports.videosMissing', { n: d.totals.videos_missing }) : ''].filter(Boolean).join(' · ') || undefined} tone={d.totals.videos_missing ? 'amber' : undefined} />
          </View>
          {d.month_totals && <Txt variant="muted" size={15}>{t('office.reports.fuelMonthLine', { month: d.month, n: n(d.month_totals.entries), litres: n(d.month_totals.litres), lkr: n(d.month_totals.lkr) })}</Txt>}
          <Section title={t('office.reports.fuel')} count={d.total ?? d.entries.length}>
            {d.entries.length === 0 && <ListEmpty text={t('office.reports.noFills')} />}
            {d.entries.map((e, i) => {
              const chip = videoChip(e.video);
              return (
                <View key={e.id} style={{ paddingVertical: 10, gap: 4 }}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Mono size={15} bold>{e.at}</Mono>
                    {e.vehicle ? <Plate regNo={e.vehicle.split(' · ')[0]} /> : null}
                    <View style={{ flex: 1 }} />
                    <Pill text={t(`office.reports.video_${chip.key}`)} tone={chip.tone} size={12} />
                  </View>
                  <Txt variant="muted" size={15}>{[e.driver, e.litres != null ? `${n(e.litres)} ${t('office.reports.litres')}` : '', e.lkr != null ? `LKR ${n(e.lkr)}` : '', e.odometer_km != null ? `${n(e.odometer_km)} km` : '', videoLine(e.video)].filter(Boolean).join(' · ')}</Txt>
                </View>
              );
            })}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {d.next && <LoadMore shown={d.entries.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
          <Txt variant="small">{t('office.reports.videosLaptop')}</Txt>
        </>
      )}
    </Screen>
  );
}

function Duty({ from, to }: { from: string; to: string }) {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const q = useTool<DutyLog>('duty_log', dutyArgs(from, to, { limit: 25 }));
  const d = q.data;
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  const n = (x: number | null | undefined) => (Number(x) || 0).toLocaleString('en-US');
  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<DutyLog>('duty_log', dutyArgs(from, to, { limit: 25, cursor: d.next }));
      q.patch((p) => appendDuty(p, page));
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
      {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {!d && !q.error && <SkeletonRows rows={4} lines={2} />}
      {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
      {d && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Tile label={t('office.reports.dutyPeriods')} value={n(d.totals.periods)} />
            <Tile label={t('office.reports.hours')} value={hoursText(d.totals.hours)} />
            <Tile label={t('office.reports.taskKm')} value={n(d.totals.task_km)} unit="km" sub={d.totals.gps_km != null ? t('office.reports.gpsKm', { km: n(d.totals.gps_km) }) : undefined} />
          </View>
          {d.gps_note ? <Txt variant="small">{d.gps_note}</Txt> : null}
          <Section title={t('office.reports.duty')} count={d.total ?? d.periods.length}>
            {d.periods.length === 0 && <ListEmpty text={t(from === to && from === colomboDate() ? 'office.reports.nobodyToday' : 'office.reports.nobodyRange')} />}
            {d.periods.map((p, i) => {
              const out = clockOut(p);
              return (
                <View key={`${p.username ?? p.driver}-${p.day}-${p.clock_in}`} style={{ paddingVertical: 10, gap: 4 }}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Txt variant="strong" style={{ flex: 1 }}>{p.driver ?? ''}</Txt>
                    <Mono size={14} color={colors.muted}>{p.day}</Mono>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Mono size={16} bold>{p.clock_in}</Mono>
                    <Txt variant="muted">→</Txt>
                    {out.onDuty ? <Pill text={t('office.reports.onDuty')} tone="blue" /> : <Mono size={16} bold>{out.time}</Mono>}
                    {!out.onDuty && out.how ? <Txt variant="small">{t(`office.reports.out_${outHowKey(out.how)}`, { how: out.how })}</Txt> : null}
                    <View style={{ flex: 1 }} />
                    <Mono size={15} bold>{hoursText(p.hours)}</Mono>
                  </View>
                  <Txt variant="muted" size={15}>{[...p.vehicles.map((v) => heldLine(v, t('office.reports.now'))), p.tasks.length ? t('office.reports.tasksN', { n: p.tasks.length }) : '', `${n(p.task_km)} km`].filter(Boolean).join(' · ')}</Txt>
                  {p.opened_by_server ? <Txt variant="small">{t('office.reports.openedByServer')}</Txt> : null}
                </View>
              );
            })}
            {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
            {d.next && <LoadMore shown={d.periods.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
          </Section>
        </>
      )}
    </Screen>
  );
}
