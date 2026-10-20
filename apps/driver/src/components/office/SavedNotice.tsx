// Hotfix O2-H2, Part 1b: the save's warnings and conflicts on the screen the person landed on (office/savedNotice.ts):
// an amber card "Saved with warnings", one line each, and OK to put it away.

import { Pressable, StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui';
import { dismissSavedNotice, useSavedNotice } from '@/office/savedNotice';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function SavedNotice({ noticeKey }: { noticeKey: string | null | undefined }) {
  const { t } = useApp();
  const notice = useSavedNotice(noticeKey);
  if (!notice || !noticeKey) return null;
  return (
    <View style={styles.card} testID="saved-notice" accessibilityRole="summary">
      <Txt variant="label" color={colors.amberText}>{(notice.title ?? t('office.saved.warningsTitle')).toUpperCase()}</Txt>
      {notice.lines.map((l, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{l}</Txt>)}
      <Pressable accessibilityRole="button" onPress={() => dismissSavedNotice(noticeKey)} style={styles.ok} testID="saved-notice-ok">
        <Txt variant="strong" size={15} color={colors.ink}>{t('office.common.ok')}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fdf1d6', borderRadius: 14, padding: 14, gap: 6, borderWidth: 1, borderColor: '#f1d89a' },
  ok: { alignSelf: 'flex-end', minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
});
