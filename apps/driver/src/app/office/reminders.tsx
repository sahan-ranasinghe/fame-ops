// Office mode (Stage 1, O3 row 5): Reminders, the list Home's Reminders chip counts (fleet_overview: no tool of its own,
// as the website's /reminders). First the documents and services due (and rentals ending, garage bookings, km
// allowances, driver licences): what, the plate and the date, each row to the vehicle's page; then everything else the
// chip counts, each row to its issue. The server's order: overdue first, then the soonest due. With issues or
// assign_tasks (office/overviewLogic.ts chipTarget).
//
// Round 4–7 (item 8, §33.7; Fleetio): only service and documents, ONE card per vehicle in the server's order: the plate
// and the model, the service's bar (list_vehicles), and that vehicle's reminders, each row to the vehicle; the licences
// keep their rows (each to its issue); everything else the overview lists (the km allowance, missed tasks, odometer
// checks…) is counted in one line that opens Issues. Without the issues permission the vehicles list says what is due.

import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Check } from '@/components/icons';
import { CareCard } from '@/components/office/VehicleCare';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Plate, Txt } from '@/components/ui';
import { colomboDate } from '@/lib/time';
import { dueWords } from '@/office/issuesLogic';
import { has } from '@/office/nav';
import { isReminderKind, levelTone, type ReminderRow, reminderGroups, remindersByVehicle } from '@/office/overviewLogic';
import { useOffice, useTool } from '@/office/state';
import type { Overview, VehiclesList } from '@/office/types';
import { careCards, careOf, isDue } from '@/office/vehicleCareLogic';
import { BackHeader, Divider, ListFailed, Pill, Row, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** The kind of the overview's item a reminder row came from (the row's key is its issue id, else its place). */
function kindOf(items: Overview['needs_attention'] | undefined, key: string): string | undefined {
  const list = items ?? [];
  return (list.find((a) => a.issue_id === key) ?? list[Number(key)])?.kind;
}

export default function RemindersScreen() {
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<Overview>('fleet_overview', {}, { every: 60_000 });
  const groups = q.data ? reminderGroups(q.data.needs_attention) : null;
  // Round 4–7 (item 8): the vehicles' service (the bar) and, without the issues permission, what is due.
  const vehicles = useTool<VehiclesList>('list_vehicles', { filter: 'all' }, { enabled: me.tools.includes('list_vehicles') });
  const issues = has(me.permissions, 'issues');
  const today = colomboDate();
  const cards = careCards(vehicles.data?.vehicles ?? [], today);
  const careByPlate = new Map(cards.map((c) => [c.reg_no, c]));
  const mine = groups ? remindersByVehicle(groups.due.filter((r) => isReminderKind(kindOf(q.data?.needs_attention, r.key)))) : null;
  if (mine && !issues) for (const c of cards) if (isDue(c, q.data?.reminders.window_days) && !mine.byPlate.has(c.reg_no)) { mine.byPlate.set(c.reg_no, []); mine.plates.push(c.reg_no); }
  const others = q.data ? q.data.needs_attention.filter((a) => !isReminderKind(a.kind)).length : 0;

  /** A reminder's row (inside its vehicle's card the plate is the card's, never repeated). */
  const row = (r: ReminderRow, i: number, inCard = false) => (
    <View key={r.key}>
      {i > 0 && <Divider />}
      <Row
        left={r.plate && !inCard ? <Plate regNo={r.plate} /> : undefined}
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
        {groups && mine && (
          <>
            {mine.plates.length > 0 && <Section title={t('office.reminders.vehicles')} count={mine.plates.length}>{null}</Section>}
            {mine.plates.map((plate) => {
              const known = careByPlate.get(plate);
              const care = known ?? careOf({ reg_no: plate }, today);
              const rows = mine.byPlate.get(plate) ?? [];
              const due = !!known && (known.service.state === 'overdue' || known.service.state === 'due_soon');
              return (
                <CareCard key={plate} c={care} docs={rows.length === 0} service={due} onPress={() => router.push({ pathname: '/office/vehicles/[reg]', params: { reg: plate } })}>
                  {rows.map((r, i) => row(r, i, true))}
                </CareCard>
              );
            })}
            {mine.loose.length > 0 && (
              <Section title={t('office.reminders.due')} count={mine.loose.length}>
                {mine.loose.map((r, i) => row(r, i))}
              </Section>
            )}
            {mine.plates.length === 0 && mine.loose.length === 0 && (
              <Section title={t('office.reminders.due')} count={0}><ListEmpty icon={Check} text={t('office.reminders.noneDue')} /></Section>
            )}
            {others > 0 && (
              <Row
                title={others === 1 ? t('office.care.issuesLineOne') : t('office.care.issuesLine', { n: others })}
                line={t('office.care.issuesLineSub')}
                right={<Txt variant="strong" size={15} color={colors.blue}>{t('office.care.openIssues')}</Txt>}
                onPress={has(me.permissions, 'issues', 'assign_tasks') ? () => router.push('/office/issues') : undefined}
                testID="reminders-issues"
              />
            )}
            <Txt variant="small" color={colors.muted}>{t('office.reminders.note')}</Txt>
          </>
        )}
      </Screen>
    </View>
  );
}
