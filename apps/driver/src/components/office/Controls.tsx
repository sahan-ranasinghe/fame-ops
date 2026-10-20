// Office mode (Hotfix O2-H1, Part B): the controls every office form shares (the principle: the same patterns everywhere):
// a stepper for a count, a "More details" fold for the optional fields on the same screen, a toggle row for a yes / no,
// a chip row for an enumeration. Big targets (44 px and over), the house colours, every word through i18n.

import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ChevronDown, ChevronUp, Minus, Plus } from '@/components/icons';
import { ChoiceChips } from '@/components/patterns/Select';
import { Mono, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** A count: − and + with the number between, within min and max; empty = not set (the server's default). */
export function Stepper({ label, value, min = 0, max = 80, onChange, hint, testID }: {
  label: string;
  /** '' = not set. */
  value: string;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
  hint?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const n = value.trim() === '' ? null : Math.max(min, Math.min(max, parseInt(value, 10) || 0));
  const step = (d: number) => {
    const next = Math.max(min, Math.min(max, (n ?? 0) + d));
    onChange(String(next));
  };
  return (
    <View style={{ gap: 6 }} testID={testID}>
      <Txt variant="strong" size={16}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} −`} onPress={() => step(-1)} disabled={n === null || n <= min} style={[styles.stepBtn, (n === null || n <= min) && { opacity: 0.35 }]}>
          <Minus size={22} color={colors.ink} strokeWidth={2.6} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => (n === null ? onChange(String(min)) : undefined)} style={styles.stepValue}>
          <Mono size={22} bold color={n === null ? colors.muted : colors.ink}>{n === null ? '—' : String(n)}</Mono>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} +`} onPress={() => step(1)} disabled={n !== null && n >= max} style={[styles.stepBtn, n !== null && n >= max && { opacity: 0.35 }]}>
          <Plus size={22} color={colors.ink} strokeWidth={2.6} />
        </Pressable>
        {n !== null && (
          <Pressable accessibilityRole="button" onPress={() => onChange('')} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
            <Txt variant="strong" size={14} color={colors.muted}>{t('office.common.clear')}</Txt>
          </Pressable>
        )}
      </View>
      {hint ? <Txt variant="small">{hint}</Txt> : null}
    </View>
  );
}

/** The optional fields of a screen, under one fold; opens by itself when any of them holds something (`filled`). */
export function MoreDetails({ filled, children, testID }: { filled: boolean; children: ReactNode; testID?: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(filled);
  const shown = open || filled;
  return (
    <View style={{ gap: 12 }} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} onPress={() => setOpen((v) => !v)} style={styles.fold}>
        <Txt variant="strong" size={16}>{t(shown ? 'office.common.fewerDetails' : 'office.common.moreDetails')}</Txt>
        {shown ? <ChevronUp size={22} color={colors.muted} /> : <ChevronDown size={22} color={colors.muted} />}
      </Pressable>
      {shown ? <View style={{ gap: 14 }}>{children}</View> : null}
    </View>
  );
}

/** A yes / no with its words on the left and the switch on the right. */
export function ToggleRow({ label, hint, value, onChange, disabled = false, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: 12 }} testID={testID}>
      <View style={{ flex: 1 }}>
        <Txt variant="body">{label}</Txt>
        {hint ? <Txt variant="small">{hint}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.blue, false: colors.line }} thumbColor="#ffffff" />
    </View>
  );
}

/** One of several, as chips (an enumeration): the shared ChoiceChip (patterns/Select: the check, the tint, the border). */
export function Chips<K extends string>({ options, value, onChange, small = false }: { options: { key: K; label: string; disabled?: boolean }[]; value: K | ''; onChange: (k: K) => void; small?: boolean }) {
  return <ChoiceChips options={options} value={value} onChange={onChange} small={small} />;
}

const styles = StyleSheet.create({
  stepBtn: { width: 52, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 64, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  fold: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
});
