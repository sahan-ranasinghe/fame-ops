// Office mode (Phase 8, O1): the building blocks the office screens share, in the driver app's tokens and components
// (components/ui.tsx) and the designs' look (design/office): the dark header with the date and the bell, section cards
// with a title, a count and "View all", rows with an avatar, status pills, chips, a sticky action bar, and the one way a
// failed call is shown (a notice with Try again; a dropped write says it may not have been saved).

import { useFocusEffect, useRouter } from 'expo-router';
import { type ReactNode, type Ref, useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bell, ChevronDown, ChevronLeft, ChevronRight, type LucideIcon, Plus } from '@/components/icons';
import { ChoiceChip } from '@/components/patterns/Select';
import { Sheet } from '@/components/patterns/Sheet';
import { setSnackbarLift } from '@/components/patterns/Snackbar';
import { ListError } from '@/components/patterns/ListState';
import { Button, Mono, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle, setWebThemeColor, webHitSlop } from '@/theme';
import { useOffice } from './state';
import { errorText, initials } from './text';
import type { FleetError } from './types';

/** The tone of a status pill or chip (the designs' colours). */
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'muted';

const TONES: Record<Tone, { bg: string; ink: string }> = {
  blue: { bg: colors.blueChip, ink: colors.blue },
  green: { bg: colors.greenChip, ink: colors.green },
  amber: { bg: colors.amberChip, ink: colors.amberText },
  red: { bg: colors.redChip, ink: colors.red },
  muted: { bg: '#ebe9e3', ink: colors.muted },
};

/** A small rounded status word ("on the way", "waiting", "free"); `icon` before it for a state of its own (Expired, Round 3). */
export function Pill({ text, tone = 'muted', size = 14, icon: Icon }: { text: string; tone?: Tone; size?: number; icon?: LucideIcon }) {
  const c = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, Icon && styles.withIcon]}>
      {Icon && <Icon size={size} color={c.ink} strokeWidth={2.4} />}
      <Txt variant="strong" size={size} color={c.ink} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/**
 * The header's numbers as one row of compact tiles (Shopify's, Stripe's and Uber Fleet's stat tiles, 21 October 2026): a
 * big number, a small label on one line, each tile opening its list. Replaces the row of chips under a dark header.
 */
export function StatTiles({ tiles, light = false }: { tiles: { key: string; n: number; label: string; tone?: 'blue' | 'muted' | 'amber' | 'red'; onPress?: () => void }[]; light?: boolean }) {
  // Round 2b: light = the compact strip in the page (Shopify / Uber Fleet), not a dark block.
  const ink = light
    ? ({ blue: colors.blue, muted: colors.ink, amber: colors.amberText, red: colors.red } as const)
    : ({ blue: '#9db8ea', muted: '#ffffff', amber: '#f7c85a', red: '#ff8a80' } as const);
  return (
    <View style={[styles.tiles, light && { marginTop: 0 }]} testID="stat-tiles">
      {tiles.map((x) => (
        <Pressable key={x.key} accessibilityRole="button" accessibilityLabel={`${x.n} ${x.label}`} onPress={x.onPress} disabled={!x.onPress}
          style={(state) => [styles.tile, light && styles.tileLight, hoverStyle(state), state.pressed && { opacity: 0.8 }]} testID={`stat-${x.key}`}>
          <Mono size={24} bold color={ink[x.tone ?? 'muted']}>{String(x.n)}</Mono>
          <Txt variant="small" color={light ? colors.muted : '#c9ccd1'} numberOfLines={1}>{x.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** A header chip ("3 on the road"): a number in mono and words. */
export function Chip({ n, text, tone = 'muted', onPress }: { n: number | string; text: string; tone?: Tone; onPress?: () => void }) {
  const c = TONES[tone];
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={(state) => [styles.chip, { backgroundColor: c.bg }, hoverStyle(state)]}>
      <Mono size={15} bold color={c.ink}>{String(n)}</Mono>
      <Txt variant="strong" size={14} color={c.ink}>{text}</Txt>
    </Pressable>
  );
}

/** The dark header of a tab screen (designs 02–05): a line above, the big title, and what comes under it (the chips). */
export function DarkHeader({ above, title, children, bell = true }: { above: string; title: string; children?: ReactNode; bell?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unread } = useOffice();
  useWebThemeColor(colors.ink);
  return (
    <View style={[styles.dark, { paddingTop: insets.top + 12 }]}>
      <View style={styles.darkTop}>
        <Txt variant="muted" size={15} color="#c9ccd1" style={{ flex: 1 }} numberOfLines={1}>{above}</Txt>
        {bell && <BellButton count={unread} onPress={() => router.push('/office/(tabs)/alerts')} />}
      </View>
      <Txt variant="title" color="#ffffff" style={{ marginTop: 8 }} numberOfLines={1}>{title}</Txt>
      {children}
    </View>
  );
}

/** The bell with the unread count (the Alerts badge; DarkHeader reads it from the office state). */
export function BellButton({ onPress, count = 0, light = false }: { onPress: () => void; count?: number; light?: boolean }) {
  const { t } = useApp();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('office.tabs.alerts')} onPress={onPress} style={(state) => [styles.bell, light && styles.bellLight, hoverStyle(state)]} testID="bell">
      <Bell size={22} color={light ? colors.ink : '#ffffff'} strokeWidth={2.2} />
      {count > 0 && <Badge n={count} />}
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  return (
    <View style={styles.badge} testID="badge">
      <Mono size={12} bold color="#ffffff">{n > 99 ? '99+' : String(n)}</Mono>
    </View>
  );
}

/**
 * Round 2b: Home's thin top bar (Gmail / Uber Fleet): the greeting and the date in small text, the bell. It stays thin
 * while the page scrolls under it; the counts and the lists live in the page.
 */
export function TopBar({ greeting, date }: { greeting: string; date: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unread } = useOffice();
  useWebThemeColor(colors.page);
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} testID="top-bar">
      <View style={{ flex: 1 }}>
        <Txt variant="strong" size={17} numberOfLines={1}>{greeting}</Txt>
        <Txt variant="small" numberOfLines={1}>{date}</Txt>
      </View>
      <BellButton light count={unread} onPress={() => router.push('/office/(tabs)/alerts')} />
    </View>
  );
}

/**
 * Round 2b: the one floating "+ New trip" button (Gmail's Compose, Google Calendar's +): bottom right, above the tab bar.
 * With one choice it opens it; with two, a small sheet asks which.
 */
export function NewTripButton({ choices }: { choices: { key: string; label: string; onPress: () => void }[] }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  if (choices.length === 0) return null;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('office.home.newTrip')} onPress={() => (choices.length === 1 ? choices[0].onPress() : setOpen(true))}
        style={(state) => [styles.fab, hoverStyle(state), state.pressed && { opacity: 0.85 }]} testID="new-trip">
        <Plus size={22} color={colors.ink} strokeWidth={2.6} />
        <Txt variant="strong" size={16}>{t('office.home.newTrip')}</Txt>
      </Pressable>
      <Sheet visible={open} title={t('office.home.newTrip')} onClose={() => setOpen(false)} testID="new-trip-sheet">
        <View style={{ gap: 10 }}>
          {choices.map((c, i) => (
            <Button key={c.key} kind={i === 0 ? 'primary' : 'outline'} label={c.label} onPress={() => { setOpen(false); c.onPress(); }} style={{ minHeight: 56 }} testID={`new-trip-${c.key}`} />
          ))}
        </View>
      </Sheet>
    </>
  );
}

/** A stack screen's top: the back arrow (back means back) and the title. */
export function BackHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useApp();
  useWebThemeColor(colors.page);
  return (
    <View style={[styles.backHeader, { paddingTop: insets.top + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office'))} style={(state) => [styles.backBtn, hoverStyle(state)]}>
        <ChevronLeft size={28} color={colors.ink} strokeWidth={2.4} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt variant="heading" numberOfLines={1}>{title}</Txt>
        {subtitle ? <Txt variant="small" numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

/** A scrolling screen with pull to refresh. */
export function Screen({ children, refreshing, onRefresh, bottom = 24, style, scrollRef }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottom?: number;
  style?: StyleProp<ViewStyle>;
  /** A handle for a screen that scrolls itself on a tap (Approve's "New requests ↑"). */
  scrollRef?: Ref<ScrollView>;
}) {
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={[{ padding: 16, gap: 14, paddingBottom: bottom }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.amber]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A section card (design 03): "NEEDS A DRIVER · 1" with a link on the right, then the rows. Round 4–7 (item 8): a group
 * of a list may collapse (`onToggle`: the heading is the button, a chevron says open or closed) and carry its severity
 * as a dot (`dot`, its words in `dotLabel` for the screen reader); `head` adds a control before the link (Select all).
 */
export function Section({ title, count, link, onLink, tone, children, open, onToggle, dot, dotLabel, head, testID }: {
  title: string;
  count?: number;
  link?: string;
  onLink?: () => void;
  tone?: 'red';
  children: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  dot?: Tone;
  dotLabel?: string;
  head?: ReactNode;
  testID?: string;
}) {
  const label = (
    <>
      {onToggle ? (open === false ? <ChevronRight size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />) : null}
      {dot ? <View style={[styles.dot, { backgroundColor: TONES[dot].ink }]} accessibilityLabel={dotLabel} /> : null}
      <Txt variant="label" color={tone === 'red' ? colors.red : colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{title.toUpperCase()}</Txt>
      {count !== undefined && <Mono size={13} bold color={tone === 'red' ? colors.red : colors.muted}>{`· ${count}`}</Mono>}
    </>
  );
  return (
    <View style={[styles.section, tone === 'red' && { borderColor: colors.red }]} testID={testID}>
      <View style={[styles.sectionHead, onToggle && open === false && { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 0 }]}>
        {onToggle ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open !== false }} onPress={onToggle} testID={testID ? `${testID}-toggle` : undefined}
            style={(state) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minHeight: 44 }, hoverStyle(state)]}>
            {label}
          </Pressable>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>{label}</View>
        )}
        {head}
        {link && onLink && (
          <Pressable accessibilityRole="button" onPress={onLink} hitSlop={10} style={(state) => [webHitSlop(10), hoverStyle(state)]} testID={testID ? `${testID}-link` : undefined}>
            <Txt variant="strong" size={16} color={colors.blue}>{link}</Txt>
          </Pressable>
        )}
      </View>
      {onToggle && open === false ? null : children}
    </View>
  );
}

/** The two-letter avatar of a person. */
export function Avatar({ name, size = 40, photo }: { name: string; size?: number; /** The person's photo (a link); the initials without one. */ photo?: string }) {
  if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.blueChip }} accessibilityLabel={name} />;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Txt variant="strong" size={Math.round(size * 0.38)} color={colors.blue}>{initials(name)}</Txt>
    </View>
  );
}

/**
 * A list row's short status at the right (Gmail's label): one short word, never a sentence; it never squeezes the title.
 * `icon` before the word marks a state of its own (Round 3 A6: Expired, a calendar with a cross; Material 3's assist chip).
 */
export function StatusChip({ text, tone = 'muted', icon: Icon, testID }: { text: string; tone?: Tone; icon?: LucideIcon; testID?: string }) {
  const c = TONES[tone];
  return (
    <View style={[styles.statusChip, { backgroundColor: c.bg }, Icon && styles.withIcon]} testID={testID}>
      {Icon && <Icon size={13} color={c.ink} strokeWidth={2.4} />}
      <Txt variant="strong" size={13} color={c.ink} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/**
 * The one list row (Gmail's list, 21 October 2026): a time column or an avatar on the left; the title on ONE line; a grey
 * second line (who · the status in words); at the right only a short StatusChip, or a button. Used by every list in
 * Office mode, on the phone and on /m/.
 */
export function Row({ left, time, title, line, line2, line2Warn = false, chip, right, onPress, testID, quiet = false }: {
  left?: ReactNode;
  /** "09:30": a mono time column on the left. */
  time?: string;
  title: string;
  line?: string;
  line2?: string;
  /** The second line warns (amber text): "Self-drive · no licence on file" (Round 3). */
  line2Warn?: boolean;
  /** The short status ("Sent", "Seen", "Late 12 min"). */
  chip?: { text: string; tone?: Tone } | null;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
  /** Round 3: a quieter row (the Activity log's routine actions): the title in the regular weight, in grey. */
  quiet?: boolean;
}) {
  const inner = (
    <>
      {time !== undefined ? <View style={styles.timeCol}><Mono size={15} bold={!quiet} color={quiet ? colors.muted : undefined}>{time}</Mono></View> : null}
      {left}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Txt variant={quiet ? 'muted' : 'strong'} size={17} numberOfLines={1}>{title}</Txt>
        {line ? <Txt variant="muted" size={15} numberOfLines={1}>{line}</Txt> : null}
        {line2 ? <Txt variant="small" numberOfLines={1} color={line2Warn ? colors.amberText : undefined}>{line2}</Txt> : null}
      </View>
      {chip ? <StatusChip text={chip.text} tone={chip.tone} /> : null}
      {right}
    </>
  );
  if (!onPress) return <View style={styles.row} testID={testID}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={(state) => [styles.row, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
}

/** The browser's theme colour while this screen is in front (theme.ts setWebThemeColor; nothing on the phone): the colour
 *  of the screen's top, as the phone's status bar shows it. */
export function useWebThemeColor(color: string) {
  useFocusEffect(useCallback(() => setWebThemeColor(color), [color]));
}

/** A thin line between rows. */
export const Divider = () => <View style={styles.divider} />;

/** The first load: a quiet line, not a spinner over the whole screen. */
export function Loading({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}>
      <ActivityIndicator color={colors.muted} />
      <Txt variant="muted">{text}</Txt>
    </View>
  );
}

/** A failed call: the sentence, the server's words when it gave them, and Try again when that would help. */
export function ErrorNotice({ error, onRetry, onSignIn }: { error: FleetError; onRetry?: () => void; onSignIn?: () => void }) {
  const { t } = useApp();
  const e = errorText(error);
  const text = e.words ? t(e.key, { words: e.words }) : t(e.key);
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Txt variant="strong" size={15} color={colors.red}>{text}</Txt>
      {e.fix === 'retry' && onRetry && <Button kind="outline" label={t('office.common.tryAgain')} onPress={onRetry} style={{ minHeight: 48 }} />}
      {e.fix === 'signin' && onSignIn && <Button kind="outline" label={t('office.common.signInAgain')} onPress={onSignIn} style={{ minHeight: 48 }} />}
    </View>
  );
}

/**
 * The list pattern's error (components/patterns/ListState.tsx ListError) in Office mode's words: the sentence from
 * errorText with Try again; with rows on screen (`stale`) "Couldn't refresh" over them. A signed-out session keeps
 * ErrorNotice (Sign in again instead of Try again).
 */
export function ListFailed({ error, onRetry, onSignIn, stale = false }: { error: FleetError; onRetry: () => void; onSignIn?: () => void; stale?: boolean }) {
  const { t } = useApp();
  const e = errorText(error);
  if (e.fix === 'signin') return <ErrorNotice error={error} onRetry={onRetry} onSignIn={onSignIn} />;
  return <ListError message={e.words ? t(e.key, { words: e.words }) : t(e.key)} onRetry={onRetry} stale={stale} />;
}

/** A line of text when a list is empty. */
export function Empty({ text }: { text: string }) {
  return <Txt variant="muted" style={{ padding: 8 }}>{text}</Txt>;
}

/** The big buttons at the bottom of a stack screen, above the safe area. */
export function StickyActions({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const height = useRef(0);
  const focused = useRef(false);
  // While this screen is in front, the snackbar sits above these buttons (Hotfix O2-H2).
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (height.current) setSnackbarLift(height.current);
      return () => {
        focused.current = false;
        setSnackbarLift(0);
      };
    }, []),
  );
  return (
    <View
      style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, 12) }]}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
        if (focused.current) setSnackbarLift(height.current);
      }}
    >
      {children}
    </View>
  );
}

/** A filter chip row ("All · 4", "On a task · 1"): the shared ChoiceChip (the check, the tint, the border). */
export function FilterChips<K extends string>({ options, value, onChange }: { options: { key: K; label: string; n?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <ChoiceChip key={o.key} label={o.label} selected={on} onPress={() => onChange(o.key)} after={o.n !== undefined ? <Mono size={14} bold color={on ? colors.blue : colors.muted}>{String(o.n)}</Mono> : undefined} />
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tile: { flex: 1, backgroundColor: colors.darkSurface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  tileLight: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: colors.page, borderBottomWidth: 1, borderBottomColor: colors.line },
  bellLight: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  fab: { position: 'absolute', right: 16, bottom: 16, minHeight: 56, paddingHorizontal: 18, borderRadius: 28, backgroundColor: colors.amber, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  statusChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 112, flexShrink: 0 },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeCol: { width: 52 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  dark: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 16 },
  darkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bell: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  backHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 12, backgroundColor: colors.page },
  backBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  section: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  avatar: { backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  divider: { height: 1, backgroundColor: colors.line },
  errorBox: { backgroundColor: colors.redChip, borderRadius: 12, padding: 14, gap: 10 },
  sticky: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
});
