// Office mode (Phase 8, O1): the Alerts tab, the notification centre (design 16; the tab says Alerts, the screen says
// Notifications: decision 3). my_inbox's last 30 days, 50 at a time, All / Unread, grouped Today / Yesterday / Earlier;
// "Mark all read" while anything is unread. A tap marks the item read (optimistic, the badge follows at once; put back
// if the server refused) and opens the screen its link maps to (office/nav.ts routeForUrl) when the app has one; an item
// whose link has no screen in O1 is only marked read and shows no Open pill: no button that does nothing.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Check, ChevronRight, ClipboardCheck, type LucideIcon, TriangleAlert, Van } from '@/components/icons';
import { Txt } from '@/components/ui';
import { colomboDate } from '@/lib/time';
import { filterInbox, groupByDay, inboxLine, type InboxFilter, kindTone, markRead, unreadAfter } from '@/office/inboxLogic';
import { routeForUrl } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { FleetError, Inbox, InboxItem } from '@/office/types';
import { DarkHeader, Empty, ErrorNotice, FilterChips, Loading, Screen, type Tone } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LIMIT = 50;

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
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const q = useTool<Inbox>('my_inbox', { limit: LIMIT }, { every: 60_000 });
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
    const route = routeForUrl(item.url, me.permissions);
    if (!item.read) {
      q.patch((p) => ({ ...p, unread: unreadAfter(p.unread, 1), items: markRead(p.items, [item.id]) }));
      setUnread(unreadAfter(unread, 1));
      api.call('mark_inbox_read', { ids: [item.id] }).catch(() => {
        // The server did not take it: the row is unread again and the badge is read back.
        q.patch((p) => ({ ...p, unread: p.unread + 1, items: p.items.map((x) => (x.id === item.id ? { ...x, read: false } : x)) }));
        reloadUnread();
      });
    }
    if (route) router.push(route as never);
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
        <FilterChips<InboxFilter>
          options={[{ key: 'all', label: t('office.common.all') }, { key: 'unread', label: t('office.alerts.unread'), n: unreadN }]}
          value={filter}
          onChange={setFilter}
        />
        {problem && <ErrorNotice error={problem} onRetry={() => void markAll()} onSignIn={() => void signOut()} />}
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !q.data && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && groups.length === 0 && <Empty text={t(filter === 'unread' ? 'office.alerts.noneUnread' : 'office.alerts.none')} />}
        {groups.map((g) => (
          <View key={g.key} style={{ gap: 8 }}>
            <Txt variant="label" color={colors.muted} style={{ paddingHorizontal: 2 }}>{t(`office.common.${g.key}`).toUpperCase()}</Txt>
            {g.items.map((item) => {
              const Icon = ICONS[item.kind] ?? Check;
              const tile = TILE[kindTone(item.kind)];
              const route = routeForUrl(item.url, me.permissions);
              return (
                <Pressable
                  key={item.id}
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
                      <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>{inboxLine(item, today, names)}</Txt>
                      {route && (
                        <View style={styles.open}>
                          <Txt variant="strong" size={14}>{t('office.alerts.open')}</Txt>
                          <ChevronRight size={16} color={colors.ink} strokeWidth={2.4} />
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
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
