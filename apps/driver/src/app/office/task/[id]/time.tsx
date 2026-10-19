// Office mode (Phase 8, O2, item 5): Change time: the day, the leave-by and the end time of a task through update_task
// with the plan version it was shown with (a stale one is refused: the page loads the task again). A running task keeps
// its day and leave-by: only the end time moves. Not designed (docs/phase8-plan.md section 11): the When step's chips and
// time boxes, one Save.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { TimeInput } from '@/components/office/TimeInput';
import { Button, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import { addDays, colomboDate } from '@/lib/time';
import { useOffice, useTool } from '@/office/state';
import { changeTimeInput, timeFieldsOf, timeLocked, type TimeFields } from '@/office/taskExtrasLogic';
import type { FleetError, TaskDetail } from '@/office/types';
import { BackHeader, Empty, ErrorNotice, Loading, Screen, StickyActions } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ChangeTimeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, tList } = useApp();
  const { api, signOut } = useOffice();
  const router = useRouter();
  const q = useTool<TaskDetail>('task_detail', { task_id: id });
  const task = q.data?.task;
  const [f, setF] = useState<TimeFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const today = colomboDate();
  const names = { days: tList('days'), months: tList('months') };
  const [pickDate, setPickDate] = useState(false);

  // The form starts from the task as it is now (once; a reload after a stale version starts it again).
  useEffect(() => {
    if (task) setF(timeFieldsOf(task));
  }, [task?.id, task?.plan_version]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = task ? timeLocked(task) : false;
  const days = [today, addDays(today, 1), addDays(today, 2)];
  const dayLabel = (day: string) => day === today ? t('office.common.today') : day === addDays(today, 1) ? `${t('office.common.tomorrow')} · ${shortDate(names, `${day}T06:00:00Z`)}` : shortDate(names, `${day}T06:00:00Z`);

  async function save() {
    if (!task || !f || busy) return;
    const r = changeTimeInput(task.id, task.plan_version ?? 0, f, task);
    if ('error' in r) {
      setWhy(t(r.error === 'nothing' ? 'office.task.timeNothing' : 'office.task.timeEndBeforeStart'));
      return;
    }
    setWhy(null);
    setProblem(null);
    setBusy(true);
    try {
      await api.call('update_task', r.input);
      Alert.alert(t('office.task.timeSavedTitle'), t('office.task.timeSavedBody'), [{ text: t('office.common.ok'), onPress: () => router.back() }]);
    } catch (e) {
      setProblem(e as FleetError);
      void q.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.task.changeTime')} subtitle={task?.title} />
      <Screen bottom={16}>
        {q.loading && !task && <Loading text={t('office.common.loading')} />}
        {q.error && !task && <ErrorNotice error={q.error} onRetry={() => void q.reload()} onSignIn={() => void signOut()} />}
        {q.data && !task && <Empty text={t('office.task.notFound')} />}
        {task && f && (
          <>
            {locked ? (
              <Txt variant="muted">{t('office.task.timeLocked', { time: task.leave_by ?? task.time ?? task.start })}</Txt>
            ) : (
              <>
                <Txt variant="label" color={colors.muted}>{t('office.task.timeDay').toUpperCase()}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(pickDate ? Array.from({ length: 14 }, (_, i) => addDays(today, i)) : [...days, ...(days.includes(f.date) || !f.date ? [] : [f.date])]).map((day) => (
                    <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: f.date === day }} onPress={() => setF({ ...f, date: day })} style={[styles.chip, f.date === day && styles.chipOn]}>
                      <Txt variant="strong" size={16} color={f.date === day ? '#ffffff' : colors.ink}>{dayLabel(day)}</Txt>
                    </Pressable>
                  ))}
                  {!pickDate && (
                    <Pressable accessibilityRole="button" onPress={() => setPickDate(true)} style={styles.chip}>
                      <Txt variant="strong" size={16}>{t('office.trip.pickDate')}</Txt>
                    </Pressable>
                  )}
                </View>
                <TimeInput label={t('office.task.timeLeave')} value={f.time} onCommit={(v) => setF({ ...f, time: v })} testID="time-leave" />
              </>
            )}
            <TimeInput label={t('office.trip.backBy')} value={f.end} onCommit={(v) => setF({ ...f, end: v })} testID="time-end" />
            <Txt variant="small">{t('office.task.timeNote')}</Txt>
            {why && <Txt variant="strong" color={colors.red}>{why}</Txt>}
            {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
          </>
        )}
      </Screen>
      {task && f && (
        <StickyActions>
          <Button label={t('office.trip.saveChanges')} onPress={() => void save()} busy={busy} style={{ minHeight: 60 }} />
        </StickyActions>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
});
