// The date patterns (docs/ui-patterns.md §2, §3): one month calendar (‹ › for the month) used three ways: the date range
// (one button, the presets, tap the start then the end, a day twice for one day), the week strip of a day of history
// (swipe week by week, Today, a calendar icon to jump), and a trip's day (Today / Tomorrow chips, Pick a date).

import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';

import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@/components/icons';
import { Button, Mono, Txt } from '@/components/ui';
import { colomboDate } from '@/lib/time';
import {
  addMonths, dayAllowed, dayState, monthGrid, PRESETS, type PresetKey, presetOf, presetRange, type RangeDraft, rangeWords, tapDay, weekDays,
  plusDays,
} from '@/lib/patterns/calendarLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

import { Sheet } from './Sheet';

type Names = { days: string[]; months: string[] };
const useNames = (): Names => { const { tList } = useApp(); return { days: tList('days'), months: tList('months') }; };
/** The weekday heads: a short form per language (a Sinhala name cut by letters breaks a letter in two). */
const useShortDays = (): string[] => { const { tList } = useApp(); return tList('daysShort'); };
const dayNum = (d: string) => String(Number(d.slice(8, 10)));

/** One month's grid. `range` paints a range; `picked` a single day; `allowed` greys the rest. */
export function MonthCalendar({ month, onMonth, onTap, range, picked, allowed }: {
  month: string;
  onMonth: (month: string) => void;
  onTap: (day: string) => void;
  range?: RangeDraft;
  picked?: string;
  allowed: (day: string) => boolean;
}) {
  const { t } = useApp();
  const names = useNames();
  const today = colomboDate();
  const weeks = useMemo(() => monthGrid(month), [month]);
  const short = useShortDays();
  const heads = [1, 2, 3, 4, 5, 6, 0].map((i) => short[i] ?? '');
  return (
    <View style={{ gap: 6 }} testID="month-calendar">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.prevYear')} onPress={() => onMonth(addMonths(month, -12))} style={styles.nav} testID="calendar-prev-year"><ChevronsLeft size={22} color={colors.ink} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.prevMonth')} onPress={() => onMonth(addMonths(month, -1))} style={styles.nav}><ChevronLeft size={22} color={colors.ink} /></Pressable>
        <Txt variant="strong" size={17} style={{ flex: 1, textAlign: 'center' }}>{`${names.months[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.nextMonth')} onPress={() => onMonth(addMonths(month, 1))} style={styles.nav}><ChevronRight size={22} color={colors.ink} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.nextYear')} onPress={() => onMonth(addMonths(month, 12))} style={styles.nav} testID="calendar-next-year"><ChevronsRight size={22} color={colors.ink} /></Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>{heads.map((h, i) => <Txt key={i} variant="small" style={{ flex: 1, textAlign: 'center' }}>{h}</Txt>)}</View>
      {weeks.map((w, i) => (
        <View key={i} style={{ flexDirection: 'row' }}>
          {w.map((d, j) => {
            if (!d) return <View key={j} style={styles.cell} />;
            const ok = allowed(d);
            const st = range ? dayState(range, d) : picked === d ? 'single' : 'none';
            const filled = st === 'start' || st === 'end' || st === 'single';
            return (
              <Pressable key={j} accessibilityRole="button" accessibilityState={{ selected: filled, disabled: !ok }} accessibilityLabel={d} disabled={!ok} onPress={() => onTap(d)} style={[styles.cell, st === 'inside' && { backgroundColor: colors.blueChip }, (st === 'start') && styles.startBand, (st === 'end') && styles.endBand]}>
                <View style={[styles.dayDot, filled && { backgroundColor: colors.ink }, d === today && !filled && { borderWidth: 1.5, borderColor: colors.blue }]}>
                  <Mono size={15} bold={filled} color={filled ? '#ffffff' : ok ? colors.ink : '#b9bcc0'}>{dayNum(d)}</Mono>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The date range
// ---------------------------------------------------------------------------

export function DateRangeButton({ value, onChange, presets = PRESETS, max, maxDays, testID = 'date-range' }: {
  value: { from: string; to: string };
  onChange: (r: { from: string; to: string }) => void;
  presets?: readonly PresetKey[];
  /** The last day that may be picked (history: today). */
  max?: string;
  /** A page's limit in days (the server's). */
  maxDays?: number;
  testID?: string;
}) {
  const { t } = useApp();
  const names = useNames();
  const today = colomboDate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RangeDraft>(value);
  const [month, setMonth] = useState(value.to);
  const preset = presetOf(value, today, presets);
  const label = [preset ? t(`patterns.preset_${preset}`) : '', rangeWords(value, names)].filter(Boolean).join(' · ');
  const allowed = (d: string) => dayAllowed(d, { max, maxDays, pending: draft.from && !draft.to ? draft.from : null });
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => { setDraft(value); setMonth(value.to); setOpen(true); }} style={styles.rangeBtn} testID={testID}>
        <CalendarIcon size={20} color={colors.ink} />
        <Txt variant="strong" size={15} style={{ flex: 1 }} numberOfLines={1}>{label}</Txt>
      </Pressable>
      <Sheet visible={open} title={t('patterns.dates')} onClose={() => setOpen(false)} testID="date-range-sheet" actions={(
        <>
          <Button kind="outline" label={t('patterns.cancel')} onPress={() => setOpen(false)} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t('patterns.apply')} disabled={!draft.from || !draft.to} onPress={() => { if (draft.from && draft.to) { onChange({ from: draft.from, to: draft.to }); setOpen(false); } }} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {presets.map((k) => {
            const r = presetRange(k, today);
            const on = draft.from === r.from && draft.to === r.to;
            return (
              <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { onChange(r); setOpen(false); }} style={[styles.chip, on && styles.chipOn]}>
                <Txt variant="strong" size={14} color={on ? '#ffffff' : colors.ink}>{t(`patterns.preset_${k}`)}</Txt>
              </Pressable>
            );
          })}
        </View>
        <Txt variant="small">{draft.from && !draft.to ? t('patterns.tapEnd') : t('patterns.tapStart')}</Txt>
        <MonthCalendar month={month} onMonth={setMonth} onTap={(d) => setDraft((r) => tapDay(r, d))} range={draft} allowed={allowed} />
        {maxDays ? <Txt variant="small">{t('patterns.maxDays', { n: maxDays })}</Txt> : null}
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// A day of history: the week strip
// ---------------------------------------------------------------------------

export function DayStrip({ value, onChange, max, min, testID = 'day-strip' }: {
  value: string;
  onChange: (day: string) => void;
  /** History: today (no future days). */
  max?: string;
  min?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const names = useNames();
  const today = colomboDate();
  const short = useShortDays();
  const [week, setWeek] = useState(value);
  // A day set from outside (a link, a reset) brings its week (the website's DayStrip does the same).
  useEffect(() => {
    setWeek((w) => (weekDays(w).includes(value) ? w : value));
  }, [value]);
  const [jump, setJump] = useState(false);
  const [month, setMonth] = useState(value);
  const days = weekDays(week);
  const allowed = (d: string) => dayAllowed(d, { max, min });
  // Never a week where every day is greyed (history: no week after today; a trip: none before today).
  const canNext = (w: string) => !max || weekDays(plusDays(w, 7))[0] <= max;
  const canPrev = (w: string) => !min || weekDays(plusDays(w, -7))[6] >= min;
  const bounds = useRef({ canNext, canPrev });
  bounds.current = { canNext, canPrev };
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dy) < 20,
    onPanResponderRelease: (_, g) => {
      if (g.dx < -40) setWeek((w) => (bounds.current.canNext(w) ? plusDays(w, 7) : w));
      else if (g.dx > 40) setWeek((w) => (bounds.current.canPrev(w) ? plusDays(w, -7) : w));
    },
  })).current;
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt variant="strong" size={16} style={{ flex: 1 }}>{rangeWords({ from: value, to: value }, names)}</Txt>
        {value !== today && (
          <Pressable accessibilityRole="button" onPress={() => { onChange(today); setWeek(today); }} style={styles.todayBtn}>
            <Txt variant="strong" size={14}>{t('patterns.today')}</Txt>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.pickDate')} onPress={() => { setMonth(value); setJump(true); }} style={styles.iconBtn}><CalendarIcon size={20} color={colors.ink} /></Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }} {...swipe.panHandlers}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.prevWeek')} accessibilityState={{ disabled: !canPrev(week) }} disabled={!canPrev(week)} onPress={() => setWeek(plusDays(week, -7))} style={styles.weekNav}><ChevronLeft size={20} color={canPrev(week) ? colors.muted : '#d6d4ce'} /></Pressable>
        {days.map((d) => {
          const on = d === value;
          const ok = allowed(d);
          return (
            <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !ok }} disabled={!ok} onPress={() => onChange(d)} style={[styles.stripDay, on && { backgroundColor: colors.ink }]}>
              <Txt variant="small" color={on ? '#ffffff' : ok ? colors.muted : '#b9bcc0'}>{short[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? ''}</Txt>
              <Mono size={16} bold color={on ? '#ffffff' : ok ? colors.ink : '#b9bcc0'}>{dayNum(d)}</Mono>
              {d === today && <View style={[styles.todayMark, on && { backgroundColor: colors.amber }]} />}
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.nextWeek')} accessibilityState={{ disabled: !canNext(week) }} disabled={!canNext(week)} onPress={() => setWeek(plusDays(week, 7))} style={styles.weekNav}><ChevronRight size={20} color={canNext(week) ? colors.muted : '#d6d4ce'} /></Pressable>
      </View>
      <Sheet visible={jump} title={t('patterns.pickDate')} onClose={() => setJump(false)}>
        <MonthCalendar month={month} onMonth={setMonth} onTap={(d) => { onChange(d); setWeek(d); setJump(false); }} picked={value} allowed={allowed} />
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// A trip's day: Today, Tomorrow, Pick a date
// ---------------------------------------------------------------------------

export function TripDayPicker({ value, onChange, max, testID = 'trip-day' }: { value: string; onChange: (day: string) => void; /** The last day offered (a driver's days off: 60 ahead). */ max?: string; testID?: string }) {
  const { t } = useApp();
  const names = useNames();
  const today = colomboDate();
  const tomorrow = plusDays(today, 1);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value || today);
  const other = value && value !== today && value !== tomorrow ? value : '';
  const chip = (on: boolean, label: string, onPress: () => void, key: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, on && styles.chipOn]} testID={`${testID}-${key}`}>
      <Txt variant="strong" size={16} color={on ? '#ffffff' : colors.ink}>{label}</Txt>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID={testID}>
      {chip(value === today, t('patterns.today'), () => onChange(today), 'today')}
      {chip(value === tomorrow, `${t('patterns.tomorrow')} · ${rangeWords({ from: tomorrow, to: tomorrow }, names)}`, () => onChange(tomorrow), 'tomorrow')}
      {other ? chip(true, rangeWords({ from: other, to: other }, names), () => { setMonth(other); setOpen(true); }, 'other') : null}
      <Pressable accessibilityRole="button" onPress={() => { setMonth(value || today); setOpen(true); }} style={styles.chip} testID={`${testID}-pick`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><CalendarIcon size={18} color={colors.ink} /><Txt variant="strong" size={16}>{t('patterns.pickDate')}</Txt></View>
      </Pressable>
      <Sheet visible={open} title={t('patterns.pickDate')} onClose={() => setOpen(false)}>
        <MonthCalendar month={month} onMonth={setMonth} onTap={(d) => { onChange(d); setOpen(false); }} picked={value} allowed={(d) => d >= today && (!max || d <= max)} />
      </Sheet>
    </View>
  );
}

/** A plain date (an expiry, a booking): the field with the calendar, any date. */
export function DateField({ label, value, onChange, min, max, testID }: { label: string; value: string; onChange: (day: string) => void; /** The first day that may be picked. */ min?: string; /** The last day that may be picked. */ max?: string; testID?: string }) {
  const { t } = useApp();
  const names = useNames();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value || colomboDate());
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="strong" size={16}>{label}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { setMonth(value || colomboDate()); setOpen(true); }} style={styles.rangeBtn} testID={testID}>
        <CalendarIcon size={20} color={colors.ink} />
        <Txt variant="strong" size={16} style={{ flex: 1 }} color={value ? colors.ink : colors.muted}>{value ? `${rangeWords({ from: value, to: value }, names)} ${value.slice(0, 4)}` : '—'}</Txt>
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)} actions={value ? <Button kind="outline" label={t('patterns.clear')} onPress={() => { onChange(''); setOpen(false); }} style={{ flex: 1, minHeight: 52 }} /> : undefined}>
        <MonthCalendar month={month} onMonth={setMonth} onTap={(d) => { onChange(d); setOpen(false); }} picked={value} allowed={(d) => (!min || d >= min) && (!max || d <= max)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cell: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  startBand: { backgroundColor: colors.blueChip, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  endBand: { backgroundColor: colors.blueChip, borderTopRightRadius: 22, borderBottomRightRadius: 22 },
  rangeBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 14 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  todayBtn: { minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, justifyContent: 'center' },
  iconBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  weekNav: { width: 30, height: 56, alignItems: 'center', justifyContent: 'center' },
  stripDay: { flex: 1, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 2 },
  todayMark: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.blue },
});
