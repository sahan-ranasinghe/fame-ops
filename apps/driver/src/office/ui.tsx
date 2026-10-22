// Office mode (Phase 8, O1): the building blocks the office screens share, in the driver app's tokens and components
// (components/ui.tsx) and the designs' look (design/office): the dark header with the date and the bell, section cards
// with a title, a count and "View all", rows with an avatar, status pills, chips, a sticky action bar, and the one way a
// failed call is shown (a notice with Try again; a dropped write says it may not have been saved).
// Round 4–7, item 12 (the approved mockups of 22 October 2026): the thin top bar, the stats row, the list row, the sticky
// bottom bar and the New trip button are the shared patterns of components/patterns (TopBar, StatsRow, ListRow,
// BottomActionBar, NewTripFab); the names here (TopBar, BackHeader, StatTiles, Row, StatusChip, StickyActions,
// NewTripButton) wire them for Office mode (the bell's count, the browser's colour, back means back).

import { useFocusEffect, useRouter } from 'expo-router';
import { type ReactNode, type Ref, useCallback } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bell, ChevronDown, ChevronRight, type LucideIcon } from '@/components/icons';
import { BottomActionBar } from '@/components/patterns/BottomActionBar';
import { ListRow, RowChip } from '@/components/patterns/ListRow';
import { look } from '@/components/patterns/look';
import { NewTripFab } from '@/components/patterns/NewTripFab';
import { ChoiceChip } from '@/components/patterns/Select';
import { StatsRow } from '@/components/patterns/StatsRow';
import { TopBar as ThinBar } from '@/components/patterns/TopBar';
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
 * The header's numbers (Shopify's, Stripe's and Uber Fleet's stat tiles, 21 October 2026): each tile opening its list.
 * Round 4–7, item 12: the approved mockup's stats row (components/patterns/StatsRow.tsx): one card, each cell an icon and its
 * label in the tile's tone over the big number. `light` is kept for the callers (the strip in the page is the only look).
 */
export function StatTiles({ tiles }: { tiles: { key: string; n: number; label: string; tone?: 'blue' | 'green' | 'muted' | 'amber' | 'red'; icon?: LucideIcon; onPress?: () => void }[]; light?: boolean }) {
  return (
    <StatsRow
      testID="stat-tiles"
      itemTestID={(k) => `stat-${k}`}
      items={tiles.map((x) => ({ key: x.key, value: x.n, label: x.label, icon: x.icon, tone: x.tone ?? 'muted', onPress: x.onPress }))}
    />
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

/** The bell with the unread count (the Alerts badge; DarkHeader reads it from the office state). `light`: the thin top bar's
 *  round bell with a ring (the approved mockup 1). */
export function BellButton({ onPress, count = 0, light = false }: { onPress: () => void; count?: number; light?: boolean }) {
  const { t } = useApp();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('office.tabs.alerts')} onPress={onPress} style={(state) => [styles.bell, light && styles.bellLight, hoverStyle(state)]} testID="bell">
      <Bell size={light ? 20 : 22} color={light ? colors.ink : '#ffffff'} strokeWidth={2.2} />
      {count > 0 && <Badge n={count} small={light} />}
    </Pressable>
  );
}

export function Badge({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall]} testID="badge">
      <Mono size={small ? 10 : 12} bold color="#ffffff">{n > 99 ? '99+' : String(n)}</Mono>
    </View>
  );
}

/**
 * Round 2b: Home's thin top bar (Gmail / Uber Fleet). Round 4–7, item 12 (the approved mockup 1): the date small above the
 * greeting in the heading font, then the round bell with its count and the person's avatar (a tap opens My profile, as
 * Gmail's account picture does). The pattern: components/patterns/TopBar.tsx.
 */
export function TopBar({ greeting, date }: { greeting: string; date: string }) {
  const router = useRouter();
  const { unread, me } = useOffice();
  const { t } = useApp();
  useWebThemeColor(colors.page);
  return (
    <ThinBar
      above={date}
      title={greeting}
      right={(
        <>
          <BellButton light count={unread} onPress={() => router.push('/office/(tabs)/alerts')} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('office.more.profile')} onPress={() => router.push('/office/profile')}
            style={(state) => [hoverStyle(state), state.pressed && { opacity: 0.7 }]} testID="top-bar-avatar">
            <Avatar name={me.name} size={40} photo={me.photo_url} dark />
          </Pressable>
        </>
      )}
    />
  );
}

/**
 * Round 2b: the one floating "+ New trip" button (Gmail's Compose, Google Calendar's +): bottom right, above the tab bar.
 * With one choice it opens it; with two, a small sheet asks which. The pattern: components/patterns/NewTripFab.tsx.
 */
export function NewTripButton({ choices }: { choices: { key: string; label: string; onPress: () => void }[] }) {
  const { t } = useApp();
  return <NewTripFab label={t('office.home.newTrip')} choices={choices} />;
}

/**
 * A stack screen's top: the round back arrow (back means back) and the title, on the thin top bar (the approved mockups 2
 * and 3). `above` is the small grey line over the title ("Request · Fri 23 Oct"); `subtitle` stays under it as it always read.
 */
export function BackHeader({ title, subtitle, above, right }: { title: string; subtitle?: string; above?: string; right?: ReactNode }) {
  const router = useRouter();
  const { t } = useApp();
  useWebThemeColor(colors.page);
  return (
    <ThinBar
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/office'))}
      backLabel={t('common.back')}
      above={above ?? subtitle}
      aboveFirst={!!above}
      title={title}
      titleSize={22}
      right={right}
      testID="back-header"
    />
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
 * Sahan's removals (22 October 2026): `dotIcon` beside the dot says the severity by its shape too (never colour alone:
 * Issues' critical octagon, warning triangle, info circle); the icon then carries `dotLabel` for the screen reader.
 * Round 4–7, item 12: `look="list"` is the approved mockups' section: the title outside the card (the count beside it, a
 * red count chip for a red section), the link at the right, then one card whose rows run edge to edge with a divider
 * (rows take `inset`); `look="group"` one kind of a group of cards under one heading (Home's "Needs you now").
 */
export function Section({ title, count, link, onLink, tone, children, open, onToggle, dot, dotLabel, dotIcon: DotIcon, head, look: kind = 'card', testID }: {
  title: string;
  count?: number;
  link?: string;
  onLink?: () => void;
  tone?: 'red';
  children: ReactNode;
  look?: 'card' | 'list' | 'group';
  open?: boolean;
  onToggle?: () => void;
  dot?: Tone;
  dotLabel?: string;
  /** The severity's icon beside the dot (its shape says it; it carries `dotLabel`). */
  dotIcon?: LucideIcon;
  head?: ReactNode;
  testID?: string;
}) {
  // One kind of a group of cards under one heading (Home's "Needs you now"): the title small inside the card's top, the
  // link at its right, the rows edge to edge under it.
  if (kind === 'group') {
    return (
      <View style={styles.listCard} testID={testID}>
        <View style={styles.groupHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <Txt variant="label" color={tone === 'red' ? colors.red : colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{title.toUpperCase()}</Txt>
            {count !== undefined && <Mono size={13} bold color={tone === 'red' ? colors.red : colors.muted}>{`· ${count}`}</Mono>}
          </View>
          {link && onLink && (
            <Pressable accessibilityRole="button" onPress={onLink} hitSlop={10} style={(state) => [webHitSlop(10), hoverStyle(state)]}>
              <Txt variant="strong" size={15} color={colors.blue}>{link}</Txt>
            </Pressable>
          )}
        </View>
        {children}
      </View>
    );
  }
  if (kind === 'list') {
    return (
      <View style={{ gap: 10 }} testID={testID}>
        <View style={styles.listHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <Txt variant="strong" size={17} numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
              {tone !== 'red' && count !== undefined ? `${title} · ${count}` : title}
            </Txt>
            {tone === 'red' && count !== undefined && count > 0 ? (
              <View style={styles.countChip}><Mono size={12} bold color={colors.red}>{String(count)}</Mono></View>
            ) : null}
          </View>
          {link && onLink && (
            <Pressable accessibilityRole="button" onPress={onLink} hitSlop={10} style={(state) => [webHitSlop(10), hoverStyle(state)]}>
              <Txt variant="strong" size={15} color={colors.blue}>{link}</Txt>
            </Pressable>
          )}
        </View>
        <View style={styles.listCard}>{children}</View>
      </View>
    );
  }
  const label = (
    <>
      {onToggle ? (open === false ? <ChevronRight size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />) : null}
      {dot ? <View style={[styles.dot, { backgroundColor: TONES[dot].ink }]} accessibilityLabel={DotIcon ? undefined : dotLabel} /> : null}
      {dot && DotIcon ? (
        <View accessible accessibilityRole="image" accessibilityLabel={dotLabel} testID={testID ? `${testID}-severity` : undefined}>
          <DotIcon size={16} color={TONES[dot].ink} strokeWidth={2.4} />
        </View>
      ) : null}
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
export function Avatar({ name, size = 40, photo, dark = false }: { name: string; size?: number; /** The person's photo (a link); the initials without one. */ photo?: string; /** The signed-in person's own (ink, the approved mockup 1). */ dark?: boolean }) {
  if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.blueChip }} accessibilityLabel={name} />;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, dark && { backgroundColor: colors.ink }]}>
      <Txt variant="strong" size={Math.round(size * 0.36)} color={dark ? '#ffffff' : colors.blue}>{initials(name)}</Txt>
    </View>
  );
}

/**
 * A list row's short status at the right (Gmail's label): one short word, never a sentence; it never squeezes the title.
 * `icon` before the word marks a state of its own (Round 3 A6: Expired). Round 4–7, item 12: the pattern's RowChip.
 */
export const StatusChip = RowChip;

/**
 * The one list row (Gmail's list, 21 October 2026; Round 4–7, item 12: the approved mockups' list row,
 * components/patterns/ListRow.tsx): a time column, an icon or an avatar on the left; the title on ONE line; a grey second
 * line; at the right only a short chip, or a button. Used by every list in Office mode, on the phone and on /m/.
 */
export const Row = ListRow;

/** The browser's theme colour while this screen is in front (theme.ts setWebThemeColor; nothing on the phone): the colour
 *  of the screen's top, as the phone's status bar shows it. */
export function useWebThemeColor(color: string) {
  useFocusEffect(useCallback(() => setWebThemeColor(color), [color]));
}

/** A thin line between rows; `soft` inside the approved mockups' list cards (look="list"). */
export const Divider = ({ soft = false }: { soft?: boolean }) => <View style={[styles.divider, soft && { backgroundColor: look.divider }]} />;

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

/** The big buttons at the bottom of a stack screen, above the safe area (the snackbar above them while the screen is in
 *  front): the one sticky bar, components/patterns/BottomActionBar.tsx, with the screen's own buttons stacked in it. */
export function StickyActions({ children }: { children: ReactNode }) {
  return <BottomActionBar>{children}</BottomActionBar>;
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
  bellLight: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: look.ring },
  badgeSmall: { top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3 },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 8 },
  listCard: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, overflow: 'hidden' },
  countChip: { backgroundColor: colors.redChip, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingTop: 12, minHeight: 40 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  dark: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 16 },
  darkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bell: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  section: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  avatar: { backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: colors.line },
  errorBox: { backgroundColor: colors.redChip, borderRadius: 12, padding: 14, gap: 10 },
});
