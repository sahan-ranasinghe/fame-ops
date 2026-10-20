// Hotfix O2-H2, Part 2: the rows of the Notifications screens. A switch row: a short title on one line, an optional one
// line under it in smaller grey text, the switch on the right (Instagram's and WhatsApp's settings rows); the whole row
// flips it. A link row: the title, its one-line summary and the arrow, opening its own screen.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { Txt } from '@/components/ui';
import { colors } from '@/theme';

export function SwitchRow({ title, text, value, onChange, disabled = false, testID }: {
  title: string;
  text?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, disabled && { opacity: 0.5 }]}
      testID={testID}
    >
      <View style={styles.words}>
        <Txt variant="strong" size={17} numberOfLines={1}>{title}</Txt>
        {text ? <Txt variant="muted" size={14} numberOfLines={1}>{text}</Txt> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.blue, false: colors.line }}
        thumbColor="#ffffff"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

export function LinkRow({ title, line, onPress, disabled = false, testID }: {
  title: string;
  line?: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, disabled && { opacity: 0.5 }]}
      testID={testID}
    >
      <View style={styles.words}>
        <Txt variant="strong" size={17} numberOfLines={1}>{title}</Txt>
        {line ? <Txt variant="muted" size={14} numberOfLines={1}>{line}</Txt> : null}
      </View>
      {!disabled && <ChevronRight size={22} color={colors.muted} />}
    </Pressable>
  );
}

/** A white card around rows, without a title (the Section card's look). */
export function RowCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 60 },
  words: { flex: 1, gap: 2 },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4 },
});
