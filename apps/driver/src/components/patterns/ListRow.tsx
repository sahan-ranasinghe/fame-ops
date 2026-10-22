// Round 4–7, item 12 (the approved mockups; Gmail's list rows, item 8's rules): the ONE list row of Office mode and /m/.
// On the left an icon tile, an avatar or a mono time column; ONE title line; ONE grey meta line (a second line only where a
// screen always had it); at the right only a small chip, a link or a button, and a chevron when the row opens a place. Every
// list of Office mode draws it (office/ui.tsx `Row` is this component). `inset` gives the row its own side padding, for a
// card whose rows run edge to edge with a divider between them (Home's sections, the request's best match).
// The app's other lists draw it too (one row per codebase, review of Round 4–7): the driver's task rows, Fuel / Mileage
// rows and reports, and Office mode's Issues. What they need beyond the plain row is optional and draws nothing when not
// given: a mono title (litres and km), a two-line title, a plate chip at the start of the grey line and a status chip at
// its end (`lineLead`, `lineChip`), the second line in a tone, lines under them (`below`: the Google credit, Changed, the
// office's reply), a long press and the ticked look (Issues' bulk actions), and the screen reader's line.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, type LucideIcon } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';
import { look, TINT, type ToneName } from './look';
import { pickedStyle } from './Select';

/**
 * A row's short status at the right (Gmail's label): one short word, never a sentence; it never squeezes the title. The one
 * status chip of the app (the driver's "Leave in 25 min" beside Next task too): `wide` lets it take the room its line has
 * (a heading's chip, the chip at the end of a grey line) instead of 120 px.
 */
export function RowChip({ text, tone = 'muted', icon: Icon, wide = false, testID }: { text: string; tone?: ToneName; icon?: LucideIcon; wide?: boolean; testID?: string }) {
  const c = TINT[tone];
  return (
    <View style={[styles.chip, wide && styles.wide, { backgroundColor: c.bg }, Icon && styles.withIcon]} testID={testID}>
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

export function ListRow({
  left, time, title, titleAfter, titleMono = false, titleLines = 1, line, lineLead, lineChip, line2, line2Warn = false, line2Tone, below, chip, right, onPress, onLongPress,
  selected = false, chevron = false, inset = false, testID, quiet = false, accessibilityLabel,
}: {
  left?: ReactNode;
  /** "09:30": a mono time column on the left. */
  time?: string;
  title: string;
  /** Beside the title on its line (a plate chip). */
  titleAfter?: ReactNode;
  /** The title in mono (numbers: "32.5 L · LKR 12,400", "45,210 km"). */
  titleMono?: boolean;
  /** Two lines for a title that is a sentence (an issue's headline). */
  titleLines?: 1 | 2;
  line?: string;
  /** At the start of the grey line (a plate chip: "WP CAB-4521 · Kamal · 2 h ago"). */
  lineLead?: ReactNode;
  /** At the end of the grey line, its status (the driver's rows: "Not accepted yet", a report's "Open"). */
  lineChip?: { text: string; tone?: ToneName } | null;
  line2?: string;
  /** The second line warns (amber text): "Self-drive · no licence on file" (Round 3). */
  line2Warn?: boolean;
  /** The second line in a tone (a fill's video: blue going up, red failed); line2Warn is the amber one. */
  line2Tone?: ToneName;
  /** Under the lines (the Google credit, "Changed", the office's reply to a report). */
  below?: ReactNode;
  /** The short status ("Sent", "Seen", "Late 12 min"). */
  chip?: { text: string; tone?: ToneName } | null;
  right?: ReactNode;
  onPress?: () => void;
  /** Hold the row (Issues: tick it for the bulk actions). */
  onLongPress?: () => void;
  /** Ticked (Gmail's selected row: a blue tint). */
  selected?: boolean;
  /** A chevron at the right: the row opens its own place (Home's rows). */
  chevron?: boolean;
  /** The row's own side padding (rows edge to edge in a card). */
  inset?: boolean;
  testID?: string;
  /** Round 3: a quieter row (the Activity log's routine actions): the title in the regular weight, in grey. */
  quiet?: boolean;
  /** What a screen reader says for the whole row. */
  accessibilityLabel?: string;
}) {
  const titleText = titleMono
    ? <Mono size={17} bold numberOfLines={titleLines} style={titleAfter ? { flexShrink: 1 } : undefined}>{title}</Mono>
    : <Txt variant={quiet ? 'muted' : 'strong'} size={16} numberOfLines={titleLines} style={titleAfter ? { flexShrink: 1 } : undefined}>{title}</Txt>;
  const lineText = line ? <Txt variant="muted" size={14} numberOfLines={1} style={lineLead || lineChip ? { flexShrink: 1 } : undefined}>{line}</Txt> : null;
  const inner = (
    <>
      {time !== undefined ? <View style={styles.timeCol}><Mono size={15} bold={!quiet} color={quiet ? colors.muted : undefined}>{time}</Mono></View> : null}
      {left}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        {titleAfter ? (
          <View style={styles.titleRow}>
            {titleText}
            {titleAfter}
          </View>
        ) : titleText}
        {lineLead || lineChip ? (
          <View style={styles.lineRow}>
            {lineLead}
            {lineText}
            {lineChip ? <RowChip text={lineChip.text} tone={lineChip.tone} wide /> : null}
          </View>
        ) : lineText}
        {line2 ? <Txt variant="small" size={13} numberOfLines={1} color={line2Tone ? TINT[line2Tone].ink : line2Warn ? colors.amberText : undefined}>{line2}</Txt> : null}
        {below}
      </View>
      {chip ? <RowChip text={chip.text} tone={chip.tone} /> : null}
      {right}
      {chevron && onPress ? <ChevronRight size={18} color={colors.muted} strokeWidth={2} /> : null}
    </>
  );
  const box = [styles.row, inset && styles.inset, selected && styles.selected, selected && !inset && styles.selectedPad];
  if (!onPress && !onLongPress) return <View style={box} testID={testID} accessibilityLabel={accessibilityLabel}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} onLongPress={onLongPress} testID={testID} style={(state) => [...box, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  inset: { paddingHorizontal: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  // The app's one selection look (patterns/Select.tsx): the tint and the border of a picked thing.
  selected: { ...pickedStyle, borderRadius: 12 },
  selectedPad: { paddingHorizontal: 6 },
  wide: { maxWidth: '100%', flexShrink: 1 },
  timeCol: { width: 52 },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 120, flexShrink: 0 },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  plate: { borderWidth: 1, borderColor: colors.ink, borderRadius: 5, paddingHorizontal: 5, flexShrink: 0 },
});
