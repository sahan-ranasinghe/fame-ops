// Office mode (Phase 8, O1): the building blocks the office screens share, in the driver app's tokens and components
// (components/ui.tsx) and the designs' look (design/office): the dark header with the date and the bell, section cards
// with a title, a count and "View all", rows with an avatar, status pills, chips, a sticky action bar, and the one way a
// failed call is shown (a notice with Try again; a dropped write says it may not have been saved).

import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Bell, ChevronLeft } from '@/components/icons';
import { LanguagePill } from '@/components/LanguageSwitch';
import { ListError } from '@/components/patterns/ListState';
import { Button, Mono, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
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

/** A small rounded status word ("on the way", "waiting", "free"). */
export function Pill({ text, tone = 'muted', size = 14 }: { text: string; tone?: Tone; size?: number }) {
  const c = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Txt variant="strong" size={size} color={c.ink} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

/** A header chip ("3 on the road"): a number in mono and words. */
export function Chip({ n, text, tone = 'muted', onPress }: { n: number | string; text: string; tone?: Tone; onPress?: () => void }) {
  const c = TONES[tone];
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={[styles.chip, { backgroundColor: c.bg }]}>
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
  return (
    <View style={[styles.dark, { paddingTop: insets.top + 12 }]}>
      <View style={styles.darkTop}>
        <Txt variant="muted" size={15} color="#c9ccd1" style={{ flex: 1 }} numberOfLines={1}>{above}</Txt>
        <LanguagePill />
        {bell && <BellButton count={unread} onPress={() => router.push('/office/(tabs)/alerts')} />}
      </View>
      <Txt variant="title" color="#ffffff" style={{ marginTop: 14 }} numberOfLines={1}>{title}</Txt>
      {children}
    </View>
  );
}

/** The bell with the unread count (the Alerts badge; DarkHeader reads it from the office state). */
export function BellButton({ onPress, count = 0 }: { onPress: () => void; count?: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.bell}>
      <Bell size={22} color="#ffffff" strokeWidth={2.2} />
      {count > 0 && <Badge n={count} />}
    </Pressable>
  );
}

export function Badge({ n }: { n: number }) {
  return (
    <View style={styles.badge}>
      <Mono size={12} bold color="#ffffff">{n > 99 ? '99+' : String(n)}</Mono>
    </View>
  );
}

/** A stack screen's top: the back arrow (back means back) and the title. */
export function BackHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useApp();
  return (
    <View style={[styles.backHeader, { paddingTop: insets.top + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/office'))} style={styles.backBtn}>
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
export function Screen({ children, refreshing, onRefresh, bottom = 24, style }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottom?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={[{ padding: 16, gap: 14, paddingBottom: bottom }, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.amber]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** A section card (design 03): "NEEDS A DRIVER · 1" with a link on the right, then the rows. */
export function Section({ title, count, link, onLink, tone, children }: {
  title: string;
  count?: number;
  link?: string;
  onLink?: () => void;
  tone?: 'red';
  children: ReactNode;
}) {
  return (
    <View style={[styles.section, tone === 'red' && { borderColor: colors.red }]}>
      <View style={styles.sectionHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Txt variant="label" color={tone === 'red' ? colors.red : colors.muted} numberOfLines={1}>{title.toUpperCase()}</Txt>
          {count !== undefined && <Mono size={13} bold color={tone === 'red' ? colors.red : colors.muted}>{`· ${count}`}</Mono>}
        </View>
        {link && onLink && (
          <Pressable accessibilityRole="button" onPress={onLink} hitSlop={10}>
            <Txt variant="strong" size={16} color={colors.blue}>{link}</Txt>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/** The two-letter avatar of a person. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Txt variant="strong" size={Math.round(size * 0.38)} color={colors.blue}>{initials(name)}</Txt>
    </View>
  );
}

/** A tappable row: an avatar or a mono time on the left, a title and a line, and a pill or a button on the right. */
export function Row({ left, title, line, line2, right, onPress, testID }: {
  left?: ReactNode;
  title: string;
  line?: string;
  line2?: string;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}) {
  const inner = (
    <>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="strong" size={17} numberOfLines={2}>{title}</Txt>
        {line ? <Txt variant="muted" size={15} numberOfLines={2}>{line}</Txt> : null}
        {line2 ? <Txt variant="small" numberOfLines={2}>{line2}</Txt> : null}
      </View>
      {right}
    </>
  );
  if (!onPress) return <View style={styles.row} testID={testID}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      {inner}
    </Pressable>
  );
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
  return <View style={[styles.sticky, { paddingBottom: Math.max(insets.bottom, 12) }]}>{children}</View>;
}

/** A filter chip row ("All · 4", "On a task · 1"). */
export function FilterChips<K extends string>({ options, value, onChange }: { options: { key: K; label: string; n?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} style={[styles.filter, on && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
            <Txt variant="strong" size={15} color={on ? '#ffffff' : colors.ink}>{o.label}</Txt>
            {o.n !== undefined && <Mono size={14} bold color={on ? '#ffffff' : colors.muted}>{String(o.n)}</Mono>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  dark: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 22 },
  darkTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bell: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  backHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 12, backgroundColor: colors.page },
  backBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  section: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 4 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 6 },
  avatar: { backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 56 },
  divider: { height: 1, backgroundColor: colors.line },
  errorBox: { backgroundColor: colors.redChip, borderRadius: 12, padding: 14, gap: 10 },
  sticky: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 14, minHeight: 48 },
});
