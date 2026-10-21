// Office mode (Phase 8, O1; the standard patterns in O3, docs/ui-patterns.md): the Tasks tab, a day's board (task_board)
// with the week strip (a day of the board: tap a day, swipe week by week, Today, the calendar; days ahead too, tasks are
// planned ahead), skeleton rows while the day's board comes: needs a driver first, then on
// the way, sent, waiting for approval, done. A row opens Task detail (design 14); "Give a driver" opens Needs a driver
// (design 11). Not designed as a list (docs/phase8-plan.md section 11): the same rows as Home's "Today's tasks".
// Stage 1 (O3 item 3): History in the header (Tasks → History, list_tasks) and Load more at the end of a column that has
// more cards than its first page (task_board with the column and its cursor; the pages loaded stay while the board is read
// again every minute, and go when the day changes).

import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DayStrip } from '@/components/patterns/Calendar';
import { Clock } from '@/components/icons';
import { ListEmpty, LoadMore, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Txt } from '@/components/ui';
import { SavedNotice } from '@/components/office/SavedNotice';
import { colomboDate } from '@/lib/time';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import { addColumnPage, BOARD_LIMIT, type BoardColumn, columnArgs, type ColumnMore, columnView } from '@/office/taskHistoryLogic';
import type { Board, BoardCard, FleetError } from '@/office/types';
import { chipText, sentenceText, taskChip, taskRowLine } from '@/office/statusWords';
import { DarkHeader, Divider, ListFailed, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TasksTab() {
  const { t } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const today = colomboDate();
  const [date, setDate] = useState(today);
  const q = useTool<Board>('task_board', { date, limit: BOARD_LIMIT }, { every: 60_000 });
  // The board shown is the day chosen (while another day's board is on its way: the skeleton, not the old day's rows).
  const b = q.data && q.data.date === date ? q.data : null;
  const canApprove = has(me.permissions, 'approve');
  // Load more per column: the pages loaded after the first, kept while the board is read again; another day starts over.
  const [more, setMore] = useState<Partial<Record<BoardColumn, ColumnMore>>>({});
  const [paging, setPaging] = useState<{ column: BoardColumn | null; error: FleetError | null; failed: BoardColumn | null }>({ column: null, error: null, failed: null });
  useEffect(() => {
    setMore({});
    setPaging({ column: null, error: null, failed: null });
  }, [date]);
  const dateRef = useRef(date);
  dateRef.current = date;
  async function loadMore(column: BoardColumn, cursor: string) {
    if (paging.column) return;
    setPaging({ column, error: null, failed: null });
    try {
      const page = await api.call<Board>('task_board', columnArgs(date, column, cursor));
      // Another day was picked meanwhile: this page was the old day's (Stage 1 review).
      if (dateRef.current !== date) return;
      setMore((m) => ({ ...m, [column]: addColumnPage(m[column], page, column) }));
      setPaging({ column: null, error: null, failed: null });
    } catch (e) {
      setPaging({ column: null, error: e as FleetError, failed: column });
    }
  }

  // The one list row (Gmail's list): the time, the title on one line, "driver · the status in words", a short chip. Round 3:
  // a trip with no app says who drives ("Nimali · Drives themselves · no app"); Running late in the person's words.
  const rowOf = (c: BoardCard, column: BoardColumn) => (
    <Row
      key={c.id}
      time={c.time}
      title={c.title}
      line={taskRowLine(t, c)}
      line2={c.late_report ? sentenceText(t, c.late_report.text) : undefined}
      chip={(() => { const k = taskChip(column, c); return { text: chipText(t, k), tone: k.tone }; })()}
      onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: c.id } })}
    />
  );
  const list = (column: BoardColumn, empty: string) => {
    if (!b) return null;
    const v = columnView(b, column, more[column]);
    return (
      <>
        {v.cards.length === 0 ? <ListEmpty text={empty} /> : v.cards.map((c, i) => <View key={c.id}>{i > 0 && <Divider />}{rowOf(c, column)}</View>)}
        {(v.next || paging.failed === column) && (
          <View style={{ gap: 10, paddingTop: 12 }}>
            {paging.failed === column && paging.error && <ListFailed error={paging.error} onRetry={() => v.next && void loadMore(column, v.next)} onSignIn={() => void signOut()} />}
            {v.next && <LoadMore shown={v.cards.length} total={v.total} busy={paging.column === column} onPress={() => void loadMore(column, v.next!)} />}
          </View>
        )}
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.tasks.above')} title={t('office.tabs.tasks')}>
        {me.tools.includes('list_tasks') && (
          <View style={{ flexDirection: 'row', marginTop: 14 }}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/office/task-history')} style={({ pressed }) => [styles.history, pressed && { opacity: 0.8 }]} testID="tasks-history">
              <Clock size={18} color="#ffffff" strokeWidth={2.4} />
              <Txt variant="strong" size={15} color="#ffffff">{t('office.history2.open')}</Txt>
            </Pressable>
          </View>
        )}
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        <SavedNotice noticeKey="/office/(tabs)/tasks" />
        <DayStrip value={date} onChange={setDate} testID="tasks-day" />
        {me.tools.includes('create_task') && <Button label={t('office.trip.assignTask')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } })} style={{ minHeight: 56 }} />}
        {!b && q.error && <ListFailed error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {!b && !q.error && <SkeletonRows rows={5} lines={2} />}
        {b && q.error && <ListFailed stale error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {b && (b.needs_driver?.length ?? 0) > 0 && (
          <Section title={t('office.home.needsDriver')} count={b.needs_driver?.length} tone="red">
            {b.needs_driver?.map((x, i) => (
              <View key={x.task_id}>
                {i > 0 && <Divider />}
                <Row
                  title={x.title}
                  line={`${x.start} · ${x.line}`}
                  right={<Button kind="dark" label={t('office.home.giveDriver')} onPress={() => router.push({ pathname: '/office/task/[id]/driver', params: { id: x.task_id } })} style={{ minHeight: 48, backgroundColor: colors.red, paddingHorizontal: 14 }} />}
                  onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: x.task_id } })}
                />
              </View>
            ))}
          </Section>
        )}
        {b && (
          <Section title={t('office.tasks.onTheWay')} count={b.counts.in_progress}>
            {list('in_progress', t('office.tasks.noneOnTheWay'))}
          </Section>
        )}
        {b && (
          <Section title={t('office.tasks.sent')} count={b.counts.assigned}>
            {list('assigned', t('office.tasks.noneSent'))}
          </Section>
        )}
        {b && (b.waiting_approval?.length ?? 0) > 0 && (
          <Section title={t('office.tasks.waitingApproval')} count={b.waiting_approval?.length}>
            {b.waiting_approval?.map((w, i) => (
              <View key={w.request_id}>
                {i > 0 && <Divider />}
                <Row
                  time={w.time}
                  title={w.title}
                  line={[w.driver, w.vehicle || w.vehicle_text, w.status].filter(Boolean).join(' · ')}
                  chip={{ text: t('office.chip.waiting'), tone: w.late ? 'red' : 'amber' }}
                  onPress={canApprove ? () => router.push({ pathname: '/office/request/[id]', params: { id: w.request_id } }) : undefined}
                />
              </View>
            ))}
          </Section>
        )}
        {b && (
          <Section title={t('office.tasks.done')} count={b.counts.completed}>
            {list('completed', t('office.tasks.noneDone'))}
          </Section>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  history: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.darkSurface },
});
