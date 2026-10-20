// Hotfix O2-H2, Part 3: ONE set of selection controls for the whole app (driver side and Office mode), so a picked thing
// always looks picked (Gmail, WhatsApp's "Forward to", Google Contacts; Material 3's selection controls):
// - SelectableRow (pick many): the leading circle is empty when not picked and a filled blue check circle when picked;
//   the row turns blue-chip tinted with a 2 px blue border. A tap anywhere on the row toggles it.
// - ChoiceRow / ChoiceCard (pick one): a radio circle (empty ring / blue ring with a dot) plus the same tint and border.
// - ChoiceChip (one of a few short words, or a filter): the same tint and border plus a check before the words.
// - Checkbox / Radio (form basics): a box or a circle with the words beside it.
// Never colour alone: every picked state has its mark (the check, the dot). Every control says its state to TalkBack
// (accessibilityRole checkbox / radio, accessibilityState checked / selected / disabled). A disabled one is greyed, not
// pressable and says why when the screen knows (`disabledReason`: "On a task", "No app account"). The rules:
// docs/ui-patterns.md, "Selection".

import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { Check } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { colors } from '@/theme';

/** The selection colours (theme.ts): blue #1e4fa0 on the blue chip background #e6edf8. */
export const SELECT = {
  on: colors.blue,
  tint: colors.blueChip,
  off: '#8b9198',
  border: 2,
  disabledOpacity: 0.5,
} as const;

/** The mark alone: an empty circle / a filled check circle (kind check), an empty ring / a ring with a dot (radio), an empty
 *  box / a filled check box (box). */
export function SelectMark({ kind, on, size = 28, testID }: { kind: 'check' | 'radio' | 'box'; on: boolean; size?: number; testID?: string }) {
  const id = testID ? `${testID}-${on ? 'on' : 'off'}` : undefined;
  if (kind === 'radio') {
    return (
      <View testID={id} style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: on ? SELECT.on : SELECT.off }]}>
        {on && <View style={{ width: size / 2, height: size / 2, borderRadius: size / 4, backgroundColor: SELECT.on }} />}
      </View>
    );
  }
  const radius = kind === 'box' ? Math.round(size / 4) : size / 2;
  return (
    <View
      testID={id}
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: radius, borderColor: on ? SELECT.on : SELECT.off },
        on && { backgroundColor: SELECT.on },
      ]}
    >
      {on && <Check size={Math.round(size * 0.66)} color="#ffffff" strokeWidth={3.2} />}
    </View>
  );
}

interface RowBase {
  disabled?: boolean;
  /** Why it cannot be picked, shown under the row's words and read by TalkBack ("On a task"). */
  disabledReason?: string;
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Pick many: a tap anywhere toggles; the circle in front is the state (empty / filled check), the row tints and borders. */
export function SelectableRow({ selected, onToggle, disabled = false, disabledReason, children, trailing, accessibilityLabel, testID, style }: RowBase & {
  selected: boolean;
  onToggle: () => void;
  /** After the words (a pill); never another button: the whole row is the control. */
  trailing?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={disabled ? disabledReason : undefined}
      disabled={disabled}
      onPress={onToggle}
      testID={testID}
      style={({ pressed }) => [styles.row, selected && styles.on, disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }, style]}
    >
      <SelectMark kind="check" on={selected} size={30} testID={testID ? `${testID}-mark` : undefined} />
      <View style={{ flex: 1, gap: 2 }}>
        {children}
        {disabled && disabledReason ? <Txt variant="small" color={colors.muted}>{disabledReason}</Txt> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

/** Pick one: the radio circle (at the start, or at the end after an avatar), the same tint and border when picked. */
export function ChoiceRow({ selected, onPress, disabled = false, disabledReason, children, leading, trailing, mark = 'start', card = false, accessibilityLabel, testID, style }: RowBase & {
  selected: boolean;
  onPress: () => void;
  /** Before the words (an avatar, a photo, an icon); the radio then sits at the end unless `mark` says start. */
  leading?: ReactNode;
  /** Before the radio at the end (a pill). */
  trailing?: ReactNode;
  mark?: 'start' | 'end';
  /** The bigger card form (rounder, more padding). */
  card?: boolean;
}) {
  const radio = <SelectMark kind="radio" on={selected} size={26} testID={testID ? `${testID}-mark` : undefined} />;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={disabled ? disabledReason : undefined}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, card && styles.card, selected && styles.on, disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }, style]}
    >
      {mark === 'start' && radio}
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        {children}
        {disabled && disabledReason ? <Txt variant="small" color={colors.muted}>{disabledReason}</Txt> : null}
      </View>
      {trailing}
      {mark === 'end' && radio}
    </Pressable>
  );
}

/** A pick-one card (the question type, a vehicle with its photo): ChoiceRow in its card form. */
export function ChoiceCard(props: Parameters<typeof ChoiceRow>[0]) {
  return <ChoiceRow {...props} card />;
}

/** A chip: one of a few short words (single) or a filter that may be on with others (`multi`). Picked = the check, the tint
 *  and the 2 px border. */
export function ChoiceChip({ label, selected, onPress, disabled = false, multi = false, small = false, onDark = false, mono = false, corner = false, size, icon, before, after, testID, accessibilityLabel, style }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  multi?: boolean;
  small?: boolean;
  /** Numbers (1×, 5×): the mono font, Latin digits. */
  mono?: boolean;
  /** A tile too narrow for the check before the words (the driver's time tiles): a filled check circle in the corner. */
  corner?: boolean;
  /** The words' size (the driver's big tiles). */
  size?: number;
  /** On a dark header (the Drivers tab): light words when not picked; picked looks the same everywhere. */
  onDark?: boolean;
  /** A node before the words when not picked (an icon); the check takes its place when picked. */
  icon?: ReactNode;
  /** Always before the words, after the check (a plate). */
  before?: ReactNode;
  /** After the words (a chevron when the chip opens a list). */
  after?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  /** The driver side's bigger chips (minHeight 52). */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.chip, small && styles.chipSmall, onDark && styles.chipDark, selected && styles.on, disabled && styles.disabled, pressed && !disabled && { opacity: 0.85 }, style]}
    >
      {selected && corner ? (
        <View style={styles.corner} testID={testID ? `${testID}-check` : undefined}><SelectMark kind="check" on size={20} /></View>
      ) : selected ? (
        <View testID={testID ? `${testID}-check` : undefined}><Check size={small ? 16 : 18} color={SELECT.on} strokeWidth={3} /></View>
      ) : icon ?? null}
      {before}
      {mono ? (
        <Mono size={size ?? (small ? 14 : 15)} bold color={selected ? SELECT.on : onDark ? '#d9dce1' : colors.ink}>{label}</Mono>
      ) : (
        <Txt variant="strong" size={size ?? (small ? 14 : 15)} color={selected ? SELECT.on : onDark ? '#d9dce1' : colors.ink}>{label}</Txt>
      )}
      {after}
    </Pressable>
  );
}

/** A row of ChoiceChips, one picked (or none). */
export function ChoiceChips<K extends string>({ options, value, onChange, small = false, testID }: {
  options: { key: K; label: string; disabled?: boolean; after?: ReactNode }[];
  value: K | '' | null | undefined;
  onChange: (k: K) => void;
  small?: boolean;
  testID?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.chips} testID={testID}>
      {options.map((o) => (
        <ChoiceChip key={o.key || '_'} label={o.label} selected={o.key === value} disabled={o.disabled} small={small} after={o.after} onPress={() => onChange(o.key)} testID={testID ? `${testID}-${o.key}` : undefined} />
      ))}
    </View>
  );
}

/** A form tick box with its words (and a line under them). `tone` danger for a tick that warns (the vehicle cannot go on). */
export function Checkbox({ checked, onChange, label, hint, disabled = false, disabledReason, tone = 'blue', testID }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'blue' | 'danger';
  testID?: string;
}) {
  const on = tone === 'danger' ? colors.red : SELECT.on;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledReason ?? hint : hint}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      testID={testID}
      style={[styles.form, disabled && styles.disabled]}
    >
      <View
        testID={testID ? `${testID}-${checked ? 'on' : 'off'}` : undefined}
        style={[styles.ring, { width: 28, height: 28, borderRadius: 7, borderColor: checked ? on : SELECT.off }, checked && { backgroundColor: on }]}
      >
        {checked && <Check size={20} color="#ffffff" strokeWidth={3.2} />}
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="strong" color={checked && tone === 'danger' ? colors.red : colors.ink}>{label}</Txt>
        {hint ? <Txt variant="small">{hint}</Txt> : null}
        {disabled && disabledReason ? <Txt variant="small" color={colors.muted}>{disabledReason}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** A form radio with its words: one of a group (the group's own state lives in the screen). */
export function Radio({ checked, onPress, label, hint, disabled = false, disabledReason, testID }: {
  checked: boolean;
  onPress: () => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked, selected: checked, disabled }}
      accessibilityLabel={label}
      accessibilityHint={disabled ? disabledReason ?? hint : hint}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.form, disabled && styles.disabled]}
    >
      <SelectMark kind="radio" on={checked} size={26} testID={testID ? `${testID}-mark` : undefined} />
      <View style={{ flex: 1 }}>
        <Txt variant="strong">{label}</Txt>
        {hint ? <Txt variant="small">{hint}</Txt> : null}
        {disabled && disabledReason ? <Txt variant="small" color={colors.muted}>{disabledReason}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** The picked style, for a control that cannot be one of the above (a segment): the tint and the 2 px blue border. */
export const pickedStyle = { backgroundColor: SELECT.tint, borderColor: SELECT.on, borderWidth: SELECT.border } as const;

const styles = StyleSheet.create({
  ring: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: SELECT.border,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  card: { borderRadius: 18, padding: 14, minHeight: 72 },
  on: { backgroundColor: SELECT.tint, borderColor: SELECT.on },
  disabled: { opacity: SELECT.disabledOpacity },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: SELECT.border,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipSmall: { minHeight: 36, paddingHorizontal: 12 },
  corner: { position: 'absolute', top: 4, right: 4 },
  chipDark: { backgroundColor: 'transparent', borderColor: '#3a4048' },
  form: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6 },
});
