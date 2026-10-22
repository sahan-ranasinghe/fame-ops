// The rows of tasks under Today's card ("Later today", "Coming up") and on "All today's tasks" (app/today-tasks.tsx,
// Hotfix 3 L6). A row opens the task, pushed on top (back returns to the list it was opened from).
// Only the tasks on screen count as seen: "Seen by driver" and the first copy kept for "Changed" (Hotfix 2, I) are
// recorded for the rows shown, not for the ones Today leaves out.
// Round 4–7, item 12 (mockup 5's "Later today"): the list row of the mockups: the leave time in mono, ONE title line, ONE
// grey line ("2 people · 58 km"; without either, where it starts or, a trip of the driver's own, where it goes) with the
// row's chip (In progress, Accepted, Not accepted yet), "Changed" under it, a chevron. The date stays under the time on
// "Coming up"; the Google credit stays.

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { ChevronRight } from '@/components/icons';
import { ChangedTag, leaveTime, useDateLabel } from '@/components/task';
import { taskTitle } from '@/components/taskLines';
import { ToneChip } from '@/components/ToneChip';
import { Mono, Txt } from '@/components/ui';
import { hasChanges } from '@/lib/taskPreview';
import { colomboTime } from '@/lib/time';
import { rowChip, rowMeta } from '@/lib/todayCard';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

/** A heading and its rows; nothing when there are none. */
export function TaskList({ title, tasks, showDate = false }: { title: string; tasks: readonly TaskWithStops[]; showDate?: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="strong" size={16} style={{ marginLeft: 4 }}>{title}</Txt>
      <TaskRows tasks={tasks} showDate={showDate} />
    </View>
  );
}

export function TaskRows({ tasks, showDate = false }: { tasks: readonly TaskWithStops[]; showDate?: boolean }) {
  const { t, changesFor } = useApp();
  const router = useRouter();
  const dateLabel = useDateLabel();
  return (
    <View style={styles.list}>
      {tasks.map((task, index) => {
        const chip = rowChip(t, task);
        const meta = rowMeta(t, task);
        return (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
            style={(state) => [styles.row, index > 0 && styles.divided, hoverStyle(state), state.pressed && { opacity: 0.8 }]}
            testID={`task-row-${task.id}`}
          >
            <View style={styles.time}>
              <Mono size={15} bold>{colomboTime(leaveTime(task))}</Mono>
              {showDate && <Txt variant="small" size={11} numberOfLines={1}>{dateLabel(task.start_at)}</Txt>}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt variant="strong" size={15} numberOfLines={1}>{taskTitle(t, task)}</Txt>
              {(meta !== '' || chip) && (
                <View style={styles.metaRow}>
                  {meta !== '' && <Txt variant="small" size={13} numberOfLines={1} style={{ flexShrink: 1 }}>{meta}</Txt>}
                  {chip && <ToneChip text={chip.text} tone={chip.tone} />}
                </View>
              )}
              <GoogleCredit show={task.task_stops.some((s) => !!s.google_place_id)} />
              {task.status === 'assigned' && hasChanges(changesFor(task)) && <ChangedTag />}
            </View>
            <ChevronRight size={18} color={colors.muted} strokeWidth={2} />
          </Pressable>
        );
      })}
    </View>
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
  list: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardLine, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  time: { width: 52 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
