// The rows of tasks under Today's card ("Later today", "Coming up") and on "All today's tasks" (app/today-tasks.tsx,
// Hotfix 3 L6). A row opens the task, pushed on top (back returns to the list it was opened from).
// Only the tasks on screen count as seen: "Seen by driver" and the first copy kept for "Changed" (Hotfix 2, I) are
// recorded for the rows shown, not for the ones Today leaves out.
// Round 4–7, item 12 (mockup 5's "Later today"): the list row of the mockups: the leave time in mono, ONE title line, ONE
// grey line ("2 people · 58 km"; without either, where it starts or, a trip of the driver's own, where it goes) with the
// row's chip (In progress, Accepted, Not accepted yet), "Changed" under it, a chevron. The date stays under the time on
// "Coming up"; the Google credit stays. Drawn by the app's one list row (components/patterns/ListRow.tsx).

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { ListRow } from '@/components/patterns/ListRow';
import { ChangedTag, leaveTime, useDateLabel } from '@/components/task';
import { taskTitle } from '@/components/taskLines';
import { Mono, Txt } from '@/components/ui';
import { hasChanges } from '@/lib/taskPreview';
import { colomboTime } from '@/lib/time';
import { rowChip, rowChipTone, rowMeta } from '@/lib/todayCard';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

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
        const changed = task.status === 'assigned' && hasChanges(changesFor(task));
        const google = task.task_stops.some((s) => !!s.google_place_id);
        return (
          <View key={task.id} style={index > 0 ? styles.divided : undefined}>
            <ListRow
              inset
              left={(
                <View style={styles.time}>
                  <Mono size={15} bold>{colomboTime(leaveTime(task))}</Mono>
                  {showDate && <Txt variant="small" size={11} numberOfLines={1}>{dateLabel(task.start_at)}</Txt>}
                </View>
              )}
              title={taskTitle(t, task)}
              line={meta !== '' ? meta : undefined}
              lineChip={chip ? { text: chip.text, tone: rowChipTone(chip.tone) } : null}
              below={google || changed ? (
                <>
                  <GoogleCredit show={google} />
                  {changed && <ChangedTag />}
                </>
              ) : undefined}
              onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
              chevron
              testID={`task-row-${task.id}`}
            />
          </View>
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
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  time: { width: 52 },
});
