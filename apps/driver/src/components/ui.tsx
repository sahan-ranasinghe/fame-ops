// Building blocks shared by all screens, following the Fame Fleet design:
// big targets, few words, strong contrast (readable in sunlight).

import { Check, type LucideIcon } from '@/components/icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

import type { Language } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, fonts, hoverStyle } from '@/theme';

type Weight = 'regular' | 'medium' | 'strong' | 'bold' | 'heading';

// English: IBM Plex Sans + Archivo for headings. Sinhala: Yaldevi + Gemunu Libre.
const FAMILY: Record<Language, Record<Weight, string>> = {
  en: { regular: fonts.body, medium: fonts.bodyMedium, strong: fonts.bodySemiBold, bold: fonts.bodyBold, heading: fonts.heading },
  si: {
    regular: fonts.sinhalaBody,
    medium: fonts.sinhalaBody,
    strong: fonts.sinhalaBodySemiBold,
    bold: fonts.sinhalaBodySemiBold,
    heading: fonts.sinhalaHeadingExtraBold,
  },
};

const VARIANTS = {
  body: { size: 17, weight: 'regular', color: colors.ink },
  muted: { size: 16, weight: 'regular', color: colors.muted },
  small: { size: 14, weight: 'regular', color: colors.muted },
  strong: { size: 17, weight: 'strong', color: colors.ink },
  big: { size: 20, weight: 'strong', color: colors.ink },
  label: { size: 13, weight: 'bold', color: colors.amberText },
  heading: { size: 22, weight: 'heading', color: colors.ink },
  title: { size: 30, weight: 'heading', color: colors.ink },
  button: { size: 19, weight: 'bold', color: colors.ink },
} as const satisfies Record<string, { size: number; weight: Weight; color: string }>;

export type Variant = keyof typeof VARIANTS;

interface TxtProps extends TextProps {
  variant?: Variant;
  color?: string;
  size?: number;
}

/** Text in the right font for the chosen language. */
export function Txt({ variant = 'body', color, size, style, selectable = false, ...rest }: TxtProps) {
  const { language } = useApp();
  const v = VARIANTS[variant];
  const fontSize = size ?? v.size;
  const base: TextStyle = {
    fontFamily: FAMILY[language][v.weight],
    fontSize,
    // Sinhala letters are taller than Latin ones.
    lineHeight: Math.round(fontSize * (language === 'si' ? 1.5 : 1.3)),
    color: color ?? v.color,
    // Wide letter spacing is a Latin small-caps look; it pulls Sinhala letters apart.
    letterSpacing: variant === 'label' && language === 'en' ? 1.4 : 0,
  };
  // Not selectable unless asked (the phone's default; a browser would select a button's words on a long press).
  return <Text {...rest} selectable={selectable} style={[base, style]} />;
}

/** Plates, times, odometer numbers: always mono, always Latin digits. */
export function Mono({ size = 17, color = colors.ink, bold = false, selectable = false, style, ...rest }: TextProps & { size?: number; color?: string; bold?: boolean }) {
  return <Text {...rest} selectable={selectable} style={[{ fontFamily: bold ? fonts.monoSemiBold : fonts.mono, fontSize: size, color }, style]} />;
}

/** A number plate in its thin bordered chip. */
export function Plate({ regNo, dark = false }: { regNo: string; dark?: boolean }) {
  return (
    <View style={[styles.plate, dark && { borderColor: '#5a6068' }]}>
      <Mono size={15} bold color={dark ? '#ffffff' : colors.ink}>{regNo}</Mono>
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'dark' | 'outline' | 'danger-text';
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** primary = amber (the main action of a screen), dark = ink, outline = secondary. */
export function Button({ label, onPress, kind = 'primary', icon: Icon, disabled = false, busy = false, style, testID }: ButtonProps) {
  const text = kind === 'dark' ? '#ffffff' : kind === 'danger-text' ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={(state) => [
        styles.button,
        kind === 'primary' && { backgroundColor: colors.amber },
        kind === 'dark' && { backgroundColor: colors.ink },
        kind === 'outline' && { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line },
        kind === 'danger-text' && { minHeight: 52 },
        hoverStyle(state),
        (disabled || busy) && { opacity: 0.45 },
        state.pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={text} /> : Icon ? <Icon size={22} color={text} strokeWidth={2.4} /> : null}
      <Txt variant="button" color={text} style={{ textAlign: 'center', flexShrink: 1 }}>{label}</Txt>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A labelled text box. `mono` for numbers. */
export function Field({ label, mono = false, style, ...input }: TextInputProps & { label: string; mono?: boolean }) {
  const { language } = useApp();
  return (
    <View style={{ flex: 1 }}>
      <Txt variant="strong" size={16} style={{ marginBottom: 8 }}>{label}</Txt>
      <TextInput
        placeholderTextColor="#9aa0a6"
        {...input}
        style={[styles.input, { fontFamily: mono ? fonts.mono : FAMILY[language].regular }, style]}
      />
    </View>
  );
}

/** Two choices side by side, as in "Did you add fuel?  Yes | No". The picked one: a check, the blue chip tint and a 2 px
 *  blue border (Material 3's segmented button; the selection rules in components/patterns/Select.tsx). `value` null: none
 *  picked yet (an optional question, Round 4–7's "Enough fuel?"); a longer label wraps inside its half. */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.segmented}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, selected: on }}
            onPress={() => onChange(option.value)}
            style={(state) => [styles.segment, on && styles.segmentOn, hoverStyle(state)]}
          >
            {on && <Check size={20} color={colors.blue} strokeWidth={3} />}
            <Txt variant="button" size={18} color={on ? colors.blue : colors.ink} style={{ flexShrink: 1, textAlign: 'center' }}>{option.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A short coloured line for problems ("Enter the odometer reading.") or notes. */
export function Notice({ text, tone = 'warn' }: { text: string; tone?: 'warn' | 'danger' | 'info' }) {
  const color = tone === 'danger' ? colors.red : tone === 'info' ? colors.blue : colors.amberText;
  const background = tone === 'danger' ? '#fbeceb' : tone === 'info' ? colors.blueChip : '#fdf1d6';
  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <Txt variant="strong" size={15} color={color}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  button: {
    minHeight: 64,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
  },
  input: {
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 19,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  segment: { flex: 1, minHeight: 56, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderWidth: 2, borderColor: 'transparent' },
  segmentOn: { backgroundColor: colors.blueChip, borderColor: colors.blue },
  notice: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
});
