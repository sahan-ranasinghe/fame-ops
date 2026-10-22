// Office mode (Phase 8, O2): the trip editor's frame (designs 06–09): the header with "New trip · step N of 4", the
// step's name, the four progress bars, the back arrow (one step back: the previous step, or out of the flow on the first),
// "Save draft" (the draft is kept anyway; the word says so and leaves), and the sticky primary button at the bottom.
// Round 4–7, item 12: on the approved mockups' thin top bar and bottom bar (components/patterns).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ArrowRight } from '@/components/icons';
import { BottomActionBar } from '@/components/patterns/BottomActionBar';
import { look } from '@/components/patterns/look';
import { TopBar } from '@/components/patterns/TopBar';
import { Button, Txt } from '@/components/ui';
import { type Step, stepIndex, STEPS, type TripMode } from '@/office/trip/draft';
import { useApp } from '@/state/app';
import { useWebThemeColor } from '@/office/ui';
import { colors } from '@/theme';

export function TripHeader({ step, above, onBack, onSaveDraft, mode }: { step: Step; above: string; onBack: () => void; onSaveDraft?: () => void; mode?: TripMode }) {
  const { t } = useApp();
  useWebThemeColor(colors.page);
  // A task's stops (mode stops) have three steps: no Who bar.
  const bars = mode === 'stops' ? STEPS.filter((x) => x !== 'who') : STEPS;
  const i = mode === 'stops' ? bars.indexOf(step) : stepIndex(step);
  // Round 4–7, item 12 (the approved mockup 2): the thin top bar (the round back, "New trip · step 4 of 4" small above the
  // step's name), Save draft at the right, the step bars under it.
  return (
    <TopBar
      onBack={onBack}
      backLabel={t('common.back')}
      above={above}
      title={t(`office.trip.step_${step}`)}
      testID="trip-header"
      right={onSaveDraft ? (
        <Pressable accessibilityRole="button" onPress={onSaveDraft} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Txt variant="strong" size={15} color={colors.blue}>{t('office.trip.saveDraft')}</Txt>
        </Pressable>
      ) : undefined}
    >
      <View style={{ flexDirection: 'row', gap: 6 }} testID="trip-steps">
        {bars.map((s, j) => <View key={s} style={[styles.bar, j <= i && { backgroundColor: colors.amber }]} />)}
      </View>
    </TopBar>
  );
}

/**
 * The sticky Next (or Send) button; `problem` under it when the step cannot go on. Round 4–7, item 12: the one bottom bar
 * (components/patterns/BottomActionBar.tsx): Back (outlined) beside the primary when `onBack` is given and there is no
 * second action, the primary with its arrow, the reason under them.
 */
export function TripFooter({ label, onPress, disabled, busy, problem, children, secondary, onBack }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  problem?: string | null;
  children?: ReactNode;
  /** A second, outlined button beside the primary one (Review's "Save as waiting" beside "Book now"). */
  secondary?: { label: string; onPress: () => void; disabled?: boolean };
  /** Back beside the primary (Review, the approved mockup 2): the step before, as the top bar's back does. */
  onBack?: () => void;
}) {
  const { t } = useApp();
  return (
    <BottomActionBar
      primary={{ label, onPress, disabled, busy, icon: ArrowRight, testID: 'trip-primary' }}
      secondary={secondary ? { label: secondary.label, onPress: secondary.onPress, disabled: secondary.disabled || busy, testID: 'trip-secondary' } : onBack ? { label: t('common.back'), onPress: onBack, disabled: busy, testID: 'trip-back' } : undefined}
      reason={problem}
      reasonTone="red"
      testID="trip-footer"
    >
      {children}
    </BottomActionBar>
  );
}

const styles = StyleSheet.create({
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: look.ring },
});

/** The departure check's line (the site's DepartureNote): red or amber, "Use HH:MM", and Move arrive-by / back-by when offered. */
export function DepartureNote({ text, tone, useLabel, onUse, moveLabel, onMove }: { text: string; tone: 'bad' | 'warn'; useLabel: string; onUse: () => void; moveLabel?: string; onMove?: () => void }) {
  const ink = tone === 'bad' ? colors.red : colors.amberText;
  return (
    <View style={[noteStyles.note, { backgroundColor: tone === 'bad' ? colors.redChip : colors.amberChip }]}>
      <Txt variant="strong" size={16} color={ink}>{text}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button label={useLabel} onPress={onUse} style={{ minHeight: 48, paddingHorizontal: 14 }} />
        {moveLabel && onMove && <Button kind="outline" label={moveLabel} onPress={onMove} style={{ minHeight: 48, paddingHorizontal: 14, borderColor: ink }} />}
      </View>
    </View>
  );
}

const noteStyles = StyleSheet.create({
  note: { borderRadius: 14, padding: 14, gap: 10 },
});
