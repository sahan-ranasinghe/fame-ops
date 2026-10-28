// Office mode, Round 48 (item 1): the shared pieces of a proposed change (office/changeLogic.ts): the from → to rows
// of what changes, and the one line on a task, a board card or a needs-a-driver row ("Change waiting for approval ·
// Sashen · Driver Kamal (was Nuwan)") that opens the request (an approver decides there; the proposer reads it and may
// withdraw). The pattern is the changed booking's decide-again flow (Phase 6 Part 2).

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { changeLines, pendingChangeTarget, pendingChangeText } from '@/office/changeLogic';
import { useOffice } from '@/office/state';
import type { FieldChanges, PendingChange } from '@/office/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** Each change as "Driver · Nuwan Perera → Kamal Silva" (a field with a time or a plate in mono). */
export function ChangeLines({ changes, testID = 'change-lines' }: { changes?: FieldChanges | null; testID?: string }) {
  const { t } = useApp();
  const lines = changeLines(changes, t);
  if (lines.length === 0) return null;
  return (
    <View style={styles.lines} testID={testID}>
      {lines.map((l) => (
        <View key={l.label} style={styles.line}>
          <Txt variant="label" color={colors.muted} style={{ minWidth: 96 }}>{l.label.toUpperCase()}</Txt>
          <Mono size={15} bold style={{ flex: 1 }}>{l.text}</Mono>
        </View>
      ))}
    </View>
  );
}

/**
 * The pending change's line with its tap to the request. `compact` draws it as one amber line under a list row; else as a
 * card on the task page with "Decide it →" (an approver) or "Open the request →".
 */
export function PendingChangeLine({ change, compact = false, testID = 'pending-change' }: { change: PendingChange; compact?: boolean; testID?: string }) {
  const { t } = useApp();
  const { me } = useOffice();
  const router = useRouter();
  const open = () => router.push(pendingChangeTarget(change.request_id, me) as never);
  const text = pendingChangeText(change, t);
  const link = me.tools.includes('decide_request') ? t('office.change.decideIt') : t('office.change.openRequest');
  if (compact) {
    return (
      <Pressable accessibilityRole="button" onPress={open} hitSlop={6} style={styles.compact} testID={testID}>
        <Txt variant="strong" size={14} color={colors.amberText} numberOfLines={2}>{text}</Txt>
      </Pressable>
    );
  }
  return (
    <View style={styles.card} testID={testID}>
      <Txt variant="strong" size={15} color={colors.amberText}>{[text, change.at].filter(Boolean).join(' · ')}</Txt>
      <Pressable accessibilityRole="button" onPress={open} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID={`${testID}-open`}>
        <Txt variant="strong" size={16} color={colors.amberText}>{link}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  card: { backgroundColor: colors.amberChip, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  compact: { minHeight: 32, justifyContent: 'center', paddingTop: 2 },
});
