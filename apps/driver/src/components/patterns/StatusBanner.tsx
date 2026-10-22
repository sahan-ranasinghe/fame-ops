// Round 4–7, item 12 (the approved mockups 3 and 4; Uber's trip status card, Google Calendar's response banner): ONE status
// banner per screen, under the top bar: a round icon in the tone's solid colour, the state in one line ("Waiting for your
// OK", "On the way to Wariyapola"), one second line ("Leaves 09:29 · asked 1 h ago", "Arrives about 10:52 · updated 10:31")
// and, at the right, one short chip ("7 min late"). The tone says the state: amber waiting / late, blue live / on the way,
// green done / approved, red needs action, grey closed. A tap opens its place when there is one.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { LucideIcon } from '@/components/icons';
import { Txt } from '@/components/ui';
import { hoverStyle } from '@/theme';
import { look, TINT, type ToneName } from './look';

export function StatusBanner({ tone, icon: Icon, title, line, chip, children, onPress, testID = 'status-banner' }: {
  tone: ToneName;
  icon: LucideIcon;
  title: string;
  /** One second line (a node for a mono time inside the words). */
  line?: ReactNode;
  chip?: { text: string; tone: ToneName } | null;
  /** More lines under it (a reason, a second state). */
  children?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const c = TINT[tone];
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: c.solid }]}>
        <Icon size={20} color={c.onSolid} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt variant="strong" size={16} numberOfLines={2} testID={`${testID}-title`}>{title}</Txt>
        {line ? (typeof line === 'string' ? <Txt variant="body" size={14} color={c.sub} testID={`${testID}-line`}>{line}</Txt> : line) : null}
        {children}
      </View>
      {chip ? (
        <View style={[styles.chip, { backgroundColor: TINT[chip.tone].bg }]} testID={`${testID}-chip`}>
          <Txt variant="strong" size={13} color={TINT[chip.tone].ink} numberOfLines={1}>{chip.text}</Txt>
        </View>
      ) : null}
    </>
  );
  const box = [styles.banner, { backgroundColor: c.bg, borderColor: c.border }];
  if (!onPress) return <View style={box} testID={testID} accessibilityRole="summary">{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={(state) => [...box, hoverStyle(state), state.pressed && { opacity: 0.8 }]} testID={testID}>
      {body}
    </Pressable>
  );
}

/** The banner's second line with a time in mono inside the words ("Leaves 09:29 · asked 1 h ago"). */
export function BannerLine({ tone, children, testID }: { tone: ToneName; children: ReactNode; testID?: string }) {
  return <Txt variant="body" size={14} color={TINT[tone].sub} testID={testID}>{children}</Txt>;
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: look.radius, padding: 14 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 120, flexShrink: 0 },
});
