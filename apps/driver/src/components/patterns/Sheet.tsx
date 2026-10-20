// The one bottom sheet (docs/ui-patterns.md §6): a grab handle, a title, the content scrolling inside, the actions fixed
// at the bottom, at most 85 % of the screen; the dimmed area, the back button or the close button closes it. Every sheet
// in the app (filters, dates, times, reasons, Ask drivers) is this one.

import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { X } from '@/components/icons';
import { Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function Sheet({ visible, title, onClose, children, actions, scroll = true, testID }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The buttons fixed at the bottom (Clear and Apply, Done…). */
  actions?: ReactNode;
  /** false when the content scrolls itself (a long list). */
  scroll?: boolean;
  testID?: string;
}) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.shade}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.close')} style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: height * 0.85, paddingBottom: Math.max(insets.bottom, 12) }]} testID={testID}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Txt variant="heading" size={22} style={{ flex: 1 }}>{title}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.close')} onPress={onClose} hitSlop={8} style={styles.close}>
              <X size={22} color={colors.ink} />
            </Pressable>
          </View>
          {scroll ? <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[styles.body, { flexShrink: 1 }]}>{children}</View>}
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(10,12,14,0.45)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingVertical: 8, gap: 14 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
});
