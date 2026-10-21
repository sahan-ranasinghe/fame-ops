// Office mode (Phase 8, O2; the standard patterns in O3, docs/ui-patterns.md): the Drivers board (design 12). The dark
// header ("Drivers", "Mon 19 Oct · N drivers"), Now | Week as a segmented control, the search bar (drivers_board's own
// `search`) and in Now one Filter button (All · Free now · On a task · Off duty · Not available with the server's counts
// in the sheet; drivers_board with the choice as its filter, every 60 s while in front, on pull to refresh), skeleton rows
// first; a row per driver (the avatar with a dot
// coloured by state, the name and the plate held today, the status line, the next task / last seen / the regular vehicle,
// Call when the number is known, a red pill when not available); a row opens the driver's page. Week: the next 7 days as a
// grid per driver from `unavailability` (today to +6): a marked cell lists its entries (Remove with remove_unavailability,
// after a confirmation), an empty cell or "+ Not available" opens the sheet (the one bottom sheet: the day as Today /
// Tomorrow / Pick a date, until as a date field, full day / morning / afternoon / hours with from–to in the time sheet,
// the reason, a note → set_unavailability). "Ask drivers" at the bottom opens the sheet of design 13
// with every free driver ticked (Free for a trip? today: the person types the time). Every button only when the person's
// tools allow it (me.tools); the rules: office/driversLogic.ts.

import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessageCircle, Phone, Plus } from '@/components/icons';
import { ChoiceChip, ChoiceChips } from '@/components/patterns/Select';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { DateField, TripDayPicker } from '@/components/patterns/Calendar';
import { FilterBar } from '@/components/patterns/FilterBar';
import { ListEmpty, SkeletonRows } from '@/components/patterns/ListState';
import { Sheet } from '@/components/patterns/Sheet';
import { TimeField } from '@/components/patterns/TimeField';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import type { FilterValues } from '@/lib/patterns/filterLogic';
import { shortDate } from '@/lib/durations';
import { MAX_DAYS } from '@/lib/availability';
import { addDays, colomboDate } from '@/lib/time';
import { askTargetsFromBoard } from '@/office/askLogic';
import { attendanceGroups, attendanceLine, boardArgs, boardChoice, boardFilterDefs, boardPill, entryParts, heldPlate, PARTS, REASONS, rowLines, type UnavailabilityForm, unavailabilityInput, weekDays, weekGrid, type WeekRow } from '@/office/driversLogic';
import { useOffice, useTool } from '@/office/state';
import type { BoardDriver, DriversBoard, FleetError, SetUnavailabilityResult, UnavailabilityList, UnavailableEntry, UnavailablePart, UnavailableReason } from '@/office/types';
import { Avatar, DarkHeader, ErrorNotice, ListFailed, Screen, StatusChip } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const EVERY_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 500;
const DOT: Record<'blue' | 'green' | 'red' | 'muted', string> = { blue: colors.blue, green: colors.green, red: colors.red, muted: '#9aa0a8' };

type ViewKey = 'now' | 'attendance' | 'week';

export default function DriversTab() {
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const names = { days: tList('days'), months: tList('months') };
  const dayLabel = (date: string) => shortDate(names, `${date}T06:00:00Z`);
  const today = colomboDate();
  const days = useMemo(() => weekDays(today), [today]);

  const [view, setView] = useState<ViewKey>('now');
  const [values, setValues] = useState<FilterValues>({ filter: 'all' });
  const filter = boardChoice(values);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const board = useTool<DriversBoard>('drivers_board', boardArgs(view, filter, search), { every: EVERY_MS });
  const week = useTool<UnavailabilityList>('unavailability', { from: today, to: addDays(today, 6) }, { every: EVERY_MS, enabled: view === 'week' });

  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState<{ driver: { name: string; username: string }; date: string } | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);
  // The entry whose Remove failed: Try again removes it again (never only hides the error).
  const [lastRemove, setLastRemove] = useState<UnavailableEntry | null>(null);

  const mayAsk = me.tools.includes('ask_drivers');
  const mayAdd = me.tools.includes('set_unavailability');
  const mayRemove = me.tools.includes('remove_unavailability');

  const drivers = board.data?.drivers ?? [];
  const total = board.data?.counts.all ?? drivers.length;
  const rows = useMemo(() => weekGrid(drivers, week.data?.entries ?? [], days), [drivers, week.data, days]);

  const openDriver = (d: Pick<BoardDriver, 'username'>) => {
    if (d.username) router.push({ pathname: '/office/driver/[username]', params: { username: d.username } });
  };

  function confirmRemove(e: UnavailableEntry) {
    const when = entryParts(e, dayLabel, t).slice(0, 2).join(' · ');
    Alert.alert(t('office.drivers.removeTitle'), t('office.drivers.removeBody', { name: e.driver ?? '', when }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('office.drivers.remove'), style: 'destructive', onPress: () => void remove(e) },
    ]);
  }
  async function remove(e: UnavailableEntry) {
    setProblem(null);
    setLastRemove(e);
    try {
      await api.call('remove_unavailability', { id: e.id });
      setLastRemove(null);
      week.patch((prev) => ({ ...prev, entries: prev.entries.filter((x) => x.id !== e.id), count: Math.max(0, prev.count - 1) }));
      void board.reload();
    } catch (err) {
      setProblem(err as FleetError);
    }
  }

  const refresh = () => void Promise.all([board.reload(), view === 'week' ? week.reload() : Promise.resolve()]);
  const subtitle = `${dayLabel(today)} · ${total === 1 ? t('office.drivers.countOne') : t('office.drivers.count', { n: total })}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <DarkHeader above={subtitle} title={t('office.drivers.title')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 10 }}>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {(['now', 'attendance', 'week'] as const).map((k) => (
              <ChoiceChip key={k} onDark label={t(`office.drivers.${k}`)} selected={view === k} onPress={() => setView(k)} />
            ))}
          </View>
        </View>
      </DarkHeader>

      <Screen refreshing={board.refreshing || week.refreshing} onRefresh={refresh} bottom={mayAsk ? 100 : 24} style={{ gap: 10 }}>
        <FilterBar
          search={text}
          onSearch={(v) => { setText(v); if (!v) setSearch(''); }}
          placeholder={t('office.drivers.search')}
          defs={view === 'now' ? boardFilterDefs(board.data?.counts, t) : []}
          values={values}
          onApply={setValues}
        />
        {!board.data && board.error && <ListFailed error={board.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {!board.data && !board.error && <SkeletonRows rows={5} lines={2} />}
        {board.data && board.error && <ListFailed stale error={board.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {problem && <ErrorNotice error={problem} onRetry={() => { if (lastRemove) void remove(lastRemove); else setProblem(null); }} />}
        {view === 'now' && board.data && drivers.length === 0 && <ListEmpty text={search ? t('office.drivers.noneMatch', { search }) : filter === 'all' ? t('office.drivers.empty') : t('office.drivers.noneInFilter')} />}
        {view === 'now' && drivers.map((d) => <DriverRow key={d.username ?? d.name} d={d} onPress={() => openDriver(d)} />)}

        {/* Round 2b: Today's attendance (Samsara's driver day): four groups from the day's duty sessions; Call on each row. */}
        {view === 'attendance' && board.data && attendanceGroups(drivers).map((g) => (
          <View key={g.state} style={{ gap: 8 }} testID={`attendance-${g.state}`}>
            <Txt variant="label" color={colors.muted}>{`${t(`office.attendance.${g.state}`)} · ${g.drivers.length}`.toUpperCase()}</Txt>
            {g.drivers.length === 0 ? <Txt variant="small">{t('office.attendance.nobody')}</Txt> : g.drivers.map((d) => (
              <DriverRow key={d.username ?? d.name} d={d} onPress={() => openDriver(d)} line={attendanceLine(d, t)} />
            ))}
          </View>
        ))}

        {view === 'week' && (
          <>
            <WeekHead days={days} names={names} today={today} />
            {!week.data && !week.error && board.data && <SkeletonRows rows={4} lines={2} />}
            {week.error && <ListFailed stale={!!week.data} error={week.error} onRetry={refresh} onSignIn={() => void signOut()} />}
            {board.data && rows.length === 0 && <ListEmpty text={search ? t('office.drivers.noneMatch', { search }) : t('office.drivers.empty')} />}
            {rows.map((row) => (
              <WeekDriver
                key={row.username ?? `name:${row.name}`}
                row={row}
                dayLabel={dayLabel}
                onOpen={() => openDriver({ username: row.username ?? undefined })}
                onAdd={mayAdd && row.username ? (date) => setAdding({ driver: { name: row.name, username: row.username as string }, date }) : undefined}
                onRemove={mayRemove ? confirmRemove : undefined}
              />
            ))}
            {board.data && rows.length > 0 && (week.data?.entries.length ?? 0) === 0 && <Txt variant="small" style={{ textAlign: 'center' }}>{t('office.drivers.weekEmpty')}</Txt>}
          </>
        )}
      </Screen>

      {mayAsk && (
        <AskBar onPress={() => setAsking(true)} disabled={drivers.length === 0} />
      )}
      {mayAsk && (
        <AskDriversSheet
          visible={asking}
          onClose={() => setAsking(false)}
          drivers={askTargetsFromBoard(drivers)}
          context={{ date: today }}
        />
      )}
      {mayAdd && adding && (
        <NotAvailableSheet
          visible
          driver={adding.driver}
          date={adding.date}
          onClose={() => setAdding(null)}
          onSaved={(entry) => {
            setAdding(null);
            week.patch((prev) => ({ ...prev, entries: [...prev.entries.filter((x) => x.id !== entry.id), entry], count: prev.count + 1 }));
            void board.reload();
          }}
        />
      )}
    </View>
  );
}

/** A driver's row (design 12): the avatar with the state's dot, "Name · [plate]", the two lines, Call or the not-available pill. */
function DriverRow({ d, onPress, line }: { d: BoardDriver; onPress: () => void; line?: string }) {
  const { t } = useApp();
  const pill = boardPill(d);
  const lines = rowLines(d, t);
  // The attendance view's own line ("Started 07:12") instead of the board's.
  const [line1, line2] = line ? [line, undefined] : lines;
  const plate = heldPlate(d);
  const call = d.links?.call;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!d.username} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]} testID={`driver-row-${d.username ?? d.name}`}>
      <View>
        <Avatar name={d.name} size={44} photo={d.photo_url} />
        <View style={[styles.dot, { backgroundColor: DOT[pill.tone] }]} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt variant="strong" size={17} numberOfLines={1} style={{ flexShrink: 1 }}>{d.name}</Txt>
          {plate ? <Plate regNo={plate} /> : null}
        </View>
        <Txt variant="muted" size={15} numberOfLines={2}>{line1}</Txt>
        {line2 ? <Txt variant="small" numberOfLines={2}>{line2}</Txt> : null}
      </View>
      {d.status.kind === 'not_available' ? (
        <StatusChip text={t('office.drivers.pill.notAvailable')} tone="red" />
      ) : call ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('office.common.call')} ${d.name}`} onPress={() => void Linking.openURL(call).catch(() => undefined)} style={styles.callBtn}>
          <Phone size={20} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** The day strip over the week grid: "Mon" over "19", today marked. */
function WeekHead({ days, names, today }: { days: string[]; names: { days: readonly string[]; months: readonly string[] }; today: string }) {
  return (
    <View style={styles.weekHead}>
      <View style={{ flex: 1 }} />
      {days.map((date) => {
        const d = new Date(`${date}T06:00:00Z`);
        const label = shortDate(names, d).split(' ');
        return (
          <View key={date} style={[styles.cellHead, date === today && { backgroundColor: colors.amberChip, borderRadius: 8 }]}>
            <Txt variant="small" size={12}>{label[0]}</Txt>
            <Mono size={14} bold>{label[1]}</Mono>
          </View>
        );
      })}
    </View>
  );
}

/** One driver in the week: the name (opens the page), "+ Not available", the seven cells, and the entries' lines with Remove. */
function WeekDriver({ row, dayLabel, onOpen, onAdd, onRemove }: {
  row: WeekRow;
  dayLabel: (date: string) => string;
  onOpen: () => void;
  onAdd?: (date: string) => void;
  onRemove?: (e: UnavailableEntry) => void;
}) {
  const { t } = useApp();
  return (
    <View style={styles.weekRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" onPress={onOpen} disabled={!row.username} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <Avatar name={row.name} size={32} />
          <Txt variant="strong" size={16} numberOfLines={1} style={{ flexShrink: 1 }}>{row.name}</Txt>
        </Pressable>
        {onAdd && (
          <Pressable accessibilityRole="button" onPress={() => onAdd(row.cells[0].date)} style={styles.addBtn}>
            <Plus size={16} color={colors.ink} strokeWidth={2.6} />
            <Txt variant="strong" size={13}>{t('office.drivers.notAvailableTitle')}</Txt>
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }} />
        {row.cells.map((c) => {
          const marked = c.mark !== 'none';
          const press = marked
            ? () => {
              const e = c.entries[0];
              if (onRemove) onRemove(e);
              else Alert.alert(e.driver ?? row.name, entryParts(e, dayLabel, t).join(' · '));
            }
            : onAdd ? () => onAdd(c.date) : undefined;
          return (
            <Pressable
              key={c.date}
              accessibilityRole="button"
              accessibilityLabel={`${dayLabel(c.date)} ${marked ? t('office.drivers.pill.notAvailable') : ''}`}
              onPress={press}
              disabled={!press}
              style={[styles.cell, c.mark === 'full' && styles.cellFull, c.mark === 'part' && styles.cellPart]}
            >
              {marked && <Txt variant="strong" size={11} color={c.mark === 'full' ? '#ffffff' : colors.amberText}>{c.entries.length > 1 ? String(c.entries.length) : ''}</Txt>}
            </Pressable>
          );
        })}
      </View>
      {row.entries.map((e) => (
        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
          <View style={[styles.dotSmall, { backgroundColor: e.part === 'full_day' ? colors.red : colors.amber }]} />
          <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>{entryParts(e, dayLabel, t).join(' · ')}</Txt>
          {onRemove && (
            <Pressable accessibilityRole="button" onPress={() => onRemove(e)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Txt variant="strong" size={14} color={colors.red}>{t('office.drivers.remove')}</Txt>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

/** The amber "Ask drivers" over the bottom (design 12). */
function AskBar({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.askBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <Button label={t('office.ask.open')} icon={MessageCircle} onPress={onPress} disabled={disabled} style={{ minHeight: 56 }} />
    </View>
  );
}

/** "Not available" (the one bottom sheet): the day (Today / Tomorrow / Pick a date), until (full days, a date field), the part, from–to for hours (the time sheet), the reason chips, a note → set_unavailability. */
function NotAvailableSheet({ visible, driver, date: firstDate, onClose, onSaved }: {
  visible: boolean;
  driver: { name: string; username: string };
  date: string;
  onClose: () => void;
  onSaved: (entry: UnavailableEntry) => void;
}) {
  const { t, language } = useApp();
  const { api } = useOffice();
  const [date, setDate] = useState(firstDate);
  const [toDate, setToDate] = useState('');
  const [part, setPart] = useState<UnavailablePart>('full_day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<UnavailableReason>('leave');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<FleetError | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const form: UnavailabilityForm = { driver: driver.username, date, toDate: toDate || undefined, part, from, to, reason, note };
  const checked = unavailabilityInput(form);

  async function save() {
    if (busy) return;
    setHint(null);
    if (!checked.ok) {
      setHint(checked.problem === 'hours' ? t('office.drivers.hoursProblem') : checked.problem === 'toDate' ? t('office.drivers.toDateProblem') : t('common.badTime'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const out = await api.call<SetUnavailabilityResult>('set_unavailability', checked.input);
      onSaved(out.entry);
    } catch (e) {
      setProblem(e as FleetError);
    } finally {
      setBusy(false);
    }
  }

  const fontFamily = language === 'si' ? fonts.sinhalaBody : fonts.body;
  return (
    <Sheet
      visible={visible}
      title={t('office.drivers.notAvailableTitle')}
      onClose={() => { if (!busy) onClose(); }}
      testID="not-available-sheet"
      actions={(
        <>
          <Button kind="outline" label={t('common.cancel')} onPress={onClose} disabled={busy} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t('office.drivers.save')} onPress={() => void save()} busy={busy} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}
    >
      <Txt variant="muted">{driver.name}</Txt>
      <Txt variant="label" color={colors.muted}>{t('office.drivers.day').toUpperCase()}</Txt>
      <TripDayPicker value={date} onChange={(d) => { setDate(d); if (toDate && toDate < d) setToDate(''); }} testID="not-available-day" />
      {part === 'full_day' && (
        <DateField label={t('office.drivers.lastDay')} value={toDate} onChange={setToDate} min={date} max={addDays(date, MAX_DAYS - 1)} testID="not-available-until" />
      )}
      <Txt variant="label" color={colors.muted}>{t('office.drivers.part.label').toUpperCase()}</Txt>
      <ChipRow options={PARTS.map((p) => ({ key: p, label: t(`office.drivers.part.${p}`) }))} value={part} onChange={setPart} />
      {part === 'hours' && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TimeField label={t('office.drivers.from')} value={from} onCommit={setFrom} testID="not-available-from" />
          <TimeField label={t('office.drivers.to')} value={to} onCommit={setTo} testID="not-available-to" />
        </View>
      )}
      <Txt variant="label" color={colors.muted}>{t('office.drivers.reason.label').toUpperCase()}</Txt>
      <ChipRow options={REASONS.map((r) => ({ key: r, label: t(`office.drivers.reason.${r}`) }))} value={reason} onChange={setReason} />
      <TextInput value={note} onChangeText={setNote} placeholder={t('office.drivers.note')} placeholderTextColor="#9aa0a6" maxLength={300} style={[styles.input, { fontFamily }]} />
      {hint && <Txt variant="strong" size={14} color={colors.red}>{hint}</Txt>}
      {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
    </Sheet>
  );
}

/** A row of small chips, one selected: the shared ChoiceChips (the check, the tint, the border). */
function ChipRow<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return <ChoiceChips options={options} value={value} onChange={onChange} small />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, minHeight: 72 },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#ffffff' },
  dotSmall: { width: 10, height: 10, borderRadius: 5 },
  callBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  weekHead: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 },
  cellHead: { width: 40, alignItems: 'center', paddingVertical: 2 },
  weekRow: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 10, gap: 6 },
  cell: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.line, marginLeft: 0, alignItems: 'center', justifyContent: 'center' },
  cellFull: { backgroundColor: colors.red, borderColor: colors.red },
  cellPart: { backgroundColor: colors.amberChip, borderColor: colors.amber },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line },
  askBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.page },
  input: { minHeight: 48, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
});
