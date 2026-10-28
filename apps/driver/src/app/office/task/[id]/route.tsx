// Office mode (Stage 1, O3 item 1): a task's driven route, opened from a task that has started (in progress or completed)
// with "Show the driven route" (driver_route with task_id: the task's own window, from Start task to Save & finish). The
// map on both engines with the line by speed band, the stops over 10 minutes, the estimated roads over gaps, one playback
// bar, the numbers (GPS km) and the summary (components/office/DayRoute.tsx); the odometer's km beside the GPS km. A
// task still under way is read again every minute. With driver_route (assign_tasks or vehicles). Round 48 (item 2): the
// driver's line fixed above the map, the map fixed, the playback bar under it, the summary and the task's km scrolling below.
// Round 48 item 5: the line snapped to roads where the map may draw it (office/snapLogic.ts), the chip over the map; the last
// answer stays drawn while the next loads.

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DayRoute } from '@/components/office/DayRoute';
import { useSnap } from '@/components/office/SnapChip';
import { Txt } from '@/components/ui';
import { taskRouteArgs } from '@/office/historyLogic';
import { withSnap } from '@/office/snapLogic';
import { useOffice, useTool } from '@/office/state';
import type { DriverRoute, TaskDetail } from '@/office/types';
import { BackHeader } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { spanWords } from '@/lib/dateWords';

export default function TaskRouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const { me, signOut } = useOffice();
  const detail = useTool<TaskDetail>('task_detail', { task_id: id });
  const task = detail.data?.task;
  const running = task?.status === 'in_progress';
  const snap = useSnap(me.map?.package);
  const route = useTool<DriverRoute>('driver_route', withSnap(taskRouteArgs(id), snap.on), { every: running ? 60_000 : undefined, enabled: me.tools.includes('driver_route') });
  // The task's last answer stays drawn while the chip's change loads the next one.
  const [held, setHeld] = useState<DriverRoute | null>(null);
  useEffect(() => {
    if (route.data) setHeld(route.data);
  }, [route.data]);
  const routeData = route.data ?? (held && held.task?.id === id ? held : null);

  const refresh = () => void Promise.all([detail.reload(), route.reload()]);
  const who = [task?.driver, spanWords(t, route.data?.task?.started, route.data?.task?.completed)].filter(Boolean).join(' · ') || t('office.history.drivenRoute');

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <BackHeader title={t('office.history.drivenRoute')} subtitle={task?.title ?? route.data?.task?.title} />
      <DayRoute
        data={routeData}
        error={route.error}
        onRetry={refresh}
        onSignIn={() => void signOut()}
        mapPackage={me.map?.package}
        emptyText={t('office.history.noTaskPoints')}
        refreshing={route.refreshing}
        onRefresh={refresh}
        above={<Txt variant="strong" size={15} numberOfLines={1} testID="task-route-who">{who}</Txt>}
        snap={snap}
      >
        {task?.km != null ? <Txt variant="muted" size={15} style={{ paddingVertical: 6 }}>{t('office.task.taskKm', { km: task.km })}</Txt> : null}
      </DayRoute>
    </View>
  );
}
