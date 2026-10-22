// Office mode (Stage 1, O3 item 3c): a task's plan on the map, the site's PlanWithMap on its own screen (one job per
// screen; opened from Task detail's More details → "Show the plan on the map"). task_detail with with_line (each leg's
// road line as the plan stored it: no new routing call) shaped as the map's task (office/taskDetailLogic.ts detailTask) on
// the task map with both engines (components/TaskMap.tsx: Google's line on Google's map only, openrouteservice's on
// either, dashed straight lines otherwise; a Google stop is never drawn on the free map), then the plan as a timeline:
// leave, each leg with its road time and source, each stop with its planned times, the drive back, the totals, the
// warnings. With task_detail (assign_tasks, or the request's people).
// Round 4–7 (one stepper): the timeline is drawn by the route stepper (components/office/PlanStepper.tsx, rows from
// office/stepperRows.ts timelineRows): the leave time as S, each stop by its number with its chip and its times in words,
// each leg in full under the row before it; the words as before.

import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { PlanStepper } from '@/components/office/PlanStepper';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { TaskMap } from '@/components/TaskMap';
import { Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import { useOffice, useTool } from '@/office/state';
import { sentenceText } from '@/office/statusWords';
import { timelineRows } from '@/office/stepperRows';
import { detailTask, planDrawable } from '@/office/taskDetailLogic';
import { legTextT, stopTimesT } from '@/office/trip/words';
import type { TaskDetail } from '@/office/types';
import { BackHeader, ListFailed, Screen, Section } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { dateWords } from '@/lib/dateWords';

export default function TaskPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const q = useTool<TaskDetail>('task_detail', { task_id: id, with_line: true });
  const p = q.data;
  const task = p?.task;
  const items = p?.timeline?.items ?? [];
  const totals = p?.timeline?.totals;
  const plan = p?.plan;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.task.planTitle')} subtitle={task?.title} />
      <Screen refreshing={q.refreshing} onRefresh={() => void q.reload()} style={{ padding: 0, gap: 0 }}>
        {p && planDrawable(p) && <View style={{ height: 320 }} testID="plan-map"><TaskMap report={false} mapPackage={me.map?.package} task={detailTask(p)} me={null} googleNoteFor="any" /></View>}
        <View style={{ padding: 16, gap: 14 }}>
          {!p && !q.error && <SkeletonRows rows={4} lines={2} />}
          {q.error && <ListFailed stale={!!p} error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
          {p && !plan && <ListEmpty text={t('office.task.planNone')} />}
          {p && plan && (
            <Txt variant="muted" size={15} testID="plan-line">
              {t('office.task.planLine', { dur: durationText(t, plan.total_drive_min), n: plan.legs.length, at: plan.computed_at ? dateWords(t, plan.computed_at) : '—' })}
            </Txt>
          )}
          {p && items.length > 0 && (
            <Section title={t('office.task.planTitle')}>
              <View style={{ gap: 10, paddingTop: 4 }}>
                <PlanStepper
                  rows={timelineRows(items, {
                    leaveBy: t('office.request.leaveBy'),
                    stopTimes: (x) => stopTimesT(t, x),
                    arriveBy: (time) => t('office.request.arriveBy', { time }),
                    onTime: t('office.trip.onTime'),
                    late: (min) => t('office.task.minLate', { min }),
                    leg: (x) => [legTextT(t, x, task?.start_place), x.via_expressway ? t('office.trip.viaExpressway') : ''].filter(Boolean).join(' · '),
                  })}
                  framed={false}
                  testID="plan-timeline"
                />
                {totals && <Txt variant="strong" size={15}>{`${t('office.trip.kmN', { km: Math.round(totals.km) })} · ${durationText(t, totals.drive_min)} · ${t('office.trip.endsAtTime', { time: totals.ends })}`}</Txt>}
              </View>
            </Section>
          )}
          {plan?.warnings?.map((w, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{sentenceText(t, w)}</Txt>)}
        </View>
      </Screen>
    </View>
  );
}
