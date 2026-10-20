// A bottom sheet that asks "why?": a few big reasons, an optional word for the
// office, confirm. Used to skip a stop and to decline a task, and in Office mode to
// decline, cancel, reopen or withdraw. The back button or Cancel closes it. Since the
// Stage 0 review it is the shared Sheet (docs/ui-patterns.md §6).

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Sheet } from '@/components/patterns/Sheet';
import { Button, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

export interface ReasonOption<R extends string> {
  value: R;
  /** i18n key */
  label: string;
}

interface Props<R extends string> {
  visible: boolean;
  /** i18n keys */
  title: string;
  question: string;
  notePlaceholder: string;
  confirmLabel: string;
  /** Plain text under the title (a place name, a task title). */
  subtitle?: string | null;
  reasons: ReasonOption<R>[];
  onConfirm: (reason: R, note: string) => void;
  onClose: () => void;
}

export function ReasonSheet<R extends string>({ visible, title, question, notePlaceholder, confirmLabel, subtitle, reasons, onConfirm, onClose }: Props<R>) {
  const { t, language } = useApp();
  const [reason, setReason] = useState<R | null>(null);
  const [note, setNote] = useState('');

  function close() {
    setReason(null);
    setNote('');
    onClose();
  }
  function confirm() {
    if (!reason) return;
    onConfirm(reason, note);
    close();
  }

  return (
    <Sheet
      visible={visible}
      title={t(title)}
      onClose={close}
      testID="reason-sheet"
      actions={(
        <>
          <Button label={t('common.cancel')} kind="outline" onPress={close} style={{ flex: 1 }} />
          <Button label={t(confirmLabel)} kind="dark" disabled={reason === null} onPress={confirm} style={{ flex: 1 }} />
        </>
      )}
    >
      <View style={{ gap: 12 }}>
        {subtitle ? <Txt variant="muted">{subtitle}</Txt> : null}
        <Txt variant="strong">{t(question)}</Txt>
        <View style={{ gap: 8 }}>
          {reasons.map((r) => {
            const on = reason === r.value;
            return (
              <Pressable key={r.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setReason(r.value)} style={[styles.option, on && styles.optionOn]}>
                <View style={[styles.radio, on && { borderColor: colors.ink, backgroundColor: colors.ink }]} />
                <Txt variant="strong" size={18}>{t(r.label)}</Txt>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          placeholder={t(notePlaceholder)}
          placeholderTextColor="#9aa0a6"
          value={note}
          onChangeText={setNote}
          maxLength={200}
          style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 14 },
  optionOn: { borderColor: colors.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: '#8b9198' },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink },
});
