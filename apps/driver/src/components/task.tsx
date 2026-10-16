// Pieces for showing a task: the stops timeline and the small text lines.

import { StyleSheet, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { stopLabel, stopTimeAt } from '@/components/taskLines';
import { Txt } from '@/components/ui';
import { colomboParts, colomboTime } from '@/lib/time';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** On the Today card: the first two stops, then "+N more". */
const COMPACT_STOPS = 2;

/**
 * Pickup (hollow dot) down to drop-off (filled dot), as on the Today card.
 * compact: the first two stops and "+N more"; a stop with a deadline shows it.
 * Each stop is named by its place in the order ("Stop 2 · Drop", Phase 7 §11) and, when the plan has the times,
 * reads "09:00–10:30 at Kurunegala site" (§17); the start reads "Start · passengers get in here".
 */
export function StopTimeline({ stops, compact = false }: { stops: TaskStop[]; compact?: boolean }) {
  const { t } = useApp();
  const order = { task_stops: stops };
  const shown = compact ? stops.slice(0, COMPACT_STOPS) : stops;
  const more = stops.length - shown.length;
  return (
    <View>
      {shown.map((stop, index) => {
        const last = index === shown.length - 1 && more === 0;
        return (
          <View key={stop.id} style={styles.stop}>
            <View style={styles.rail}>
              <View style={[styles.dot, last && { backgroundColor: colors.ink }]} />
              {!last && <View style={styles.line} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
              <Txt variant="muted" size={15}>{stopLabel(t, order, stop)}{stop.arrive_by ? ` · ${t('task.arriveBy', { time: colomboTime(stop.arrive_by) })}` : ''}</Txt>
              <Txt variant="strong" size={18}>{stopTimeAt(t, stop) ?? stop.place_name}</Txt>
              <GoogleCredit show={!!stop.google_place_id} />
              {stop.is_start && <Txt variant="small">{t('stop.start')}</Txt>}
            </View>
          </View>
        );
      })}
      {more > 0 && (
        <View style={styles.stop}>
          <View style={styles.rail}><View style={[styles.dot, { backgroundColor: colors.ink }]} /></View>
          <Txt variant="muted" size={15}>{t('today.moreStops', { n: more })}</Txt>
        </View>
      )}
    </View>
  );
}

/** "Wed 7 Oct" in the chosen language (digits stay Latin). */
export function useDateLabel(): (at: Date | string) => string {
  const { tList } = useApp();
  const days = tList('days');
  const months = tList('months');
  return (at) => {
    const { weekday, day, month } = colomboParts(at);
    return `${days[weekday] ?? ''} ${day} ${months[month] ?? ''}`.trim();
  };
}

/** "5 passengers · Contact: Ashan W. 0771234567", or null when there is nothing to say. */
export function usePeopleLine(): (task: TaskWithStops) => string | null {
  const { t } = useApp();
  return (task) => {
    const parts: string[] = [];
    if (task.passengers != null && task.passengers > 0) {
      parts.push(task.passengers === 1 ? t('common.onePassenger') : t('common.passengers', { n: task.passengers }));
    }
    if (task.contact_name) parts.push(`${t('today.contact', { name: task.contact_name })} ${task.contact_phone ?? ''}`.trim());
    return parts.length > 0 ? parts.join(' · ') : null;
  };
}

/** The stop the driver is heading to (or at): the first one not done or skipped, else the last. */
export function nextStop(task: TaskWithStops): TaskStop | null {
  return (
    task.task_stops.find((stop) => stop.status === 'pending' || stop.status === 'arrived') ??
    task.task_stops[task.task_stops.length - 1] ??
    null
  );
}

/** The time to show on a task card: when to leave (the plan) rather than the office's start time. */
export function leaveTime(task: Pick<TaskWithStops, 'leave_by' | 'start_at'>): string {
  return task.leave_by ?? task.start_at;
}

const styles = StyleSheet.create({
  stop: { flexDirection: 'row', gap: 14 },
  rail: { width: 16, alignItems: 'center', paddingTop: 5 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.card },
  line: { flex: 1, width: 3, backgroundColor: '#cfcac0', marginVertical: 3, borderRadius: 2 },
});
