// Office mode (Phase 8, O2): the trip editor's frame (designs 06–09): the dark header with "New trip · step N of 4", the
// step's name, the four progress bars, the back arrow (one step back: the previous step, or out of the flow on the first),
// "Save draft" (the draft is kept anyway; the word says so and leaves), and the sticky primary button at the bottom.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, ChevronRight } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { type Step, stepIndex, STEPS, type TripMode } from '@/office/trip/draft';
import { useApp } from '@/state/app';
import { useWebThemeColor } from '@/office/ui';
import { colors } from '@/theme';

export function TripHeader({ step, above, onBack, onSaveDraft, mode }: { step: Step; above: string; onBack: () => void; onSaveDraft?: () => void; mode?: TripMode }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  useWebThemeColor(colors.ink);
  // A task's stops (mode stops) have three steps: no Who bar.
  const bars = mode === 'stops' ? STEPS.filter((x) => x !== 'who') : STEPS;
  const i = mode === 'stops' ? bars.indexOf(step) : stepIndex(step);
  return (
    <View style={[styles.dark, { paddingTop: insets.top + 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.back}>
          <ChevronLeft size={26} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt variant="muted" size={15} color="#c9ccd1" numberOfLines={1}>{above}</Txt>
          <Txt variant="title" size={30} color="#ffffff">{t(`office.trip.step_${step}`)}</Txt>
        </View>
        {onSaveDraft && (
          <Pressable accessibilityRole="button" onPress={onSaveDraft} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Txt variant="strong" size={16} color="#c9ccd1">{t('office.trip.saveDraft')}</Txt>
          </Pressable>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 14 }}>
        {bars.map((s, j) => <View key={s} style={[styles.bar, j <= i && { backgroundColor: colors.amber }]} />)}
      </View>
    </View>
  );
}

/** The sticky Next (or Send) button; `problem` under it when the step cannot go on. */
export function TripFooter({ label, onPress, disabled, busy, problem, children, secondary }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  problem?: string | null;
  children?: ReactNode;
  /** A second, outlined button beside the primary one (Review's "Save as waiting" beside "Book now"). */
  secondary?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {secondary ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button kind="outline" label={secondary.label} onPress={secondary.onPress} disabled={secondary.disabled || busy} style={{ flex: 1 }} />
          <Button label={label} icon={busy ? undefined : ChevronRight} onPress={onPress} disabled={disabled} busy={busy} style={{ flex: 1.3 }} />
        </View>
      ) : (
        <Button label={label} icon={busy ? undefined : ChevronRight} onPress={onPress} disabled={disabled} busy={busy} />
      )}
      {/* Part B (docs/design-pass.md R7): why the button waits, under it, as on every other action bar. */}
      {problem ? <Txt variant="strong" size={15} color={colors.red} testID="footer-problem">{problem}</Txt> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dark: { backgroundColor: colors.ink, paddingHorizontal: 16, paddingBottom: 16 },
  back: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.darkSurface },
  footer: { backgroundColor: colors.page, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 12, gap: 8 },
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
