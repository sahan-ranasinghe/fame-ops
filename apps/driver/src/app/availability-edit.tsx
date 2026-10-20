// Add or change a time I'm not available (Part 3b, H1), pushed over Me → Availability (with ?id= for a change): the day
// (big buttons for the next 60 days), for a full day a last day (several days, at most 31), when (Full day · Morning until
// the split · Afternoon from the split · From–to with the two times; the split is the office's half_day_split, 13:00 by
// default), the reason, a note. Save → set_my_unavailability (online only: "No connection" keeps the form; a refusal
// comes back in words). Back with something changed asks "Discard changes?"; after Save it returns to the list.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { Button, Card, Field, Notice, Txt } from '@/components/ui';
import { ApiError, setMyUnavailability } from '@/lib/api';
import {
  AVAIL_PARTS,
  AVAIL_REASONS,
  type AvailForm,
  availArgs,
  availDirty,
  formFromRow,
  newAvailForm,
  partKey,
  reasonKey,
  type UnavailabilityRow,
} from '@/lib/availability';
import { getJson, KEYS } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { colomboDate } from '@/lib/time';
import { DateField, TripDayPicker } from '@/components/patterns/Calendar';
import { TimeField } from '@/components/patterns/TimeField';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** Noon of a Colombo day, for the day's label ("Tue 20 Oct"). */

export default function AvailabilityEditScreen() {
  const { t, me, settings } = useApp();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = colomboDate();
  const row = id ? (getJson<UnavailabilityRow[]>(KEYS.availability) ?? []).find((item) => item.id === id) ?? null : null;
  const [start] = useState<AvailForm>(() => (row ? formFromRow(row) : newAvailForm(today)));
  const [form, setForm] = useState<AvailForm>(start);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { allowLeave } = useLeaveGuard(availDirty(start, form), busy);

  if (!me) return <Redirect href="/login" />;

  const split = settings.half_day_split;
  const change = (patch: Partial<AvailForm>) => {
    setForm((old) => ({ ...old, ...patch }));
    setProblem(null);
  };

  async function save() {
    if (busy) return;
    const built = availArgs(form, row?.id ?? null);
    if ('problem' in built) {
      setProblem(t(built.problem));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const answer = await setMyUnavailability(supabase, built.args);
      setBusy(false);
      if (answer.result === 'refused') {
        setProblem(t('avail.failed', { reason: answer.reason }));
        return;
      }
      allowLeave();
      router.back();
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof ApiError && error.permanent ? t('avail.failed', { reason: error.message }) : t('avail.noConnection'));
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={26} style={{ flex: 1 }}>{t(row ? 'avail.title' : 'avail.add')}</Txt>
        </View>

        <Card style={{ gap: 12 }}>
          <Txt variant="big">{t('avail.day')}</Txt>
          {/* The day: Today, Tomorrow or Pick a date (docs/ui-patterns.md §3); an entry already running keeps its first day. */}
          <TripDayPicker value={form.from} onChange={(day) => change({ from: day, to: form.to && form.to > day ? form.to : null })} testID="avail-day" />
        </Card>

        <Card style={{ gap: 10 }}>
          <Txt variant="big">{t('avail.when')}</Txt>
          {AVAIL_PARTS.map((part) => (
            <Option key={part} on={form.part === part} label={t(partKey(part), { time: split })} onPress={() => change({ part, to: part === 'full_day' ? form.to : null })} />
          ))}
          {form.part === 'hours' && (
            <View style={styles.times}>
              <TimeField label={t('avail.from')} value={form.start} onCommit={(start) => change({ start })} testID="avail-from" />
              <TimeField label={t('avail.to')} value={form.end} onCommit={(end) => change({ end })} testID="avail-to" />
            </View>
          )}
        </Card>

        {form.part === 'full_day' && (
          <Card style={{ gap: 12 }}>
            <Txt variant="big">{t('avail.lastDay')}</Txt>
            {/* No last day picked = that one day; a tap on the picked day takes it back. */}
            <DateField label={t('avail.lastDay')} value={form.to ?? ''} onChange={(day) => change({ to: day && day > form.from ? day : null })} min={form.from} testID="avail-last-day" />
          </Card>
        )}

        <Card style={{ gap: 10 }}>
          <Txt variant="big">{t('avail.reason')}</Txt>
          <View style={styles.reasons}>
            {AVAIL_REASONS.map((reason) => (
              <Chip key={reason} on={form.reason === reason} label={t(reasonKey(reason))} onPress={() => change({ reason })} wide />
            ))}
          </View>
          <Field label={t('avail.note')} value={form.note} onChangeText={(text) => change({ note: text })} maxLength={300} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} />
        </Card>

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button label={t('avail.save')} busy={busy} onPress={() => void save()} />
      </View>
    </KeyboardAvoidingView>
  );
}

/** A big choice button (a day, a reason). */
function Chip({ on, label, onPress, wide = false }: { on: boolean; label: string; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, wide && styles.wide, on && styles.chipOn]}>
      <Txt variant="strong" size={17} color={on ? '#ffffff' : colors.ink}>{label}</Txt>
    </Pressable>
  );
}

/** One of the "when" choices, as the reasons sheet shows its options. */
function Option({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.option, on && styles.optionOn]}>
      <View style={[styles.radio, on && { borderColor: colors.ink, backgroundColor: colors.ink }]} />
      <Txt variant="strong" size={18} style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingRight: 8 },
  chip: {
    minHeight: 56, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  wide: { flexGrow: 1, minWidth: '45%' },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  times: { flexDirection: 'row', gap: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 14, minHeight: 56 },
  optionOn: { borderColor: colors.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: '#8b9198' },
});
