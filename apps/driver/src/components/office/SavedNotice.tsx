// Hotfix O2-H2, Part 1b: the save's warnings and conflicts on the screen the person landed on (office/savedNotice.ts):
// an amber card "Saved with warnings", one line each, and OK to put it away. Round 3: each line in the person's language
// (office/statusWords.ts: the assign and plan warnings, the conflicts; the English when a sentence is not known). Round 4–7
// (7): a conflict that names its holder is a card (components/office/HolderParts.tsx ConflictCard) under the lines.

import { Pressable, StyleSheet, View } from 'react-native';

import { ConflictCard } from '@/components/office/HolderParts';
import { Txt } from '@/components/ui';
import { dismissSavedNotice, useSavedNotice } from '@/office/savedNotice';
import { sentenceText } from '@/office/statusWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function SavedNotice({ noticeKey }: { noticeKey: string | null | undefined }) {
  const { t } = useApp();
  const notice = useSavedNotice(noticeKey);
  if (!notice || !noticeKey) return null;
  return (
    <View style={styles.card} testID="saved-notice" accessibilityRole="summary">
      <Txt variant="label" color={colors.amberText}>{(notice.title ?? t('office.saved.warningsTitle')).toUpperCase()}</Txt>
      {notice.lines.map((l, i) => <Txt key={i} variant="strong" size={15} color={colors.amberText}>{sentenceText(t, l)}</Txt>)}
      {/* Round 4–7 (7): a conflict that names who holds the driver or vehicle, with Call, WhatsApp and Ask for it. */}
      {notice.conflicts?.map((c, i) => <ConflictCard key={`${c.kind}-${c.task?.id ?? i}`} c={c} testID={`saved-conflict-${i}`} />)}
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
