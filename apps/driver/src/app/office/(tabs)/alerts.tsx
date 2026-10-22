// Office mode (Phase 8, O1): the Alerts tab, the notification centre (design 16; the tab says Alerts, the screen says
// Notifications: decision 3). my_inbox's last 30 days, 50 at a time, All / Unread, grouped Today / Yesterday / Earlier;
// "Mark all read" while anything is unread. A tap marks the item read (optimistic, the badge follows at once; put back
// if the server refused) and opens the screen its link maps to (office/nav.ts routeForUrl) when the app has one; an item
// whose link has no screen in O1 is only marked read and shows no Open pill: no button that does nothing. Round 4–7 (7): an
// item with buttons (an Ask for it's Yes / No) shows them under it: a tap calls the tool as the server gave it, the item is
// read, and the buttons become "You said Yes"; a holder.* item the person cannot open as a task opens the Asks page.

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Check, ChevronRight, ClipboardCheck, type LucideIcon, TriangleAlert, Van } from '@/components/icons';
import { InboxActions } from '@/components/office/HolderParts';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Txt } from '@/components/ui';
import { whenWords } from '@/lib/dateWords';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { colomboDate } from '@/lib/time';
import { appendInbox, filterInbox, groupByDay, inboxArgs, inboxHistory, inboxChoice, inboxFilterDefs, inboxLine, kindTone, markRead, unreadAfter } from '@/office/inboxLogic';
import { holderAsksRoute } from '@/office/holderLogic';
import { routeForUrl } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, Inbox, InboxItem } from '@/office/types';
import { DarkHeader, ErrorNotice, ListFailed, Screen, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 500;

const ICONS: Record<InboxItem['kind'], LucideIcon> = { urgent: TriangleAlert, alarm: TriangleAlert, alert: ClipboardCheck, soft: Van, info: Check };
const TILE: Record<Tone, { bg: string; ink: string }> = {
  red: { bg: colors.redChip, ink: colors.red },
  amber: { bg: colors.amberChip, ink: colors.amberText },
  blue: { bg: colors.blueChip, ink: colors.blue },
  green: { bg: colors.greenChip, ink: colors.green },
  muted: { bg: '#ebe9e3', ink: colors.muted },
};

export default function AlertsTab() {
  const { t, tList } = useApp();
  const { me, api, signOut, unread, setUnread, reloadUnread } = useOffice();
  const router = useRouter();
  const [values, setValues] = useState<FilterValues>({ show: 'all' });
  const filter = inboxChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const archived = inboxHistory(values);
  const q = useTool<Inbox>('my_inbox', inboxArgs(LIMIT, search, archived), { every: 60_000 });
  // O3 row 7: the next 50 (older pages, and the archived ones when History asks for them).
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  async function loadMore() {
    // The list this page belongs to: a page that lands after the filter or day changed is dropped.
    const k = q.key;
    if (!q.data?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<Inbox>('my_inbox', inboxArgs(LIMIT, search, archived, q.data.next));
      q.patch((p) => appendInbox(p, page), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }
  const today = colomboDate();
  const names = { days: tList('days'), months: tList('months') };
  const unreadN = q.data?.unread ?? unread;
  const groups = groupByDay(filterInbox(q.data?.items ?? [], filter), today);

  async function markAll() {
    setBusy(true);
    setProblem(null);
    try {
      await api.call('mark_inbox_read', { all: true });
      q.patch((p) => ({ ...p, unread: 0, items: markRead(p.items, 'all') }));
      setUnread(0);
      await q.reload();
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  function open(item: InboxItem) {
    const route = routeForUrl(item.url, me.permissions) ?? holderAsksRoute(item);
    markItemRead(item);
    if (route) router.push(route as never);
  }

  /** The item read (optimistic: the badge follows at once; put back if the server refused). Opening it or answering one
   *  of its buttons does this. */
  function markItemRead(item: InboxItem) {
    if (!item.read) {
      q.patch((p) => ({ ...p, unread: unreadAfter(p.unread, 1), items: markRead(p.items, [item.id]) }));
      setUnread(unreadAfter(unread, 1));
      api.call('mark_inbox_read', { ids: [item.id] }).catch(() => {
        // The server did not take it: the row is unread again and the badge is read back.
        q.patch((p) => ({ ...p, unread: p.unread + 1, items: p.items.map((x) => (x.id === item.id ? { ...x, read: false } : x)) }));
        reloadUnread();
      });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.alerts.above')} title={t('office.alerts.title')} bell={false}>
        {unreadN > 0 && (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void markAll()} style={[styles.markAll, busy && { opacity: 0.5 }]}>
            <Txt variant="strong" size={16} color={colors.amber}>{t('office.alerts.markAllRead')}</Txt>
          </Pressable>
        )}
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.alerts.search')}
          defs={inboxFilterDefs(unreadN, t)}
          values={values}
          onApply={setValues}
        />
        {problem && <ErrorNotice error={problem} onRetry={() => void markAll()} onSignIn={() => void signOut()} />}
        {!q.data && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!q.data && !q.error && <SkeletonRows rows={5} lines={2} />}
        {q.data && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && groups.length === 0 && <ListEmpty text={search ? t('office.alerts.noneMatch', { search }) : t(filter === 'unread' ? 'office.alerts.noneUnread' : 'office.alerts.none')} />}
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Txt variant="label" color={colors.muted} style={{ paddingHorizontal: 2 }}>{t(`office.common.${g.key}`).toUpperCase()}</Txt>
            {g.items.map((item) => {
              const Icon = ICONS[item.kind] ?? Check;
              const tile = TILE[kindTone(item.kind)];
              const route = routeForUrl(item.url, me.permissions) ?? holderAsksRoute(item);
              return (
                <View key={item.id} style={{ gap: 6 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: !item.read }}
                    onPress={() => open(item)}
                    style={({ pressed }) => [styles.card, !item.read && styles.unreadCard, pressed && { opacity: 0.8 }]}
                  >
                    <View style={[styles.tile, { backgroundColor: tile.bg }]}>
                      <Icon size={22} color={tile.ink} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Txt variant={item.read ? 'body' : 'strong'} size={17}>{item.title}</Txt>
                      {item.body ? <Txt variant="muted" size={15}>{item.body}</Txt> : null}
                      <View style={styles.foot}>
                        <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>{inboxLine({ ...item, ago: whenWords(t, item.ago) }, today, names)}</Txt>
                        {route && (
                          <View style={styles.open}>
                            <Txt variant="strong" size={14}>{t('office.alerts.open')}</Txt>
                            <ChevronRight size={16} color={colors.ink} strokeWidth={2.4} />
                          </View>
                        )}
                      </View>
                    </View>
                  </Pressable>
                  {/* Round 4–7 (7): an item's buttons (an Ask for it's Yes / No, Gmail / Slack actionable notifications). */}
                  {item.actions?.length ? <InboxActions item={item} onRead={markItemRead} /> : null}
                </View>
              );
            })}
          </View>
        ))}
        {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
        {q.data?.next && <LoadMore shown={q.data.items.length} total={q.data.total} busy={more.busy} onPress={() => void loadMore()} />}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  markAll: { alignSelf: 'flex-end', minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14, minHeight: 72 },
  unreadCard: { borderLeftWidth: 4, borderLeftColor: colors.amber },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, minHeight: 32 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.amber, borderRadius: 10, paddingLeft: 12, paddingRight: 8, height: 32 },
});
