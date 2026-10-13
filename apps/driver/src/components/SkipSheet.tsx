// "Skip this stop?": the four reasons, an optional word for the office, confirm.
// A bottom sheet over the task screen; the back button or Cancel closes it.

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Txt } from '@/components/ui';
import type { TaskStop } from '@/lib/types';
import { type SkipReason, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const REASONS: { value: Exclude<SkipReason, 'not_visited'>; label: string }[] = [
  { value: 'closed', label: 'task.skipReason.closed' },
  { value: 'nobody_there', label: 'task.skipReason.nobodyThere' },
  { value: 'not_needed', label: 'task.skipReason.notNeeded' },
  { value: 'other', label: 'task.skipReason.other' },
];

export function SkipSheet({ stop, onClose }: { stop: TaskStop | null; onClose: () => void }) {
  const { t, language, skipStop } = useApp();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState('');

  function close() {
    setReason(null);
    setNote('');
    onClose();
  }
  function confirm() {
    if (!stop || !reason) return;
    skipStop(stop, reason, note);
    close();
  }

  return (
    <Modal visible={stop !== null} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.shade}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Txt variant="heading">{t('task.skipTitle')}</Txt>
          {stop && <Txt variant="muted">{stop.place_name}</Txt>}
          <Txt variant="strong" style={{ marginTop: 6 }}>{t('task.skipWhy')}</Txt>
          <View style={{ gap: 8 }}>
            {REASONS.map((r) => {
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
            placeholder={t('task.skipNote')}
            placeholderTextColor="#9aa0a6"
            value={note}
            onChangeText={setNote}
            maxLength={200}
            style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
          />
          <Button label={t('task.skipConfirm')} kind="dark" disabled={reason === null} onPress={confirm} />
          <Button label={t('common.cancel')} kind="outline" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, padding: 14 },
  optionOn: { borderColor: colors.ink },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: '#8b9198' },
  input: { minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 17, color: colors.ink },
});
