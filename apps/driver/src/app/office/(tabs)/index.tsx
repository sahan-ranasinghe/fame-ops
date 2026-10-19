// Office mode (Phase 8, O1): Home by permission (designs 02–05). The dark header with the date, the greeting and the
// at-a-glance chips (fleet_overview), then the sections the person's permissions bring (office/nav.ts homeSections):
// requests to approve (list_requests), needs a driver (fleet_overview), critical issues (fleet_overview), today's tasks
// (task_board), on the road (fleet_overview), my trips (my_trips). Each card opens its real screen; pull to refresh, and
// everything is read again when the screen comes back. The trip editor (+ Assign a task, Request) is round O2: no big
// action button yet, so none is shown.

import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { addDays, colomboDate } from '@/lib/time';
import { shortDate } from '@/lib/durations';
import { boardLine, boardPill, greeting, isCreatedTask, requestLine, requestTitle, statusTone, tripLive, tripTitle } from '@/office/homeLogic';
import { has, homeChips, homeSections } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { firstName } from '@/office/text';
import type { Board, MyTrips, Overview, RequestsList } from '@/office/types';
import { Avatar, Chip, DarkHeader, Divider, Empty, ErrorNotice, Loading, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { Button } from '@/components/ui';

const ROWS = 5;

export default function OfficeHome() {
  const { t, tList } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const sections = homeSections(me.permissions);
  const chips = homeChips(me.permissions);
  const today = colomboDate();

  const overview = useTool<Overview>('fleet_overview', {}, { every: 60_000 });
  const requests = useTool<RequestsList>('list_requests', { status: 'waiting', limit: ROWS }, { enabled: sections.includes('requests'), every: 60_000 });
  const board = useTool<Board>('task_board', { date: today, limit: ROWS }, { enabled: sections.includes('tasks'), every: 60_000 });
  const trips = useTool<MyTrips>('my_trips', { from: addDays(today, -7), to: addDays(today, 30), limit: ROWS }, { enabled: sections.includes('trips') });

  const refresh = useCallback(() => {
    void Promise.all([overview.reload(), requests.reload(), board.reload(), trips.reload()]);
  }, [overview, requests, board, trips]);

  const names = { days: tList('days'), months: tList('months') };
  const ov = overview.data;
  const refreshing = overview.refreshing || requests.refreshing || board.refreshing || trips.refreshing;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={shortDate(names, Date.now())} title={t(`office.home.${greeting()}`, { name: firstName(me.name) })}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {ov && chips.includes('road') && <Chip n={ov.vehicles.on_the_road} text={t('office.home.onRoad')} tone="blue" onPress={has(me.permissions, 'view') ? () => router.push('/office/(tabs)/live') : undefined} />}
          {ov && chips.includes('free') && <Chip n={ov.vehicles.parked} text={t('office.home.free')} tone="muted" />}
          {ov && chips.includes('waiting') && <Chip n={ov.requests.waiting} text={t('office.home.waitingOk')} tone="amber" onPress={() => router.push('/office/(tabs)/approve')} />}
          {ov && chips.includes('garage') && ov.vehicles.in_garage !== undefined && <Chip n={ov.vehicles.in_garage} text={t('office.home.inGarage')} tone="muted" />}
        </View>
      </DarkHeader>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {overview.error && !ov && <ErrorNotice error={overview.error} onRetry={refresh} onSignIn={() => void signOut()} />}

        {sections.includes('requests') && (
          <Section title={t('office.home.requests')} count={ov?.requests.waiting} link={t('office.common.viewAll')} onLink={() => router.push('/office/(tabs)/approve')}>
            {requests.loading && <Loading text={t('office.common.loading')} />}
            {requests.error && !requests.data && <ErrorNotice error={requests.error} onRetry={refresh} />}
            {requests.data && requests.data.requests.length === 0 && <Empty text={t('office.home.noRequests')} />}
            {requests.data?.requests.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider />}
                <Row
                  left={<Avatar name={r.requested_by} />}
                  title={requestTitle(r)}
                  line={requestLine(r)}
                  right={r.asked ? <Txt variant="small" style={{ maxWidth: 90, textAlign: 'right' }}>{r.asked}</Txt> : undefined}
                  onPress={() => router.push({ pathname: '/office/request/[id]', params: { id: r.id } })}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('needs_driver') && (
          <Section title={t('office.home.needsDriver')} count={ov?.needs_driver?.count ?? 0} tone="red" link={has(me.permissions, 'assign_tasks') ? t('office.common.viewAll') : undefined} onLink={() => router.push('/office/(tabs)/tasks')}>
            {overview.loading && <Loading text={t('office.common.loading')} />}
            {ov && (ov.needs_driver?.tasks.length ?? 0) === 0 && <Empty text={t('office.home.noNeedsDriver')} />}
            {ov?.needs_driver?.tasks.slice(0, ROWS).map((x, i) => (
              <View key={x.task_id}>
                {i > 0 && <Divider />}
                <Row
                  title={x.title}
                  line={`${x.start} · ${x.line}`}
                  right={has(me.permissions, 'assign_tasks')
                    ? <Button kind="dark" label={t('office.home.giveDriver')} onPress={() => router.push({ pathname: '/office/task/[id]/driver', params: { id: x.task_id } })} style={{ minHeight: 48, backgroundColor: colors.red, paddingHorizontal: 14 }} />
                    : <Pill text={x.when} tone="red" />}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('critical') && (
          <Section title={t('office.home.critical')} count={ov?.critical?.count ?? 0} tone={ov?.critical?.count ? 'red' : undefined}>
            {overview.loading && <Loading text={t('office.common.loading')} />}
            {ov && (ov.critical?.items.length ?? 0) === 0 && <Empty text={t('office.home.noCritical')} />}
            {ov?.critical?.items.slice(0, ROWS).map((x, i) => (
              <View key={x.issue_id ?? `${x.what}-${i}`}>
                {i > 0 && <Divider />}
                <Row title={x.what} line={[x.subject, x.vehicle, x.due].filter(Boolean).join(' · ')} />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('tasks') && (
          <Section title={t('office.home.tasks')} count={board.data ? board.data.counts.assigned + board.data.counts.in_progress + board.data.counts.completed : undefined} link={t('office.home.board')} onLink={() => router.push('/office/(tabs)/tasks')}>
            {board.loading && <Loading text={t('office.common.loading')} />}
            {board.error && !board.data && <ErrorNotice error={board.error} onRetry={refresh} />}
            {board.data && [...board.data.in_progress, ...board.data.assigned].length === 0 && <Empty text={t('office.home.noTasks')} />}
            {board.data && [...board.data.in_progress, ...board.data.assigned].slice(0, ROWS).map((c, i) => {
              const pill = boardPill(c);
              return (
                <View key={c.id}>
                  {i > 0 && <Divider />}
                  <Row
                    left={<Mono size={16} bold style={{ width: 52 }}>{c.time}</Mono>}
                    title={c.title}
                    line={boardLine(c)}
                    right={<Pill text={pill.key === 'late' ? t('office.status.late', { min: pill.min ?? 0 }) : t(`office.status.${pill.key}`)} tone={pill.tone} />}
                    onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: c.id } })}
                  />
                </View>
              );
            })}
            {board.data && (board.data.counts.assigned + board.data.counts.in_progress) > ROWS && (
              <Txt variant="strong" color={colors.blue} style={{ textAlign: 'center', paddingVertical: 10 }} onPress={() => router.push('/office/(tabs)/tasks')}>
                {t('office.home.allTasks', { n: board.data.counts.assigned + board.data.counts.in_progress })}
              </Txt>
            )}
          </Section>
        )}

        {sections.includes('road') && (
          <Section title={t('office.home.road')} count={ov?.on_the_road.length} link={t('office.home.liveMap')} onLink={() => router.push('/office/(tabs)/live')}>
            {overview.loading && <Loading text={t('office.common.loading')} />}
            {ov && ov.on_the_road.length === 0 && <Empty text={t('office.home.noRoad')} />}
            {ov?.on_the_road.slice(0, ROWS).map((d, i) => (
              <View key={d.username ?? d.driver}>
                {i > 0 && <Divider />}
                <Row
                  left={<Avatar name={d.driver} />}
                  title={[d.driver, d.vehicle].filter(Boolean).join(' · ')}
                  line={[d.task ?? d.going_to, d.near ? `${d.near}` : d.status_text].filter(Boolean).join(' · ')}
                  right={<Pill text={d.task ? t('office.home.onTask') : t('office.home.onDuty')} tone={d.task ? 'blue' : 'green'} />}
                  onPress={() => router.push({ pathname: '/office/(tabs)/live', params: d.username ? { driver: d.username } : {} })}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('trips') && (
          <Section title={t('office.home.trips')} count={trips.data?.count} link={t('office.common.viewAll')} onLink={() => router.push('/office/(tabs)/trips')}>
            {trips.loading && <Loading text={t('office.common.loading')} />}
            {trips.error && !trips.data && <ErrorNotice error={trips.error} onRetry={refresh} />}
            {trips.data && trips.data.trips.length === 0 && <Empty text={t('office.home.noTrips')} />}
            {trips.data?.trips.slice(0, ROWS).map((x, i) => {
              const live = tripLive(x);
              return (
                <View key={isCreatedTask(x) ? `t-${x.id}` : `r-${x.id}`}>
                  {i > 0 && <Divider />}
                  <Row
                    title={tripTitle(x)}
                    line={[x.when, x.back_by ? `${t('office.trips.backBy')} ${x.back_by}` : ''].filter(Boolean).join(' · ')}
                    right={<Pill text={live.text} tone={statusTone(live.state)} />}
                    onPress={() => router.push('/office/(tabs)/trips')}
                  />
                </View>
              );
            })}
          </Section>
        )}
      </Screen>
    </View>
  );
}
