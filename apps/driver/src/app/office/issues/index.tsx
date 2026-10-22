// Office mode (Phase 8, O2; the standard patterns in O3, docs/ui-patterns.md): the Issues list (the site's issues centre
// on a phone; no design: the O1 screens' look). list_issues with the search bar (the words sent as `search` half a second
// after the last key), one Filter button (the status: Active · Open · In progress · Resolved · Dismissed, the tool's own
// status with the server's counts; the severity narrowing the page on the phone), the chips in use under it, Sort (the
// tool's own `sort`: the most urgent or the newest first; the status's own order until the person picks), 50 at a time
// with Load more on the cursor, skeleton rows while the first answer comes, pull to refresh and a read again when the
// screen comes back. A row opens the issue's page (/office/issues/[id]). Everything the server answers is shown (with
// issues every kind, with assign_tasks only the task kinds: the server's rule); the actions live on the page.
//
// Round 4–7 (item 8, §33.7): the tabs Open · Snoozed · Resolved over the sheet's status (Gmail's Inbox · Snoozed · Done;
// Open leaves the snoozed out). Open is grouped by kind (Samsara / Sentry / GitHub: list_issues group: true, the most
// urgent group first, "MISSED TASKS · 12" with its 3 newest, collapsible, "Show all 12" = the kind chosen, 50 a page);
// words searched for list their results as one list. Gmail's rows: the kind's icon tinted by severity, ONE title (the
// server's headline), ONE grey line (the plate chip · driver · when, in words), the Pre-trip tag, who has it, the status
// only when the tab does not say it. With update_issues: tap a row's icon (or hold the row) to tick it, a group's
// Select, "Select all 12 in this group"; the bar at the bottom resolves or dismisses them with one reason
// (update_issues). The header counts what needs action (critical and warning), as Home and the site's badge.
// The row is the app's one list row (components/patterns/ListRow.tsx: the tick or icon on the left, the long press, the
// ticked look, the plate chip at the start of the grey line, the chips and the photo at the right); who took it is said in
// the grey line ("taken by Sahan 10:05") and who closed it under it ("Resolved by Sahan · Today 14:20").

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Bell, Calendar, CalendarX, Car, Check, ClipboardCheck, Clock, FileText, Gauge, IdCard, Info, ListChecks, type LucideIcon, MapPin, Navigation, OctagonAlert, Route, TriangleAlert, User, Van, Wrench, X,
} from '@/components/icons';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { ChoiceChips, SelectMark } from '@/components/patterns/Select';
import { Sheet } from '@/components/patterns/Sheet';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ListRow, RowPlate } from '@/components/patterns/ListRow';
import { Button, Field, Segmented, Txt } from '@/components/ui';
import { presetRange } from '@/lib/patterns/calendarLogic';
import { defaultValues, type FilterValues } from '@/lib/patterns/filterLogic';
import { colomboDate } from '@/lib/time';
import {
  appendPage, BULK_REASONS, type BulkAction, bulkCalls, defaultSort, dueWords, groupText, groupTick, type IssueGroup, ISSUE_SORTS, ISSUE_TABS, type IssueSort, type IssueTab, issuesArgs,
  issuesChoice, issuesFilterDefs, isActive, kindText, listRows, metaParts, needsAction, rowTitle, rowWho, SEARCH_DEBOUNCE_MS, severityChipShown, severityCounts, severityIcon, type SeverityIcon, severityTone, showsGroups, snoozeParts, statusShown,
  statusTone, TAB_STATUS, tabExtra, tabFor, toggled, withoutIssues, issuesExtra, issuesExtraDefs, kindsFor,
} from '@/office/issuesLogic';
import { useOffice, useTool } from '@/office/state';
import { has } from '@/office/nav';
import type { FleetError, Issue, IssuesList, VehiclesList } from '@/office/types';
import { Avatar, Chip, DarkHeader, Divider, ErrorNotice, ListFailed, Screen, Section, StatusChip, StickyActions, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';
import { dateWords } from '@/lib/dateWords';

/** Each kind's icon (Gmail's leading icon): the row never repeats the kind in words. */
const KIND_ICONS: Record<string, LucideIcon> = {
  vehicle_report: TriangleAlert, odometer_flag: Gauge, km_gap: Route, service_due: Wrench, document: FileText, documents_missing: FileText, licence: IdCard,
  allowance: Gauge, rental: Calendar, garage_booked: Wrench, signal: MapPin, late_start: Clock, running_late: Clock, not_accepted: User, declined: User,
  request_waiting: ClipboardCheck, vehicle_conflict: Car, app_stopped: Bell, arrival_override: MapPin, completed_early: Check, vehicle_needed: Van,
  missed_task: CalendarX, push_failed: Bell, routing_failed: Navigation, map_fallback: MapPin, trip_not_confirmed: ListChecks,
};
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
/** A group heading's severity by its shape (Sahan, 22 October 2026: never colour alone; issuesLogic.ts severityIcon). */
const SEVERITY_ICONS: Record<SeverityIcon, LucideIcon> = { octagon: OctagonAlert, triangle: TriangleAlert, info: Info };

const TILE: Record<Tone, { bg: string; ink: string }> = {
  red: { bg: colors.redChip, ink: colors.red },
  amber: { bg: colors.amberChip, ink: colors.amberText },
  blue: { bg: colors.blueChip, ink: colors.blue },
  green: { bg: colors.greenChip, ink: colors.green },
  muted: { bg: '#ebe9e3', ink: colors.muted },
};

export default function IssuesScreen() {
  const { t } = useApp();
  const { api, me, signOut } = useOffice();
  const router = useRouter();
  // O3 row 6: the kind (the ones this person may read), the vehicle (list_vehicles' plates) and when it was opened.
  const kinds = kindsFor(me.permissions);
  const plates = useTool<VehiclesList>('list_vehicles', { filter: 'all', limit: 200 }, { enabled: me.tools.includes('list_vehicles') && has(me.permissions, 'issues') });
  const plateList = (plates.data?.vehicles ?? []).map((v) => v.reg_no);
  const [values, setValues] = useState<FilterValues>(() => defaultValues([...issuesFilterDefs(null, null, t), ...issuesExtraDefs(kinds, [], t)]));
  const today = colomboDate();
  const extra = issuesExtra(values, (preset) => presetRange(preset, today));
  const { status, severity } = issuesChoice(values);
  // The Sort menu: null = the status's own order (the most urgent for the open ones, the newest for the closed ones).
  const [sortPick, setSortPick] = useState<IssueSort | null>(null);
  const sort = sortPick ?? defaultSort(status);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  // Round 4–7 (item 8): the tab (Snoozed is its own; Open and Resolved follow the sheet's status), the groups by kind.
  const [snoozedTab, setSnoozedTab] = useState(false);
  const tab = tabFor(status, snoozedTab);
  const grouped = showsGroups(tab, extra.kind, search);
  Object.assign(extra, tabExtra(tab, grouped, severity));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The ticks (Gmail's): only open issues, with update_issues; a new view starts with none.
  const mayBulk = me.tools.includes('update_issues') && tab !== 'resolved';
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const view = JSON.stringify([tab, values, search]);
  const [pickedView, setPickedView] = useState(view);
  if (pickedView !== view) {
    setPickedView(view);
    setPicked(new Set());
  }
  const pick = (ids: string[], on: boolean) => setPicked((p) => toggled(p, ids, on));
  const [acting, setActing] = useState<BulkAction | null>(null);
  const [reason, setReason] = useState('');
  const [bulk, setBulk] = useState<{ busy: boolean; error: FleetError | null; done: number }>({ busy: false, error: null, done: 0 });

  // The words typed go to the server half a second after the last key (every key would be a call).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = useTool<IssuesList>('list_issues', issuesArgs(status, search, undefined, sortPick ?? undefined, extra));
  const d = q.data;
  const rows = listRows(d?.issues ?? [], status, severity);
  // The groups are narrowed by the server: no counts from the rows of a page there.
  const counts = grouped ? null : severityCounts(d?.issues ?? [], status);
  const defs = [...issuesFilterDefs(d, d ? counts : null, t), ...issuesExtraDefs(kinds, plateList, t)];
  const apply = (next: FilterValues) => {
    // Another status starts again in that status's own order (and leaves the Snoozed tab).
    if (issuesChoice(next).status !== status) {
      setSortPick(null);
      setSnoozedTab(false);
    }
    setValues(next);
  };
  const setTab = (next: IssueTab) => {
    setSortPick(null);
    setSnoozedTab(next === 'snoozed');
    setValues((v) => ({ ...v, status: TAB_STATUS[next] }));
  };
  /** "Show all 12": the kind chosen in the sheet (its chip shows; removing it goes back to the groups). */
  const showKind = (kind: string) => setValues((v) => ({ ...v, kind }));

  /** "Select all 12 in this group": every issue of the kind under the same filters (their ids). */
  async function pickAllOf(kind: string, count: number) {
    try {
      const all = await api.call<IssuesList>('list_issues', { ...issuesArgs(status, search, undefined, sortPick ?? undefined, { ...extra, group: undefined, severity: severity !== 'all' ? severity : undefined, kind }), limit: Math.min(500, count) });
      pick(all.issues.map((i) => i.id), true);
    } catch (e) {
      showSnackbar({ text: t('office.common.tryAgain'), tone: 'error' });
      setBulk({ busy: false, error: e as FleetError, done: 0 });
    }
  }

  async function act() {
    if (!acting) return;
    const calls = bulkCalls([...picked], acting, reason);
    if (!calls.length) return;
    setBulk({ busy: true, error: null, done: 0 });
    let done = 0;
    const doneIds: string[] = [];
    try {
      for (const c of calls) {
        const r = await api.call<{ done: number; failed?: { id: string; error: string }[] }>('update_issues', c);
        done += r.done;
        const failed = new Set((r.failed ?? []).map((f) => f.id));
        doneIds.push(...c.ids.filter((id) => !failed.has(id)));
        if (r.failed?.length) throw { code: 'partial', message: r.failed[0].error } as FleetError;
      }
      q.patch((prev) => withoutIssues(prev, doneIds), q.key);
      setActing(null);
      setPicked(new Set());
      setBulk({ busy: false, error: null, done: 0 });
      const key = acting === 'resolved' ? 'doneResolved' : 'doneDismissed';
      showSnackbar({ text: done === 1 ? t(`office.issues.bulk.${key}One`) : t(`office.issues.bulk.${key}`, { n: done }) });
    } catch (e) {
      if (doneIds.length) q.patch((prev) => withoutIssues(prev, doneIds), q.key);
      setPicked((p) => toggled(p, doneIds, false));
      setBulk({ busy: false, error: e as FleetError, done });
    } finally {
      void q.reload();
    }
  }

  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<IssuesList>('list_issues', issuesArgs(status, search, d.next, sortPick ?? undefined, extra));
      q.patch((p) => appendPage(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const emptyText = () => {
    if (search) return t('office.issues.empty.search', { search });
    if (severity !== 'all' && (grouped || (counts?.all ?? 0) > 0)) return t('office.issues.empty.severity');
    if (tab === 'snoozed') return t('office.issues.emptyTab.snoozed');
    return t(`office.issues.empty.${status}`);
  };

  /** One row; `group` = the severity its group's heading shows (absent in a flat list: a search, a kind's list). */
  const renderRow = (i: Issue, group?: string) => {
    const tile = TILE[severityTone(i.severity)];
    const snooze = snoozeParts(i);
    const meta = metaParts(i);
    const Icon = KIND_ICONS[i.kind] ?? TriangleAlert;
    const canPick = mayBulk && isActive(i.status);
    const on = picked.has(i.id);
    const open = () => router.push({ pathname: '/office/issues/[id]', params: { id: i.id } });
    // Who has it ("taken by Sahan 10:05", in the grey line) and who closed it, when ("Resolved by Sahan · Today 14:20").
    const who = rowWho(i);
    const taken = who.taken ? (who.taken.at ? t('office.issues.takenByAt', { name: who.taken.name, at: who.taken.at }) : t('office.issues.takenBy', { name: who.taken.name })) : '';
    const closed = who.closed ? closedWords(who.closed) : '';
    return (
      <ListRow
        // While rows are ticked, a tap ticks (Gmail); a long press starts it.
        onPress={picked.size > 0 && canPick ? () => pick([i.id], !on) : open}
        onLongPress={canPick ? () => pick([i.id], !on) : undefined}
        selected={on}
        left={canPick ? (
          // The kind's icon, tinted by severity; with bulk actions it is the tick (Gmail's avatar), else a picture.
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t('office.issues.selectRow', { title: rowTitle(i) })}
            onPress={() => pick([i.id], !on)}
            style={(state) => [styles.tile, { backgroundColor: on ? colors.blueChip : tile.bg }, hoverStyle(state)]}
            testID="issue-tick"
          >
            {on ? <SelectMark kind="check" on size={26} /> : <Icon size={22} color={tile.ink} strokeWidth={2.2} />}
          </Pressable>
        ) : (
          <View accessibilityRole="image" accessibilityLabel={`${t(`office.issues.severity.${i.severity}`)} · ${kindText(i, t)}`} style={[styles.tile, { backgroundColor: tile.bg }]} testID="issue-tick">
            <Icon size={22} color={tile.ink} strokeWidth={2.2} />
          </View>
        )}
        title={rowTitle(i)}
        titleLines={2}
        lineLead={meta.plate ? <RowPlate regNo={meta.plate} /> : undefined}
        line={[dueWords(t, meta.rest), taken].filter(Boolean).join(' · ')}
        line2={snooze
          ? (snooze.by ? t('office.issues.snoozedUntilBy', { at: dateWords(t, snooze.until), name: snooze.by }) : t('office.issues.snoozedUntil', { at: dateWords(t, snooze.until) }))
          : closed || undefined}
        line2Warn={!!snooze}
        right={(
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {/* Round 4–7 (4): a problem found by a vehicle check before work. */}
            {i.pre_trip ? <StatusChip text={t('office.checks.preTrip')} tone="amber" testID="issue-pre-trip" /> : null}
            {/* Sahan's removals (22 October 2026): Warning / Info only where no group heading says it; Critical always. */}
            {severityChipShown(i.severity, group) ? <StatusChip text={t(`office.issues.severity.${i.severity}`)} tone={severityTone(i.severity)} testID="issue-severity" /> : null}
            {statusShown(status, i.status) ? <StatusChip text={t(`office.issues.status.${i.status}`)} tone={statusTone(i.status)} /> : null}
            {/* Round 3: the person who took it, their photo (initials until there is one); their name is in the grey line. */}
            {i.assigned_to ? <Avatar name={i.assigned_to.name} size={28} photo={i.assigned_to.photo_url} /> : null}
          </View>
        )}
        testID="issue-row"
      />
    );
  };

  /** "Resolved by Sahan · Today 14:20", "closed automatically · Today 14:20", "by Sahan" (no time known), "closed 14:20". */
  const closedWords = (c: NonNullable<ReturnType<typeof rowWho>['closed']>): string => {
    const at = c.at ? dateWords(t, c.at) : '';
    if (c.by === 'system') return [t('office.issues.closedAuto'), at].filter(Boolean).join(' · ');
    if (c.by && at) return t(c.how === 'dismissed' ? 'office.issues.dismissedBy' : 'office.issues.resolvedBy', { name: c.by, at });
    if (c.by) return t('office.issues.closedBy', { name: c.by });
    return at ? t(c.how === 'dismissed' ? 'office.issues.dismissedAt' : 'office.issues.closedAt', { at }) : '';
  };

  /** A group's rows in the order asked (Sort): the most urgent first, else as the server sent them (the newest first). */
  const ordered = (g: IssueGroup) => (sort === 'urgent' ? [...g.newest].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)) : g.newest);

  const renderGroup = (g: IssueGroup) => {
    const ids = g.newest.map((i) => i.id);
    const tick = groupTick(picked, ids);
    const isOpen = !collapsed.has(g.kind);
    return (
      <Section
        key={g.kind}
        title={groupText(g, t)}
        count={g.count}
        dot={severityTone(g.severity)}
        dotLabel={t(`office.issues.severity.${g.severity}`)}
        dotIcon={SEVERITY_ICONS[severityIcon(g.severity)]}
        open={isOpen}
        onToggle={() => setCollapsed((c) => toggled(c, [g.kind], !c.has(g.kind)))}
        link={g.count > g.newest.length ? t('office.issues.showAll', { n: g.count }) : undefined}
        onLink={() => showKind(g.kind)}
        head={mayBulk && isOpen ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: tick === 'on' ? true : tick === 'mixed' ? 'mixed' : false }} accessibilityLabel={t('office.issues.selectShown')}
            onPress={() => pick(ids, tick !== 'on')} style={(state) => [{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }, hoverStyle(state)]} testID="group-tick">
            <SelectMark kind="box" on={tick === 'on'} size={24} />
          </Pressable>
        ) : undefined}
        testID={`issue-group-${g.kind}`}
      >
        {ordered(g).map((i, n) => <View key={i.id}>{n > 0 && <Divider />}{renderRow(i, g.severity)}</View>)}
        {mayBulk && tick === 'on' && g.count > ids.length && (
          <Pressable accessibilityRole="button" onPress={() => void pickAllOf(g.kind, g.count)} style={{ minHeight: 44, justifyContent: 'center' }} testID="group-select-all">
            <Txt variant="strong" size={15} color={colors.blue}>{t('office.issues.selectAllGroup', { n: g.count })}</Txt>
          </Pressable>
        )}
      </Section>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      {/* The header counts what needs action (critical and warning, not snoozed): the same number as Home and the site's badge. */}
      <DarkHeader above={t('office.issues.above')} title={`${t('office.issues.title')}${d ? ` · ${needsAction(d)}` : ''}`}>
        {d && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <Chip n={d.open} text={t('office.issues.chip_open')} tone={d.open > 0 ? 'red' : 'muted'} onPress={() => apply({ ...values, status: 'open' })} />
            <Chip n={d.in_progress} text={t('office.issues.chip_in_progress')} tone={d.in_progress > 0 ? 'amber' : 'muted'} onPress={() => apply({ ...values, status: 'in_progress' })} />
            {(d.snoozed ?? 0) > 0 && <Chip n={d.snoozed ?? 0} text={t('office.issues.chip_snoozed')} tone="muted" onPress={() => setTab('snoozed')} />}
          </View>
        )}
        {me.tools.includes('list_vehicle_reports') && (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/office/maintenance', params: { view: 'reports' } })} style={{ minHeight: 44, justifyContent: 'center', marginTop: 6 }} testID="issues-maintenance">
            <Txt variant="strong" size={16} color={colors.amber}>{t('office.maint.link')}</Txt>
          </Pressable>
        )}
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <Segmented
          options={ISSUE_TABS.map((k) => ({ value: k, label: k !== 'resolved' && d ? t('office.issues.tabN', { label: t(`office.issues.tab.${k}`), n: k === 'open' ? d.open + d.in_progress : d.snoozed ?? 0 }) : t(`office.issues.tab.${k}`) }))}
          value={tab}
          onChange={setTab}
        />
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.issues.searchPlaceholder')}
          defs={defs}
          values={values}
          onApply={apply}
          sort={{ value: sort, options: ISSUE_SORTS.map((k) => ({ value: k, label: t(`office.issues.sort_${k}`) })), onChange: (v) => setSortPick(v as IssueSort) }}
        />
        {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!d && !q.error && <SkeletonRows rows={5} lines={3} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && grouped && (
          (d.groups ?? []).length === 0
            ? <Section title={t(`office.issues.filter.${status}`)} count={0}><ListEmpty icon={Check} text={emptyText()} /></Section>
            : (d.groups ?? []).map(renderGroup)
        )}
        {d && !grouped && (
          <Section
            title={extra.kind ? groupText({ kind: extra.kind }, t) : tab === 'snoozed' ? t('office.issues.tab.snoozed') : t(`office.issues.filter.${status}`)}
            count={severity === 'all' && d.total !== undefined ? d.total : rows.length}
            link={extra.kind ? t('office.issues.allKinds') : undefined}
            onLink={() => setValues((v) => ({ ...v, kind: 'all' }))}
          >
            {rows.length === 0
              ? <ListEmpty icon={tab === 'snoozed' ? Clock : Check} text={emptyText()} />
              : rows.map((i, n) => <View key={i.id}>{n > 0 && <Divider />}{renderRow(i)}</View>)}
            {d.total !== undefined && d.total > d.issues.length && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <LoadMore shown={d.issues.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
              </View>
            )}
          </Section>
        )}
      </Screen>
      {/* The ticks' bar (Gmail's): how many, Resolve, Dismiss, and clear. */}
      {mayBulk && picked.size > 0 && (
        <StickyActions>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} testID="bulk-bar">
            <Pressable accessibilityRole="button" accessibilityLabel={t('office.issues.clearSelection')} onPress={() => setPicked(new Set())} style={(state) => [{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, hoverStyle(state)]}>
              <X size={22} color={colors.ink} />
            </Pressable>
            <Txt variant="strong" style={{ flex: 1 }}>{t('office.issues.selectedN', { n: picked.size })}</Txt>
            <Button kind="outline" label={t('office.issues.bulk.dismiss')} onPress={() => { setReason(''); setBulk({ busy: false, error: null, done: 0 }); setActing('dismissed'); }} style={{ minHeight: 48, paddingHorizontal: 14 }} />
            <Button kind="dark" label={t('office.issues.bulk.resolve')} onPress={() => { setReason(''); setBulk({ busy: false, error: null, done: 0 }); setActing('resolved'); }} style={{ minHeight: 48, paddingHorizontal: 14 }} />
          </View>
        </StickyActions>
      )}
      {/* One reason for every issue ticked (required): the common ones as chips; the error stays here with Try again. */}
      <Sheet
        visible={!!acting}
        title={picked.size === 1 ? t(acting === 'dismissed' ? 'office.issues.bulk.titleDismissOne' : 'office.issues.bulk.titleResolveOne') : t(acting === 'dismissed' ? 'office.issues.bulk.titleDismiss' : 'office.issues.bulk.titleResolve', { n: picked.size })}
        onClose={() => { if (!bulk.busy) setActing(null); }}
        testID="bulk-sheet"
        actions={(
          <>
            <Button kind="outline" label={t('office.common.cancel')} onPress={() => setActing(null)} disabled={bulk.busy} style={{ flex: 1, minHeight: 52 }} />
            <Button kind="dark" label={t(acting === 'dismissed' ? 'office.issues.bulk.dismiss' : 'office.issues.bulk.resolve')} busy={bulk.busy} disabled={!reason.trim()} onPress={() => void act()} style={{ flex: 1, minHeight: 52 }} testID="bulk-confirm" />
          </>
        )}
      >
        <ChoiceChips options={BULK_REASONS.map((k) => ({ key: k, label: t(`office.issues.reason.${k}`) }))} value={BULK_REASONS.find((k) => t(`office.issues.reason.${k}`) === reason) ?? ''} onChange={(k) => setReason(t(`office.issues.reason.${k}`))} small />
        <Field label={t('office.issues.bulk.reason')} value={reason} onChangeText={setReason} placeholder={t('office.issues.bulk.reasonPlaceholder')} maxLength={500} />
        {!reason.trim() ? <Txt variant="small">{t('office.issues.bulk.reasonNeeded')}</Txt> : null}
        {bulk.error ? <ErrorNotice error={bulk.done ? { ...bulk.error, message: t('office.issues.bulk.partly', { done: bulk.done, why: bulk.error.message }) } : bulk.error} onRetry={() => void act()} onSignIn={() => void signOut()} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
