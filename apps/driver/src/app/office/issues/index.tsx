// Office mode (Phase 8, O2; the standard patterns in O3, docs/ui-patterns.md): the Issues list (the site's issues centre
// on a phone; no design: the O1 screens' look). list_issues with the search bar (the words sent as `search` half a second
// after the last key), one Filter button (the status: Active · Open · In progress · Resolved · Dismissed, the tool's own
// status with the server's counts; the severity narrowing the page on the phone), the chips in use under it, Sort (the
// tool's own `sort`: the most urgent or the newest first; the status's own order until the person picks), 50 at a time
// with Load more on the cursor, skeleton rows while the first answer comes, pull to refresh and a read again when the
// screen comes back. A row opens the issue's page (/office/issues/[id]). Everything the server answers is shown (with
// issues every kind, with assign_tasks only the task kinds: the server's rule); the actions live on the page.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { TriangleAlert } from '@/components/icons';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Plate, Txt } from '@/components/ui';
import { presetRange } from '@/lib/patterns/calendarLogic';
import { defaultValues, type FilterValues } from '@/lib/patterns/filterLogic';
import { colomboDate } from '@/lib/time';
import {
  activeCount, appendPage, defaultSort, dueWords, ISSUE_SORTS, type IssueSort, issuesArgs, issuesChoice, issuesFilterDefs, kindText, listRows, rowLine, SEARCH_DEBOUNCE_MS,
  severityCounts, severityTone, snoozeParts, statusTone, whoLine, type WhoWords, issuesExtra, issuesExtraDefs, kindsFor,
} from '@/office/issuesLogic';
import { useOffice, useTool } from '@/office/state';
import { has } from '@/office/nav';
import type { FleetError, Issue, IssuesList, VehiclesList } from '@/office/types';
import { Avatar, Chip, DarkHeader, Divider, ListFailed, Screen, Section, StatusChip, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords } from '@/lib/dateWords';

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

  // The words typed go to the server half a second after the last key (every key would be a call).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = useTool<IssuesList>('list_issues', issuesArgs(status, search, undefined, sortPick ?? undefined, extra));
  const d = q.data;
  const rows = listRows(d?.issues ?? [], status, severity);
  const counts = severityCounts(d?.issues ?? [], status);
  const defs = [...issuesFilterDefs(d, d ? counts : null, t), ...issuesExtraDefs(kinds, plateList, t)];
  const apply = (next: FilterValues) => {
    // Another status starts again in that status's own order.
    if (issuesChoice(next).status !== status) setSortPick(null);
    setValues(next);
  };
  const words: WhoWords = {
    // The server's "2026-10-18 09:12" in words (Round 3 A4, lib/dateWords.ts): "Today 09:12".
    opened: (at) => t('office.issues.opened', { at: dateWords(t, at) }),
    takenBy: (name, at) => (at ? t('office.issues.takenByAt', { name, at }) : t('office.issues.takenBy', { name })),
    closed: (at) => t('office.issues.closedAt', { at: dateWords(t, at) }),
    dismissed: (at) => t('office.issues.dismissedAt', { at: dateWords(t, at) }),
  };

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
    if (severity !== 'all' && counts.all > 0) return t('office.issues.empty.severity');
    return t(`office.issues.empty.${status}`);
  };

  const renderRow = (i: Issue) => {
    const tile = TILE[severityTone(i.severity)];
    const snooze = snoozeParts(i);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/office/issues/[id]', params: { id: i.id } })}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.tile, { backgroundColor: tile.bg }]}>
          <TriangleAlert size={22} color={tile.ink} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt variant="strong" size={17} numberOfLines={2}>{i.title}</Txt>
          <Txt variant="muted" size={15} numberOfLines={2}>{rowLine({ ...i, due: dueWords(t, i.due) }, kindText(i, t))}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {i.vehicle ? <Plate regNo={i.vehicle} /> : null}
            {/* Round 3: the person who took it, their photo beside the words (initials until there is one). */}
            {i.assigned_to ? <Avatar name={i.assigned_to.name} size={24} photo={i.assigned_to.photo_url} /> : null}
            <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>{whoLine(i, words)}</Txt>
          </View>
          {snooze && (
            <Txt variant="small" color={colors.amberText}>
              {snooze.by ? t('office.issues.snoozedUntilBy', { at: dateWords(t, snooze.until), name: snooze.by }) : t('office.issues.snoozedUntil', { at: dateWords(t, snooze.until) })}
            </Txt>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <StatusChip text={t(`office.issues.severity.${i.severity}`)} tone={severityTone(i.severity)} />
          <StatusChip text={t(`office.issues.status.${i.status}`)} tone={statusTone(i.status)} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.issues.above')} title={`${t('office.issues.title')}${d ? ` · ${activeCount(d)}` : ''}`}>
        {d && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <Chip n={d.open} text={t('office.issues.chip_open')} tone={d.open > 0 ? 'red' : 'muted'} onPress={() => apply({ ...values, status: 'open' })} />
            <Chip n={d.in_progress} text={t('office.issues.chip_in_progress')} tone={d.in_progress > 0 ? 'amber' : 'muted'} onPress={() => apply({ ...values, status: 'in_progress' })} />
            {(d.snoozed ?? 0) > 0 && <Chip n={d.snoozed ?? 0} text={t('office.issues.chip_snoozed')} tone="muted" />}
          </View>
        )}
        {me.tools.includes('list_vehicle_reports') && (
          <Pressable accessibilityRole="link" onPress={() => router.push('/office/maintenance')} style={{ minHeight: 44, justifyContent: 'center', marginTop: 6 }} testID="issues-maintenance">
            <Txt variant="strong" size={16} color={colors.amber}>{t('office.maint.link')}</Txt>
          </Pressable>
        )}
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
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
        {d && (
          <Section title={t(`office.issues.filter.${status}`)} count={severity === 'all' && d.total !== undefined ? d.total : rows.length}>
            {rows.length === 0
              ? <ListEmpty text={emptyText()} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, minHeight: 56 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
