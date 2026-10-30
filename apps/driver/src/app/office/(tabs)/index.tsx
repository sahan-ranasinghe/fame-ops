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
// Round 4–7, item 12 (the approved mockup 1, design/mockups/2026-10-22): restyled, nothing removed. The thin top bar (the
// date over the greeting, the bell, the avatar to My profile), the stats row with icons (On the road blue, Free green, In
// garage grey; each opens its list as before), "Needs you now" with its total over the kinds that wait (requests, trips
// that need a driver, needs attention, the reminders), each a card of list rows with an icon tile and its own View all;
// then On the road, Today's tasks and My trips as list-look sections; the floating New trip button.
// Round 50 (§37.4): at the top, "You have a trip to drive · Start driving" for a person who drives their own trips
// (components/office/DriveLine.tsx; Driving mode).
// Round 51b (30 October 2026): a card opens its item, not only the button in it: the trip-to-drive card opens the trip,
// a needs-a-driver row its task (Give a driver keeps its own action); the stats tiles open their lists as before.

import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { addDays, colomboDate } from '@/lib/time';
import { whenWords } from '@/lib/dateWords';
import { dueWords, needsAction } from '@/office/issuesLogic';
import { shortDate } from '@/lib/durations';
import { greeting, isCreatedTask, requestLine, requestTitle, tripLive, tripTitle } from '@/office/homeLogic';
import { chipText, sentenceText, taskChip, taskRowLine, tripChip } from '@/office/statusWords';
import { has, homeActions, homeChips, homeSections } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { firstName } from '@/office/text';
import type { Board, IssuesList, MyTrips, Overview, RequestsList } from '@/office/types';
import { Avatar, Divider, ListFailed, NewTripButton, Pill, Row, Screen, Section, StatTiles, TopBar } from '@/office/ui';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { Button } from '@/components/ui';
import { Bell, Check, ChevronDown, ChevronRight, ClipboardCheck, FileText, MapPin, TriangleAlert, UserX, Wrench } from '@/components/icons';
import { RowIcon, RowPlate } from '@/components/patterns/ListRow';
import { look } from '@/components/patterns/look';
import { SavedNotice } from '@/components/office/SavedNotice';
import { DriveLine } from '@/components/office/DriveLine';
import { PendingChangeLine } from '@/components/office/ChangeParts';
import { changeLine, changeTitle, isChange } from '@/office/changeLogic';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { attentionCount, attentionGroups, chipTarget, reminderTile, snoozeCalls, withoutGroups } from '@/office/overviewLogic';
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
  // Round 4–7 (item 8, §33.7): Needs attention counts what needs action (critical and warning, not snoozed), the same number
  // as the Issues screen's header and the site's badge (list_issues needs_action; one row asked, only the counts read).
  const issueCounts = useTool<IssuesList>('list_issues', { status: 'active', snoozed: false, limit: 1 }, { enabled: sections.includes('critical') && me.tools.includes('list_issues'), every: 60_000 });

  const refresh = useCallback(() => {
    void Promise.all([overview.reload(), requests.reload(), board.reload(), trips.reload(), issueCounts.reload()]);
  }, [overview, requests, board, trips, issueCounts]);

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
  // The attention count: needs_action when the issues answer is in, else the server's groups' count (as before).
  const attention = issueCounts.data ? needsAction(issueCounts.data) : attentionCount(ov);
  // The reminders row: only service and document reminders (the rest are counted in Issues).
  const reminders = reminderTile(ov?.needs_attention);
  const refreshing = overview.refreshing || requests.refreshing || board.refreshing || trips.refreshing;

  // "Needs you now" (the approved mockup 1): what waits for this person, by kind, in one group of cards under one heading
  // with the total. Each kind keeps its own list, its View all and its actions.
  const needsTotal = (sections.includes('requests') ? ov?.requests.waiting ?? 0 : 0)
    + (sections.includes('needs_driver') ? ov?.needs_driver?.count ?? 0 : 0)
    + (sections.includes('critical') ? attention : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {/* Round 2b (Gmail / Uber Fleet / Shopify): a thin top bar; the counts as a strip in the page; "Needs you now" first;
          one floating "+ New trip". The language switch is on My profile. Round 4–7, item 12 (the approved mockup 1): the
          date over the greeting, the bell and the avatar; the stats row with icons; the sections as list rows. */}
      <TopBar greeting={t(`office.home.${greeting()}`, { name: firstName(me.name) })} date={shortDate(names, Date.now())} />
      <Screen refreshing={refreshing} onRefresh={refresh} bottom={actions.length > 0 ? 96 : 24} style={{ paddingTop: 4 }}>
        <SavedNotice noticeKey="/office" />
        {/* Round 50 (§37.4): a trip the person drives themselves today: Start driving opens Driving mode on it. */}
        <DriveLine />
        {ov && (
          <StatTiles light tiles={[
            ...(chips.includes('road') ? [{ key: 'road', n: ov.vehicles.on_the_road, label: t('office.home.tileRoad'), tone: 'blue' as const, icon: MapPin, onPress: go('road') }] : []),
            ...(chips.includes('free') ? [{ key: 'free', n: ov.vehicles.parked, label: t('office.home.tileFree'), tone: 'green' as const, icon: Check, onPress: go('free') }] : []),
            ...(chips.includes('garage') && ov.vehicles.in_garage !== undefined ? [{ key: 'garage', n: ov.vehicles.in_garage, label: t('office.home.tileGarage'), icon: Wrench, onPress: go('garage') }] : []),
          ]} />
        )}
        {overview.error && <ListFailed stale={!!ov} error={overview.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {(sections.includes('requests') || sections.includes('needs_driver') || sections.includes('critical') || (ov && chipTarget('reminders', me) && reminders.count > 0)) && (
          <View style={styles.needsHead}>
            <Txt variant="strong" size={17} testID="needs-you-now" accessibilityRole="header">{t('office.home.needsYouNow')}</Txt>
            {needsTotal > 0 ? <View style={styles.needsChip}><Mono size={12} bold color={colors.red}>{String(needsTotal)}</Mono></View> : null}
          </View>
        )}

        {sections.includes('requests') && (
          <Section look="group" title={t('office.home.requests')} count={ov?.requests.waiting} link={t('office.common.viewAll')} onLink={() => router.push('/office/(tabs)/approve')}>
            {!requests.data && !requests.error && <View style={styles.inset}><SkeletonRows rows={2} lines={2} /></View>}
            {requests.error && <View style={styles.inset}><ListFailed stale={!!requests.data} error={requests.error} onRetry={refresh} /></View>}
            {requests.data && requests.data.requests.length === 0 && <View style={styles.inset}><ListEmpty text={t('office.home.noRequests')} /></View>}
            {requests.data?.requests.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider soft />}
                <Row
                  inset
                  chevron
                  left={r.requested_by_photo_url ? <Avatar name={r.requested_by} photo={r.requested_by_photo_url} /> : <RowIcon icon={ClipboardCheck} tone="amber" />}
                  // Round 48 (item 1): a proposed change to a task reads "Change · <task>" with what changes and who proposes it.
                  title={isChange(r) ? changeTitle(r, t) : requestTitle(r)}
                  line={[isChange(r) ? changeLine(r, t) : requestLine({ ...r, when: whenWords(t, r.when) }), r.asked ? whenWords(t, r.asked) : ''].filter(Boolean).join(' · ')}
                  onPress={() => router.push({ pathname: '/office/request/[id]', params: { id: r.id } })}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('needs_driver') && (
          <Section look="group" title={t('office.home.needsDriver')} count={ov?.needs_driver?.count ?? 0} tone="red" link={has(me.permissions, 'assign_tasks') ? t('office.common.viewAll') : undefined} onLink={() => router.push('/office/(tabs)/tasks')}>
            {!ov && !overview.error && <View style={styles.inset}><SkeletonRows rows={2} lines={2} /></View>}
            {ov && (ov.needs_driver?.tasks.length ?? 0) === 0 && <View style={styles.inset}><ListEmpty text={t('office.home.noNeedsDriver')} /></View>}
            {ov?.needs_driver?.tasks.slice(0, ROWS).map((x, i) => (
              <View key={x.task_id}>
                {i > 0 && <Divider soft />}
                <Row
                  inset
                  left={<RowIcon icon={UserX} tone="red" />}
                  title={x.title}
                  line={`${whenWords(t, x.start)} · ${x.line}`}
                  below={x.pending_change ? <PendingChangeLine change={x.pending_change} compact testID={`home-pending-change-${x.task_id}`} /> : undefined}
                  // Round 51b: the whole row opens the task (Give a driver keeps its own action), as Today's tasks do.
                  onPress={me.tools.includes('task_detail') ? () => router.push({ pathname: '/office/task/[id]', params: { id: x.task_id } }) : undefined}
                  testID={`home-needs-driver-${x.task_id}`}
                  right={has(me.permissions, 'assign_tasks')
                    ? <Button kind="dark" label={t('office.home.giveDriver')} onPress={() => router.push({ pathname: '/office/task/[id]/driver', params: { id: x.task_id } })} style={{ minHeight: 44, backgroundColor: colors.red, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }} />
                    : <Pill text={whenWords(t, x.when)} tone="red" />}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('critical') && (
          <Section look="group" title={t('office.home.attention')} count={attention} tone={attention ? 'red' : undefined} link={t('office.common.viewAll')} onLink={() => router.push('/office/issues')}>
            {!ov && !overview.error && <View style={styles.inset}><SkeletonRows rows={2} lines={2} /></View>}
            {snoozeError && !snoozing && <View style={styles.inset}><ErrorNotice error={snoozeError.error} onSignIn={() => void signOut()} /></View>}
            {ov && attentionGroups(ov).length === 0 && <View style={styles.inset}><ListEmpty text={t('office.home.noAttention')} /></View>}
            {attentionGroups(ov).slice(0, ROWS).map((g, i) => {
              const open = expanded.has(g.key);
              const single = g.items.length === 1 && g.items[0].issue_id;
              return (
                <View key={g.key} testID="attention-group">
                  {i > 0 && <Divider soft />}
                  <Row
                    inset
                    left={g.items.length > 1
                      ? <View style={styles.groupIcon}>{open ? <ChevronDown size={20} color={colors.ink} /> : <ChevronRight size={20} color={colors.ink} />}</View>
                      : <RowIcon icon={g.vehicle ? FileText : TriangleAlert} tone={g.severity === 'critical' ? 'red' : 'amber'} />}
                    title={g.title}
                    line={[g.vehicle, g.count > 1 ? t('office.home.attentionN', { n: g.count }) : dueWords(t, g.items[0]?.due)].filter(Boolean).join(' · ') || undefined}
                    chip={{ text: t(`office.home.sev_${g.severity}`), tone: g.severity === 'critical' ? 'red' : 'amber' }}
                    onPress={single ? () => router.push({ pathname: '/office/issues/[id]', params: { id: g.items[0].issue_id ?? '' } }) : () => setExpanded((x) => { const n = new Set(x); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                  />
                  {open && g.items.map((x, k) => (
                    <Row key={x.issue_id ?? `${g.key}-${k}`} inset chevron title={x.what} line={[x.subject, x.vehicle, dueWords(t, x.due)].filter(Boolean).join(' · ') || undefined}
                      onPress={x.issue_id ? () => router.push({ pathname: '/office/issues/[id]', params: { id: x.issue_id ?? '' } }) : undefined} />
                  ))}
                  {maySnooze && g.issue_ids.length > 0 && (
                    <Pressable accessibilityRole="button" onPress={() => { setSnoozeError(null); setSnoozing(g); }} style={styles.snooze} testID="attention-snooze">
                      <Txt variant="strong" size={15} color={colors.blue}>{t('office.home.snooze')}</Txt>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </Section>
        )}

        {ov && chipTarget('reminders', me) && reminders.count > 0 && (
          <View style={styles.card}>
            <Row
              inset
              chevron
              left={<RowIcon icon={Bell} tone={reminders.red ? 'red' : 'amber'} />}
              title={reminders.count === 1 ? t('office.home.remindersRowOne') : t('office.home.remindersRow', { n: reminders.count })}
              onPress={go('reminders')}
              testID="home-reminders"
            />
          </View>
        )}

        {sections.includes('road') && (
          <Section look="list" title={t('office.home.road')} count={ov?.on_the_road.length} link={t('office.home.liveMap')} onLink={() => router.push('/office/(tabs)/live')}>
            {!ov && !overview.error && <View style={styles.inset}><SkeletonRows rows={2} lines={2} /></View>}
            {ov && ov.on_the_road.length === 0 && <View style={styles.inset}><ListEmpty text={t('office.home.noRoad')} /></View>}
            {ov?.on_the_road.slice(0, ROWS).map((d, i) => (
              <View key={d.username ?? d.driver}>
                {i > 0 && <Divider soft />}
                <Row
                  inset
                  left={<Avatar name={d.driver} />}
                  title={d.driver}
                  titleAfter={d.vehicle ? <RowPlate regNo={d.vehicle} /> : undefined}
                  line={[d.task ?? d.going_to, d.near ? `${d.near}` : sentenceText(t, d.status_text)].filter(Boolean).join(' · ')}
                  chip={{ text: d.task ? t('office.chip.underWay') : t('office.chip.onDuty'), tone: d.task ? 'blue' : 'green' }}
                  onPress={() => router.push({ pathname: '/office/(tabs)/live', params: d.username ? { driver: d.username } : {} })}
                />
              </View>
            ))}
          </Section>
        )}

        {sections.includes('tasks') && (
          <Section look="list" title={t('office.home.tasks')} count={board.data ? board.data.counts.assigned + board.data.counts.in_progress + board.data.counts.completed : undefined} link={t('office.home.board')} onLink={() => router.push('/office/(tabs)/tasks')}>
            {!board.data && !board.error && <View style={styles.inset}><SkeletonRows rows={3} lines={2} /></View>}
            {board.error && <View style={styles.inset}><ListFailed stale={!!board.data} error={board.error} onRetry={refresh} /></View>}
            {board.data && [...board.data.in_progress, ...board.data.assigned].length === 0 && (
              <View style={styles.inset}>
                <ListEmpty
                  text={t('office.home.noTasks')}
                  action={actions.includes('assign') ? t('office.trip.assignTask') : undefined}
                  onAction={actions.includes('assign') ? () => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } }) : undefined}
                />
              </View>
            )}
            {board.data && [...board.data.in_progress.map((c) => ({ c, col: 'in_progress' as const })), ...board.data.assigned.map((c) => ({ c, col: 'assigned' as const }))].slice(0, ROWS).map(({ c, col }, i) => {
              const k = taskChip(col, c);
              return (
                <View key={c.id}>
                  {i > 0 && <Divider soft />}
                  <Row
                    inset
                    time={c.time}
                    title={c.title}
                    line={taskRowLine(t, c)}
                    chip={{ text: chipText(t, k), tone: k.tone }}
                    onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: c.id } })}
                  />
                </View>
              );
            })}
            {board.data && (board.data.counts.assigned + board.data.counts.in_progress) > ROWS && (
              <>
                <Divider soft />
                <Txt variant="strong" color={colors.blue} style={{ textAlign: 'center', paddingVertical: 12 }} onPress={() => router.push('/office/(tabs)/tasks')}>
                  {t('office.home.allTasks', { n: board.data.counts.assigned + board.data.counts.in_progress })}
                </Txt>
              </>
            )}
          </Section>
        )}

        {sections.includes('trips') && (
          <Section look="list" title={t('office.home.trips')} count={trips.data?.count} link={t('office.common.viewAll')} onLink={() => router.push('/office/(tabs)/trips')}>
            {!trips.data && !trips.error && <View style={styles.inset}><SkeletonRows rows={2} lines={2} /></View>}
            {trips.error && <View style={styles.inset}><ListFailed stale={!!trips.data} error={trips.error} onRetry={refresh} /></View>}
            {trips.data && trips.data.trips.length === 0 && (
              <View style={styles.inset}>
                <ListEmpty
                  text={t('office.home.noTrips')}
                  action={actions.includes('request') ? t('office.trip.requestVehicle') : undefined}
                  onAction={actions.includes('request') ? () => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } }) : undefined}
                />
              </View>
            )}
            {trips.data?.trips.slice(0, ROWS).map((x, i) => {
              const live = tripLive(x);
              return (
                <View key={isCreatedTask(x) ? `t-${x.id}` : `r-${x.id}`}>
                  {i > 0 && <Divider soft />}
                  <Row
                    inset
                    title={tripTitle(x)}
                    line={[whenWords(t, x.when), x.back_by ? `${t('office.trips.backBy')} ${x.back_by}` : ''].filter(Boolean).join(' · ')}
                    chip={(() => { const k = tripChip(live.state); return { text: t(`office.chip.${k.key}`), tone: k.tone }; })()}
                    onPress={() => router.push('/office/(tabs)/trips')}
                  />
                </View>
              );
            })}
          </Section>
        )}
      </Screen>
      <NewTripButton choices={[
        ...(actions.includes('assign') ? [{ key: 'task', label: t('office.trip.assignTask'), onPress: () => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } }) }] : []),
        ...(actions.includes('request') ? [{ key: 'request', label: t('office.trip.requestVehicle'), onPress: () => router.push({ pathname: '/office/trip/where', params: { mode: 'request' } }) }] : []),
      ]} />
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

const styles = StyleSheet.create({
  needsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  needsChip: { backgroundColor: colors.redChip, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  inset: { paddingHorizontal: 14, paddingBottom: 8 },
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, overflow: 'hidden' },
  groupIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: look.quiet, alignItems: 'center', justifyContent: 'center' },
  snooze: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 14, marginLeft: 52 },
});
