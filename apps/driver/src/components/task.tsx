// Pieces for showing a task: the stops timeline and the small text lines.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { ChevronDown } from '@/components/icons';
import { stopLabel, stopTimeAt } from '@/components/taskLines';
import { Txt } from '@/components/ui';
import { phoneDisplay } from '@/lib/contacts';
import { durationText, relativeTime } from '@/lib/durations';
import { cardStops, type StopChange } from '@/lib/taskPreview';
import { colomboParts, colomboTime } from '@/lib/time';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/**
 * Pickup (hollow dot) down to drop-off (filled dot), as on the Today card.
 * compact (the Today card, Hotfix 2 I): every stop in order, up to four; above four the first four and "Show all N
 * stops", which opens the rest in place. A stop with a deadline shows it.
 * Each stop is named by its place in the order ("Stop 2 · Drop", Phase 7 §11) and, when the plan has the times,
 * reads "09:00–10:30 at Kurunegala site" (§17); the start reads "Start · passengers get in here".
 * detailed (the preview): the place, then "arrive 09:00 · leave 10:30 · by 10:00".
 * changes (the preview of a changed task): the stops that are new, moved or changed are marked; removed ones are listed
 * after, struck through.
 */
export function StopTimeline({ stops, compact = false, detailed = false, changes, removed = [] }: {
  stops: TaskStop[];
  compact?: boolean;
  detailed?: boolean;
  changes?: Record<string, StopChange>;
  removed?: { place: string; type: string }[];
}) {
  const { t } = useApp();
  const [expanded, setExpanded] = useState(false);
  const order = { task_stops: stops };
  const { shown, hidden } = compact ? cardStops(stops, expanded) : { shown: stops, hidden: 0 };
  const typeKey: Record<string, string> = { pickup: 'stop.pickup', drop: 'stop.drop', visit: 'stop.visit' };
  return (
    <View>
      {shown.map((stop, index) => {
        const last = index === shown.length - 1 && hidden === 0 && removed.length === 0;
        const changed = changes?.[stop.id];
        const label = `${stopLabel(t, order, stop)}${!detailed && stop.arrive_by ? ` · ${t('task.arriveBy', { time: colomboTime(stop.arrive_by) })}` : ''}`;
        const times = detailed
          ? [
            stop.planned_arrive_at && stop.planned_depart_at
              ? t('preview.arriveLeave', { arrive: colomboTime(stop.planned_arrive_at), leave: colomboTime(stop.planned_depart_at) })
              : null,
            stop.arrive_by ? t('preview.arriveBy', { time: colomboTime(stop.arrive_by) }) : null,
          ].filter(Boolean).join(' · ')
          : '';
        return (
          <View key={stop.id} style={styles.stop}>
            <View style={styles.rail}>
              <View style={[styles.dot, last && { backgroundColor: colors.ink }]} />
              {!last && <View style={styles.line} />}
            </View>
            <View style={[{ flex: 1, paddingBottom: last ? 0 : 14 }]}>
              <View style={changed ? styles.changed : undefined}>
                <Txt variant="muted" size={15}>{label}</Txt>
                <Txt variant="strong" size={18}>{detailed ? stop.place_name : stopTimeAt(t, stop) ?? stop.place_name}</Txt>
                <GoogleCredit show={!!stop.google_place_id} />
                {detailed && times !== '' && <Txt variant="muted" size={15}>{times}</Txt>}
                {stop.is_start && <Txt variant="small">{t('stop.start')}</Txt>}
                {detailed && stop.note && <Txt variant="small" color={colors.amberText}>{stop.note}</Txt>}
                {changed && <ChangedTag />}
              </View>
            </View>
          </View>
        );
      })}
      {removed.map((gone, index) => {
        const last = index === removed.length - 1 && hidden === 0;
        return (
          <View key={`removed-${index}`} style={styles.stop}>
            <View style={styles.rail}>
              <View style={[styles.dot, { borderColor: colors.muted }]} />
              {!last && <View style={styles.line} />}
            </View>
            <View style={[{ flex: 1, paddingBottom: last ? 0 : 14 }]}>
              <View style={styles.changed}>
                {gone.type !== '' && <Txt variant="muted" size={15} style={styles.struck}>{t(typeKey[gone.type] ?? 'stop.visit')}</Txt>}
                <Txt variant="strong" size={18} color={colors.muted} style={styles.struck}>{gone.place}</Txt>
                <ChangedTag />
              </View>
            </View>
          </View>
        );
      })}
      {hidden > 0 && (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.showAll}>
          <View style={styles.rail}><View style={[styles.dot, { backgroundColor: colors.ink }]} /></View>
          <Txt variant="strong" size={16} style={{ flex: 1 }}>{t('preview.showAll', { n: stops.length })}</Txt>
          <ChevronDown size={22} color={colors.ink} />
        </Pressable>
      )}
    </View>
  );
}

/** "Changed", in amber: what the office changed since the driver last saw the task. */
export function ChangedTag() {
  const { t } = useApp();
  return (
    <View style={styles.tag}>
      <Txt variant="strong" size={13} color={colors.amberText}>{t('preview.changed')}</Txt>
    </View>
  );
}

/** The time now, again every `everyMs` (a "leave in 45 min" stays right while the screen is open). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** The one duration formatter (lib/durations.ts) in the chosen language: "in 45 min", "tomorrow 09:00", "3 h 20 min". */
export function useDurations(): { relative: (at: Date | string | number, now?: number) => string; duration: (minutes: number) => string } {
  const { t, tList } = useApp();
  const names = { days: tList('days'), months: tList('months') };
  return {
    relative: (at, now = Date.now()) => relativeTime(t, names, at, now),
    duration: (minutes) => durationText(t, minutes),
  };
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

/** "5 passengers · Contact: Ashan W. 077 123 4567", or null when there is nothing to say. */
export function usePeopleLine(): (task: TaskWithStops) => string | null {
  const { t } = useApp();
  return (task) => {
    const parts: string[] = [];
    if (task.passengers != null && task.passengers > 0) {
      parts.push(task.passengers === 1 ? t('common.onePassenger') : t('common.passengers', { n: task.passengers }));
    }
    if (task.contact_name) parts.push(`${t('today.contact', { name: task.contact_name })} ${task.contact_phone ? phoneDisplay(task.contact_phone) : ''}`.trim());
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
  changed: { backgroundColor: '#fdf1d6', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginLeft: -4, gap: 2 },
  struck: { textDecorationLine: 'line-through' },
  tag: { alignSelf: 'flex-start', backgroundColor: '#fae3a8', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2 },
  showAll: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 },
  rail: { width: 16, alignItems: 'center', paddingTop: 5 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.card },
  line: { flex: 1, width: 3, backgroundColor: '#cfcac0', marginVertical: 3, borderRadius: 2 },
});
