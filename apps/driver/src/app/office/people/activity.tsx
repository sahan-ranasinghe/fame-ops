// Round 2b: More → Activity log (users; Google Workspace's admin audit log), the same as the site's Settings → Activity
// log: activity_log, who changed what and when, newest first: the action in words, what it was about, who and through
// which channel, done / refused (with the reason) / failed. The days (one date range button, the last 7 by default) and a
// person (the search: a name, an e-mail or a driver's username); 50 at a time with Load more.

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DateRangeButton } from '@/components/patterns/Calendar';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Txt } from '@/components/ui';
import { presetRange } from '@/lib/patterns/calendarLogic';
import { colomboDate } from '@/lib/time';
import { useOffice, useTool } from '@/office/state';
import type { ActivityEntry, ActivityLog, FleetError } from '@/office/types';
import { BackHeader, Divider, ListFailed, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const SEARCH_DEBOUNCE_MS = 500;
/** The server answers up to 92 days at a time. */
const MAX_DAYS = 92;

const TONE = { done: 'green', refused: 'amber', failed: 'red', running: 'muted' } as const;

export default function ActivityLogScreen() {
  const { t } = useApp();
  const { api, signOut } = useOffice();
  const today = colomboDate();
  const [range, setRange] = useState(() => presetRange('last7', today));
  const [text, setText] = useState('');
  const [person, setPerson] = useState('');
  const [more, setMore] = useState<{ busy: boolean; error: FleetError | null }>({ busy: false, error: null });
  useEffect(() => {
    const timer = setTimeout(() => setPerson(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const args = (cursor?: string) => ({ from: range.from, to: range.to, limit: 50, ...(person ? { person } : {}), ...(cursor ? { cursor } : {}) });
  const q = useTool<ActivityLog>('activity_log', args());
  const d = q.data;

  async function loadMore() {
    const k = q.key;
    if (!d?.next || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const page = await api.call<ActivityLog>('activity_log', args(d.next));
      q.patch((p) => ({ ...page, entries: [...p.entries, ...page.entries] }), k, true);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e as FleetError });
    }
  }

  const row = (e: ActivityEntry) => (
    <Row
      time={e.at.slice(-5)}
      title={[e.action, e.about].filter(Boolean).join(' · ')}
      line={[e.at.slice(0, 10), e.person, e.channel].filter(Boolean).join(' · ')}
      line2={e.reason}
      chip={{ text: t(`office.activity.${e.outcome}`), tone: TONE[e.outcome] }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.activity.title')} subtitle={t('office.activity.sub')} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <DateRangeButton value={range} onChange={setRange} max={today} maxDays={MAX_DAYS} testID="activity-range" />
        <FilterBar search={text} onSearch={(v) => { setText(v); if (!v) setPerson(''); }} placeholder={t('office.activity.search')} defs={[]} values={{}} onApply={() => undefined} />
        {!d && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!d && !q.error && <SkeletonRows rows={6} lines={2} />}
        {d && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {d && (
          <Section title={t('office.activity.title')} count={d.total ?? d.entries.length}>
            {d.entries.length === 0
              ? <ListEmpty text={t(person ? 'office.activity.emptyPerson' : 'office.activity.empty')} />
              : d.entries.map((e, i) => <View key={e.id}>{i > 0 && <Divider />}{row(e)}</View>)}
            {d.total !== undefined && d.total > d.entries.length && (
              <View style={{ gap: 10, paddingTop: 12 }}>
                {more.error && <ListFailed error={more.error} onRetry={() => void loadMore()} onSignIn={() => void signOut()} />}
                {d.next && <LoadMore shown={d.entries.length} total={d.total} busy={more.busy} onPress={() => void loadMore()} />}
              </View>
            )}
          </Section>
        )}
        <Txt variant="small">{t('office.more.activityLine')}</Txt>
      </Screen>
    </View>
  );
}
