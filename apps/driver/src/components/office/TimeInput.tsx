// Office mode (Phase 8, O2): a time field, HH:MM in mono (the designs' big time boxes): the digits typed get their colon,
// the value is committed when four digits are in or the field is left; an incomplete value is not committed (nothing
// plans on a half-typed time, as the site's TimeInput). Clear with the X.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { X } from '@/components/icons';
import { Txt } from '@/components/ui';
import { formatTyped, isTime } from '@/office/trip/timeLogic';
import { colors, fonts } from '@/theme';

export { formatTyped, isTime };

export function TimeInput({ value, onCommit, label, placeholder = '--:--', tone, testID }: {
  value: string;
  onCommit: (time: string) => void;
  label?: string;
  placeholder?: string;
  /** red: the departure check says it is late. */
  tone?: 'red';
  testID?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (v: string) => {
    if (v === '' || isTime(v)) onCommit(v);
  };
  return (
    <View style={{ flex: 1 }}>
      {label ? <Txt variant="label" color={colors.muted} style={{ marginBottom: 6 }}>{label.toUpperCase()}</Txt> : null}
      <View style={[styles.box, tone === 'red' && { borderColor: colors.red }]}>
        <TextInput
          testID={testID}
          value={text}
          onChangeText={(raw) => {
            const next = formatTyped(raw);
            setText(next);
            if (isTime(next)) commit(next);
          }}
          onBlur={() => commit(text)}
          keyboardType="number-pad"
          maxLength={5}
          placeholder={placeholder}
          placeholderTextColor="#9aa0a6"
          style={styles.input}
          accessibilityLabel={label}
        />
        {text !== '' && (
          <Pressable accessibilityRole="button" onPress={() => { setText(''); onCommit(''); }} hitSlop={8} style={styles.clear}>
            <X size={20} color={colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingLeft: 14 },
  input: { flex: 1, fontFamily: fonts.monoSemiBold, fontSize: 26, color: colors.ink, paddingVertical: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
