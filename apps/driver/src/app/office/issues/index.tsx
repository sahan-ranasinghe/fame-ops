// Office mode (Phase 8, O2): the Issues list (the site's issues centre on a phone; no design: the O1 screens' look).
// list_issues with the status chips (Active · Open · In progress · Resolved · Dismissed, the tool's own status), the
// severity chips narrowing the page on the phone, the words searched for (sent as `search` half a second after the
// last key), 50 at a time with Load more on the cursor, pull to refresh and a read again when the screen comes back.
// A row opens the issue's page (/office/issues/[id]). Everything the server answers is shown (with issues every kind,
// with assign_tasks only the task kinds: the server's rule); the actions live on the page, by the person's tools.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Search, TriangleAlert, X } from '@/components/icons';
import { Button, Plate, Txt } from '@/components/ui';
import {
  activeCount, appendPage, DEFAULT_STATUS, type IssueStatusFilter, issuesArgs, kindText, listRows, rowLine, SEARCH_DEBOUNCE_MS, SEVERITY_FILTERS,
  type SeverityFilter, severityCounts, severityTone, snoozeParts, STATUS_FILTERS, statusTone, whoLine, type WhoWords,
} from '@/office/issuesLogic';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, Issue, IssuesList } from '@/office/types';
import { Chip, DarkHeader, Divider, Empty, ErrorNotice, FilterChips, Loading, Pill, Screen, Section, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const TILE: Record<Tone, { bg: string; ink: string }> = {
  red: { bg: colors.redChip, ink: colors.red },
  amber: { bg: colors.amberChip, ink: colors.amberText },
  blue: { bg: colors.blueChip, ink: colors.blue },
  green: { bg: colors.greenChip, ink: colors.green },
  muted: { bg: '#ebe9e3', ink: colors.muted },
};

export default function IssuesScreen() {
  const { t, language } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const [status, setStatus] = useState<IssueStatusFilter>(DEFAULT_STATUS);
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });

  // The words typed go to the server half a second after the last key (every key would be a call).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const q = useTool<IssuesList>('list_issues', issuesArgs(status, search));
  const d = q.data;
  const rows = listRows(d?.issues ?? [], status, severity);
  const counts = severityCounts(d?.issues ?? [], status);
  const words: WhoWords = {
    opened: (at) => t('office.issues.opened', { at }),
    takenBy: (name, at) => (at ? t('office.issues.takenByAt', { name, at }) : t('office.issues.takenBy', { name })),
    closed: (at) => t('office.issues.closedAt', { at }),
    dismissed: (at) => t('office.issues.dismissedAt', { at }),
  };

  async function loadMore() {
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<IssuesList>('list_issues', issuesArgs(status, search, d.next));
      q.patch((p) => appendPage(p, page));
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
          <Txt variant="muted" size={15} numberOfLines={2}>{rowLine(i, kindText(i, t))}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {i.vehicle ? <Plate regNo={i.vehicle} /> : null}
            <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>{whoLine(i, words)}</Txt>
          </View>
          {snooze && (
            <Txt variant="small" color={colors.amberText}>
              {snooze.by ? t('office.issues.snoozedUntilBy', { at: snooze.until, name: snooze.by }) : t('office.issues.snoozedUntil', { at: snooze.until })}
            </Txt>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Pill text={t(`office.issues.severity.${i.severity}`)} tone={severityTone(i.severity)} size={13} />
          <Pill text={t(`office.issues.status.${i.status}`)} tone={statusTone(i.status)} size={13} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.issues.above')} title={`${t('office.issues.title')}${d ? ` · ${activeCount(d)}` : ''}`}>
        {d && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <Chip n={d.open} text={t('office.issues.chip_open')} tone={d.open > 0 ? 'red' : 'muted'} onPress={() => setStatus('open')} />
            <Chip n={d.in_progress} text={t('office.issues.chip_in_progress')} tone={d.in_progress > 0 ? 'amber' : 'muted'} onPress={() => setStatus('in_progress')} />
            {(d.snoozed ?? 0) > 0 && <Chip n={d.snoozed ?? 0} text={t('office.issues.chip_snoozed')} tone="muted" />}
          </View>
        )}
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterChips<IssueStatusFilter>
          options={STATUS_FILTERS.map((k) => ({
            key: k,
            label: t(`office.issues.filter.${k}`),
            n: d && k === 'active' ? activeCount(d) : d && k === 'open' ? d.open : d && k === 'in_progress' ? d.in_progress : undefined,
          }))}
          value={status}
          onChange={setStatus}
        />
        <FilterChips<SeverityFilter>
          options={SEVERITY_FILTERS.map((k) => ({ key: k, label: k === 'all' ? t('office.common.all') : t(`office.issues.severity.${k}`), n: d ? counts[k] : undefined }))}
          value={severity}
          onChange={setSeverity}
        />
        <View style={styles.search}>
          <Search size={20} color={colors.muted} strokeWidth={2.2} />
          <TextInput
            accessibilityRole="search"
            value={text}
            onChangeText={setText}
            placeholder={t('office.issues.searchPlaceholder')}
            placeholderTextColor="#9aa0a6"
            returnKeyType="search"
            onSubmitEditing={() => setSearch(text.trim())}
            autoCorrect={false}
            style={[styles.searchInput, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
          />
          {text.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('office.issues.clearSearch')} onPress={() => { setText(''); setSearch(''); }} style={styles.clear}>
              <X size={20} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !d && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t(`office.issues.filter.${status}`)} count={severity === 'all' && d.total !== undefined ? d.total : rows.length}>
            {rows.length === 0
              ? <Empty text={emptyText()} />
              : rows.map((i, n) => <View key={i.id}>{n > 0 && <Divider />}{renderRow(i)}</View>)}
            {d.total !== undefined && d.total > d.issues.length && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.issues.showing', { n: d.issues.length, total: d.total })}</Txt>
                {more.error && <ErrorNotice error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <Button kind="outline" label={t('office.issues.loadMore')} busy={more.busy} onPress={() => void loadMore()} style={{ minHeight: 52 }} />}
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
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.card, paddingLeft: 14, paddingRight: 4 },
  searchInput: { flex: 1, fontSize: 17, color: colors.ink, minHeight: 48, paddingVertical: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
