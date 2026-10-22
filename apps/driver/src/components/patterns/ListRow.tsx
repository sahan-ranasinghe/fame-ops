// Round 4–7, item 12 (the approved mockups; Gmail's list rows, item 8's rules): the ONE list row of Office mode and /m/.
// On the left an icon tile, an avatar or a mono time column; ONE title line; ONE grey meta line (a second line only where a
// screen always had it); at the right only a small chip, a link or a button, and a chevron when the row opens a place. Every
// list of Office mode draws it (office/ui.tsx `Row` is this component). `inset` gives the row its own side padding, for a
// card whose rows run edge to edge with a divider between them (Home's sections, the request's best match).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, type LucideIcon } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';
import { look, TINT, type ToneName } from './look';

/** A row's short status at the right (Gmail's label): one short word, never a sentence; it never squeezes the title. */
export function RowChip({ text, tone = 'muted', icon: Icon, testID }: { text: string; tone?: ToneName; icon?: LucideIcon; testID?: string }) {
  const c = TINT[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }, Icon && styles.withIcon]} testID={testID}>
      {Icon && <Icon size={13} color={c.ink} strokeWidth={2.4} />}
      <Txt variant="strong" size={13} color={c.ink} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/** A plate in a row: mono inside a thin bordered chip (the README's plate chip), small beside a name. */
export function RowPlate({ regNo }: { regNo: string }) {
  return (
    <View style={styles.plate}>
      <Mono size={12} color={colors.ink} numberOfLines={1}>{regNo}</Mono>
    </View>
  );
}

/** The 40 px tinted tile with an icon at a row's left (a request to approve, a trip without a driver, a document). */
export function RowIcon({ icon: Icon, tone = 'muted', size = 40 }: { icon: LucideIcon; tone?: ToneName | 'quiet'; size?: number }) {
  const bg = tone === 'quiet' ? look.quiet : TINT[tone].bg;
  const ink = tone === 'quiet' ? look.quietInk : TINT[tone].ink;
  return (
    <View style={[styles.icon, { width: size, height: size, backgroundColor: bg }]}>
      <Icon size={Math.round(size / 2)} color={ink} strokeWidth={2} />
    </View>
  );
}

export function ListRow({ left, time, title, titleAfter, line, line2, line2Warn = false, chip, right, onPress, chevron = false, inset = false, testID, quiet = false }: {
  left?: ReactNode;
  /** "09:30": a mono time column on the left. */
  time?: string;
  title: string;
  /** Beside the title on its line (a plate chip). */
  titleAfter?: ReactNode;
  line?: string;
  line2?: string;
  /** The second line warns (amber text): "Self-drive · no licence on file" (Round 3). */
  line2Warn?: boolean;
  /** The short status ("Sent", "Seen", "Late 12 min"). */
  chip?: { text: string; tone?: ToneName } | null;
  right?: ReactNode;
  onPress?: () => void;
  /** A chevron at the right: the row opens its own place (Home's rows). */
  chevron?: boolean;
  /** The row's own side padding (rows edge to edge in a card). */
  inset?: boolean;
  testID?: string;
  /** Round 3: a quieter row (the Activity log's routine actions): the title in the regular weight, in grey. */
  quiet?: boolean;
}) {
  const inner = (
    <>
      {time !== undefined ? <View style={styles.timeCol}><Mono size={15} bold={!quiet} color={quiet ? colors.muted : undefined}>{time}</Mono></View> : null}
      {left}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        {titleAfter ? (
          <View style={styles.titleRow}>
            <Txt variant={quiet ? 'muted' : 'strong'} size={16} numberOfLines={1} style={{ flexShrink: 1 }}>{title}</Txt>
            {titleAfter}
          </View>
        ) : <Txt variant={quiet ? 'muted' : 'strong'} size={16} numberOfLines={1}>{title}</Txt>}
        {line ? <Txt variant="muted" size={14} numberOfLines={1}>{line}</Txt> : null}
        {line2 ? <Txt variant="small" size={13} numberOfLines={1} color={line2Warn ? colors.amberText : undefined}>{line2}</Txt> : null}
      </View>
      {chip ? <RowChip text={chip.text} tone={chip.tone} /> : null}
      {right}
      {chevron && onPress ? <ChevronRight size={18} color={colors.muted} strokeWidth={2} /> : null}
    </>
  );
  const box = [styles.row, inset && styles.inset];
  if (!onPress) return <View style={box} testID={testID}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={(state) => [...box, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  inset: { paddingHorizontal: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  timeCol: { width: 52 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 120, flexShrink: 0 },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  plate: { borderWidth: 1, borderColor: colors.ink, borderRadius: 5, paddingHorizontal: 5, flexShrink: 0 },
});
