// Office mode (Phase 8, O1): Home by permission (designs 02–05). The dark header with the date, the greeting and the
// at-a-glance chips (fleet_overview), then the sections the person's permissions bring (office/nav.ts homeSections):
// requests to approve (list_requests), needs a driver (fleet_overview), critical issues (fleet_overview), today's tasks
// (task_board), on the road (fleet_overview), my trips (my_trips). Each card opens its real screen; pull to refresh, and
// everything is read again when the screen comes back; a section shows skeleton rows until its answer comes (the list
// pattern, docs/ui-patterns.md §5), Try again when it failed, and what to do next when it is empty. Stage 1 (O3 row 5): every
// header chip opens its list (on the road → Live, free now / in garage → Vehicles with that filter, waiting → Approve,
// reminders → Reminders) or stays a number for someone who may not open it; Needs attention shows the server's groups
// (expand in place, each item to its issue) with Snooze for tomorrow or a week (update_issue snooze on every issue
// behind the group). The rules: office/overviewLogic.ts. The trip editor (+ Assign a task, Request) is round O2: no big
// action button yet, so none is shown.

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { addDays, colomboDate } from '@/lib/time';
import { shortDate } from '@/lib/durations';
import { boardLine, boardPill, greeting, isCreatedTask, requestLine, requestTitle, statusTone, tripLive, tripTitle } from '@/office/homeLogic';
import { has, homeActions, homeChips, homeSections } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { firstName } from '@/office/text';
import type { Board, MyTrips, Overview, RequestsList } from '@/office/types';
import { Avatar, Chip, DarkHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { Button } from '@/components/ui';
import { ChevronDown, ChevronRight, Plus } from '@/components/icons';
import { SavedNotice } from '@/components/office/SavedNotice';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { attentionCount, attentionGroups, chipTarget, snoozeCalls, withoutGroups } from '@/office/overviewLogic';
import type { AttentionGroup, FleetError } from '@/office/types';
import { ErrorNotice } from '@/office/ui';

const ROWS = 5;

export default function OfficeHome() {
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const sections = homeSections(me.permissions);
  const chips = homeChips(me.permissions);
  const actions = homeActions(me.permissions);
  const today = colomboDate();

  const overview = useTool<Overview>('fleet_overview', {}, { every: 60_000 });
  const requests = useTool<RequestsList>('list_requests', { status: 'waiting', limit: ROWS }, { enabled: sections.includes('requests'), every: 60_000 });
  const board = useTool<Board>('task_board', { date: today, limit: ROWS }, { enabled: sections.includes('tasks'), every: 60_000 });
  const trips = useTool<MyTrips>('my_trips', { from: addDays(today, -7), to: addDays(today, 30), limit: ROWS }, { enabled: sections.includes('trips') });

  const refresh = useCallback(() => {
    void Promise.all([overview.reload(), requests.reload(), board.reload(), trips.reload()]);
  }, [overview, requests, board, trips]);

  const names = { days: tList('days'), months: tList('months') };
  const go = (chip: Parameters<typeof chipTarget>[0]) => {
    const to = chipTarget(chip, me);
    // A tap stamp, so the same link opens its filter again on a tab that stayed mounted (Approve: ?status=).
    return to ? () => router.push(`${to}${to.includes('?') ? '&' : '?'}at=${Date.now()}` as never) : undefined;
  };

  // Needs attention: a group opens in place; Snooze hides every issue behind it until tomorrow 07:00 or a week from now.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [snoozing, setSnoozing] = useState<AttentionGroup | null>(null);
  const [snoozeBusy, setSnoozeBusy] = useState(false);
  const [snoozeError, setSnoozeError] = useState<{ error: FleetError; group: AttentionGroup; when: 'tomorrow' | 'week' } | null>(null);
  const maySnooze = me.tools.includes('update_issue');
  // A snooze says so in the snackbar with Undo for 6 s (docs/ui-patterns.md §10; Gmail's "Snoozed · Undo"): update_issue
  // snooze null on the same issues, then read again. An Undo that did not get through says so, with Try again.
  async function undoSnooze(group: AttentionGroup) {
    try {
      for (const id of [...new Set(group.issue_ids)]) await api.call('update_issue', { id, snooze: null });
      await overview.reload();
    } catch {
      showSnackbar({ text: t('office.home.undoFailed'), tone: 'error', action: { label: t('office.common.tryAgain'), onPress: () => void undoSnooze(group) } });
    }
  }
  async function snooze(group: AttentionGroup, when: 'tomorrow' | 'week') {
    setSnoozeBusy(true);
    setSnoozeError(null);
    try {
      for (const call of snoozeCalls(group, when)) await api.call('update_issue', call);
      overview.patch((prev) => withoutGroups(prev, [group.key]));
      setSnoozing(null);
      showSnackbar({ text: t('office.home.snoozedLine', { title: group.title }), action: { label: t('office.decide.undo'), onPress: () => void undoSnooze(group) } });
    } catch (e) {
      setSnoozeError({ error: e as FleetError, group, when });
    } finally {
      setSnoozeBusy(false);
    }
  }
  const ov = overview.data;
  const refreshing = overview.refreshing || requests.refreshing || board.refreshing || trips.refreshing;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={shortDate(names, Date.now())} title={t(`office.home.${greeting()}`, { name: firstName(me.name) })}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {ov && chips.includes('road') && <Chip n={ov.vehicles.on_the_road} text={t('office.home.onRoad')} tone="blue" onPress={go('road')} />}
          {ov && chips.includes('free') && <Chip n={ov.vehicles.parked} text={t('office.home.free')} tone="muted" onPress={go('free')} />}
          {ov && chips.includes('waiting') && <Chip n={ov.requests.waiting} text={t('office.home.waitingOk')} tone="amber" onPress={go('waiting')} />}
          {ov && chips.includes('garage') && ov.vehicles.in_garage !== undefined && <Chip n={ov.vehicles.in_garage} text={t('office.home.inGarage')} tone="muted" onPress={go('garage')} />}
          {ov && chipTarget('reminders', me) && ov.reminders.count > 0 && <Chip n={ov.reminders.count} text={t('office.home.reminders')} tone={ov.reminders.red ? 'red' : 'muted'} onPress={go('reminders')} />}
        </View>
      </DarkHeader>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SavedNotice noticeKey="/office" />
        {overview.error && <ListFailed stale={!!ov} error={overview.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {actions.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {actions.includes('assign') && <Button icon={Plus} label={t('office.trip.assignTask')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } })} style={{ flex: 1, minHeight: 60 }} />}
            {actions.includes('request') && <Button kind={actions.includes('assign') ? 'outline' : 'primary'} label={t(actions.includes('assign') ? 'office.trip.request' : 'office.trip.requestVehicle')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } })} style={{ flex: 1, minHeight: 60 }} />}
          </View>
        )}

        {sections.includes('requests') && (
          <Section title={t('office.home.requests')} count={ov?.requests.waiting} link={t('office.common.viewAll')} onLink={() => router.push('/office/(tabs)/approve')}>
            {!requests.data && !requests.error && <SkeletonRows rows={2} lines={2} />}
            {requests.error && <ListFailed stale={!!requests.data} error={requests.error} onRetry={refresh} />}
            {requests.data && requests.data.requests.length === 0 && <ListEmpty text={t('office.home.noRequests')} />}
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
            {!ov && !overview.error && <SkeletonRows rows={2} lines={2} />}
            {ov && (ov.needs_driver?.tasks.length ?? 0) === 0 && <ListEmpty text={t('office.home.noNeedsDriver')} />}
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
          <Section title={t('office.home.attention')} count={attentionCount(ov)} tone={attentionCount(ov) ? 'red' : undefined} link={t('office.common.viewAll')} onLink={() => router.push('/office/issues')}>
            {!ov && !overview.error && <SkeletonRows rows={2} lines={2} />}
            {snoozeError && !snoozing && <ErrorNotice error={snoozeError.error} onSignIn={() => void signOut()} />}
            {ov && attentionGroups(ov).length === 0 && <ListEmpty text={t('office.home.noAttention')} />}
            {attentionGroups(ov).slice(0, ROWS).map((g, i) => {
              const open = expanded.has(g.key);
              const single = g.items.length === 1 && g.items[0].issue_id;
              return (
                <View key={g.key} testID="attention-group">
                  {i > 0 && <Divider />}
                  <Row
                    left={g.items.length > 1 ? (open ? <ChevronDown size={20} color={colors.ink} /> : <ChevronRight size={20} color={colors.ink} />) : undefined}
                    title={g.title}
                    line={[g.vehicle, g.count > 1 ? t('office.home.attentionN', { n: g.count }) : g.items[0]?.due].filter(Boolean).join(' · ') || undefined}
                    right={<Pill text={t(`office.home.sev_${g.severity}`)} tone={g.severity === 'critical' ? 'red' : 'amber'} />}
                    onPress={single ? () => router.push({ pathname: '/office/issues/[id]', params: { id: g.items[0].issue_id ?? '' } }) : () => setExpanded((x) => { const n = new Set(x); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                  />
                  {open && g.items.map((x, k) => (
                    <Row key={x.issue_id ?? `${g.key}-${k}`} title={x.what} line={[x.subject, x.vehicle, x.due].filter(Boolean).join(' · ') || undefined}
                      onPress={x.issue_id ? () => router.push({ pathname: '/office/issues/[id]', params: { id: x.issue_id ?? '' } }) : undefined} />
                  ))}
                  {maySnooze && g.issue_ids.length > 0 && (
                    <Pressable accessibilityRole="button" onPress={() => { setSnoozeError(null); setSnoozing(g); }} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} testID="attention-snooze">
                      <Txt variant="strong" size={15} color={colors.blue}>{t('office.home.snooze')}</Txt>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </Section>
        )}

        {sections.includes('tasks') && (
          <Section title={t('office.home.tasks')} count={board.data ? board.data.counts.assigned + board.data.counts.in_progress + board.data.counts.completed : undefined} link={t('office.home.board')} onLink={() => router.push('/office/(tabs)/tasks')}>
            {!board.data && !board.error && <SkeletonRows rows={3} lines={2} />}
            {board.error && <ListFailed stale={!!board.data} error={board.error} onRetry={refresh} />}
            {board.data && [...board.data.in_progress, ...board.data.assigned].length === 0 && (
              <ListEmpty
                text={t('office.home.noTasks')}
                action={actions.includes('assign') ? t('office.trip.assignTask') : undefined}
                onAction={actions.includes('assign') ? () => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } }) : undefined}
              />
            )}
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
            {!ov && !overview.error && <SkeletonRows rows={2} lines={2} />}
            {ov && ov.on_the_road.length === 0 && <ListEmpty text={t('office.home.noRoad')} />}
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
            {!trips.data && !trips.error && <SkeletonRows rows={2} lines={2} />}
            {trips.error && <ListFailed stale={!!trips.data} error={trips.error} onRetry={refresh} />}
            {trips.data && trips.data.trips.length === 0 && (
              <ListEmpty
                text={t('office.home.noTrips')}
                action={actions.includes('request') ? t('office.trip.requestVehicle') : undefined}
                onAction={actions.includes('request') ? () => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } }) : undefined}
              />
            )}
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
      <Sheet visible={snoozing !== null} title={t('office.home.snoozeTitle')} onClose={() => setSnoozing(null)}>
        {snoozing && <Txt variant="muted" size={15}>{snoozing.title}</Txt>}
        {snoozing && (['tomorrow', 'week'] as const).map((when) => (
          <Button key={when} kind="outline" label={t(`office.home.snooze_${when}`)} busy={snoozeBusy} disabled={snoozeBusy} onPress={() => void snooze(snoozing, when)} style={{ minHeight: 56, marginTop: 10 }} testID={`snooze-${when}`} />
        ))}
        {snoozeError && <ErrorNotice error={snoozeError.error} onRetry={() => void snooze(snoozeError.group, snoozeError.when)} onSignIn={() => void signOut()} />}
      </Sheet>
    </View>
  );
}
