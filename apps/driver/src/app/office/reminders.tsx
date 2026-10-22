// Office mode (Stage 1, O3 row 5): Reminders, the list Home's Reminders chip counts (fleet_overview: no tool of its own,
// as the website's /reminders). First the documents and services due (and rentals ending, garage bookings, km
// allowances, driver licences): what, the plate and the date, each row to the vehicle's page; then everything else the
// chip counts, each row to its issue. The server's order: overdue first, then the soonest due. With issues or
// assign_tasks (office/overviewLogic.ts chipTarget).

import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Plate, Txt } from '@/components/ui';
import { dueWords } from '@/office/issuesLogic';
import { levelTone, type ReminderRow, reminderGroups } from '@/office/overviewLogic';
import { useOffice, useTool } from '@/office/state';
import type { Overview } from '@/office/types';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function RemindersScreen() {
  const { t } = useApp();
  const { signOut } = useOffice();
  const router = useRouter();
  const q = useTool<Overview>('fleet_overview', {}, { every: 60_000 });
  const groups = q.data ? reminderGroups(q.data.needs_attention) : null;

  const row = (r: ReminderRow, i: number) => (
    <View key={r.key}>
      {i > 0 && <Divider />}
      <Row
        left={r.plate ? <Plate regNo={r.plate} /> : undefined}
        title={r.what}
        line={r.subject}
        right={r.due ? <Pill text={dueWords(t, r.due)} tone={levelTone(r.level)} /> : undefined}
        onPress={r.to ? () => router.push(r.to as never) : undefined}
        testID="reminder-row"
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.reminders.title')} subtitle={q.data?.reminders.window_days ? t('office.reminders.window', { n: q.data.reminders.window_days }) : undefined} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()}>
        {!q.data && !q.error && <SkeletonRows rows={4} lines={2} />}
        {q.error && <ListFailed stale={!!q.data} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {groups && (
          <>
            <Section title={t('office.reminders.due')} count={groups.due.length}>
              {groups.due.length === 0 && <ListEmpty text={t('office.reminders.noneDue')} />}
              {groups.due.map(row)}
            </Section>
            {groups.other.length > 0 && (
              <Section title={t('office.reminders.other')} count={groups.other.length}>
                {groups.other.map(row)}
              </Section>
            )}
            <Txt variant="small" color={colors.muted}>{t('office.reminders.note')}</Txt>
          </>
        )}
      </Screen>
    </View>
  );
}
