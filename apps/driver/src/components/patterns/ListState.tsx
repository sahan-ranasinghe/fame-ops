// The list states (docs/ui-patterns.md §5): skeleton rows while the first answer is on its way (never a spinner in a
// list), the empty state that says what to do next, the error with Try again, "Couldn't refresh" over rows already
// shown, and Load more at the end.

import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import type { LucideIcon } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** The native animation driver exists only on a phone (react-native-web warns and falls back on every use). */
const NATIVE_DRIVER = Platform.OS !== 'web';

/** Grey bars the shape of the rows, gently pulsing. */
export function SkeletonRows({ rows = 4, lines = 2, testID = 'skeleton-rows' }: { rows?: number; lines?: number; testID?: string }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: NATIVE_DRIVER }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const { t } = useApp();
  return (
    <Animated.View style={{ gap: 14, opacity: pulse }} testID={testID} accessibilityLabel={t('patterns.loading')} accessible>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.avatar} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.bar, { width: i % 2 ? '62%' : '74%' }]} />
            {lines > 1 && <View style={[styles.bar, { width: i % 2 ? '44%' : '52%', height: 10 }]} />}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

/** What to do when there is nothing: the sentence and, when there is one, the action; `icon` above it (Round 4–7, item 8). */
export function ListEmpty({ text, action, onAction, icon: Icon }: { text: string; action?: string; onAction?: () => void; icon?: LucideIcon }) {
  return (
    <View style={styles.empty} testID="list-empty">
      {Icon ? <View style={{ alignItems: 'center' }} testID="list-empty-icon"><Icon size={32} color={colors.muted} strokeWidth={2} /></View> : null}
      <Txt variant="muted" style={{ textAlign: 'center' }}>{text}</Txt>
      {action && onAction ? <Button kind="outline" label={action} onPress={onAction} style={{ minHeight: 48, alignSelf: 'center', paddingHorizontal: 18 }} /> : null}
    </View>
  );
}

/** The server's sentence with Try again (with rows on screen: "Couldn't refresh" over them). */
export function ListError({ message, onRetry, stale = false }: { message: string; onRetry: () => void; stale?: boolean }) {
  const { t } = useApp();
  return (
    <View style={[styles.error, stale && { paddingVertical: 8 }]} testID="list-error">
      <Txt variant="strong" size={15} color={colors.red} style={{ flex: 1 }}>{stale ? t('patterns.couldntRefresh') : message}</Txt>
      <Button kind="outline" label={t('patterns.tryAgain')} onPress={onRetry} style={{ minHeight: 44, paddingHorizontal: 14 }} />
    </View>
  );
}

/** Load more at the end of a list the server pages; "25 of 140" beside it when the total is known. */
export function LoadMore({ shown, total, busy, onPress }: { shown: number; total?: number; busy: boolean; onPress: () => void }) {
  const { t } = useApp();
  return (
    <View style={{ gap: 6, alignItems: 'center' }}>
      <Button kind="outline" label={t('patterns.loadMore')} busy={busy} onPress={onPress} style={{ minHeight: 52, alignSelf: 'stretch' }} />
      {total !== undefined ? <Txt variant="small">{t('patterns.shownOf', { n: shown, total })}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e7e5df' },
  bar: { height: 14, borderRadius: 7, backgroundColor: '#e7e5df' },
  empty: { gap: 12, paddingVertical: 28, paddingHorizontal: 12 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.redChip, borderRadius: 14, padding: 12 },
});
