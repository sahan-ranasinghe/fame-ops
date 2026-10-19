// Office mode (Phase 8, O1): the Tasks tab, a day's board (task_board) with a date switch: needs a driver first, then on
// the way, sent, waiting for approval, done. A row opens Task detail (design 14); "Give a driver" opens Needs a driver
// (design 11). Not designed as a list (docs/phase8-plan.md section 11): the same rows as Home's "Today's tasks".

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ChevronLeft, ChevronRight } from '@/components/icons';
import { Button, Mono, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import { addDays, colomboDate } from '@/lib/time';
import { boardLine, boardPill } from '@/office/homeLogic';
import { has } from '@/office/nav';
import { useOffice, useTool } from '@/office/state';
import type { Board, BoardCard } from '@/office/types';
import { DarkHeader, Divider, Empty, ErrorNotice, Loading, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function TasksTab() {
  const { t, tList } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const today = colomboDate();
  const [date, setDate] = useState(today);
  const q = useTool<Board>('task_board', { date, limit: 50 }, { every: 60_000 });
  const b = q.data;
  const names = { days: tList('days'), months: tList('months') };
  const canApprove = has(me.permissions, 'approve');

  const rowOf = (c: BoardCard) => {
    const pill = boardPill(c);
    return (
      <Row
        key={c.id}
        left={<Mono size={16} bold style={{ width: 52 }}>{c.time}</Mono>}
        title={c.title}
        line={boardLine(c)}
        line2={c.late_report?.text}
        right={<Pill text={pill.key === 'late' ? t('office.status.late', { min: pill.min ?? 0 }) : t(`office.status.${pill.key}`)} tone={pill.tone} />}
        onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: c.id } })}
      />
    );
  };
  const list = (cards: BoardCard[], empty: string) => (
    cards.length === 0 ? <Empty text={empty} /> : cards.map((c, i) => <View key={c.id}>{i > 0 && <Divider />}{rowOf(c)}</View>)
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={t('office.tasks.above')} title={t('office.tabs.tasks')}>
        {/* The date switch: a day back, the day, a day on; the day's name resets to today. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('office.tasks.prevDay')} onPress={() => setDate(addDays(date, -1))} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronLeft size={26} color="#ffffff" />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setDate(today)} style={{ flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
            <Txt variant="strong" color="#ffffff" size={18}>{date === today ? `${t('office.common.today')} · ${shortDate(names, Date.now())}` : date === addDays(today, 1) ? `${t('office.common.tomorrow')} · ${shortDate(names, `${date}T06:00:00Z`)}` : shortDate(names, `${date}T06:00:00Z`)}</Txt>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('office.tasks.nextDay')} onPress={() => setDate(addDays(date, 1))} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <ChevronRight size={26} color="#ffffff" />
          </Pressable>
        </View>
      </DarkHeader>
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {me.tools.includes('create_task') && <Button label={t('office.trip.assignTask')} onPress={() => router.push({ pathname: '/office/trip/where', params: { mode: 'task' } })} style={{ minHeight: 56 }} />}
        {q.loading && <Loading text={t('office.common.loading')} />}
        {q.error && !b && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
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
            {list(b.in_progress, t('office.tasks.noneOnTheWay'))}
          </Section>
        )}
        {b && (
          <Section title={t('office.tasks.sent')} count={b.counts.assigned}>
            {list(b.assigned, t('office.tasks.noneSent'))}
          </Section>
        )}
        {b && (b.waiting_approval?.length ?? 0) > 0 && (
          <Section title={t('office.tasks.waitingApproval')} count={b.waiting_approval?.length}>
            {b.waiting_approval?.map((w, i) => (
              <View key={w.request_id}>
                {i > 0 && <Divider />}
                <Row
                  left={<Mono size={16} bold style={{ width: 52 }}>{w.time}</Mono>}
                  title={w.title}
                  line={[w.driver, w.vehicle || w.vehicle_text, w.status].filter(Boolean).join(' · ')}
                  right={<Pill text={t('office.status.waiting')} tone={w.late ? 'red' : 'amber'} />}
                  onPress={canApprove ? () => router.push({ pathname: '/office/request/[id]', params: { id: w.request_id } }) : undefined}
                />
              </View>
            ))}
          </Section>
        )}
        {b && (
          <Section title={t('office.tasks.done')} count={b.counts.completed}>
            {list(b.completed, t('office.tasks.noneDone'))}
          </Section>
        )}
      </Screen>
    </View>
  );
}
