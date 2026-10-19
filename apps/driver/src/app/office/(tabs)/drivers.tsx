// Office mode (Phase 8, O2): the Drivers board (design 12). The dark header ("Drivers", "Mon 19 Oct · N drivers"), Now |
// Week, and in Now the chips All · Free now · On a task · Off duty · Not available with the server's counts (drivers_board
// with the chip as its filter, every 60 s while in front, on pull to refresh); a row per driver (the avatar with a dot
// coloured by state, the name and the plate held today, the status line, the next task / last seen / the regular vehicle,
// Call when the number is known, a red pill when not available); a row opens the driver's page. Week: the next 7 days as a
// grid per driver from `unavailability` (today to +6): a marked cell lists its entries (Remove with remove_unavailability,
// after a confirmation), an empty cell or "+ Not available" opens the sheet (the day, full day / morning / afternoon /
// hours with from–to, the reason, a note → set_unavailability). "Ask drivers" at the bottom opens the sheet of design 13
// with every free driver ticked (Free for a trip? today: the person types the time). Every button only when the person's
// tools allow it (me.tools); the rules: office/driversLogic.ts.

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessageCircle, Phone, Plus } from '@/components/icons';
import { AskDriversSheet } from '@/components/office/AskDriversSheet';
import { Button, Mono, Plate, Txt } from '@/components/ui';
import { shortDate } from '@/lib/durations';
import { addDays, colomboDate } from '@/lib/time';
import { askTargetsFromBoard } from '@/office/askLogic';
import { BOARD_FILTERS, boardPill, entryParts, heldPlate, PARTS, REASONS, rowLines, type UnavailabilityForm, unavailabilityInput, weekDays, weekGrid, type WeekRow } from '@/office/driversLogic';
import { useOffice, useTool } from '@/office/state';
import type { BoardDriver, BoardFilter, DriversBoard, FleetError, SetUnavailabilityResult, UnavailabilityList, UnavailableEntry, UnavailablePart, UnavailableReason } from '@/office/types';
import { Avatar, DarkHeader, Empty, ErrorNotice, Loading, Pill, Screen } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const EVERY_MS = 60_000;
const DOT: Record<'blue' | 'green' | 'red' | 'muted', string> = { blue: colors.blue, green: colors.green, red: colors.red, muted: '#9aa0a8' };

type ViewKey = 'now' | 'week';

export default function DriversTab() {
  const { t, tList } = useApp();
  const { me, api, signOut } = useOffice();
  const router = useRouter();
  const names = { days: tList('days'), months: tList('months') };
  const dayLabel = (date: string) => shortDate(names, `${date}T06:00:00Z`);
  const today = colomboDate();
  const days = useMemo(() => weekDays(today), [today]);

  const [view, setView] = useState<ViewKey>('now');
  const [filter, setFilter] = useState<BoardFilter>('all');
  const board = useTool<DriversBoard>('drivers_board', view === 'now' ? { filter } : {}, { every: EVERY_MS });
  const week = useTool<UnavailabilityList>('unavailability', { from: today, to: addDays(today, 6) }, { every: EVERY_MS, enabled: view === 'week' });

  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState<{ driver: { name: string; username: string }; date: string } | null>(null);
  const [problem, setProblem] = useState<FleetError | null>(null);

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
    try {
      await api.call('remove_unavailability', { id: e.id });
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
          <View style={styles.seg}>
            {(['now', 'week'] as const).map((k) => (
              <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: view === k }} onPress={() => setView(k)} style={[styles.segBtn, view === k && { backgroundColor: '#ffffff' }]}>
                <Txt variant="strong" size={15} color={view === k ? colors.ink : '#b9bec6'}>{t(`office.drivers.${k}`)}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
        {view === 'now' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
            {BOARD_FILTERS.map((k) => {
              const on = filter === k;
              const n = board.data?.counts[k];
              return (
                <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilter(k)} style={[styles.chip, on && styles.chipOn]}>
                  <Txt variant="strong" size={14} color={on ? colors.ink : '#d9dce1'}>{t(`office.drivers.filter.${k}`)}</Txt>
                  {n !== undefined && <Mono size={14} bold color={on ? colors.ink : '#d9dce1'}>{`· ${n}`}</Mono>}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </DarkHeader>

      <Screen refreshing={board.refreshing || week.refreshing} onRefresh={refresh} bottom={mayAsk ? 100 : 24} style={{ gap: 10 }}>
        {board.loading && <Loading text={t('office.common.loading')} />}
        {board.error && !board.data && <ErrorNotice error={board.error} onRetry={refresh} onSignIn={() => void signOut()} />}
        {problem && <ErrorNotice error={problem} onRetry={() => setProblem(null)} />}
        {view === 'now' && board.data && drivers.length === 0 && <Empty text={filter === 'all' ? t('office.drivers.empty') : t('office.drivers.noneInFilter')} />}
        {view === 'now' && drivers.map((d) => <DriverRow key={d.username ?? d.name} d={d} onPress={() => openDriver(d)} />)}

        {view === 'week' && (
          <>
            <WeekHead days={days} names={names} today={today} />
            {week.loading && <Loading text={t('office.common.loading')} />}
            {week.error && !week.data && <ErrorNotice error={week.error} onRetry={refresh} />}
            {board.data && rows.length === 0 && <Empty text={t('office.drivers.empty')} />}
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
          days={days}
          date={adding.date}
          dayLabel={dayLabel}
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
function DriverRow({ d, onPress }: { d: BoardDriver; onPress: () => void }) {
  const { t } = useApp();
  const pill = boardPill(d);
  const [line1, line2] = rowLines(d, t);
  const plate = heldPlate(d);
  const call = d.links?.call;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!d.username} style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]} testID={`driver-row-${d.username ?? d.name}`}>
      <View>
        <Avatar name={d.name} size={44} />
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
        <Pill text={t('office.drivers.pill.notAvailable')} tone="red" size={13} />
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

/** "Not available": the day (the week's days as chips), until (full days), the part, from–to for hours, the reason chips, a note → set_unavailability. */
function NotAvailableSheet({ visible, driver, days, date: firstDate, dayLabel, onClose, onSaved }: {
  visible: boolean;
  driver: { name: string; username: string };
  days: string[];
  date: string;
  dayLabel: (date: string) => string;
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

  const insets = useSafeAreaInsets();
  const fontFamily = language === 'si' ? fonts.sinhalaBody : fonts.body;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.shade}>
      <Pressable style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} testID="not-available-sheet">
        <View style={styles.handle} />
        <Txt variant="heading" size={22}>{t('office.drivers.notAvailableTitle')}</Txt>
        <Txt variant="muted">{driver.name}</Txt>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
          <Txt variant="label" color={colors.muted}>{t('office.drivers.day').toUpperCase()}</Txt>
          <ChipRow options={days.map((d) => ({ key: d, label: dayLabel(d) }))} value={date} onChange={(d) => { setDate(d); if (toDate && toDate < d) setToDate(''); }} />
          {part === 'full_day' && (
            <>
              <Txt variant="label" color={colors.muted}>{t('office.drivers.lastDay').toUpperCase()}</Txt>
              <ChipRow options={[{ key: '', label: t('office.drivers.sameDay') }, ...days.filter((d) => d > date).map((d) => ({ key: d, label: dayLabel(d) }))]} value={toDate} onChange={setToDate} />
            </>
          )}
          <Txt variant="label" color={colors.muted}>{t('office.drivers.part.label').toUpperCase()}</Txt>
          <ChipRow options={PARTS.map((p) => ({ key: p, label: t(`office.drivers.part.${p}`) }))} value={part} onChange={setPart} />
          {part === 'hours' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([['from', from, setFrom], ['to', to, setTo]] as const).map(([k, v, set]) => (
                <View key={k} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt variant="strong" size={15}>{t(`office.drivers.${k}`)}</Txt>
                  <TextInput value={v} onChangeText={set} placeholder="HH:MM" placeholderTextColor="#9aa0a6" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={t(`office.drivers.${k}`)} style={[styles.input, { flex: 1, fontFamily: fonts.mono }]} />
                </View>
              ))}
            </View>
          )}
          <Txt variant="label" color={colors.muted}>{t('office.drivers.reason.label').toUpperCase()}</Txt>
          <ChipRow options={REASONS.map((r) => ({ key: r, label: t(`office.drivers.reason.${r}`) }))} value={reason} onChange={setReason} />
          <TextInput value={note} onChangeText={setNote} placeholder={t('office.drivers.note')} placeholderTextColor="#9aa0a6" maxLength={300} style={[styles.input, { fontFamily }]} />
          {hint && <Txt variant="strong" size={14} color={colors.red}>{hint}</Txt>}
          {problem && <ErrorNotice error={problem} onRetry={() => void save()} />}
        </ScrollView>
        <Button label={t('office.drivers.save')} onPress={() => void save()} busy={busy} style={{ minHeight: 56 }} />
        <Button kind="outline" label={t('common.cancel')} onPress={onClose} disabled={busy} style={{ minHeight: 48 }} />
      </View>
    </View>
    </Modal>
  );
}

/** A row of small chips, one selected. */
function ChipRow<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} style={[styles.pick, on && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
            <Txt variant="strong" size={14} color={on ? '#ffffff' : colors.ink}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.darkSurface, borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { minWidth: 72, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#3a4048' },
  chipOn: { backgroundColor: colors.amber, borderColor: colors.amber },
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
  shade: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: colors.page, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#c9c6bc', alignSelf: 'center' },
  pick: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1.5, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, fontSize: 17, color: colors.ink, backgroundColor: colors.card },
});
