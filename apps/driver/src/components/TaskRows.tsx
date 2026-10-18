// The rows of tasks under Today's card ("Later today", "Coming up") and on "All today's tasks" (app/today-tasks.tsx,
// Hotfix 3 L6). A row opens the task, pushed on top (back returns to the list it was opened from).
// Only the tasks on screen count as seen: "Seen by driver" and the first copy kept for "Changed" (Hotfix 2, I) are
// recorded for the rows shown, not for the ones Today leaves out.

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { ChevronRight } from '@/components/icons';
import { ChangedTag, leaveTime, useDateLabel } from '@/components/task';
import { taskTitle } from '@/components/taskLines';
import { Card, Mono, Txt } from '@/components/ui';
import { hasChanges } from '@/lib/taskPreview';
import { colomboTime } from '@/lib/time';
import { isSelfTrip } from '@/lib/trips';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** A heading and its rows; nothing when there are none. */
export function TaskList({ title, tasks, showDate = false }: { title: string; tasks: readonly TaskWithStops[]; showDate?: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="heading" style={{ marginLeft: 6 }}>{title}</Txt>
      <TaskRows tasks={tasks} showDate={showDate} />
    </View>
  );
}

export function TaskRows({ tasks, showDate = false }: { tasks: readonly TaskWithStops[]; showDate?: boolean }) {
  const { t, changesFor } = useApp();
  const router = useRouter();
  const dateLabel = useDateLabel();
  return (
    <Card style={{ padding: 0 }}>
      {tasks.map((task, index) => (
        <Pressable
          key={task.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
          style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
        >
          <View style={{ width: 62 }}>
            <Mono size={18} bold>{colomboTime(leaveTime(task))}</Mono>
            {showDate && <Txt variant="small">{dateLabel(task.start_at)}</Txt>}
          </View>
          <View style={{ flex: 1 }}>
            {task.status === 'in_progress' && <Txt variant="label" color={colors.blue}>{t('today.inProgress')}</Txt>}
            <Txt variant="strong" size={18}>{taskTitle(t, task)}</Txt>
            {/* A trip of the driver's own goes to its stop: there is no "from". */}
            {isSelfTrip(task)
              ? task.task_stops.length > 0 && <Txt variant="muted">{task.task_stops[task.task_stops.length - 1].place_name}</Txt>
              : task.task_stops[0] && <Txt variant="muted">{t('today.from', { place: task.task_stops[0].place_name })}</Txt>}
            <GoogleCredit show={task.task_stops.some((s) => !!s.google_place_id)} />
            {task.status === 'assigned' && (
              <Txt variant="small" color={task.accepted_at ? colors.blue : colors.amberText}>{t(task.accepted_at ? 'today.accepted' : 'today.notAccepted')}</Txt>
            )}
            {task.status === 'assigned' && hasChanges(changesFor(task)) && <ChangedTag />}
          </View>
          <ChevronRight size={22} color={colors.ink} />
        </Pressable>
      ))}
    </Card>
  );
}

/**
 * The tasks on screen still to start: each is marked seen once ("Seen by driver"), and its first copy is kept so a later
 * change by the office shows as "Changed" (Hotfix 2, I).
 */
export function useMarkShown(onScreen: readonly TaskWithStops[]): void {
  const { markSeen, rememberShown } = useApp();
  const assigned = onScreen.filter((task) => task.status === 'assigned');
  const unseen = assigned.filter((task) => !task.seen_at).map((task) => task.id).join(',');
  const shownKey = assigned.map((task) => task.id).join(',');
  const latest = useRef(assigned);
  latest.current = assigned;
  useFocusEffect(
    useCallback(() => {
      if (unseen !== '') markSeen(unseen.split(','));
    }, [unseen, markSeen]),
  );
  useFocusEffect(
    useCallback(() => {
      rememberShown(latest.current);
      // Only when the tasks on screen change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shownKey, rememberShown]),
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 72 },
});
