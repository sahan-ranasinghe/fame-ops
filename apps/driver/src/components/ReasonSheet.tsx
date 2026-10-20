// A bottom sheet that asks "why?": a few big reasons, an optional word for the
// office, confirm. Used to skip a stop and to decline a task. The back button
// or Cancel closes it.

import { useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceRow } from '@/components/patterns/Select';
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
  const insets = useSafeAreaInsets();
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.shade}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Txt variant="heading">{t(title)}</Txt>
          {subtitle ? <Txt variant="muted">{subtitle}</Txt> : null}
          <Txt variant="strong" style={{ marginTop: 6 }}>{t(question)}</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {reasons.map((r) => {
              const on = reason === r.value;
              return (
                <ChoiceRow key={r.value} selected={on} onPress={() => setReason(r.value)} accessibilityLabel={t(r.label)} testID={`reason-${r.value}`}>
                  <Txt variant="strong" size={18}>{t(r.label)}</Txt>
                </ChoiceRow>
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
          <Button label={t(confirmLabel)} kind="dark" disabled={reason === null} onPress={confirm} />
          <Button label={t('common.cancel')} kind="outline" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink },
});
